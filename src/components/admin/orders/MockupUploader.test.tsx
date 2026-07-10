import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { MockupUploader, type MockupImage } from './MockupUploader';

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
  vi.stubGlobal('fetch', vi.fn());
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
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => image({ id: 'img-new', caption: null }),
    } as Response);
    const { container } = renderUploader([]);

    const file = new File(['bytes'], 'mockup.png', { type: 'image/png' });
    await user.upload(fileInput(container), file);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/admin/orders/order-1/garments/garment-1/images');
    expect(init).toMatchObject({ method: 'POST' });
    expect((init!.body as FormData).get('file')).toBe(file);

    expect(await screen.findByText('Image uploaded')).toBeInTheDocument();
  });

  it('includes the caption field entered before uploading', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => image() } as Response);
    const { container } = renderUploader([]);

    await user.type(screen.getByPlaceholderText('Caption (optional)'), 'Back view');
    await user.upload(fileInput(container), new File(['bytes'], 'mockup.png', { type: 'image/png' }));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init!.body as FormData).get('caption')).toBe('Back view');
  });

  it('selecting two files in one batch uploads both and reports the combined success count', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => image({ id: 'img-1' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => image({ id: 'img-2' }) } as Response);
    const { container } = renderUploader([]);

    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ];
    await user.upload(fileInput(container), files);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('2 images uploaded')).toBeInTheDocument();
  });

  it('reports partial failure counts when one of two uploads fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => image({ id: 'img-1' }) } as Response)
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Too large' }) } as Response);
    const { container } = renderUploader([]);

    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ];
    await user.upload(fileInput(container), files);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Image uploaded')).toBeInTheDocument();
    expect(await screen.findByText('Failed to upload 1 image')).toBeInTheDocument();
  });

  it('deleting an image confirms, then DELETEs it and removes it from the grid', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    renderUploader([image({ id: 'img-1', caption: 'Front view' })]);

    await user.click(screen.getByRole('button', { name: /delete/i }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/orders/order-1/garments/garment-1/images/img-1',
      { method: 'DELETE' },
    );
    expect(await screen.findByText('Image removed')).toBeInTheDocument();
    expect(screen.queryByText('Front view')).not.toBeInTheDocument();
    expect(screen.getByText('No mock-ups uploaded yet')).toBeInTheDocument();
  });

  it('shows an error message and keeps the image when deletion fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    renderUploader([image({ id: 'img-1', caption: 'Front view' })]);

    await user.click(screen.getByRole('button', { name: /delete/i }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Failed to remove image')).toBeInTheDocument();
    expect(screen.getByText('Front view')).toBeInTheDocument();
  });
});
