import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, timingSafeEqual } from 'crypto';
import { Readable } from 'stream';
import { config } from '../config';
import { prisma } from '../prisma';

// Storage mode: 's3' when STORAGE_* S3/R2 vars are set (or STORAGE_DRIVER=s3);
// otherwise 'db' — files are stored in the Postgres database itself.
// Open-source Postgres as the object store, zero external services; S3/R2
// remains the drop-in upgrade. Uploaded documents are permanent customer data
// — they never live on the ephemeral Render filesystem in either mode.
const useDb =
  config.storage.driver === 'db' ||
  (config.storage.driver !== 's3' && !(config.storage.bucket && config.storage.accessKey));

export function storageMode(): 's3' | 'db' {
  return useDb ? 'db' : 's3';
}

// Works with any S3-compatible object storage (AWS S3, R2, B2, MinIO…).
// Uploaded documents are permanent customer data — they never live on the
// ephemeral Render filesystem.

const client = new S3Client({
  region: config.storage.region,
  endpoint: config.storage.endpoint || undefined,
  forcePathStyle: Boolean(config.storage.endpoint && !config.storage.endpoint.includes('amazonaws.com')),
  credentials: {
    accessKeyId: config.storage.accessKey,
    secretAccessKey: config.storage.secretKey,
  },
});

export function storageKey(workspaceId: string, documentId: string, ext: string): string {
  return `workspaces/${workspaceId}/documents/${documentId}/original.${ext}`;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  if (useDb) {
    await prisma.storedObject.upsert({
      where: { key },
      update: { data: body, contentType, sizeBytes: body.length },
      create: { key, data: body, contentType, sizeBytes: body.length },
    });
    return;
  }
  await client.send(
    new PutObjectCommand({ Bucket: config.storage.bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObject(key: string): Promise<Buffer> {
  if (useDb) {
    const row = await prisma.storedObject.findUnique({ where: { key } });
    if (!row) throw new Error(`Stored object not found: ${key}`);
    return Buffer.from(row.data);
  }
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: config.storage.bucket, Key: key }));
    const stream = res.Body as Readable;
    const parts: Buffer[] = [];
    for await (const chunk of stream) parts.push(chunk as Buffer);
    return Buffer.concat(parts);
  } catch (err) {
    // Objects uploaded before S3 mode was enabled still live in Postgres.
    // Serve them from the DB and lazily copy them to S3 so the workspace can
    // move to object storage without any downtime or manual migration.
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
      const row = await prisma.storedObject.findUnique({ where: { key } });
      if (!row) throw new Error(`Stored object not found: ${key}`);
      const body = Buffer.from(row.data);
      void client
        .send(new PutObjectCommand({ Bucket: config.storage.bucket, Key: key, Body: body, ContentType: row.contentType }))
        .catch(() => {});
      return body;
    }
    throw err;
  }
}

// Fetch a stored object's bytes + type directly (db-mode streaming endpoint).
export async function dbGetObject(key: string): Promise<{ data: Buffer; contentType: string } | null> {
  const row = await prisma.storedObject.findUnique({
    where: { key },
    select: { data: true, contentType: true },
  });
  return row ? { data: Buffer.from(row.data), contentType: row.contentType } : null;
}

// Time-limited signed download URL — the file itself stays private. In S3
// mode this is a presigned URL; in db mode it is an HMAC-signed link to the
// streaming endpoint in the documents router (same trust model: anyone
// holding the link has access until it expires).
function fileToken(docId: string, exp: number): string {
  return createHmac('sha256', process.env.AUTH_SECRET || 'lumen').update(`${docId}.${exp}`).digest('hex');
}

export function verifyFileToken(docId: string, t: string | undefined): boolean {
  if (!t) return false;
  const dot = t.indexOf('.');
  if (dot < 1) return false;
  const exp = Number(t.slice(0, dot));
  const sig = t.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = Buffer.from(fileToken(docId, exp));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function presignedDownloadUrl(key: string, filename: string, ttlSec = 300): Promise<string> {
  if (useDb) {
    // key format: workspaces/<workspaceId>/documents/<documentId>/original.<ext>
    const docId = key.split('/')[3];
    const exp = Date.now() + ttlSec * 1000;
    const name = encodeURIComponent(filename);
    const base = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_API_URL || '';
    return `${base}/api/documents/${docId}/file?t=${exp}.${fileToken(docId, exp)}&name=${name}`;
  }
  const cmd = new GetObjectCommand({
    Bucket: config.storage.bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\]/g, '')}"`,
  });
  return getSignedUrl(client, cmd, { expiresIn: ttlSec });
}

export async function deleteObject(key: string): Promise<void> {
  if (useDb) {
    await prisma.storedObject.deleteMany({ where: { key } });
    return;
  }
  await client.send(new DeleteObjectCommand({ Bucket: config.storage.bucket, Key: key }));
  // Also clear any legacy DB copy of the same object.
  await prisma.storedObject.deleteMany({ where: { key } }).catch(() => {});
}
