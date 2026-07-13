'use client';

import { Space, Table, Tag, Typography } from 'antd';
import type { ColumnType } from 'antd/es/table';

export interface SizingRow {
  size: string | null;
  playerName: string | null;
  playerNumber: string | null;
  notes: string | null;
  viaTeamRoster?: boolean;
}

const columns: ColumnType<SizingRow & { _key: string }>[] = [
  {
    title: 'Size',
    dataIndex: 'size',
    width: 80,
    render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
  },
  {
    title: 'Player Name',
    dataIndex: 'playerName',
    render: (_: string | null, record: SizingRow) => (
      <Space size={8} wrap>
        {record.playerName ?? <Typography.Text type="secondary">—</Typography.Text>}
        {record.viaTeamRoster ? (
          <Tag color="processing" style={{ marginInlineEnd: 0 }}>
            via team roster
          </Tag>
        ) : null}
      </Space>
    ),
  },
  {
    title: '#',
    dataIndex: 'playerNumber',
    width: 60,
    render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
  },
  {
    title: 'Notes',
    dataIndex: 'notes',
    render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
  },
];

export function SizingTableReadOnly({ rows }: { rows: SizingRow[] }) {
  if (rows.length === 0) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        No sizing specified
      </Typography.Text>
    );
  }

  const data = rows.map((r, i) => ({ ...r, _key: String(i) }));

  return (
    <Table
      dataSource={data}
      columns={columns}
      rowKey="_key"
      pagination={false}
      size="small"
      style={{
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 6,
      }}
    />
  );
}
