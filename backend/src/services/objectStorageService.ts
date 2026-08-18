import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const s3 = new S3Client({
  endpoint: process.env.OBJECT_STORE_ENDPOINT,
  region: 'auto',
  credentials: {
    accessKeyId: process.env.OBJECT_STORE_ACCESS_KEY ?? '',
    secretAccessKey: process.env.OBJECT_STORE_SECRET_KEY ?? '',
  },
});

const BUCKET = process.env.OBJECT_STORE_BUCKET ?? 'crew-management-assets';

export async function uploadBuffer(prefix: string, buffer: Buffer, contentType: string): Promise<string> {
  const key = `${prefix}/${randomUUID()}`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  return key;
}

export async function getSignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: expiresInSeconds });
}
