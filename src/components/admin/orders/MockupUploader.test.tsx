import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch } from '@/test/mockFetch';
import { MockupUploader, type MockupImage } from './MockupUploader';

const IMAGES_URL = '/api/admin/orders/order-1/garments/garment-1/images';

function image(overrides: Partial<MockupImage> = {}): MockupImage {
  return {
    id: 'img-1',
    storageKey: 'orders/1/mockup.png',
    caption: null,
    sortOrder: 0,
    url: 'https://signed.example.com/mockup.png',
    ...overrides,
  };
}

function renderUploader(initialImages: MockupImage[] = []) {
  return render(
    <AntdApp>
      <MockupUploader orderId="order-1" garmentId="garment-1" initialImages={initialImages} />
    </AntdApp>,
  );
}

function fileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  // Default: any request throws loudly; tests install their own routes.
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MockupUploader', () => {
  it('shows an empty state when there are no images', () => {
    renderUploader([]);
    expect(screen.getByText('No mock-ups uploaded yet')).toBeInTheDocument();
  });

  it('renders existing images with their captions', () => {
    renderUploader([image({ caption: 'Front view' })]);
    expect(screen.queryByText('No mock-ups uploaded yet')).not.toBeInTheDocument();
    expect(screen.getByText('Front view')).toBeInTheDocument();
    expect(screen.getByAltText('Front view')).toHaveAttribute('src', 'https://signed.example.com/mockup.png');
  });

  it('uploading a single image POSTs it and appends it to the grid', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      { match: IMAGES_URL, method: 'POST', response: image({ id: 'img-new', caption: null }) },
    ]);
    const { container } = renderUploader([]);

    const file = new File(['bytes'], 'mockup.png', { type: 'image/png' });
    await user.upload(fileInput(container), file);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(IMAGES_URL);
    expect(init).toMatchObject({ method: 'POST' });
    expect((init!.body as FormData).get('file')).toBe(file);

    expect(await screen.findByText('Image uploaded')).toBeInTheDocument();
  });

  // Captions are added AFTER upload, per image (David, 2026-08-03) — the
  // pre-upload caption input is gone and the upload carries no caption field.
  it('uploads without a caption and edits it in place afterwards', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      { match: IMAGES_URL, method: 'POST', response: image({ id: 'img-9', caption: null }) },
      {
        match: `${IMAGES_URL}/img-9`,
        method: 'PATCH',
        response: { id: 'img-9', caption: 'Back view' },
      },
    ]);
    const { container } = renderUploader([]);

    expect(screen.queryByPlaceholderText('Caption (optional)')).not.toBeInTheDocument();
    await user.upload(fileInput(container), new File(['bytes'], 'mockup.png', { type: 'image/png' }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0][1]!.body as FormData).get('caption')).toBeNull();

    await user.click(await screen.findByRole('button', { name: /add caption/i }));
    await user.type(screen.getByPlaceholderText('Caption'), 'Back view');
    await user.keyboard('{Enter}');

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
    expect(body.caption).toBe('Back view');
    expect(await screen.findByText('Back view')).toBeInTheDocument();
  });

  it('selecting two files in one batch uploads both and reports the combined success count', async () => {
    const user = userEvent.setup();
    let uploadCount = 0;
    const { fetchMock } = installMockFetch([
      { match: IMAGES_URL, method: 'POST', response: () => image({ id: `img-${++uploadCount}` }) },
    ]);
    const { container } = renderUploader([]);

    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ];
    await user.upload(fileInput(container), files);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('2 images uploaded')).toBeInTheDocument();
  });

  it('reports partial failure counts when one of two uploads fails', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      // Baseline: uploads fail…
      { match: IMAGES_URL, method: 'POST', status: 400, response: { error: 'Too large' } },
      // …except the first one (once-routes are matched first, then consumed).
      { match: IMAGES_URL, method: 'POST', once: true, response: image({ id: 'img-1' }) },
    ]);
    const { container } = renderUploader([]);

    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ];
    await user.upload(fileInput(container), files);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Image uploaded')).toBeInTheDocument();
    expect(await screen.findByText(/Failed to upload 1 image/)).toBeInTheDocument();
  });

  it('deleting an image confirms, then DELETEs it and removes it from the grid', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([
      { match: `${IMAGES_URL}/img-1`, method: 'DELETE', response: { ok: true } },
    ]);
    renderUploader([image({ id: 'img-1', caption: 'Front view' })]);

    await user.click(screen.getByRole('button', { name: /delete/i }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/garments/garment-1/images/img-1',
      { method: 'DELETE' },
    );
    expect(await screen.findByText('Image removed')).toBeInTheDocument();
    expect(screen.queryByText('Front view')).not.toBeInTheDocument();
    expect(screen.getByText('No mock-ups uploaded yet')).toBeInTheDocument();
  });

  it('shows an error message and keeps the image when deletion fails', async () => {
    const user = userEvent.setup();
    installMockFetch([
      { match: `${IMAGES_URL}/img-1`, method: 'DELETE', status: 500, response: {} },
    ]);
    renderUploader([image({ id: 'img-1', caption: 'Front view' })]);

    await user.click(screen.getByRole('button', { name: /delete/i }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Failed to remove image')).toBeInTheDocument();
    expect(screen.getByText('Front view')).toBeInTheDocument();
  });
});
