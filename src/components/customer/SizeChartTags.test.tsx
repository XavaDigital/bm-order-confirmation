import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SizeChartTags } from './SizeChartTags';

const charts = [
  {
    name: 'Adult Sizing',
    url: 'https://x/adult.pdf',
    storageKey: 'charts/adult.pdf',
    downloadUrl: 'https://x/adult.pdf',
  },
];

describe('SizeChartTags', () => {
  it('renders nothing when there are no charts', () => {
    const { container } = render(
      <SizeChartTags charts={[]} onPreview={vi.fn()} labelIcon={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('exposes a clickable chart as a keyboard-reachable button', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    render(<SizeChartTags charts={charts} onPreview={onPreview} labelIcon={null} />);

    const chip = screen.getByRole('button', { name: /preview size chart: adult sizing/i });
    await user.click(chip);
    expect(onPreview).toHaveBeenCalledWith(charts[0]);
  });

  it('opens the preview on Enter and Space from the keyboard', async () => {
    const onPreview = vi.fn();
    render(<SizeChartTags charts={charts} onPreview={onPreview} labelIcon={null} />);

    const chip = screen.getByRole('button', { name: /preview size chart: adult sizing/i });
    chip.focus();
    await userEvent.keyboard('{Enter}');
    expect(onPreview).toHaveBeenCalledTimes(1);

    await userEvent.keyboard(' ');
    expect(onPreview).toHaveBeenCalledTimes(2);
  });

  it('renders a chart without a signed URL as inert (no button role)', () => {
    render(
      <SizeChartTags
        charts={[{ name: 'Missing File', url: null, storageKey: null, downloadUrl: null }]}
        onPreview={vi.fn()}
        labelIcon={null}
      />,
    );

    expect(screen.getByText('Missing File')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /missing file/i })).not.toBeInTheDocument();
  });
});
