import { config } from '../config';

// Minimal OpenAI-compatible client (works with OpenAI, Azure gateways,
// OpenRouter, Together…). Raw fetch — no SDK lock-in.

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export function hasAI(): boolean {
  return Boolean(config.ai.apiKey);
}

export function aiUnavailableMessage(): string {
  return 'The AI provider is not configured on this deployment. Set AI_PROVIDER_API_KEY (and optionally AI_BASE_URL / AI_CHAT_MODEL) on the backend to enable AI features.';
}

// Every provider call is time-capped (default 60 s, AI_TIMEOUT_MS): a hung
// upstream must never pin a worker. The cap covers connect + response headers;
// once a chat stream has started, token reads are not capped (known limit).
function asTimeoutError(err: unknown): Error | null {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new Error(
      `AI provider timed out after ${Math.round(config.ai.timeoutMs / 1000)}s — the request to ${config.ai.baseUrl} was aborted.`,
    );
  }
  return null;
}

async function post(path: string, body: unknown, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${config.ai.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(config.ai.timeoutMs),
    });
  } catch (err) {
    throw asTimeoutError(err) ?? err;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AI provider error ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

export async function chat(messages: ChatMessage[], opts: { temperature?: number } = {}): Promise<string> {
  const res = await post('/chat/completions', {
    model: config.ai.chatModel,
    messages,
    temperature: opts.temperature ?? 0.2,
  });
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

// Streaming chat — yields token deltas parsed from provider SSE.
export async function* chatStream(messages: ChatMessage[]): AsyncGenerator<string> {
  const res = await post('/chat/completions', {
    model: config.ai.chatModel,
    messages,
    stream: true,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const delta = JSON.parse(payload) as {
          choices: { delta: { content?: string } }[];
        };
        const piece = delta.choices?.[0]?.delta?.content;
        if (piece) yield piece;
      } catch {
        /* ignore keep-alive / partial frames */
      }
    }
  }
}

// Local open-source embeddings (AI_EMBEDDING_BASE_URL=local): the model runs
// in-process via transformers.js — no API, no key, no cost.
// e.g. Xenova/all-MiniLM-L6-v2 (384-dim, ONNX quantized).
let localEmbedder: Promise<(texts: string[]) => Promise<number[][]>> | null = null;
function getLocalEmbedder(model: string) {
  localEmbedder ??= (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    const extractor = (await pipeline('feature-extraction', model)) as unknown as (
      texts: string[],
      opts: { pooling: 'mean'; normalize: boolean },
    ) => Promise<{ tolist(): number[][] }>;
    return async (texts: string[]) =>
      (await extractor(texts, { pooling: 'mean', normalize: true })).tolist();
  })();
  return localEmbedder;
}

export async function embed(texts: string[]): Promise<number[][]> {
  const input = texts.map((t) => t.slice(0, 8000));
  if (config.ai.embeddingBaseUrl === 'local') {
    const run = await getLocalEmbedder(config.ai.embeddingModel);
    return run(input);
  }
  const base = config.ai.embeddingBaseUrl || config.ai.baseUrl;
  let res: Response;
  try {
    res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({ model: config.ai.embeddingModel, input }),
      signal: AbortSignal.timeout(config.ai.timeoutMs),
    });
  } catch (err) {
    throw asTimeoutError(err) ?? err;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AI provider error ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data.map((d) => d.embedding);
}

// Chat that must answer with a single JSON object. Falls back to extracting
// the first {...} block if the model wraps the JSON in prose or fences.
export async function chatJson<T>(messages: ChatMessage[]): Promise<T | null> {
  const raw = await chat([
    ...messages,
    {
      role: 'system',
      content:
        'Respond with a single valid JSON object only. No markdown fences, no prose before or after.',
    },
  ]);
  const attempts = [raw, raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)];
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as T;
    } catch {
      /* try next */
    }
  }
  return null;
}
