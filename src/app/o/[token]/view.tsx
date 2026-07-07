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
  Modal,
  message,
} from 'antd';
import {
  CheckCircleFilled,
  ExclamationCircleFilled,
  FilePdfOutlined,
  FileImageOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import Image from 'next/image';
import { darkTheme, BEASTMODE, headingFont } from '@/lib/theme';
import { formatDateLong, formatCurrency } from '@/lib/format';
import { APP_NAME, SALES_REP_LABEL } from '@/lib/config';
import { pushOrderConfirmed } from '@/lib/gtm';
import { MockupGallery, type GalleryImage } from '@/components/customer/MockupGallery';
import { SizingTableReadOnly, type SizingRow } from '@/components/customer/SizingTableReadOnly';
import {
  AcknowledgmentPanel,
  ACKNOWLEDGMENTS,
} from '@/components/customer/AcknowledgmentPanel';
import { ShippingAddressField } from '@/components/customer/ShippingAddressField';
import { SignaturePad, type SignatureData } from '@/components/customer/SignaturePad';
import { ConfirmButton } from '@/components/customer/ConfirmButton';
import { RequestChangesModal } from '@/components/customer/RequestChangesModal';
import { StatusPage } from '@/components/customer/StatusPage';

const { Title, Text, Paragraph } = Typography;

interface SizeChartLink {
  name: string;
  storageKey: string | null;
  url: string | null;
  downloadUrl: string | null;
}

interface GarmentData {
  id: string;
  name: string;
  fabrics: string[];
  notes: string | null;
  sizing: SizingRow[];
  images: GalleryImage[];
  sizeCharts: SizeChartLink[];
}

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
    garments: GarmentData[];
  };
}

// ---------------------------------------------------------------------------
// Section heading
// ---------------------------------------------------------------------------
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        borderLeft: `4px solid ${BEASTMODE.accent}`,
        paddingLeft: 12,
        marginBottom: 20,
      }}
    >
      <Title
        level={4}
        style={{
          margin: 0,
          color: '#fff',
          textTransform: 'uppercase',
          letterSpacing: 2,
          fontSize: 13,
          fontFamily: headingFont,
          fontWeight: 400,
        }}
      >
        {children}
      </Title>
    </div>
  );
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
          fontSize: 52,
          fontFamily: headingFont,
          fontWeight: 400,
          letterSpacing: 6,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        Confirmed
      </Title>
      <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 18, display: 'block', marginBottom: 8 }}>
        Order <strong style={{ color: '#fff' }}>{orderNumber}</strong> has been confirmed.
      </Text>
      <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
        {new Date(confirmedAt).toLocaleString('en-NZ', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
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
          fontSize: 44,
          fontFamily: headingFont,
          fontWeight: 400,
          letterSpacing: 5,
          textTransform: 'uppercase',
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

  const cardStyle = {
    background: BEASTMODE.charcoal,
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    marginBottom: 24,
  };

  return (
    <ConfigProvider theme={darkTheme}>
      <div style={{ minHeight: '100vh', background: BEASTMODE.navy }}>
        {/* ── Hero header ── */}
        <header
          style={{
            background: BEASTMODE.ink,
            borderBottom: `3px solid ${BEASTMODE.accent}`,
            padding: '24px',
          }}
        >
          <div style={{ maxWidth: 860, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              {/* Actual logo from beastmode.co.nz — SVG paths render correctly without page fonts */}
              <Image
                src="/logo.svg"
                alt={APP_NAME}
                width={141}
                height={44}
                priority
                style={{ display: 'block' }}
              />
              <div
                style={{
                  width: 1,
                  height: 24,
                  background: 'rgba(255,255,255,0.2)',
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.5)',
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                  fontWeight: 600,
                }}
              >
                Order Confirmation
              </div>
            </div>
            <Title
              level={2}
              style={{ color: '#fff', margin: 0, fontWeight: 900, letterSpacing: 1 }}
            >
              {order.orderNumber}
            </Title>
            {(order.customerName || order.clubName) && (
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 15, marginTop: 4, display: 'block' }}>
                {order.customerName}
                {order.clubName ? ` · ${order.clubName}` : ''}
              </Text>
            )}
          </div>
        </header>

        <main style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px 80px' }}>
          {/* ── Order Summary ── */}
          <Card style={cardStyle} styles={{ body: { padding: '20px 24px' } }}>
            <SectionHeading>Order Summary</SectionHeading>
            <Descriptions
              column={{ xs: 1, sm: 2 }}
              size="small"
              styles={{
                label: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
                content: { color: 'rgba(255,255,255,0.9)' },
              }}
            >
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
                    style={{ color: BEASTMODE.accent }}
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
            <Card key={garment.id} style={cardStyle} styles={{ body: { padding: '20px 24px' } }}>
              <SectionHeading>
                Garment {idx + 1} — {garment.name}
              </SectionHeading>

              {/* Mock-ups */}
              {garment.images.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 10 }}>
                    Mock-up Images
                  </Text>
                  <MockupGallery images={garment.images} />
                </div>
              )}

              {/* Fabrics */}
              {garment.fabrics.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 8 }}>
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

              {/* Notes */}
              {garment.notes && (
                <div style={{ marginBottom: 20 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                    Notes
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.8)' }}>{garment.notes}</Text>
                </div>
              )}

              {/* Sizing table */}
              <div style={{ marginBottom: garment.sizeCharts.length > 0 ? 20 : 0 }}>
                <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 10 }}>
                  Sizing
                </Text>
                <SizingTableReadOnly rows={garment.sizing} />
              </div>

              {/* Size charts */}
              {garment.sizeCharts.length > 0 && (
                <div>
                  <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 8 }}>
                    <FilePdfOutlined style={{ marginRight: 6 }} />
                    Reference Size Charts
                  </Text>
                  <Space wrap>
                    {garment.sizeCharts.map((chart) =>
                      chart.url ? (
                        <Tag
                          key={chart.name}
                          color="default"
                          icon={chart.storageKey?.endsWith('.pdf') ? <FilePdfOutlined /> : <FileImageOutlined />}
                          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.8)', cursor: 'pointer' }}
                          onClick={() => setChartPreview(chart)}
                        >
                          {chart.name}
                        </Tag>
                      ) : (
                        <Tag key={chart.name} color="default" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>
                          {chart.name}
                        </Tag>
                      )
                    )}
                  </Space>
                </div>
              )}
            </Card>
          ))}

          {/* ── Concerns / Comments ── */}
          <Card style={cardStyle} styles={{ body: { padding: '20px 24px' } }}>
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
          <Card style={cardStyle} styles={{ body: { padding: '20px 24px' } }}>
            <SectionHeading>Shipping Address</SectionHeading>
            <ShippingAddressField
              mode={order.shippingMode}
              prefilledAddress={order.shippingAddress}
              onChange={(addr) => setShippingAddress(addr as Record<string, unknown>)}
            />
          </Card>

          {/* ── Acknowledgments ── */}
          <Card style={cardStyle} styles={{ body: { padding: '20px 24px' } }}>
            <SectionHeading>Acknowledgments</SectionHeading>
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, display: 'block', marginBottom: 16 }}>
              Please read and tick each item to confirm your order.
            </Text>
            <AcknowledgmentPanel checked={checkedAcks} onChange={setCheckedAcks} />
          </Card>

          {/* ── Signature ── */}
          <Card style={cardStyle} styles={{ body: { padding: '20px 24px' } }}>
            <SectionHeading>Signature</SectionHeading>
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, display: 'block', marginBottom: 16 }}>
              Sign below to authenticate your confirmation. You may skip if preferred.
            </Text>
            <SignaturePad onChange={setSignature} />
          </Card>

          {/* ── Actions ── */}
          <Divider style={{ borderColor: 'rgba(255,255,255,0.1)' }} />

          {checkedAcks.size < ACKNOWLEDGMENTS.length && (
            <Alert
              type="warning"
              showIcon
              message={`Please tick all ${ACKNOWLEDGMENTS.length} acknowledgments above before confirming.`}
              style={{
                marginBottom: 20,
                background: 'rgba(250,173,20,0.08)',
                border: '1px solid rgba(250,173,20,0.3)',
              }}
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
        </main>
      </div>

      {/* Size chart preview modal */}
      <Modal
        open={!!chartPreview}
        onCancel={() => setChartPreview(null)}
        footer={
          chartPreview?.downloadUrl ? (
            <a
              href={chartPreview.downloadUrl}
              style={{ color: BEASTMODE.accent, fontSize: 14 }}
            >
              Download
            </a>
          ) : null
        }
        title={chartPreview?.name}
        width="80vw"
        styles={{ body: { padding: 0, textAlign: 'center', background: '#111' } }}
        centered
      >
        {chartPreview?.url && (
          chartPreview.storageKey?.endsWith('.pdf') ? (
            <iframe
              src={chartPreview.url}
              style={{ width: '100%', height: '75vh', border: 'none' }}
              title={chartPreview.name}
            />
          ) : (
            <img
              src={chartPreview.url}
              alt={chartPreview.name}
              style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
            />
          )
        )}
      </Modal>
    </ConfigProvider>
  );
}
