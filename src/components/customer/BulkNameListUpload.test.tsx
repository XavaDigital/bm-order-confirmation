import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkNameListUpload } from './BulkNameListUpload';

function csvFile(content: string, name = 'names.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

/** The hidden input antd's Upload.Dragger renders. */
function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]')!;
}

describe('BulkNameListUpload', () => {
  it('shows the column guidance and a template download button', () => {
    render(<BulkNameListUpload garmentName="Hoodie" onImport={vi.fn()} />);

    expect(screen.getByText('Bulk upload names')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download template/ })).toBeInTheDocument();
    // The guidance names both columns and the format.
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Number')).toBeInTheDocument();
    expect(screen.getByText(/Drag your Hoodie sheet here/)).toBeInTheDocument();
  });

  it('parses a dropped CSV and reports what the import did', async () => {
    const onImport = vi.fn().mockResolvedValue({ added: 2, duplicates: 1 });
    const { container } = render(
      <BulkNameListUpload garmentName="Hoodie" onImport={onImport} />,
    );

    await userEvent.upload(
      fileInput(container),
      csvFile('Name,Number\nAlex,7\nBillie,\nAlex,7\n,9'),
    );

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledWith([
      { name: 'Alex', playerNumber: '7' },
      { name: 'Billie', playerNumber: null },
      { name: 'Alex', playerNumber: '7' },
    ]);
    expect(
      await screen.findByText('Added 2 names · 1 already on the list · 1 blank row ignored'),
    ).toBeInTheDocument();
  });

  it('surfaces a parse error inline without calling onImport', async () => {
    const onImport = vi.fn();
    const { container } = render(
      <BulkNameListUpload garmentName="Hoodie" onImport={onImport} />,
    );

    await userEvent.upload(fileInput(container), csvFile('Colour,Size\nRed,M'));

    expect(await screen.findByText(/No "Name" column found/)).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('surfaces an import failure (e.g. locked roster) thrown by the caller', async () => {
    const onImport = vi.fn().mockRejectedValue(new Error('This roster is locked.'));
    const { container } = render(
      <BulkNameListUpload garmentName="Hoodie" onImport={onImport} />,
    );

    await userEvent.upload(fileInput(container), csvFile('Name\nAlex'));

    expect(await screen.findByText('This roster is locked.')).toBeInTheDocument();
  });
});
