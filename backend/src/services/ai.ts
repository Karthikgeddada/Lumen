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

async function post(path: string, body: unknown, signal?: AbortSignal) {
  const res = await fetch(`${config.ai.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
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

export async function embed(texts: string[]): Promise<number[][]> {
  const res = await post('/embeddings', {
    model: config.ai.embeddingModel,
    input: texts.map((t) => t.slice(0, 8000)),
  });
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
