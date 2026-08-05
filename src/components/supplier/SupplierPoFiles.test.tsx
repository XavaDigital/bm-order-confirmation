import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch } from '@/test/mockFetch';
import { SupplierPoFiles, type PoFileItem } from './SupplierPoFiles';

const CODE = 'DY';
const PO = 'PO-2608-DY01';
const FILES_URL = `/api/supplier/${CODE}/po/${PO}/files`;

function file(overrides: Partial<PoFileItem> = {}): PoFileItem {
  return {
    id: 'file-1',
    fileName: 'layout.pdf',
    sizeBytes: 1234,
    category: 'Layout',
    uploadedByKind: 'staff',
    uploadedByLabel: 'dana@example.com',
    statusAtUpload: 'pre_production',
    createdAt: '2026-08-01T10:00:00Z',
    downloadUrl: 'https://signed.example/layout.pdf',
    comments: [],
    ...overrides,
  };
}

function renderCard(items: PoFileItem[] | null, onUploaded = vi.fn().mockResolvedValue(undefined)) {
  render(
    <AntdApp>
      <SupplierPoFiles code={CODE} poNumber={PO} items={items} onUploaded={onUploaded} />
    </AntdApp>,
  );
  return onUploaded;
}

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SupplierPoFiles', () => {
  it('groups parent-supplied files by category with version counters', () => {
    renderCard([
      file({ id: 'f1', fileName: 'layout.ai', category: 'Layout' }),
      file({ id: 'f2', fileName: 'print-1.jpg', category: 'Test print', createdAt: '2026-08-02T10:00:00Z' }),
      file({ id: 'f3', fileName: 'print-2.jpg', category: 'Test print', createdAt: '2026-08-03T10:00:00Z' }),
    ]);
    expect(screen.getByText('layout.ai')).toBeInTheDocument();
    expect(screen.getAllByText(/^v\d$/).map((el) => el.textContent)).toEqual(['v1', 'v1', 'v2']);
  });

  it('disables upload until a category is picked or typed (server rejects without one)', async () => {
    const user = userEvent.setup();
    renderCard([]);

    const button = screen.getByRole('button', { name: /choose file & upload/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Pick or type a category first/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Category (required)'), 'Test print');
    expect(button).toBeEnabled();
    expect(screen.queryByText(/Pick or type a category first/)).not.toBeInTheDocument();
  });

  it('uploads with the category and asks the page to refresh the shared data', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch();
    addRoute({ match: FILES_URL, method: 'POST', status: 201, response: { id: 'file-9' } });
    const onUploaded = renderCard([]);

    await user.type(screen.getByPlaceholderText('Category (required)'), 'Test print');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['png-bytes'], 'print.png', { type: 'image/png' }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post?.[0]).toBe(FILES_URL);
      const body = post![1]!.body as FormData;
      expect((body.get('file') as File).name).toBe('print.png');
      expect(body.get('category')).toBe('Test print');
    });
    await vi.waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(await screen.findByText('print.png uploaded')).toBeInTheDocument();
  });

  it('surfaces the server 400 message when a missing category slips through', async () => {
    const user = userEvent.setup();
    const { addRoute } = installMockFetch();
    addRoute({
      match: FILES_URL,
      method: 'POST',
      status: 400,
      response: { error: 'A file category is required (e.g. Layout, Test print)' },
    });
    renderCard([]);

    await user.type(screen.getByPlaceholderText('Category (required)'), 'Layout');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'layout.ai'));

    expect(
      await screen.findByText('A file category is required (e.g. Layout, Test print)'),
    ).toBeInTheDocument();
  });

  it('shows a spinner while the page is still loading the files', () => {
    renderCard(null);
    expect(document.querySelector('.ant-spin')).toBeInTheDocument();
  });
});
