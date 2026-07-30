import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/lib/env';

/**
 * Storage is misconfigured or the provider rejected our credentials — a SERVER
 * setup problem, not a bad request. Routes surface this as a 503 with the
 * message (the `*UnavailableError` suffix is mapped by `defineRoute`), so a
 * dead access key says so instead of hiding behind a generic 500.
 */
export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

/**
 * S3 error codes that mean "your configuration/credentials are wrong" rather
 * than "this request failed". Anything not listed here (throttling, network
 * blips, 5xx from the provider) stays a genuine unexpected error.
 */
const CONFIG_ERROR_MESSAGES: Record<string, string> = {
  InvalidAccessKeyId:
    'File storage rejected the configured access key (it does not exist). Check AWS_S3_ACCESS_KEY.',
  UnrecognizedClientException:
    'File storage rejected the configured access key. Check AWS_S3_ACCESS_KEY.',
  SignatureDoesNotMatch:
    'File storage rejected the configured secret key (signature mismatch). Check AWS_S3_SECRET_ACCESS_KEY.',
  AccessDenied:
    'File storage denied access. The configured identity needs s3:PutObject, s3:GetObject and s3:DeleteObject on the bucket.',
  NoSuchBucket: 'The configured file-storage bucket does not exist. Check AWS_S3_BUCKET.',
  PermanentRedirect:
    'The file-storage bucket is in a different region. Check AWS_S3_REGION.',
  AuthorizationHeaderMalformed:
    'The file-storage bucket is in a different region. Check AWS_S3_REGION.',
  ExpiredToken: 'The file-storage credentials have expired.',
  InvalidToken: 'The file-storage credentials are no longer valid.',
  CredentialsProviderError:
    'File-storage credentials could not be resolved. Check AWS_S3_ACCESS_KEY / AWS_S3_SECRET_ACCESS_KEY.',
};

/**
 * Rethrow provider credential/config failures as StorageUnavailableError,
 * leaving everything else untouched for the caller's own handling.
 */
function rethrowConfigError(err: unknown): never {
  const name = (err as { name?: string })?.name;
  const message = name ? CONFIG_ERROR_MESSAGES[name] : undefined;
  if (message) throw new StorageUnavailableError(message);
  throw err;
}

function client(): S3Client {
  return new S3Client({
    region: env.AWS_S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: env.AWS_S3_ACCESS_KEY ?? '',
      secretAccessKey: env.AWS_S3_SECRET_ACCESS_KEY ?? '',
    },
    // Non-AWS providers (Supabase Storage) need an explicit endpoint and
    // path-style addressing — their S3 compat layer doesn't do virtual hosts.
    ...(env.AWS_S3_ENDPOINT && { endpoint: env.AWS_S3_ENDPOINT, forcePathStyle: true }),
  });
}

/**
 * True when object storage is fully configured. Credentials are checked too,
 * not just the bucket — a half-configured server should fail the up-front 503
 * gate rather than at upload time with a provider error.
 */
export function isStorageConfigured(): boolean {
  return Boolean(env.AWS_S3_BUCKET && env.AWS_S3_ACCESS_KEY && env.AWS_S3_SECRET_ACCESS_KEY);
}

function bucket(): string {
  const b = env.AWS_S3_BUCKET;
  if (!b) throw new StorageUnavailableError('AWS_S3_BUCKET is not configured');
  return b;
}

/** Upload a file buffer. Returns the storage key. */
export async function uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<string> {
  try {
    await client().send(
      new PutObjectCommand({ Bucket: bucket(), Key: key, Body: buffer, ContentType: mimeType }),
    );
  } catch (err) {
    rethrowConfigError(err);
  }
  return key;
}

/** Generate a temporary signed URL for private read access. */
export async function getSignedUrl(
  key: string,
  expiresInSeconds = 3600,
  responseHeaders?: { contentDisposition?: string },
): Promise<string> {
  return awsGetSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ...(responseHeaders?.contentDisposition && {
        ResponseContentDisposition: responseHeaders.contentDisposition,
      }),
    }),
    { expiresIn: expiresInSeconds },
  );
}

/** Delete a file from storage. */
export async function deleteFile(key: string): Promise<void> {
  try {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  } catch (err) {
    rethrowConfigError(err);
  }
}

/** Build a namespaced storage key for a mock-up image. */
export function mockupKey(orderId: string, garmentId: string, filename: string): string {
  return `mockups/${orderId}/${garmentId}/${filename}`;
}

/** Build a namespaced storage key for a mock-up image's generated thumbnail (always .webp). */
export function mockupThumbnailKey(orderId: string, garmentId: string, filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  return `mockups/${orderId}/${garmentId}/thumb-${base}.webp`;
}

/** Build a namespaced storage key for a signature image. */
export function signatureKey(orderId: string, filename: string): string {
  return `signatures/${orderId}/${filename}`;
}

/** Build a namespaced storage key for a reference size chart file. */
export function sizeChartKey(filename: string): string {
  return `size-charts/${filename}`;
}
