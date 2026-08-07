'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Form,
  Button,
  Space,
  Typography,
  Card,
  App,
  Popconfirm,
  Breadcrumb,
  Alert,
  Tooltip,
  Input,
  Menu,
  Grid,
  Segmented,
  Modal,
  Tag,
} from 'antd';
import {
  ArrowLeftOutlined,
  BgColorsOutlined,
  DeleteOutlined,
  SaveOutlined,
  FilePdfOutlined,
  PrinterOutlined,
  LockOutlined,
  CopyOutlined,
  StopOutlined,
  ProfileOutlined,
  SkinOutlined,
  LinkOutlined,
  TeamOutlined,
  HistoryOutlined,
  ShoppingCartOutlined,
  FolderOpenOutlined,
  CheckSquareOutlined,
  MessageOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import { formatDateTime } from '@/lib/format';
import { SEMANTIC } from '@/lib/semantic-colors';
import { useRouter } from 'next/navigation';
import { deleteJson, patchJson, postJson } from '@/lib/api-fetch';
import { OrderForm, toApiPayload, type OrderFormValues } from '@/components/admin/orders/OrderForm';
import { GarmentsMasterDetail } from '@/components/admin/orders/GarmentsMasterDetail';
import { CustomerHubSelect, type HubCustomerPick } from '@/components/admin/orders/CustomerHubSelect';
import { ContactHubSelect, type HubContactPick } from '@/components/admin/orders/ContactHubSelect';
import { ShareLinkPanel } from '@/components/admin/orders/ShareLinkPanel';
import { OrderStatusBadge } from '@/components/admin/orders/OrderStatusBadge';
import { AuditLogTab } from '@/components/admin/orders/AuditLogTab';
import { RosterPanel } from '@/components/admin/orders/RosterPanel';
import { OrderContactPanel, type OrderContactValues } from '@/components/admin/orders/OrderContactPanel';
import { OrderNotesPanel } from '@/components/admin/orders/OrderNotesPanel';
import { ProductionPanel } from '@/components/admin/orders/ProductionPanel';
import { OrderAssetsPanel } from '@/components/admin/orders/OrderAssetsPanel';
import { DesignProjectLinkControl } from '@/components/admin/orders/DesignProjectLinkControl';
import { NotesThread } from '@/components/admin/orders/NotesThread';
import { ReconfirmationBanner } from '@/components/admin/orders/ReconfirmationBanner';
import { StageChecklist } from '@/components/admin/workflow/StageChecklist';
import { ConditionalReminders } from '@/components/admin/workflow/ConditionalReminders';
import { useProductionSummary } from '@/lib/use-production-summary';
import type { MockupImage } from '@/components/admin/orders/MockupUploader';

interface SizingRow {
  id?: string;
  size?: string | null;
  playerName?: string | null;
  playerNumber?: string | null;
  notes?: string | null;
  sortOrder?: number;
}

interface GarmentData {
  id: string;
  name: string;
  fabrics: string[];
  notes: string | null;
  sortOrder: number;
  sizing: SizingRow[];
  images: MockupImage[];
  sizeChartIds: string[];
  garmentTypeId?: string | null;
  selectedOptions?: Record<string, string> | null;
  selectedFabrics?: Record<string, string> | null;
}

export interface AdminOrderData {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerContact: string | null;
  clubName: string | null;
  orderValueAmount: string | null;
  orderValueCurrency: string | null;
  invoiceUrl: string | null;
  expectedShipDate: string | null;
  deadlineDate: string | null;
  generalNotes: string | null;
  internalNotes: string | null;
  shippingMode: 'prefilled' | 'customer_entered' | 'later';
  /**
   * Whether the order has any shipping-address line to print — drives the
   * address-label button (the label route 409s on an empty address, and a
   * link that downloads an error JSON is not acceptable UI).
   */
  hasShippingAddress: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  colorSampleRequestedAt: string | null;
  changesRequestedComment: string | null;
  changesRequestedCount: number;
  /**
   * Required-nullable rather than optional, deliberately: these are mapped by
   * hand in page.tsx, and optional typing let the mapper silently omit them —
   * shipped fields (name, contact, design link) rendered as absent in prod
   * (found live 2026-08-03). Required means a forgotten mapping fails tsc.
   */
  name: string | null;
  hubCustomerId: string | null;
  hubCustomerName: string | null;
  hubContactId: string | null;
  hubContactName: string | null;
  designProjectRef: string | null;
  /** Set when this order is a reprint — the source order it reprints. */
  sourceOrder?: { id: string; orderNumber: string } | null;
  reprintReason?: string | null;
  garments: GarmentData[];
  currentAccess: {
    id: string;
    createdAt: string;
    revokedAt: string | null;
    hasAccessCode: boolean;
    /** Null for links minted before the readable token column. */
    url: string | null;
  } | null;
}

const CANCELLABLE_STATUSES = new Set(['sent', 'viewed', 'changes_requested']);

/**
 * Card titles step above the content they introduce (David, 2026-08-06 round
 * three) — "Customer" must visibly outrank the names inside it. Mirrors
 * CARD_STYLES on the PO detail page; keep the two in step.
 */
const CARD_STYLES: { header: React.CSSProperties } = {
  header: { fontSize: 16, fontWeight: 600 },
};

interface Props {
  order: AdminOrderData;
  /** Signed-in staff user — authors may edit/delete their own notes. */
  currentUserId: string;
  isAdmin: boolean;
}

export function OrderDetailView({ order, currentUserId, isAdmin }: Props) {
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') ?? 'details';
  const [activeTab, setActiveTab] = useState(initialTab);
  // Owned here (not in the panel) so the rail badge + garments warning stay in
  // step with it, and so an edit anywhere in the order can refresh all three.
  const production = useProductionSummary(order.id);
  // Null until the thread reports in, so the rail shows "Notes" rather than
  // "Notes (0)" before it has loaded.
  const [noteCount, setNoteCount] = useState<number | null>(null);
  // Panels mount on first visit and stay mounted after (they hold state and
  // fetch their own data) — same semantics as the old Tabs lazy render.
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([initialTab]));
  const screens = Grid.useBreakpoint();
  const isNarrow = screens.lg === false;
  const [form] = Form.useForm<OrderFormValues>();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [isReprint, setIsReprint] = useState(true);
  const [reprintReason, setReprintReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [colorSampleRequestedAt, setColorSampleRequestedAt] = useState(order.colorSampleRequestedAt);
  const [resolvingColorSample, setResolvingColorSample] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(order.status);
  const [hubCustomer, setHubCustomer] = useState<HubCustomerPick | null>(
    order.hubCustomerId ? { id: order.hubCustomerId, name: order.hubCustomerName ?? '' } : null,
  );
  const [hubContact, setHubContact] = useState<HubContactPick | null>(
    order.hubContactId ? { id: order.hubContactId, name: order.hubContactName ?? '' } : null,
  );
  const [hasActiveToken, setHasActiveToken] = useState(
    order.currentAccess !== null && order.currentAccess.revokedAt === null,
  );
  const [tokenCreatedAt, setTokenCreatedAt] = useState(order.currentAccess?.createdAt ?? null);
  // The URL is staff-readable at rest (David, 2026-08-04) — like the roster
  // page URL, it never disappears after generation.
  const [activeLinkUrl, setActiveLinkUrl] = useState(order.currentAccess?.url ?? null);
  // Bumped when an action outside the panel changes the token (cancelling the
  // order revokes it), forcing ShareLinkPanel to remount and pick up the new
  // hasActiveToken/tokenCreatedAt props (it otherwise only reads them once, on
  // its own initial mount).
  const [shareLinkVersion, setShareLinkVersion] = useState(0);

  // The order name lives above the form (very top of the details page —
  // David, 2026-08-04), so it is plain state rather than an antd form field.
  const [orderName, setOrderName] = useState(order.name ?? '');
  // Contact & branding live in the Team order page section (David, 2026-08-04)
  // and save independently of the Details form.
  const [contact, setContact] = useState<OrderContactValues>({
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerContact: order.customerContact ?? null,
    clubName: order.clubName ?? null,
  });
  const initialValues: Partial<OrderFormValues> = {
    orderValueAmount: order.orderValueAmount ? Number(order.orderValueAmount) : undefined,
    orderValueCurrency: order.orderValueCurrency ?? 'NZD',
    invoiceUrl: order.invoiceUrl ?? undefined,
    expectedShipDate: order.expectedShipDate ?? undefined,
    deadlineDate: order.deadlineDate ?? undefined,
    generalNotes: order.generalNotes ?? undefined,
    shippingMode: order.shippingMode,
  };

  async function saveDetails() {
    let values: OrderFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSaving(true);
    try {
      const payload = toApiPayload(values as unknown as Record<string, unknown>);
      const body = {
        // '' (a cleared input) means "remove the name" — the schema wants null.
        name: orderName.trim() || null,
        // Contact fields are deliberately NOT sent — they live in the Team
        // order page section (OrderContactPanel) and save there.
        orderValueAmount: payload.orderValueAmount != null ? Number(payload.orderValueAmount) : null,
        orderValueCurrency: payload.orderValueCurrency,
        invoiceUrl: payload.invoiceUrl ?? null,
        expectedShipDate: payload.expectedShipDate ?? null,
        deadlineDate: payload.deadlineDate ?? null,
        generalNotes: payload.generalNotes ?? null,
        // internalNotes is deliberately NOT sent: the field is retired in the
        // UI and an omitted key leaves any legacy content untouched.
        shippingMode: payload.shippingMode,
        hubCustomerId: hubCustomer?.id ?? null,
        hubCustomerName: hubCustomer?.name ?? null,
        hubContactId: hubContact?.id ?? null,
        hubContactName: hubContact?.name ?? null,
      };

      await patchJson(`/api/admin/orders/${order.id}`, body, 'Save failed');
      message.success('Order details saved');
    } catch {
      message.error('Failed to save order details');
    } finally {
      setSaving(false);
    }
  }

  async function deleteOrder() {
    setDeleting(true);
    try {
      await deleteJson(`/api/admin/orders/${order.id}`, undefined, 'Delete failed');
      message.success('Order deleted');
      router.push('/admin/orders');
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : 'Failed to delete order');
      setDeleting(false);
    }
  }

  async function duplicateOrder(options?: { reprint?: boolean; reprintReason?: string | null }) {
    setDuplicating(true);
    try {
      const data = await postJson<{ orderId: string; orderNumber: string }>(
        `/api/admin/orders/${order.id}/duplicate`,
        { reprint: options?.reprint ?? false, reprintReason: options?.reprintReason ?? null },
        'Failed to duplicate order',
      );
      message.success(
        options?.reprint
          ? `Created reprint ${data.orderNumber} of this order`
          : `Created ${data.orderNumber} from this order`,
      );
      router.push(`/admin/orders/${data.orderId}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to duplicate order');
      setDuplicating(false);
    }
  }

  async function cancelOrder() {
    setCancelling(true);
    try {
      await postJson(`/api/admin/orders/${order.id}/cancel`, undefined, 'Failed to cancel order');
      setCurrentStatus('cancelled');
      setHasActiveToken(false);
      setActiveLinkUrl(null);
      setShareLinkVersion((v) => v + 1);
      message.success('Order cancelled');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to cancel order');
    } finally {
      setCancelling(false);
    }
  }

  async function resolveColorSample() {
    setResolvingColorSample(true);
    try {
      await postJson(
        `/api/admin/orders/${order.id}/resolve-color-sample`,
        undefined,
        'Failed to resolve colour sample request',
      );
      setColorSampleRequestedAt(null);
      message.success('Colour sample request marked as resolved');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to resolve colour sample request');
    } finally {
      setResolvingColorSample(false);
    }
  }

  function selectTab(key: string) {
    setActiveTab(key);
    setVisitedTabs((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    router.replace(`?tab=${key}`, { scroll: false });
    // Visited panels stay mounted, so opening Production must re-read rather
    // than show whatever the first visit fetched.
    if (key === 'production') production.reload();
  }

  // ONE thread for the whole order (scope=all, garment-taggable) — rendered in
  // the right rail on wide screens, or as a tab when narrow. Never both at once.
  const notesThread = (
    <>
      {order.internalNotes && (
        <Alert
          type="info"
          style={{ marginBottom: 12 }}
          message="Imported notes"
          description={
            <Typography.Paragraph
              style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginBottom: 0 }}
            >
              {order.internalNotes}
            </Typography.Paragraph>
          }
        />
      )}
      <NotesThread
        scope="all"
        orderId={order.id}
        garments={order.garments.map((g) => ({ id: g.id, name: g.name }))}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        onCountChange={setNoteCount}
      />
    </>
  );

  // The notes + comments as two distinct CARDS (David, 2026-08-06, matching
  // the PO page's right rail) — shown in the sticky rail on wide screens and
  // stacked inside the Notes tab when narrow. Never both at once.
  const notesCards = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="Order notes" size="small" styles={CARD_STYLES}>
        <OrderNotesPanel orderId={order.id} currentUserId={currentUserId} isAdmin={isAdmin} />
      </Card>
      <Card
        title={noteCount === null ? 'Comments' : `Comments (${noteCount})`}
        size="small"
        styles={CARD_STYLES}
      >
        {notesThread}
      </Card>
    </Space>
  );

  const sections = [
    {
      key: 'details',
      label: 'Details',
      icon: <ProfileOutlined />,
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {currentStatus === 'cancelled' && (
            <Alert
              type="error"
              showIcon
              message="This order has been cancelled."
              description="The customer's link has been revoked. Duplicate this order if the deal is revived."
            />
          )}
          {currentStatus === 'confirmed' && (
            <Alert
              type="success"
              showIcon
              message="This order has been confirmed by the customer."
              description={
                order.confirmedAt
                  ? `Confirmed on ${formatDateTime(order.confirmedAt)}`
                  : undefined
              }
            />
          )}
          {colorSampleRequestedAt && (
            <Alert
              type="warning"
              showIcon
              icon={<BgColorsOutlined />}
              message="Customer requested a colour book / physical sample — hold production."
              description={
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <span>{`Requested on ${formatDateTime(colorSampleRequestedAt)}. Arrange colour matching with the customer before releasing this order to production.`}</span>
                  <Popconfirm
                    title="Mark colour sample request as resolved?"
                    description="This clears the hold-production alert. Only confirm once colour matching has actually been arranged with the customer."
                    onConfirm={resolveColorSample}
                    okText="Yes, resolved"
                  >
                    <Button size="small" loading={resolvingColorSample}>
                      Mark Resolved
                    </Button>
                  </Popconfirm>
                </Space>
              }
            />
          )}
          {currentStatus === 'changes_requested' && (
            <Alert
              type="warning"
              showIcon
              message={
                order.changesRequestedCount > 1
                  ? `Customer has requested changes (round ${order.changesRequestedCount}).`
                  : 'Customer has requested changes.'
              }
              description={
                order.changesRequestedComment
                  ? `"${order.changesRequestedComment}" — Update the order and send a new link when ready.`
                  : 'Update the order details and send a new link when ready.'
              }
            />
          )}
          {/* Distinct section CARDS (David, 2026-08-06, matching the PO page):
              "order name would be in a section, then a customer section, then
              an order details section — our titles are more obvious because
              they're a card title." */}
          <Card title="Order name" size="small" styles={CARD_STYLES}>
            <Input
              placeholder="Order name — e.g. Winter hoodies 2026"
              value={orderName}
              onChange={(e) => setOrderName(e.target.value)}
              maxLength={200}
            />
          </Card>

          <Card title="Customer" size="small" styles={CARD_STYLES}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {/* Renders nothing unless the Sales Hub integration is configured */}
              <CustomerHubSelect
                value={hubCustomer}
                onSelect={(customer) => {
                  setHubCustomer(customer);
                  // A contact only means something inside its customer — changing
                  // or clearing the customer invalidates the contact pick.
                  if (customer?.id !== hubCustomer?.id) setHubContact(null);
                }}
              />
              <ContactHubSelect
                customerId={hubCustomer?.id ?? null}
                value={hubContact}
                onSelect={(contact) => {
                  setHubContact(contact);
                  // The order-page contact fields are the person's details —
                  // picking a contact expresses "this is the person", so prefill
                  // them (same behaviour as the new-order form).
                  if (contact) {
                    form.setFieldsValue({
                      customerName: contact.name,
                      ...(contact.email && { customerEmail: contact.email }),
                    });
                  }
                }}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {contact.customerName}
                {contact.clubName ? ` · ${contact.clubName}` : ''} — contact details for the
                customer-facing page are edited in the Team order page section.
              </Typography.Text>
            </Space>
          </Card>

          <Card title="Order details" size="small" styles={CARD_STYLES}>
            <OrderForm
              form={form}
              initialValues={initialValues}
              hubLinked={hubCustomer !== null}
              hideContactFields
              hideSectionTitle
            />
          </Card>
          {/* The internal-notes textarea moved to the attributed notes thread
              (right rail / Notes tab) — one place to write, with who and when.
              Legacy text saved here before the change shows above the thread. */}
          <Space>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={saveDetails}
            >
              Save details
            </Button>
            {currentStatus === 'draft' && (
              <Popconfirm
                title="Delete this order?"
                description="This action cannot be undone. Only draft orders can be deleted."
                onConfirm={deleteOrder}
                okText="Delete"
                okType="danger"
              >
                <Button danger icon={<DeleteOutlined />} loading={deleting}>
                  Delete order
                </Button>
              </Popconfirm>
            )}
          </Space>
        </Space>
      ),
    },
    {
      key: 'garments',
      label: `Garments (${order.garments.length})`,
      icon: <SkinOutlined />,
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {production.attention.needsAttention && (
            <Alert
              type="warning"
              showIcon
              message="These garments are not fully covered by a purchase order"
              description={
                <Space direction="vertical" size={4}>
                  <span>
                    {production.attention.message}. Raise a new purchase order for the
                    uncovered rows, or issue a revision on the affected purchase order, so
                    the supplier builds what the order now says.
                  </span>
                  <Button size="small" onClick={() => selectTab('production')}>
                    Open Production
                  </Button>
                </Space>
              }
            />
          )}
          <GarmentsMasterDetail
            orderId={order.id}
            initialGarments={order.garments}
            onGarmentsChanged={production.reload}
          />
        </Space>
      ),
    },
    {
      key: 'share',
      label: 'Confirmation Link',
      icon: <LinkOutlined />,
      children: (
        <ShareLinkPanel
          key={shareLinkVersion}
          orderId={order.id}
          customerEmail={contact.customerEmail}
          hasActiveToken={hasActiveToken}
          tokenCreatedAt={tokenCreatedAt}
          initialUrl={activeLinkUrl}
          orderCancelled={currentStatus === 'cancelled'}
          hasAccessCode={order.currentAccess?.hasAccessCode ?? false}
          garmentSummary={{
            total: order.garments.length,
            missingSizing: order.garments.filter((g) => g.sizing.length === 0).map((g) => g.name),
            missingImages: order.garments.filter((g) => g.images.length === 0).map((g) => g.name),
          }}
        />
      ),
    },
    {
      key: 'roster',
      label: 'Team order page',
      icon: <TeamOutlined />,
      children: (
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <OrderContactPanel
            orderId={order.id}
            initial={contact}
            hubLinked={hubCustomer !== null}
            onSaved={setContact}
          />
          <RosterPanel orderId={order.id} customerEmail={contact.customerEmail} />
        </Space>
      ),
    },
    {
      key: 'files',
      label: 'Design Files',
      icon: <FolderOpenOutlined />,
      children: (
        <OrderAssetsPanel
          orderId={order.id}
          garments={order.garments.map((g) => ({ id: g.id, name: g.name }))}
          designProjectRef={order.designProjectRef}
        />
      ),
    },
    {
      key: 'checklist',
      label: 'Checklist',
      icon: <CheckSquareOutlined />,
      children: (
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <StageChecklist
            boardKey="order"
            entityId={order.id}
            isAdmin={isAdmin}
            onAdvanced={() => router.refresh()}
          />
          <ConditionalReminders boardKey="order" entityId={order.id} />
        </Space>
      ),
    },
    // On wide screens the notes live in the persistent right rail instead
    // (David, 2026-08-03: notes visible on every page of the order) — the tab
    // only exists where there is no room for a third column.
    ...(isNarrow
      ? [{
          key: 'notes',
          label: noteCount === null ? 'Notes' : `Notes (${noteCount})`,
          icon: <MessageOutlined />,
          children: notesCards,
        }]
      : []),
    {
      key: 'production',
      label: production.attention.needsAttention ? (
        <Space size={6}>
          <span>Production</span>
          <Tooltip title={`Action needed — ${production.attention.message}`}>
            <WarningOutlined
              aria-label="Production needs attention"
              style={{ color: SEMANTIC.warning }}
            />
          </Tooltip>
        </Space>
      ) : (
        'Production'
      ),
      icon: <ShoppingCartOutlined />,
      children: (
        <ProductionPanel
          orderId={order.id}
          orderStatus={currentStatus}
          colorSampleRequestedAt={colorSampleRequestedAt}
          deadlineDate={order.deadlineDate ?? null}
          garments={order.garments.map((g) => ({ id: g.id, name: g.name }))}
          summary={production.summary}
          loading={production.loading}
          error={production.error}
          reload={production.reload}
        />
      ),
    },
    {
      key: 'audit',
      label: 'Audit Log',
      icon: <HistoryOutlined />,
      children: <AuditLogTab orderId={order.id} />,
    },
  ];

  const panelBodies = sections.map((s) => (
    <div key={s.key} style={{ display: s.key === activeTab ? 'block' : 'none' }}>
      {visitedTabs.has(s.key) ? s.children : null}
    </div>
  ));

  return (
    // The header spreads freely; the two-column row below caps itself at
    // 1600px (David, 2026-08-06 round three) — the old 1200px page cap that
    // cramped big screens, especially the garments sizing table, stays gone.
    <div>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <Link href="/admin/orders">Orders</Link> },
          { title: order.orderNumber },
        ]}
      />

      {/* Above everything: an order the customer has not agreed to is the first
          thing anyone opening this page needs to know (David, 2026-08-07). */}
      <ReconfirmationBanner orderId={order.id} canMutate onChanged={() => router.refresh()} />

      <Modal
        open={reprintOpen}
        title="Duplicate this order"
        okText={isReprint ? 'Create reprint' : 'Create duplicate'}
        confirmLoading={duplicating}
        onCancel={() => setReprintOpen(false)}
        onOk={() => {
          setReprintOpen(false);
          void duplicateOrder({
            reprint: isReprint,
            reprintReason: isReprint && reprintReason.trim() ? reprintReason.trim() : null,
          });
        }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Segmented
            value={isReprint ? 'reprint' : 'duplicate'}
            onChange={(value) => setIsReprint(value === 'reprint')}
            options={[
              { label: 'Reprint of this order', value: 'reprint' },
              { label: 'Plain duplicate', value: 'duplicate' },
            ]}
            block
          />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {isReprint
              ? 'Links the new order to this one, so the factory is told which job to reuse the production layout from. Design and font files carry over.'
              : 'An unlinked copy. Use this for a similar-but-separate job — nothing will reference this order.'}
          </Typography.Text>
          {isReprint && (
            <Input.TextArea
              rows={2}
              maxLength={500}
              value={reprintReason}
              onChange={(e) => setReprintReason(e.target.value)}
              placeholder="Why is this being reprinted? (optional — e.g. customer reordering same kit)"
            />
          )}
        </Space>
      </Modal>

      <div
        style={{
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Link href="/admin/orders">
          <Button icon={<ArrowLeftOutlined />} type="text" />
        </Link>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {order.orderNumber}
        </Typography.Title>
        {order.name && (
          <Typography.Text style={{ fontSize: 16 }} type="secondary">
            {order.name}
          </Typography.Text>
        )}
        <OrderStatusBadge status={currentStatus} />
        {order.sourceOrder && (
          <Tooltip title={order.reprintReason ?? 'Reprint of an earlier order'}>
            <Link href={`/admin/orders/${order.sourceOrder.id}`}>
              <Tag icon={<CopyOutlined />} color="cyan">
                Reprint of {order.sourceOrder.orderNumber}
              </Tag>
            </Link>
          </Tooltip>
        )}
        {hubCustomer && (
          <Tooltip title="Linked to a Sales Hub customer">
            <Tag icon={<LinkOutlined />} color="geekblue">
              Hub: {hubCustomer.name}
            </Tag>
          </Tooltip>
        )}
        <DesignProjectLinkControl
          orderId={order.id}
          hubCustomerId={order.hubCustomerId}
          designProjectRef={order.designProjectRef}
          onChanged={() => router.refresh()}
        />
        {order.customerName && (
          <Typography.Text type="secondary">— {order.customerName}</Typography.Text>
        )}
        {order.clubName && (
          <Typography.Text type="secondary">/ {order.clubName}</Typography.Text>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <Space>
            {currentStatus === 'confirmed' && (
              <Button
                icon={<FilePdfOutlined />}
                href={`/api/admin/orders/${order.id}/pdf`}
                target="_blank"
                download
              >
                Download PDF
              </Button>
            )}
            {/* The admin UI has no address fields of its own (the customer
                enters the address on their page), so the label lives with the
                header actions. Disabled — not a dead link to an error JSON —
                when there is nothing to print. */}
            <Tooltip
              title={
                order.hasShippingAddress
                  ? '174×100mm label PDF — print at 100%'
                  : 'This order has no shipping address to print'
              }
            >
              {order.hasShippingAddress ? (
                <Button
                  icon={<PrinterOutlined />}
                  href={`/api/admin/orders/${order.id}/address-label`}
                  target="_blank"
                >
                  Print address label
                </Button>
              ) : (
                <Button icon={<PrinterOutlined />} disabled>
                  Print address label
                </Button>
              )}
            </Tooltip>
            <Tooltip title="Creates a new draft order pre-filled with this order's customer, garments, sizing, size charts and design files (mock-ups are not copied)">
              <Button
                icon={<CopyOutlined />}
                loading={duplicating}
                onClick={() => setReprintOpen(true)}
              >
                Duplicate
              </Button>
            </Tooltip>
            {CANCELLABLE_STATUSES.has(currentStatus) && (
              <Popconfirm
                title="Cancel this order?"
                description="This marks the order as dead and immediately revokes the customer's link. This cannot be undone."
                onConfirm={cancelOrder}
                okText="Cancel order"
                okType="danger"
              >
                <Button danger icon={<StopOutlined />} loading={cancelling}>
                  Cancel order
                </Button>
              </Popconfirm>
            )}
          </Space>
        </div>
      </div>

      {isNarrow ? (
        <Card styles={{ body: { padding: 0 } }}>
          <div style={{ padding: 16 }}>
            <Segmented
              block
              value={activeTab}
              onChange={(v) => selectTab(v as string)}
              options={sections.map((s) => ({ label: s.label, value: s.key }))}
              style={{ marginBottom: 16 }}
            />
            {panelBodies}
          </div>
        </Card>
      ) : (
        // Two-column layout matching the PO page (David, 2026-08-06 round
        // three): the row spreads to 1600px — a fluid main column plus a
        // sticky right rail of cards (order notes + comments) pinned to the
        // row's right edge. Same wrapper values as PoDetailView — keep the
        // two pages in step.
        <div
          data-testid="detail-layout"
          style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', maxWidth: 1600 }}
        >
          <div style={{ flex: '1 1 640px', minWidth: 0 }}>
            <Card styles={{ body: { padding: 0 } }}>
              <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 480 }}>
                {/* Left rail — vertical section nav, stays visible while the content scrolls */}
                <Menu
                  mode="inline"
                  selectedKeys={[activeTab]}
                  onClick={({ key }) => selectTab(key)}
                  items={sections.map(({ key, label, icon }) => ({ key, label, icon }))}
                  style={{
                    width: 200,
                    flexShrink: 0,
                    paddingTop: 8,
                    position: 'sticky',
                    top: 88,
                    alignSelf: 'flex-start',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0, padding: 16 }}>{panelBodies}</div>
              </div>
            </Card>
          </div>
          {/* Right rail — order notes first (the finalisation points, David,
              2026-08-04), then the discussion thread, each as its own card. */}
          <div
            style={{
              flex: '1 1 360px',
              maxWidth: 400,
              minWidth: 320,
              position: 'sticky',
              top: 88,
              alignSelf: 'flex-start',
              maxHeight: 'calc(100vh - 104px)',
              overflowY: 'auto',
            }}
          >
            {notesCards}
          </div>
        </div>
      )}
    </div>
  );
}
