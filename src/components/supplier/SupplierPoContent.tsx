'use client';

/**
 * Everything the factory needs from one PO snapshot, rendered identically on
 * BOTH supplier surfaces — the password portal detail page
 * (/supplier/[code]/po/[poNumber]) and the legacy per-PO token link (/s/[token]) —
 * so the two can never drift (David, 2026-08-05).
 *
 * Per garment: name/type, fabrics (labeled picks + legacy list), EVERY garment
 * option (blank values render as a dash — they must always be displayed), the
 * mock-up image grid, size charts with download links, and the sizing table
 * carrying EVERY captured sizing column plus Size/Player/Number/Qty/Notes —
 * headers always render, even when a column is blank throughout. Then the
 * order-level design/font asset list.
 *
 * Renders ONLY from the immutable PoSnapshot (signed per request), never live
 * order rows.
 */
import { Card, Space, Table, Tag, Typography } from 'antd';
import type { ColumnType } from 'antd/es/table';
import {
  DownloadOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  LinkOutlined,
  PaperClipOutlined,
} from '@ant-design/icons';
import type { PoSnapshot, PoSnapshotGarment, PoSnapshotLine } from '@/db/schema';
import { ASSET_KIND_COLOR, ASSET_KIND_LABEL } from '@/lib/asset-kind';
import { CARD_STYLE, CARD_BODY_STYLES, GARMENT_BOX_STYLE } from '@/components/customer/customerStyles';
import {
  garmentUnits,
  lineColumnDescriptors,
  optionEntries,
  type SignedPoAsset,
  type SignedPoImage,
  type SignedPoSizeChart,
} from './po-view-helpers';

const { Text } = Typography;

const dash = <Text style={{ color: 'rgba(255,255,255,0.45)' }}>—</Text>;

function LabelValue({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 2 }}>
      <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, width: 140, flexShrink: 0 }}>
        {label}
      </Text>
      <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>
        {value.trim() ? value : '—'}
      </Text>
    </div>
  );
}

function GarmentImages({ images }: { images: SignedPoImage[] }) {
  const withUrl = images.filter((img) => img.url || img.thumbnailUrl);
  if (withUrl.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '10px 0 4px' }}>
      {withUrl.map((img) => {
        const full = img.url ?? img.thumbnailUrl!;
        const thumb = img.thumbnailUrl ?? img.url!;
        return (
          <a
            key={img.id}
            href={full}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'block', width: 110, textAlign: 'center' }}
            aria-label={img.caption ? `Open image: ${img.caption}` : 'Open garment image'}
          >
            {/* Signed S3 URLs — next/image needs remote-pattern config, plain img is the customer-surface convention. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt={img.caption ?? 'Garment mock-up'}
              style={{
                width: 110,
                height: 110,
                objectFit: 'contain',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
              }}
            />
            {img.caption && (
              <Text
                style={{
                  color: 'rgba(255,255,255,0.55)',
                  fontSize: 11,
                  display: 'block',
                  marginTop: 2,
                }}
              >
                {img.caption}
              </Text>
            )}
          </a>
        );
      })}
    </div>
  );
}

function GarmentSizeCharts({ charts }: { charts: SignedPoSizeChart[] }) {
  if (charts.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 2 }}>
      <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, width: 140, flexShrink: 0 }}>
        Size charts
      </Text>
      <Space wrap size={6}>
        {charts.map((chart) =>
          chart.downloadUrl ? (
            <a key={chart.id} href={chart.downloadUrl} download aria-label={`Download size chart: ${chart.name}`}>
              <Tag
                icon={chart.storageKey?.endsWith('.pdf') ? <FilePdfOutlined /> : <FileImageOutlined />}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: 'rgba(255,255,255,0.85)',
                  cursor: 'pointer',
                  marginInlineEnd: 0,
                }}
              >
                {chart.name} <DownloadOutlined />
              </Tag>
            </a>
          ) : (
            <Tag
              key={chart.id}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.5)',
                marginInlineEnd: 0,
              }}
            >
              {chart.name}
            </Tag>
          ),
        )}
      </Space>
    </div>
  );
}

function GarmentBlock({ garment }: { garment: PoSnapshotGarment }) {
  const units = garmentUnits(garment);
  const columns: ColumnType<PoSnapshotLine>[] = lineColumnDescriptors(garment).map(
    (descriptor) => ({
      title: descriptor.label,
      key: descriptor.key,
      render: (_: unknown, line: PoSnapshotLine) => {
        const value = descriptor.getValue(line);
        return value.trim() ? value : dash;
      },
    }),
  );

  return (
    <div style={GARMENT_BOX_STYLE}>
      <div style={{ marginBottom: 10 }}>
        <Text strong style={{ color: 'rgba(255,255,255,0.92)', fontSize: 15 }}>
          {garment.name}
        </Text>
        {garment.garmentTypeName && (
          <Text style={{ color: 'rgba(255,255,255,0.5)', marginLeft: 10 }}>
            {garment.garmentTypeName}
          </Text>
        )}
        <Text style={{ color: 'rgba(255,255,255,0.5)', marginLeft: 10, fontSize: 12 }}>
          {units} unit{units === 1 ? '' : 's'}
        </Text>
      </div>

      {/* Fabrics: labeled picks (typed garments) plus the legacy free-text list. */}
      {optionEntries(garment.selectedFabrics).map(({ label, value }) => (
        <LabelValue key={`fabric:${label}`} label={label} value={value} />
      ))}
      {garment.fabrics.length > 0 && (
        <LabelValue label="Fabrics" value={garment.fabrics.join(', ')} />
      )}

      {/* EVERY garment option, blank or not. */}
      {optionEntries(garment.selectedOptions).map(({ label, value }) => (
        <LabelValue key={`option:${label}`} label={label} value={value} />
      ))}

      <GarmentSizeCharts charts={(garment.sizeCharts ?? []) as SignedPoSizeChart[]} />

      {garment.notes && <LabelValue label="Notes" value={garment.notes} />}

      <GarmentImages images={(garment.images ?? []) as SignedPoImage[]} />

      <Table
        dataSource={garment.lines}
        columns={columns}
        rowKey="sizingRowId"
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        style={{ marginTop: 10, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}
        locale={{ emptyText: 'No sizing rows in this revision' }}
      />
    </div>
  );
}

function AssetRow({ asset }: { asset: SignedPoAsset }) {
  const link = asset.downloadUrl ?? asset.url;
  return (
    <div>
      <Space size={6} wrap>
        <Tag color={ASSET_KIND_COLOR[asset.kind]} style={{ marginInlineEnd: 0 }}>
          {ASSET_KIND_LABEL[asset.kind]}
        </Tag>
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: '#fff' }}>
            <Space size={4}>
              {asset.storageKey ? <PaperClipOutlined /> : <LinkOutlined />}
              {asset.name}
            </Space>
          </a>
        ) : (
          <Text style={{ color: 'rgba(255,255,255,0.9)' }}>{asset.name}</Text>
        )}
        {asset.garmentName && (
          <Text style={{ color: 'rgba(255,255,255,0.45)' }}>({asset.garmentName})</Text>
        )}
        {asset.usage && <Text style={{ color: 'rgba(255,255,255,0.45)' }}>for {asset.usage}</Text>}
      </Space>
      {asset.notes && (
        <div>
          <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{asset.notes}</Text>
        </div>
      )}
    </div>
  );
}

export interface SupplierPoContentProps {
  snapshot: PoSnapshot;
}

/** The garments card + the design/font files card for one PO snapshot. */
export function SupplierPoContent({ snapshot }: SupplierPoContentProps) {
  const assets = (snapshot.assets ?? []) as SignedPoAsset[];
  return (
    <>
      <Card title="Order contents" style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        {snapshot.reprintOfOrderNumber && (
          <div style={{ marginBottom: 12 }}>
            <Text style={{ color: 'rgba(255,255,255,0.55)' }}>
              Reprint of {snapshot.reprintOfOrderNumber} — the prior layout can be reused.
            </Text>
          </div>
        )}
        {snapshot.garments.map((garment) => (
          <GarmentBlock key={garment.garmentId} garment={garment} />
        ))}
      </Card>

      {assets.length > 0 && (
        <Card title="Design & font files" style={CARD_STYLE} styles={CARD_BODY_STYLES}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {assets.map((asset, i) => (
              <AssetRow key={`${asset.name}-${i}`} asset={asset} />
            ))}
          </Space>
        </Card>
      )}
    </>
  );
}
