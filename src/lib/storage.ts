import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';

function client(): S3Client {
  return new S3Client({
    region: process.env.AWS_S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY ?? '',
    },
  });
}

function bucket(): string {
  return process.env.AWS_S3_BUCKET ?? '';
}

/** Upload a file buffer. Returns the storage key. */
export async function uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<string> {
  await client().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: buffer, ContentType: mimeType }),
  );
  return key;
}

/** Generate a temporary signed URL for private read access. */
export async function getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  return awsGetSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

/** Delete a file from storage. */
export async function deleteFile(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/** Build a namespaced storage key for a mock-up image. */
export function mockupKey(orderId: string, garmentId: string, filename: string): string {
  return `mockups/${orderId}/${garmentId}/${filename}`;
}

/** Build a namespaced storage key for a signature image. */
export function signatureKey(orderId: string, filename: string): string {
  return `signatures/${orderId}/${filename}`;
}

/** Build a namespaced storage key for a reference size chart file. */
export function sizeChartKey(filename: string): string {
  return `size-charts/${filename}`;
}
