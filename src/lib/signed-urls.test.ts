import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSignedUrlMock } = vi.hoisted(() => ({ getSignedUrlMock: vi.fn() }));
vi.mock('@/lib/storage', () => ({ getSignedUrl: getSignedUrlMock }));

import { signImageRefs, signChartRefs } from './signed-urls';

beforeEach(() => {
  getSignedUrlMock.mockReset();
});

describe('signImageRefs', () => {
  it('signs both the original and a distinct thumbnail when thumbnailStorageKey is present', async () => {
    getSignedUrlMock.mockImplementation((key: string) => Promise.resolve(`signed:${key}`));

    const [img] = await signImageRefs([
      { id: 'img-1', storageKey: 'mockups/a.png', thumbnailStorageKey: 'mockups/thumb-a.webp' },
    ]);

    expect(img.url).toBe('signed:mockups/a.png');
    expect(img.thumbnailUrl).toBe('signed:mockups/thumb-a.webp');
  });

  it('falls back to the original url when there is no thumbnailStorageKey', async () => {
    getSignedUrlMock.mockImplementation((key: string) => Promise.resolve(`signed:${key}`));

    const [img] = await signImageRefs([{ id: 'img-1', storageKey: 'mockups/a.png', thumbnailStorageKey: null }]);

    expect(img.url).toBe('signed:mockups/a.png');
    expect(img.thumbnailUrl).toBe('signed:mockups/a.png');
  });

  it('returns empty strings for both urls when signing fails', async () => {
    getSignedUrlMock.mockRejectedValueOnce(new Error('storage not configured'));

    const [img] = await signImageRefs([{ id: 'img-1', storageKey: 'mockups/a.png', thumbnailStorageKey: 'mockups/thumb-a.webp' }]);

    expect(img.url).toBe('');
    expect(img.thumbnailUrl).toBe('');
  });
});

describe('signChartRefs', () => {
  it('returns null url/downloadUrl when there is no storageKey', async () => {
    const [chart] = await signChartRefs([{ name: 'Unlinked chart', storageKey: null }]);
    expect(chart).toEqual({ name: 'Unlinked chart', storageKey: null, url: null, downloadUrl: null });
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });
});
