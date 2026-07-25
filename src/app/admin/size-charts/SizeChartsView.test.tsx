import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { installMockFetch, type MockRoute } from '@/test/mockFetch';
import { SizeChartsView } from './SizeChartsView';

function chart(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chart-1',
    name: 'Adult Unisex',
    description: null,
    storageKey: 'charts/adult.pdf',
    createdAt: '2026-06-01T10:00:00Z',
    url: 'https://signed.example.com/adult.pdf',
    ...overrides,
  };
}

function chartsRoute(charts: ReturnType<typeof chart>[]): MockRoute {
  return { match: '/api/admin/size-charts', method: 'GET', response: charts };
}

function renderView(role: 'sales' | 'admin' = 'admin') {
  return render(
    <AntdApp>
      <SizeChartsView role={role} />
    </AntdApp>,
  );
}

function fileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

// antd's Modal leave-transition waits for a real transitionend event before
// unmounting, which jsdom never dispatches on its own — sweep for the leaving
// nodes and fire it manually, retrying until the dialog is actually gone.
async function waitForModalToClose() {
  await vi.waitFor(() => {
    document
      .querySelectorAll('.ant-zoom-leave-active, .ant-fade-leave-active')
      .forEach((el) => fireEvent.transitionEnd(el));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
}

beforeEach(() => {
  // Default: any request throws loudly; tests install their own routes.
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SizeChartsView', () => {
  it('fetches and renders a row per chart', async () => {
    const { fetchMock } = installMockFetch([chartsRoute([chart()])]);
    renderView();

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/size-charts');
    expect(await screen.findByText('Adult Unisex')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
  });

  it('shows an "Image" type tag for a non-PDF storage key', async () => {
    installMockFetch([chartsRoute([chart({ storageKey: 'charts/kids.png' })])]);
    renderView();

    expect(await screen.findByText('Image')).toBeInTheDocument();
  });

  it('shows a dash for a chart with no description', async () => {
    installMockFetch([chartsRoute([chart({ description: null })])]);
    renderView();

    const row = (await screen.findByText('Adult Unisex')).closest('tr')!;
    expect(row).toHaveTextContent('—');
  });

  it('shows the empty-library message when there are no charts', async () => {
    installMockFetch([chartsRoute([])]);
    renderView();

    expect(await screen.findByText(/no size charts yet/i)).toBeInTheDocument();
  });

  it('shows an error message when the initial fetch fails', async () => {
    installMockFetch([{ match: '/api/admin/size-charts', method: 'GET', status: 500, response: {} }]);
    renderView();

    expect(await screen.findByText('Failed to load size charts')).toBeInTheDocument();
  });

  it('does not show a View button for a chart with no signed url', async () => {
    installMockFetch([chartsRoute([chart({ url: null })])]);
    renderView();

    await screen.findByText('Adult Unisex');
    expect(screen.queryByRole('button', { name: /eye/i })).not.toBeInTheDocument();
  });

  it('viewing a PDF chart opens a preview modal with an iframe', async () => {
    const user = userEvent.setup();
    installMockFetch([chartsRoute([chart({ storageKey: 'charts/adult.pdf', url: 'https://signed.example.com/adult.pdf' })])]);
    renderView();
    await screen.findByText('Adult Unisex');

    await user.click(screen.getByRole('button', { name: /eye/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTitle('Adult Unisex')).toHaveAttribute('src', 'https://signed.example.com/adult.pdf');
  });

  it('viewing an image chart opens a preview modal with an image', async () => {
    const user = userEvent.setup();
    installMockFetch([chartsRoute([chart({ storageKey: 'charts/kids.png', url: 'https://signed.example.com/kids.png' })])]);
    renderView();
    await screen.findByText('Adult Unisex');

    await user.click(screen.getByRole('button', { name: /eye/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByAltText('Adult Unisex')).toHaveAttribute('src', 'https://signed.example.com/kids.png');
  });

  it('uploading a chart with a selected file POSTs the form and prepends the new chart', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([chartsRoute([])]);
    renderView();
    await screen.findByText(/no size charts yet/i);

    await user.click(screen.getByRole('button', { name: /upload chart/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('Adult Unisex Jersey'), 'Youth Unisex');
    await user.upload(fileInput(dialog), new File(['bytes'], 'youth.pdf', { type: 'application/pdf' }));

    addRoute({
      match: '/api/admin/size-charts',
      method: 'POST',
      response: chart({ id: 'chart-2', name: 'Youth Unisex', storageKey: 'charts/youth.pdf' }),
    });
    await user.click(within(dialog).getByRole('button', { name: /^upload$/i }));

    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/admin/size-charts');
    expect(init).toMatchObject({ method: 'POST' });
    expect((init!.body as FormData).get('name')).toBe('Youth Unisex');
    expect((init!.body as FormData).get('file')).toBeInstanceOf(File);
    expect(await screen.findByText('"Youth Unisex" uploaded')).toBeInTheDocument();
    expect(screen.getByText('Youth Unisex')).toBeInTheDocument();
  });

  it('shows an error message when the upload request fails', async () => {
    const user = userEvent.setup();
    const { addRoute } = installMockFetch([chartsRoute([])]);
    renderView();
    await screen.findByText(/no size charts yet/i);

    await user.click(screen.getByRole('button', { name: /upload chart/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('Adult Unisex Jersey'), 'Youth Unisex');
    await user.upload(fileInput(dialog), new File(['bytes'], 'youth.pdf', { type: 'application/pdf' }));

    addRoute({
      match: '/api/admin/size-charts',
      method: 'POST',
      status: 400,
      response: { error: 'File too large' },
    });
    await user.click(within(dialog).getByRole('button', { name: /^upload$/i }));

    expect(await screen.findByText('File too large')).toBeInTheDocument();
  });

  it('editing a chart pre-fills the form, saves via PATCH, and updates the row', async () => {
    const user = userEvent.setup();
    const { fetchMock, addRoute } = installMockFetch([chartsRoute([chart()])]);
    renderView();
    await screen.findByText('Adult Unisex');

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('Adult Unisex')).toBeInTheDocument();

    const nameInput = within(dialog).getByDisplayValue('Adult Unisex');
    await user.clear(nameInput);
    await user.type(nameInput, 'Adult Unisex V2');

    addRoute({
      match: '/api/admin/size-charts/chart-1',
      method: 'PATCH',
      response: chart({ name: 'Adult Unisex V2' }),
    });
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));

    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/size-charts/chart-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Adult Unisex V2', description: '', sizes: [] }),
    });
    expect(await screen.findByText('Chart updated')).toBeInTheDocument();
    expect(screen.getByText('Adult Unisex V2')).toBeInTheDocument();
  });

  it('shows an error message when saving an edit fails', async () => {
    const user = userEvent.setup();
    const { addRoute } = installMockFetch([chartsRoute([chart()])]);
    renderView();
    await screen.findByText('Adult Unisex');

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');

    addRoute({ match: '/api/admin/size-charts/chart-1', method: 'PATCH', status: 500, response: {} });
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('Failed to save changes')).toBeInTheDocument();
  });

  it('deleting a chart with no linked garments shows a plain success message', async () => {
    const user = userEvent.setup();
    const { addRoute } = installMockFetch([chartsRoute([chart()])]);
    renderView();
    await screen.findByText('Adult Unisex');

    addRoute({
      match: '/api/admin/size-charts/chart-1',
      method: 'DELETE',
      response: { linkedGarmentCount: 0 },
    });
    await user.click(screen.getByRole('button', { name: /delete/i }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('"Adult Unisex" deleted')).toBeInTheDocument();
    expect(screen.queryByText('Adult Unisex')).not.toBeInTheDocument();
  });

  it('deleting a chart that is linked to garments shows a warning with the count', async () => {
    const user = userEvent.setup();
    const { addRoute } = installMockFetch([chartsRoute([chart()])]);
    renderView();
    await screen.findByText('Adult Unisex');

    addRoute({
      match: '/api/admin/size-charts/chart-1',
      method: 'DELETE',
      response: { linkedGarmentCount: 3 },
    });
    await user.click(screen.getByRole('button', { name: /delete/i }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/linked to 3 garment\(s\)/)).toBeInTheDocument();
  });

  it('shows an error message when deleting fails', async () => {
    const user = userEvent.setup();
    const { addRoute } = installMockFetch([chartsRoute([chart()])]);
    renderView();
    await screen.findByText('Adult Unisex');

    addRoute({ match: '/api/admin/size-charts/chart-1', method: 'DELETE', status: 500, response: {} });
    await user.click(screen.getByRole('button', { name: /delete/i }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Failed to delete chart')).toBeInTheDocument();
    expect(screen.getByText('Adult Unisex')).toBeInTheDocument();
  });

  it('hides the upload button and edit/delete row actions for a sales-role session', async () => {
    installMockFetch([chartsRoute([chart()])]);
    renderView('sales');
    await screen.findByText('Adult Unisex');

    expect(screen.queryByRole('button', { name: /upload chart/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    // View is still available — sales keeps read access.
    expect(screen.getByRole('button', { name: /eye/i })).toBeInTheDocument();
  });

  it('closing the upload modal without saving does not call fetch again', async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockFetch([chartsRoute([])]);
    renderView();
    await screen.findByText(/no size charts yet/i);

    await user.click(screen.getByRole('button', { name: /upload chart/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
    await waitForModalToClose();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
