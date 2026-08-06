'use client';

/**
 * The revision stepper on the supplier PO detail page (David: suppliers "step
 * through the revisions so they can see what changed"). Renders nothing while
 * the PO has a single revision — the subtitle already names it.
 *
 * Shows "Revision N of M" with ‹ › steppers, the viewed revision's reason and
 * date, an older-revision notice when N < M, and the compact "what changed
 * since revision N-1" summary computed by po-diff.ts. The highlights
 * themselves live in SupplierPoContent; this card is the legend.
 */
import { Alert, Button, Card, Space, Tag, Typography } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { formatDate } from '@/lib/format';
import { CARD_STYLE, CARD_BODY_STYLES } from '@/components/customer/customerStyles';

const { Text } = Typography;

export interface PoRevisionInfo {
  revisionNumber: number;
  reason: string | null;
  createdAt: string;
}

export interface PoRevisionStepperProps {
  revisions: PoRevisionInfo[];
  /** The revision currently displayed. */
  current: number;
  /** Blocks the steppers while a revision (or its predecessor) is loading. */
  loading?: boolean;
  /**
   * "What changed" lines vs the previous revision (diff.summary). Null while
   * unavailable (revision 1, or the predecessor still loading).
   */
  summary: string[] | null;
  onChange: (revisionNumber: number) => void;
}

export function PoRevisionStepper({
  revisions,
  current,
  loading,
  summary,
  onChange,
}: PoRevisionStepperProps) {
  if (revisions.length < 2) return null;

  const latest = revisions[revisions.length - 1].revisionNumber;
  const shown = revisions.find((r) => r.revisionNumber === current);
  const first = revisions[0].revisionNumber;

  return (
    <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Space size={8}>
          <Button
            size="small"
            icon={<LeftOutlined />}
            aria-label="Previous revision"
            disabled={loading || current <= first}
            onClick={() => onChange(current - 1)}
          />
          <Text strong style={{ color: 'rgba(255,255,255,0.92)' }}>
            Revision {current} of {latest}
          </Text>
          <Button
            size="small"
            icon={<RightOutlined />}
            aria-label="Next revision"
            disabled={loading || current >= latest}
            onClick={() => onChange(current + 1)}
          />
        </Space>
        {shown && (
          <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
            {formatDate(shown.createdAt)}
            {shown.reason ? ` — ${shown.reason}` : ''}
          </Text>
        )}
      </div>

      {current < latest && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12 }}
          message={`You are viewing an older revision — revision ${latest} is the current one.`}
        />
      )}

      {current > first && summary !== null && (
        <div style={{ marginTop: 12 }}>
          <Text
            style={{
              display: 'block',
              color: 'rgba(255,255,255,0.65)',
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 6,
            }}
          >
            Changed since revision {current - 1}
          </Text>
          {summary.length === 0 ? (
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
              No content changes — the garments and sizing are identical to revision {current - 1}.
            </Text>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {summary.map((line, i) => (
                <li key={i} style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginBottom: 2 }}>
                  {line}
                </li>
              ))}
            </ul>
          )}
          <Space size={10} style={{ marginTop: 8 }}>
            <Tag color="gold" style={{ marginInlineEnd: 0 }}>
              changed
            </Tag>
            <Tag color="green" style={{ marginInlineEnd: 0 }}>
              added
            </Tag>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
              Highlights below mark what differs from revision {current - 1}. Removed items appear
              only in this list.
            </Text>
          </Space>
        </div>
      )}
    </Card>
  );
}
