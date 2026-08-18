import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { randomUUID } from 'crypto';

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

export async function uploadBuffer(prefix: string, buffer: Buffer, contentType: string): Promise<string> {
  const key = `${prefix}/${randomUUID()}`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  return key;
}

export async function getSignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  return getSignedUrl(signingClient, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: expiresInSeconds });
}
