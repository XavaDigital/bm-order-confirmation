'use client';

import { useState } from 'react';
import {
  ConfigProvider,
  Typography,
  Card,
  Descriptions,
  Divider,
  Input,
  Space,
  Alert,
  Tag,
  message,
} from 'antd';
import {
  BgColorsOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  ExclamationCircleFilled,
  FilePdfOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { darkTheme, BRAND } from '@/lib/theme';
import { formatDateLong, formatCurrency, formatDateTimeLong } from '@/lib/format';
import { SALES_REP_LABEL } from '@/lib/config';
import { pushOrderConfirmed } from '@/lib/gtm';
import type { OrderGarment, SizeChartLink } from '@/types/customer';
import { MockupGallery } from '@/components/customer/MockupGallery';
import { SizingTableReadOnly } from '@/components/customer/SizingTableReadOnly';
import {
  AcknowledgmentPanel,
  ACKNOWLEDGMENTS,
} from '@/components/customer/AcknowledgmentPanel';
import { ShippingAddressField } from '@/components/customer/ShippingAddressField';
import { SignaturePad, type SignatureData } from '@/components/customer/SignaturePad';
import { ConfirmButton } from '@/components/customer/ConfirmButton';
import { RequestChangesModal } from '@/components/customer/RequestChangesModal';
import { RequestColorSampleModal } from '@/components/customer/RequestColorSampleModal';
import { StatusPage } from '@/components/customer/StatusPage';
import { CustomerPageShell } from '@/components/customer/CustomerPageShell';
import { SectionHeading } from '@/components/customer/SectionHeading';
import { SizeChartTags } from '@/components/customer/SizeChartTags';
import { SizeChartPreviewModal } from '@/components/customer/SizeChartPreviewModal';
import {
  CARD_STYLE,
  CARD_BODY_STYLES,
  DESCRIPTIONS_STYLES,
  FIELD_LABEL_STYLE,
  WARNING_SURFACE_STYLE,
} from '@/components/customer/customerStyles';

const { Title, Text, Paragraph } = Typography;

export interface CustomerOrderViewProps {
  token: string;
  order: {
    id: string;
    orderNumber: string;
    customerName: string;
    customerEmail: string;
    clubName: string | null;
    status: string;
    orderValueAmount: string | null;
    orderValueCurrency: string;
    invoiceUrl: string | null;
    expectedShipDate: string | null;
    deadlineDate: string | null;
    generalNotes: string | null;
    shippingMode: 'prefilled' | 'customer_entered' | 'later';
    shippingAddress: unknown;
    colorSampleRequested: boolean;
    rosterSummary?: {
      total: number;
      submitted: number;
      pending: number;
    };
    garments: OrderGarment[];
  };
}

// ---------------------------------------------------------------------------
// Already confirmed panel
// ---------------------------------------------------------------------------
function AlreadyConfirmedPanel({ orderNumber }: { orderNumber: string }) {
  return (
    <StatusPage icon={<CheckCircleFilled style={{ fontSize: 64, color: '#52c41a', marginBottom: 24 }} />}>
      <Title style={{ color: '#fff', marginBottom: 8 }}>Order Confirmed</Title>
      <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 16 }}>
        Order <strong style={{ color: '#fff' }}>{orderNumber}</strong> has already been
        confirmed. No further action is required.
      </Text>
    </StatusPage>
  );
}

// ---------------------------------------------------------------------------
// Success panel shown after confirming
// ---------------------------------------------------------------------------
function SuccessPanel({
  orderNumber,
  confirmedAt,
}: {
  orderNumber: string;
  confirmedAt: string;
}) {
  return (
    <StatusPage icon={<CheckCircleFilled style={{ fontSize: 72, color: '#52c41a', marginBottom: 24 }} />} maxWidth={520}>
      <Title
        style={{
          color: '#fff',
          fontSize: 40,
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        Confirmed
      </Title>
      <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 18, display: 'block', marginBottom: 8 }}>
        Order <strong style={{ color: '#fff' }}>{orderNumber}</strong> has been confirmed.
      </Text>
      <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
        {formatDateTimeLong(confirmedAt)}
      </Text>
      <Paragraph style={{ color: 'rgba(255,255,255,0.55)', marginTop: 32, fontSize: 14 }}>
        Thank you. Your {SALES_REP_LABEL} will be in touch with next steps.
      </Paragraph>
    </StatusPage>
  );
}

// ---------------------------------------------------------------------------
// Panel shown after customer submits a changes request
// ---------------------------------------------------------------------------
function ChangesRequestedPanel({ orderNumber }: { orderNumber: string }) {
  return (
    <StatusPage icon={<ExclamationCircleFilled style={{ fontSize: 72, color: '#faad14', marginBottom: 24 }} />} maxWidth={520}>
      <Title
        style={{
          color: '#fff',
          fontSize: 34,
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        Changes Requested
      </Title>
      <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 18, display: 'block', marginBottom: 8 }}>
        Your request for order <strong style={{ color: '#fff' }}>{orderNumber}</strong> has been received.
      </Text>
      <Paragraph style={{ color: 'rgba(255,255,255,0.55)', marginTop: 24, fontSize: 14 }}>
        Your {SALES_REP_LABEL} will review your request and be in touch shortly.
      </Paragraph>
    </StatusPage>
  );
}

// ---------------------------------------------------------------------------
// Main confirmation view
// ---------------------------------------------------------------------------
export function CustomerOrderView({ token, order }: CustomerOrderViewProps) {
  const [checkedAcks, setCheckedAcks] = useState<Set<string>>(new Set());
  const [concerns, setConcerns] = useState('');
  const [shippingAddress, setShippingAddress] = useState<Record<string, unknown> | null>(null);
  const [signature, setSignature] = useState<SignatureData>({ dataUrl: null, type: 'none' });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ orderNumber: string; confirmedAt: string } | null>(null);
  const [changesRequested, setChangesRequested] = useState<{ orderNumber: string } | null>(null);
  const [changesModalOpen, setChangesModalOpen] = useState(false);
  const [chartPreview, setChartPreview] = useState<SizeChartLink | null>(null);
  const [sampleRequested, setSampleRequested] = useState(order.colorSampleRequested);
  const [sampleModalOpen, setSampleModalOpen] = useState(false);
  const [sampleSubmitting, setSampleSubmitting] = useState(false);
  const pendingRosterMembers = order.rosterSummary?.pending ?? 0;

  // Already confirmed on the server
  if (order.status === 'confirmed') {
    return (
      <ConfigProvider theme={darkTheme}>
        <AlreadyConfirmedPanel orderNumber={order.orderNumber} />
      </ConfigProvider>
    );
  }

  // Customer just submitted a changes request
  if (changesRequested) {
    return (
      <ConfigProvider theme={darkTheme}>
        <ChangesRequestedPanel orderNumber={changesRequested.orderNumber} />
      </ConfigProvider>
    );
  }

  // Success state after form submission
  if (result) {
    return (
      <ConfigProvider theme={darkTheme}>
        <SuccessPanel orderNumber={result.orderNumber} confirmedAt={result.confirmedAt} />
      </ConfigProvider>
    );
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/o/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          acknowledgments: ACKNOWLEDGMENTS.map((a) => ({ key: a.key, text: a.text })),
          concerns: concerns.trim() || null,
          shippingAddress: order.shippingMode === 'customer_entered' ? shippingAddress : null,
          signatureBase64: signature.dataUrl,
          signatureType: signature.type,
        }),
      });

      const data = await res.json();

      if (res.status === 409 && data.code === 'already_confirmed') {
        setResult({ orderNumber: order.orderNumber, confirmedAt: new Date().toISOString() });
        return;
      }

      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to confirm');
      }

      // Push Google Ads conversion event to GTM dataLayer.
      // GTM picks this up and fires Enhanced Conversions for Leads with hashed email + value.
      // transaction_id deduplicates on Google's side if the page is refreshed.
      pushOrderConfirmed({
        transaction_id: order.id,
        value: order.orderValueAmount ? Number(order.orderValueAmount) : 0,
        currency: order.orderValueCurrency,
        email: order.customerEmail,
      });

      setResult({ orderNumber: data.orderNumber, confirmedAt: data.confirmedAt });
    } catch (err: unknown) {
      console.error('[confirm]', err);
      message.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequestChanges(comment: string) {
    const res = await fetch('/api/o/request-changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, comment }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Failed to submit request');
    setChangesModalOpen(false);
    setChangesRequested({ orderNumber: order.orderNumber });
    setChangesRequested({ orderNumber: data.orderNumber });
  }

  async function handleRequestColorSample() {
    setSampleSubmitting(true);
    try {
      const res = await fetch('/api/o/request-color-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to submit request');
      setSampleRequested(true);
      setSampleModalOpen(false);
      message.success('Colour sample requested — our team will be in touch before production.');
    } catch (err: unknown) {
      console.error('[request-color-sample]', err);
      message.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSampleSubmitting(false);
    }
  }

  return (
    <CustomerPageShell
      label="Order Confirmation"
      title={order.orderNumber}
      subtitle={
        order.customerName || order.clubName ? (
          <>
            {order.customerName}
            {order.clubName ? ` · ${order.clubName}` : ''}
          </>
        ) : undefined
      }
      subtitleColor="rgba(255,255,255,0.55)"
    >
      {/* ── Order Summary ── */}
      <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <SectionHeading>Order Summary</SectionHeading>
        <Descriptions column={{ xs: 1, sm: 2 }} size="small" styles={DESCRIPTIONS_STYLES}>
          <Descriptions.Item label="Order Number">{order.orderNumber}</Descriptions.Item>
          {order.orderValueAmount && (
            <Descriptions.Item label="Order Value">
              {order.orderValueCurrency} {formatCurrency(order.orderValueAmount)}
            </Descriptions.Item>
          )}
          {order.expectedShipDate && (
            <Descriptions.Item label="Expected Ship">
              {formatDateLong(order.expectedShipDate)}
            </Descriptions.Item>
          )}
          {order.deadlineDate && (
            <Descriptions.Item label="Required By">
              {formatDateLong(order.deadlineDate)}
            </Descriptions.Item>
          )}
          {order.invoiceUrl && (
            <Descriptions.Item label="Invoice">
              <a
                href={order.invoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: BRAND.primaryDark }}
              >
                View Invoice
              </a>
            </Descriptions.Item>
          )}
          {order.generalNotes && (
            <Descriptions.Item label="Notes" span={2}>
              {order.generalNotes}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* ── Garments ── */}
      {order.garments.map((garment, idx) => (
        <Card key={garment.id} style={CARD_STYLE} styles={CARD_BODY_STYLES}>
          <SectionHeading>
            Garment {idx + 1} — {garment.name}
          </SectionHeading>

          {/* Mock-ups */}
          {garment.images.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <Text style={{ ...FIELD_LABEL_STYLE, marginBottom: 10 }}>
                Mock-up Images
              </Text>
              <MockupGallery images={garment.images} />
              <Text
                style={{
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: 12,
                  fontStyle: 'italic',
                  display: 'block',
                  marginTop: 10,
                }}
              >
                Note: colours and print detail may appear slightly different in person than
                shown on screen, due to monitor display settings and the printing process.
              </Text>
            </div>
          )}

          {/* Labeled fabric picks (from the garment type's fabric fields) */}
          {garment.selectedFabrics &&
            Object.entries(garment.selectedFabrics).filter(([, v]) => v).length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <Text style={FIELD_LABEL_STYLE}>
                  <TagsOutlined style={{ marginRight: 6 }} />
                  Fabrics
                </Text>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px 16px' }}>
                  {Object.entries(garment.selectedFabrics)
                    .filter(([, v]) => v)
                    .map(([label, valueText]) => (
                      <Text key={label} style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
                        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{label}: </Text>
                        {valueText}
                      </Text>
                    ))}
                </div>
              </div>
            )}

          {/* Fabrics (legacy free-text list) */}
          {garment.fabrics.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <Text style={FIELD_LABEL_STYLE}>
                <TagsOutlined style={{ marginRight: 6 }} />
                Fabrics
              </Text>
              <Space wrap>
                {garment.fabrics.map((f) => (
                  <Tag key={f} color="default" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)' }}>
                    {f}
                  </Tag>
                ))}
              </Space>
            </div>
          )}

          {/* Selected options (from the garment type preset) */}
          {garment.selectedOptions &&
            Object.entries(garment.selectedOptions).filter(([, v]) => v).length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <Text style={FIELD_LABEL_STYLE}>
                  Options
                </Text>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px 16px' }}>
                  {Object.entries(garment.selectedOptions)
                    .filter(([, v]) => v)
                    .map(([label, valueText]) => (
                      <Text key={label} style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
                        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{label}: </Text>
                        {valueText}
                      </Text>
                    ))}
                </div>
              </div>
            )}

          {/* Notes */}
          {garment.notes && (
            <div style={{ marginBottom: 20 }}>
              <Text style={{ ...FIELD_LABEL_STYLE, marginBottom: 6 }}>
                Notes
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)' }}>{garment.notes}</Text>
            </div>
          )}

          {/* Sizing table */}
          <div style={{ marginBottom: garment.sizeCharts.length > 0 ? 20 : 0 }}>
            <Text style={{ ...FIELD_LABEL_STYLE, marginBottom: 10 }}>
              Sizing
            </Text>
            <SizingTableReadOnly rows={garment.sizing} sizingColumns={garment.sizingColumns} />
          </div>

          {/* Size charts */}
          <SizeChartTags
            charts={garment.sizeCharts}
            onPreview={setChartPreview}
            labelIcon={<FilePdfOutlined style={{ marginRight: 6 }} />}
          />
        </Card>
      ))}

      {/* ── Concerns / Comments ── */}
      <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <SectionHeading>Concerns or Comments</SectionHeading>
        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, display: 'block', marginBottom: 12 }}>
          Optional. Please note any questions or concerns before confirming.
        </Text>
        <Input.TextArea
          rows={4}
          placeholder="Any concerns or comments about this order…"
          value={concerns}
          onChange={(e) => setConcerns(e.target.value)}
          maxLength={2000}
          showCount
          style={{ resize: 'vertical' }}
        />
      </Card>

      {/* ── Shipping Address ── */}
      <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <SectionHeading>Shipping Address</SectionHeading>
        <ShippingAddressField
          mode={order.shippingMode}
          prefilledAddress={order.shippingAddress}
          onChange={(addr) => setShippingAddress(addr as Record<string, unknown>)}
        />
      </Card>

      {/* ── Acknowledgments ── */}
      <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <SectionHeading>Acknowledgments</SectionHeading>
        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, display: 'block', marginBottom: 16 }}>
          Please read and tick each item to confirm your order.
        </Text>
        <AcknowledgmentPanel checked={checkedAcks} onChange={setCheckedAcks} />
      </Card>

      {/* ── Signature ── */}
      <Card style={CARD_STYLE} styles={CARD_BODY_STYLES}>
        <SectionHeading>Signature</SectionHeading>
        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, display: 'block', marginBottom: 16 }}>
          Sign below to authenticate your confirmation. You may skip if preferred.
        </Text>
        <SignaturePad onChange={setSignature} />
      </Card>

      {/* ── Actions ── */}
      <Divider style={{ borderColor: 'rgba(255,255,255,0.1)' }} />

      {pendingRosterMembers > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`${pendingRosterMembers} team member${pendingRosterMembers === 1 ? '' : 's'} ${pendingRosterMembers === 1 ? 'has' : 'have'} not submitted a size yet.`}
          description="You can still confirm this order now if you want to proceed before every team member replies."
          style={{ marginBottom: 20, ...WARNING_SURFACE_STYLE }}
        />
      )}

      {checkedAcks.size < ACKNOWLEDGMENTS.length && (
        <Alert
          type="warning"
          showIcon
          message={`Please tick all ${ACKNOWLEDGMENTS.length} acknowledgments above before confirming.`}
          style={{ marginBottom: 20, ...WARNING_SURFACE_STYLE }}
        />
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 16,
          flexWrap: 'wrap',
          paddingBottom: 40,
        }}
      >
        <ConfirmButton
          checkedAcks={checkedAcks}
          onConfirm={handleConfirm}
          loading={submitting}
        />
        <button
          onClick={() => setSampleModalOpen(true)}
          disabled={submitting || sampleRequested}
          style={{
            height: 52,
            minWidth: 180,
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            background: 'transparent',
            border: `1px solid ${sampleRequested ? 'rgba(82,196,26,0.5)' : 'rgba(22,119,255,0.5)'}`,
            borderRadius: 6,
            color: sampleRequested ? '#52c41a' : '#1677ff',
            cursor: submitting || sampleRequested ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.5 : 1,
            transition: 'all 0.15s',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            justifyContent: 'center',
          }}
        >
          {sampleRequested ? (
            <>
              <CheckCircleOutlined /> Sample Requested
            </>
          ) : (
            <>
              <BgColorsOutlined /> Request Colour Sample
            </>
          )}
        </button>
        <button
          onClick={() => setChangesModalOpen(true)}
          disabled={submitting}
          style={{
            height: 52,
            minWidth: 180,
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            background: 'transparent',
            border: '1px solid rgba(250,173,20,0.5)',
            borderRadius: 6,
            color: '#faad14',
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.5 : 1,
            transition: 'all 0.15s',
          }}
        >
          Request Changes
        </button>
      </div>

      <RequestChangesModal
        open={changesModalOpen}
        onCancel={() => setChangesModalOpen(false)}
        onSubmit={handleRequestChanges}
      />

      <RequestColorSampleModal
        open={sampleModalOpen}
        submitting={sampleSubmitting}
        onCancel={() => setSampleModalOpen(false)}
        onConfirm={handleRequestColorSample}
      />

      {/* Size chart preview modal */}
      <SizeChartPreviewModal chart={chartPreview} onClose={() => setChartPreview(null)} />
    </CustomerPageShell>
  );
}
