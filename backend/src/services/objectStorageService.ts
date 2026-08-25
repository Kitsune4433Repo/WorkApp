import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';

const credentials = {
  accessKeyId: process.env.OBJECT_STORE_ACCESS_KEY ?? '',
  secretAccessKey: process.env.OBJECT_STORE_SECRET_KEY ?? '',
};
const region = process.env.OBJECT_STORE_REGION ?? 'auto';

// Without OBJECT_STORE_ENDPOINT set (e.g. the R2 credentials haven't been added to the deploy yet),
// the SDK falls back to resolving a real AWS endpoint for the bogus 'auto' region and can hang on a
// slow/failed connection for minutes with no explicit timeout — which just looks like the upload
// spinner never finishing. These bound that to a clear failure instead.
const requestHandler = new NodeHttpHandler({ connectionTimeout: 10_000, requestTimeout: 30_000 });

// Path-style addressing is required for MinIO/local dev; AWS S3 also accepts it.
const s3 = new S3Client({ endpoint: process.env.OBJECT_STORE_ENDPOINT, region, forcePathStyle: true, credentials, requestHandler });

// In docker-compose, the backend reaches object storage over the internal service hostname
// (OBJECT_STORE_ENDPOINT), but a signed URL handed to a browser/mobile client must resolve from
// outside the network — OBJECT_STORE_PUBLIC_ENDPOINT covers that split; in production both are
// typically the same public S3-compatible endpoint.
const signingClient = new S3Client({
  endpoint: process.env.OBJECT_STORE_PUBLIC_ENDPOINT ?? process.env.OBJECT_STORE_ENDPOINT,
  region,
  forcePathStyle: true,
  credentials,
  requestHandler,
});

const BUCKET = process.env.OBJECT_STORE_BUCKET ?? 'crew-management-assets';

// Turns an opaque AWS SDK/network failure into a message an admin (not a developer with log
// access) can actually act on — this is what the "Failed to upload" banner shows, so it's the only
// diagnostic a live deploy without shell/log access has for "did I set the R2 vars up right?".
function describeUploadFailure(err: unknown): string {
  if (!process.env.OBJECT_STORE_ENDPOINT) {
    return 'Object storage isn’t configured yet (OBJECT_STORE_ENDPOINT is unset) — set OBJECT_STORE_ENDPOINT/ACCESS_KEY/SECRET_KEY in your deploy’s environment variables.';
  }
  const name = (err as { name?: string })?.name ?? '';
  const code = (err as { Code?: string })?.Code ?? (err as { code?: string })?.code ?? '';
  const message = err instanceof Error ? err.message : String(err);
  if (name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return `Couldn’t reach the object storage endpoint (${process.env.OBJECT_STORE_ENDPOINT}) — check that OBJECT_STORE_ENDPOINT is correct and reachable.`;
  }
  if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch' || name === 'CredentialsProviderError') {
    return 'Object storage rejected the credentials — check OBJECT_STORE_ACCESS_KEY/SECRET_KEY.';
  }
  if (code === 'NoSuchBucket') {
    return `Bucket "${BUCKET}" doesn’t exist at that endpoint — check OBJECT_STORE_BUCKET and that the bucket was actually created.`;
  }
  return `Object storage upload failed: ${message}`;
}

export async function uploadBuffer(prefix: string, buffer: Buffer, contentType: string): Promise<string> {
  const key = `${prefix}/${randomUUID()}`;
  try {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  } catch (err) {
    throw new Error(describeUploadFailure(err));
  }
  return key;
}

// filename, when given, is what the browser saves the file as (e.g. on a right-click "Save As" or
// Android's download-to-storage) — object keys are bare random ids with no extension, so without
// this every saved file lands as an unrecognizable, extension-less name instead of the document's
// title. 'inline' (not 'attachment') keeps images/PDFs opening in-place, matching current behavior.
export async function getSignedDownloadUrl(key: string, expiresInSeconds = 3600, filename?: string): Promise<string> {
  return getSignedUrl(
    signingClient,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(filename ? { ResponseContentDisposition: `inline; filename="${filename.replace(/"/g, "'")}"` } : {}),
    }),
    { expiresIn: expiresInSeconds },
  );
}

// For server-side zipping (bulk "download selected/all resources") — unlike getSignedDownloadUrl,
// this fetches the bytes directly since a zip archive is assembled on the backend, not the browser.
export async function getObjectStream(key: string): Promise<Readable> {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Body as Readable;
}

// Best-effort: an orphaned object left behind in the bucket is harmless, whereas failing the whole
// delete because storage happened to be briefly unreachable would leave the DB row stuck too.
export async function deleteObject(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    console.warn(`[objectStorageService] failed to delete ${key} from the bucket:`, err instanceof Error ? err.message : err);
  }
}
