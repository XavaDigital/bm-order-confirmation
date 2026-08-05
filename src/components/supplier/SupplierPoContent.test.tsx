import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PoSnapshot, PoSnapshotAsset, PoSnapshotImage, PoSnapshotSizeChart } from '@/db/schema';
import { SupplierPoContent } from './SupplierPoContent';

/** A signed snapshot the way the supplier views receive it (post-signing). */
function snapshot(overrides: Partial<PoSnapshot> = {}): PoSnapshot {
  return {
    orderNumber: 'OC-ABCD1234',
    garments: [
      {
        garmentId: 'g-1',
        name: 'Home Jersey',
        garmentTypeId: 't-1',
        garmentTypeName: 'Pullover Hoodie',
        fabrics: ['Legacy Poly'],
        selectedFabrics: { 'Outer Fabric': 'Cotton Fleece' },
        // One filled, one BLANK — the blank one must still render its label.
        selectedOptions: { 'Zip Type': 'pullover', 'Cord Color': '' },
        sizingColumns: [{ label: 'Colour', type: 'text' }],
        sizeCharts: [
          // Extra signed fields (downloadUrl) ride along at runtime — assert
          // through the base type the way the views receive them.
          {
            id: 'c-1',
            name: 'Adult Hoodie Chart',
            storageKey: 'charts/adult.pdf',
            downloadUrl: 'https://signed.example/chart.pdf',
          } as PoSnapshotSizeChart,
        ],
        images: [
          {
            id: 'i-1',
            storageKey: 'images/front.png',
            thumbnailStorageKey: 'images/front-thumb.png',
            caption: 'Front mock-up',
            url: 'https://signed.example/front.png',
            thumbnailUrl: 'https://signed.example/front-thumb.png',
          } as PoSnapshotImage,
        ],
        notes: 'Tight collar',
        lines: [
          {
            sizingRowId: 'r-1',
            size: 'M',
            playerName: 'Alex',
            playerNumber: '7',
            quantity: 2,
            notes: null,
            // No Colour value — the column header must render regardless.
            customValues: null,
          },
        ],
      },
    ],
    assets: [
      {
        kind: 'font',
        name: 'Block Numbers',
        usage: 'playerNumber',
        url: null,
        storageKey: 'assets/font.ttf',
        notes: null,
        garmentName: 'Home Jersey',
        downloadUrl: 'https://signed.example/font.ttf',
      } as PoSnapshotAsset,
    ],
    ...overrides,
  };
}

describe('SupplierPoContent', () => {
  it('renders every sizing column header even when its values are blank', () => {
    render(<SupplierPoContent snapshot={snapshot()} />);
    for (const header of ['Size', 'Player Name', 'Number', 'Qty', 'Colour', 'Notes']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('renders every garment option label, blank values included', () => {
    render(<SupplierPoContent snapshot={snapshot()} />);
    expect(screen.getByText('Zip Type')).toBeInTheDocument();
    expect(screen.getByText('pullover')).toBeInTheDocument();
    // The blank option still shows its label (value renders as a dash).
    expect(screen.getByText('Cord Color')).toBeInTheDocument();
  });

  it('shows fabrics — labeled picks and the legacy list', () => {
    render(<SupplierPoContent snapshot={snapshot()} />);
    expect(screen.getByText('Outer Fabric')).toBeInTheDocument();
    expect(screen.getByText('Cotton Fleece')).toBeInTheDocument();
    expect(screen.getByText('Legacy Poly')).toBeInTheDocument();
  });

  it('links size charts for download and images to their signed URLs', () => {
    render(<SupplierPoContent snapshot={snapshot()} />);

    const chartLink = screen.getByRole('link', { name: /Download size chart: Adult Hoodie Chart/ });
    expect(chartLink).toHaveAttribute('href', 'https://signed.example/chart.pdf');

    const image = screen.getByAltText('Front mock-up');
    expect(image).toHaveAttribute('src', 'https://signed.example/front-thumb.png');
    expect(image.closest('a')).toHaveAttribute('href', 'https://signed.example/front.png');
  });

  it('lists design/font assets with kind label and signed link', () => {
    render(<SupplierPoContent snapshot={snapshot()} />);
    expect(screen.getByText('Font')).toBeInTheDocument();
    const assetLink = screen.getByRole('link', { name: /Block Numbers/ });
    expect(assetLink).toHaveAttribute('href', 'https://signed.example/font.ttf');
    expect(screen.getByText('for playerNumber')).toBeInTheDocument();
  });

  it('tolerates a minimal legacy snapshot (no images, charts, columns or assets)', () => {
    render(
      <SupplierPoContent
        snapshot={{
          orderNumber: 'OC-LEGACY',
          garments: [
            {
              garmentId: 'g-9',
              name: 'Old Shorts',
              garmentTypeId: null,
              garmentTypeName: null,
              fabrics: [],
              selectedFabrics: null,
              selectedOptions: null,
              notes: null,
              lines: [],
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('Old Shorts')).toBeInTheDocument();
    expect(screen.getByText('No sizing rows in this revision')).toBeInTheDocument();
    expect(screen.queryByText('Design & font files')).not.toBeInTheDocument();
  });
});
