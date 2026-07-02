import { beforeEach, describe, expect, it, vi } from 'vitest';

const { send, S3ClientMock, PutObjectCommandMock, DeleteObjectCommandMock, GetObjectCommandMock, getSignedUrlMock } =
  vi.hoisted(() => {
    const send = vi.fn().mockResolvedValue({});
    const S3ClientMock = vi.fn(function S3Client() {
      return { send };
    });
    const PutObjectCommandMock = vi.fn(function PutObjectCommand(input: unknown) {
      return { __type: 'PutObjectCommand', input };
    });
    const DeleteObjectCommandMock = vi.fn(function DeleteObjectCommand(input: unknown) {
      return { __type: 'DeleteObjectCommand', input };
    });
    const GetObjectCommandMock = vi.fn(function GetObjectCommand(input: unknown) {
      return { __type: 'GetObjectCommand', input };
    });
    const getSignedUrlMock = vi.fn().mockResolvedValue('https://signed.example.com/mock');
    return { send, S3ClientMock, PutObjectCommandMock, DeleteObjectCommandMock, GetObjectCommandMock, getSignedUrlMock };
  });

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: S3ClientMock,
  PutObjectCommand: PutObjectCommandMock,
  DeleteObjectCommand: DeleteObjectCommandMock,
  GetObjectCommand: GetObjectCommandMock,
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: getSignedUrlMock }));

vi.mock('@/lib/env', () => ({
  env: {
    AWS_S3_BUCKET: 'test-bucket' as string | undefined,
    AWS_S3_REGION: 'us-east-1',
    AWS_S3_ACCESS_KEY: 'key',
    AWS_S3_SECRET_ACCESS_KEY: 'secret',
  },
}));

import { env } from '@/lib/env';
import { uploadFile, getSignedUrl, deleteFile, mockupKey, signatureKey, sizeChartKey } from './storage';

beforeEach(() => {
  send.mockClear();
  S3ClientMock.mockClear();
  PutObjectCommandMock.mockClear();
  DeleteObjectCommandMock.mockClear();
  GetObjectCommandMock.mockClear();
  getSignedUrlMock.mockClear();
  env.AWS_S3_BUCKET = 'test-bucket';
});

describe('uploadFile', () => {
  it('sends a PutObjectCommand with the bucket, key, body and content type, and returns the key', async () => {
    const buffer = Buffer.from('hello');
    const result = await uploadFile('mockups/a/b/c.png', buffer, 'image/png');

    expect(result).toBe('mockups/a/b/c.png');
    expect(PutObjectCommandMock).toHaveBeenCalledWith({
      Bucket: 'test-bucket',
      Key: 'mockups/a/b/c.png',
      Body: buffer,
      ContentType: 'image/png',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('throws when AWS_S3_BUCKET is not configured', async () => {
    env.AWS_S3_BUCKET = undefined;
    await expect(uploadFile('x.png', Buffer.from('x'), 'image/png')).rejects.toThrow('AWS_S3_BUCKET is not configured');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('deleteFile', () => {
  it('sends a DeleteObjectCommand with the bucket and key', async () => {
    await deleteFile('mockups/a/b/c.png');

    expect(DeleteObjectCommandMock).toHaveBeenCalledWith({ Bucket: 'test-bucket', Key: 'mockups/a/b/c.png' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('getSignedUrl', () => {
  it('requests a signed url with the default 1-hour expiry', async () => {
    const url = await getSignedUrl('mockups/a/b/c.png');

    expect(url).toBe('https://signed.example.com/mock');
    expect(GetObjectCommandMock).toHaveBeenCalledWith({ Bucket: 'test-bucket', Key: 'mockups/a/b/c.png' });
    expect(getSignedUrlMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 3600 });
  });

  it('respects a custom expiry', async () => {
    await getSignedUrl('mockups/a/b/c.png', 900);
    expect(getSignedUrlMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 900 });
  });

  it('sets ResponseContentDisposition when provided', async () => {
    await getSignedUrl('mockups/a/b/c.png', 3600, { contentDisposition: 'attachment; filename="c.png"' });

    expect(GetObjectCommandMock).toHaveBeenCalledWith({
      Bucket: 'test-bucket',
      Key: 'mockups/a/b/c.png',
      ResponseContentDisposition: 'attachment; filename="c.png"',
    });
  });
});

describe('key builders', () => {
  it('mockupKey namespaces by order and garment', () => {
    expect(mockupKey('order-1', 'garment-1', 'a.png')).toBe('mockups/order-1/garment-1/a.png');
  });

  it('signatureKey namespaces by order', () => {
    expect(signatureKey('order-1', 'sig.png')).toBe('signatures/order-1/sig.png');
  });

  it('sizeChartKey has no namespace prefix beyond size-charts/', () => {
    expect(sizeChartKey('chart.pdf')).toBe('size-charts/chart.pdf');
  });
});
