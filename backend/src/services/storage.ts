import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { config } from '../config';

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
  await client.send(
    new PutObjectCommand({ Bucket: config.storage.bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await client.send(new GetObjectCommand({ Bucket: config.storage.bucket, Key: key }));
  const stream = res.Body as Readable;
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

// Time-limited signed download URL — the file itself stays private.
export async function presignedDownloadUrl(key: string, filename: string, ttlSec = 300): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: config.storage.bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\]/g, '')}"`,
  });
  return getSignedUrl(client, cmd, { expiresIn: ttlSec });
}

export async function deleteObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: config.storage.bucket, Key: key }));
}
