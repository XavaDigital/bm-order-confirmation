'use client';

/**
 * Purchase-order detail (PO_PLAN): header actions (approve / send / PDF /
 * status machine), variance banner + revision issuing, editable dates (the
 * customer deadline auto-imports from the order and re-syncs when the order's
 * deadline changes — last write wins) and notes, the always-on supplier portal
 * link + password, the latest-revision line tables with per-garment sections,
 * revision + audit history, and shipments.
 *
 * Layout (David, 2026-08-06 round three): a two-column row capped at 1600px —
 * fluid form column, sticky right rail (order notes + supplier comments,
 * ~360-400px, pinned to the row's right edge; a checklist card will land above
 * them later). The header leads with the DISPLAY title (poDisplayTitle) —
 * poNumber stays the canonical identity everywhere else.
 *
 * Data: the client loads GET /api/admin/purchase-orders/[id] for the PO
 * itself, and sources VARIANCE from the parent order's production-summary
 * endpoint (GET /api/admin/orders/[orderId]/purchase-orders), which already
 * computes per-PO live variance + counts — no bespoke variance endpoint.
 * Status actions offer ONLY the transitions `canTransition` allows (the same
 * pure function the service guards with), so the UI can never offer an
 * illegal move — including remake's two re-entry options.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Collapse,
  DatePicker,
  Dropdown,
  Input,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import {
  CheckOutlined,
  CopyOutlined,
  DownOutlined,
  DownloadOutlined,
  EditOutlined,
  ExportOutlined,
  FileExcelOutlined,
  LinkOutlined,
  MailOutlined,
  PaperClipOutlined,
  SendOutlined,
  SyncOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import dayjs, { type Dayjs } from 'dayjs';
import type { ColumnType } from 'antd/es/table';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { ColorBookSelect } from '@/components/admin/purchase-orders/ColorBookSelect';
import {
  PoChecklistCard,
  usePoChecklist,
} from '@/components/admin/purchase-orders/PoChecklistCard';
import { SendPoModal, type SendPoResult } from '@/components/admin/purchase-orders/SendPoModal';
import {
  PoFilesCard,
  usePoFiles,
  type PoFileItem,
} from '@/components/admin/purchase-orders/PoFilesCard';
import { PoStatusBadge } from '@/components/admin/purchase-orders/PoStatusBadge';
import { ShipmentStatusBadge } from '@/components/admin/purchase-orders/ShipmentStatusBadge';
import { VarianceDiff } from '@/components/admin/purchase-orders/VarianceDiff';
<<<<<<< Updated upstream
import { RichTextEditor } from '@/components/admin/RichTextEditor';
// Pure merge/thumbnail helpers shared with the supplier activity feed — one
// chronology rule for both sides of the conversation.
import { buildActivityFeed, isImageFileName } from '@/components/supplier/po-view-helpers';
import { isNoteEmpty, sanitizeNoteHtml } from '@/lib/rich-text';
=======
import { ConditionalReminders } from '@/components/admin/workflow/ConditionalReminders';
>>>>>>> Stashed changes
import { PO_STATUSES, canTransition, type PoStatus } from '@/server/purchase-orders/contract';
import { PO_FILE_CATEGORIES } from '@/server/purchase-orders/files-contract';
import {
  sizeSummary,
  type PoVariance,
  type PoVarianceCounts,
} from '@/server/purchase-orders/snapshot';
import type {
  PoSnapshot,
  PoSnapshotAsset,
  PoSnapshotGarment,
  PoSnapshotImage,
  PoSnapshotLine,
  PoSnapshotSizeChart,
} from '@/db/schema';
import { PO_STATUS, poStatusMeta } from '@/lib/status';
import { ASSET_KIND_COLOR, ASSET_KIND_LABEL } from '@/lib/asset-kind';
import { formatDate } from '@/lib/format';
import { poDisplayTitle } from '@/lib/po-title';
import { ApiError, getJson, postForm, postJson, patchJson } from '@/lib/api-fetch';

const { Text } = Typography;

/** Snapshot media as served by the admin GET — signed for the LATEST revision
 *  (signPoSnapshotMedia in getPurchaseOrder); older rows never render inline. */
type SignedSnapshotChart = PoSnapshotSizeChart & { downloadUrl?: string | null };
type SignedSnapshotImage = PoSnapshotImage & { url?: string | null; thumbnailUrl?: string | null };

interface PoRevision {
  id: string;
  revisionNumber: number;
  reason: string | null;
  snapshot: PoSnapshot;
  createdAt: string;
}

interface PoShipment {
  id: string;
  nickname: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  status: string;
}

/** One audit row of the PO's who/when record (listPoHistory, newest first). */
interface PoHistoryEntry {
  id: string;
  eventType: string;
  actorEmail: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

/** Plain labels for the PO history card — anything else renders its raw type. */
const HISTORY_EVENT_LABEL: Record<string, string> = {
  'po.status_changed': 'Status changed',
  'po.ship_date_changed': 'Ship date changed',
  'po.supplier_updated': 'Supplier update',
  'po.sent': 'Sent to supplier',
  'po.created': 'Created',
  'po.updated': 'Details updated',
};

/** A note/comment row from the parent order's notes API (subset we render). */
interface PoOrderNote {
  id: string;
  body: string;
  /** Rich body for staff comments; sanitised again at render (NoteBody's rule). */
  bodyHtml?: string | null;
  authorKind: 'staff' | 'email_flow' | 'system' | 'supplier';
  authorName: string | null;
  authorEmail: string | null;
  authorLabel: string | null;
  visibility: 'internal' | 'shared';
  deleted: boolean;
  createdAt: string;
}

function noteAuthor(note: PoOrderNote): string {
  return note.authorName ?? note.authorEmail ?? note.authorLabel ?? 'Unknown';
}

interface PoDetail {
  id: string;
  poNumber: string;
  /** Human-readable customer part of the display title (David, 2026-08-06). */
  customerRef: string | null;
  orderId: string;
  status: string;
  currentRevisionNumber: number;
  deadlineDate: string | null;
  expectedShipDate: string | null;
  actualShipDate: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  notes: string | null;
  createdAt: string;
  /** The supplier colour book this job is matched against (null = none). */
  colorBookId: string | null;
  colorBookName: string | null;
  supplier: {
    id: string;
    name: string;
    contactPerson: string | null;
    email: string | null;
    phone: string | null;
  };
  order: {
    id: string;
    orderNumber: string;
    customerName: string;
    status: string;
    /** The customer deadline — served live from the order so it can't go stale. */
    deadlineDate: string | null;
  };
  revisions: PoRevision[];
  shipments: PoShipment[];
  /** Legacy emailed-token link info (the token flow is gone; view-only). */
  supplierLink: { active: boolean; lastViewedAt: string | null };
  /** The pretty always-on portal URL (/supplier/{CODE}/...). */
  portalUrl: string;
  history: PoHistoryEntry[];
}

interface ProductionSummary {
  purchaseOrders: Array<{
    id: string;
    variance: PoVariance;
    varianceCounts: PoVarianceCounts;
  }>;
}

const dash = <Text type="secondary">—</Text>;

/**
 * Heading for the per-garment snapshot sections (David, 2026-08-06 round
 * three): the underline is a FAINT rule (the theme's split colour, not the
 * border colour) that runs under the text and on across the section, capped at
 * half the section's width — an underline, not a divider crossing the whole
 * card.
 */
function SnapshotSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        margin: '12px 0 6px',
        width: '100%',
        maxWidth: '50%',
        paddingBottom: 3,
        borderBottom: '1px solid var(--ant-color-split, rgba(128, 128, 128, 0.2))',
      }}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.8,
        }}
      >
        {children}
      </Text>
    </div>
  );
}

/**
 * Each garment's details are a genuine TWO-COLUMN block (David, 2026-08-06
 * round three): Fabrics on the left, Options on the right, collapsing to one
 * column when the main column is narrow. Size charts / Images / Sizing stay
 * full-width below.
 */
const DETAIL_COLUMNS_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: '0 32px',
  alignItems: 'start',
};

/** Entries within Fabrics/Options STACK one per line, never wrap across. */
const STACKED_ENTRY_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  marginBottom: 2,
};

/**
 * Card titles step above the content they introduce (David, round three) —
 * "Summary" must visibly outrank the supplier name inside it, "Dates" its
 * field labels. Mirrored on the order detail page; keep the two in step.
 */
const CARD_STYLES: { header: React.CSSProperties } = {
  header: { fontSize: 16, fontWeight: 600 },
};

/**
 * Line-table columns for one snapshot garment: the fixed columns plus one per
 * user-defined sizing column captured in the snapshot (values live in each
 * line's `customValues`, keyed by label). Quantity only appears when some line
 * carries one — pre-0025 revisions have none and a column of 1s is noise.
 */
function buildLineColumns(garment: PoSnapshotGarment): ColumnType<PoSnapshotLine>[] {
  const columns: ColumnType<PoSnapshotLine>[] = [
    {
      title: 'Size',
      dataIndex: 'size',
      width: 120,
      render: (v: string | null) => v ?? dash,
    },
    {
      title: 'Player',
      dataIndex: 'playerName',
      render: (v: string | null) => v ?? dash,
    },
    {
      title: 'Number',
      dataIndex: 'playerNumber',
      width: 110,
      render: (v: string | null) => v ?? dash,
    },
  ];

  for (const col of garment.sizingColumns ?? []) {
    columns.push({
      title: col.label,
      key: `custom-${col.label}`,
      render: (_: unknown, line: PoSnapshotLine) => line.customValues?.[col.label] ?? dash,
    });
  }

  if ((garment.lines ?? []).some((line) => line.quantity !== undefined)) {
    columns.push({
      title: 'Qty',
      dataIndex: 'quantity',
      width: 70,
      render: (v: number | undefined) => v ?? 1,
    });
  }

  columns.push({
    title: 'Notes',
    dataIndex: 'notes',
    render: (v: string | null) => v ?? dash,
  });

  return columns;
}

export function PoDetailView({ poId }: { poId: string }) {
  const { message, modal } = App.useApp();
  const [detail, setDetail] = useState<PoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [varianceInfo, setVarianceInfo] = useState<{
    variance: PoVariance;
    counts: PoVarianceCounts;
  } | null>(null);

  // The send flow goes through the preview modal (David, 2026-08-06): see
  // what's actually being emailed, add an optional message, then confirm.
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [revisionModalOpen, setRevisionModalOpen] = useState(false);
  const [revisionReason, setRevisionReason] = useState('');
  const [issuingRevision, setIssuingRevision] = useState(false);

  // Editable summary fields. The customer deadline is editable again (David,
  // 2026-08-06) — it auto-imports from the order and re-syncs when the order's
  // deadline changes; between the two, the last write wins.
  const [deadline, setDeadline] = useState<Dayjs | null>(null);
  const [expectedShip, setExpectedShip] = useState<Dayjs | null>(null);
  const [actualShip, setActualShip] = useState<Dayjs | null>(null);
  const [notes, setNotes] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);

  // Customer-ref editing (the human part of the display title).
  const [refModalOpen, setRefModalOpen] = useState(false);
  const [refDraft, setRefDraft] = useState('');
  const [savingRef, setSavingRef] = useState(false);

  // The supplier's portal password (from the supplier record): undefined =
  // still loading, null = no password set (portal closed).
  const [portalPassword, setPortalPassword] = useState<string | null | undefined>(undefined);

  // Colour book editing (David, 2026-08-05): the display is "Colour book: X";
  // Edit swaps in the supplier's book list.
  const [editingColorBook, setEditingColorBook] = useState(false);

  // The parent order's threads: supplier-shared comments + team order notes.
  const [comments, setComments] = useState<PoOrderNote[]>([]);
  const [orderNotes, setOrderNotes] = useState<PoOrderNote[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // Internal order-notes composer (David, 2026-08-06: add notes from here too).
  const [noteDraft, setNoteDraft] = useState('');
  const [postingNote, setPostingNote] = useState(false);

  // Production files — page-owned, shared between PoFilesCard (structured
  // lens) and the Comments rail feed (chronological lens).
  const { items: files, loadError: filesError, reload: reloadFiles } = usePoFiles(poId);

  // Attach-a-file next to the comment composer (defaults to Reference image).
  const [attachCategory, setAttachCategory] = useState('Reference image');
  const [attaching, setAttaching] = useState(false);

  // Per-garment "Add image" (posts to the ORDER, then refreshes the draft PO).
  const [imageCaptions, setImageCaptions] = useState<Record<string, string>>({});
  const [uploadingImageFor, setUploadingImageFor] = useState<string | null>(null);

  // "Refresh from order" for unsent POs.
  const [refreshing, setRefreshing] = useState(false);

  // The PO's pre-send checklist — the card owns the rows; the page reads them
  // so the Send button can hint at outstanding items (server enforces).
  const {
    items: checklistItems,
    loadError: checklistError,
    reload: reloadChecklist,
    toggle: toggleChecklistItem,
  } = usePoChecklist(poId);

  const loadThreads = useCallback(
    async (orderId: string) => {
      // Best-effort: the PO page still works if the notes API fails.
      try {
        const [commentRows, noteRows] = await Promise.all([
          getJson<PoOrderNote[]>(
            `/api/admin/orders/${orderId}/notes`,
            'Failed to load comments',
          ),
          getJson<PoOrderNote[]>(
            `/api/admin/orders/${orderId}/notes?kind=note`,
            'Failed to load order notes',
          ),
        ]);
        // The supplier conversation is the SHARED slice of the order thread —
        // internal chatter stays on the order page.
        setComments(commentRows.filter((n) => n.visibility === 'shared' && !n.deleted));
        setOrderNotes(noteRows.filter((n) => !n.deleted));
      } catch {
        // leave whatever was last loaded
      }
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getJson<PoDetail>(
        `/api/admin/purchase-orders/${poId}`,
        'Failed to load purchase order',
      );
      setDetail(d);
      setDeadline(d.deadlineDate ? dayjs(d.deadlineDate) : null);
      setExpectedShip(d.expectedShipDate ? dayjs(d.expectedShipDate) : null);
      setActualShip(d.actualShipDate ? dayjs(d.actualShipDate) : null);
      setNotes(d.notes ?? '');
      // The portal password lives on the supplier record, not the PO read.
      try {
        const supplier = await getJson<{ portalPassword: string | null }>(
          `/api/admin/suppliers/${d.supplier.id}`,
          'Failed to load supplier',
        );
        setPortalPassword(supplier.portalPassword);
      } catch {
        setPortalPassword(undefined);
      }
      await loadThreads(d.orderId);
      // Variance is best-effort — the page still works if the summary fails.
      try {
        const summary = await getJson<ProductionSummary>(
          `/api/admin/orders/${d.orderId}/purchase-orders`,
          'Failed to load variance',
        );
        const entry = summary.purchaseOrders.find((p) => p.id === poId);
        setVarianceInfo(
          entry ? { variance: entry.variance, counts: entry.varianceCounts } : null,
        );
      } catch {
        setVarianceInfo(null);
      }
    } catch {
      message.error('Failed to load purchase order');
    } finally {
      setLoading(false);
    }
  }, [poId, message, loadThreads]);

  useEffect(() => {
    load();
  }, [load]);

  /** The modal did the actual send — surface the result and reload. */
  async function handleSent(res: SendPoResult) {
    const { images, fonts, sizeCharts, sizeReduced } = res.attachmentSummary;
    const parts = ['PDF', 'spreadsheet'];
    if (images > 0) parts.push(`${images} image${images === 1 ? '' : 's'}`);
    if (fonts > 0) parts.push(`${fonts} font/design file${fonts === 1 ? '' : 's'}`);
    if (sizeCharts > 0) parts.push(`${sizeCharts} size chart${sizeCharts === 1 ? '' : 's'}`);
    message.success(`Purchase order emailed to ${res.to} (${parts.join(', ')})`);
    if (sizeReduced) {
      message.warning('Images were too large to attach at full resolution — reduced-size copies were sent instead.');
    }
    await load();
  }

  /** Tick/untick/sidestep a manual checklist item from the rail card. */
  async function handleChecklistToggle(itemId: string, checked: boolean, sidestepReason?: string) {
    const error = await toggleChecklistItem(itemId, checked, sidestepReason);
    // A refused SIDESTEP is reported inside the modal, which stays open — a
    // toast as well would say the same thing twice.
    if (error && !sidestepReason) message.error(error);
    return error;
  }

  async function applyStatus(next: PoStatus) {
    try {
      await postJson(
        `/api/admin/purchase-orders/${poId}/status`,
        { status: next },
        'Failed to update status',
      );
      message.success(`Status updated to ${PO_STATUS[next].label}`);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update status');
    }
  }

  async function issueRevision() {
    const reason = revisionReason.trim();
    if (reason.length < 1 || reason.length > 500) {
      message.error('Enter a reason (1–500 characters)');
      return;
    }
    setIssuingRevision(true);
    try {
      await postJson(
        `/api/admin/purchase-orders/${poId}/revisions`,
        { reason },
        'Failed to issue revision',
      );
      message.success('Revision issued');
      setRevisionModalOpen(false);
      setRevisionReason('');
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to issue revision');
    } finally {
      setIssuingRevision(false);
    }
  }

  async function saveSummary() {
    setSavingSummary(true);
    try {
      await patchJson(
        `/api/admin/purchase-orders/${poId}`,
        {
          // Directly settable again (David, 2026-08-06); the order-side re-sync
          // still runs when the ORDER's deadline changes — last write wins.
          deadlineDate: deadline ? deadline.format('YYYY-MM-DD') : null,
          expectedShipDate: expectedShip ? expectedShip.format('YYYY-MM-DD') : null,
          actualShipDate: actualShip ? actualShip.format('YYYY-MM-DD') : null,
          notes: notes.trim() || null,
        },
        'Failed to save',
      );
      message.success('Saved');
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingSummary(false);
    }
  }

  async function saveCustomerRef() {
    setSavingRef(true);
    try {
      await patchJson(
        `/api/admin/purchase-orders/${poId}`,
        { customerRef: refDraft.trim() || null },
        'Failed to save the customer ref',
      );
      message.success('Customer ref saved');
      setRefModalOpen(false);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save the customer ref');
    } finally {
      setSavingRef(false);
    }
  }

  async function changeColorBook(colorBookId: string | null) {
    try {
      await patchJson(
        `/api/admin/purchase-orders/${poId}`,
        { colorBookId },
        'Failed to update the colour book',
      );
      message.success(colorBookId ? 'Colour book updated' : 'Colour book cleared');
      setEditingColorBook(false);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update the colour book');
    }
  }

  /** Link + password together, ready to paste into an email (ShareLinkPanel's pattern). */
  function portalEmailSnippet(url: string, password: string): string {
    return `View and update this purchase order here:\n${url}\n\nPortal password: ${password}`;
  }

  async function copyPortalSnippet() {
    if (!detail || !portalPassword) return;
    try {
      await navigator.clipboard.writeText(portalEmailSnippet(detail.portalUrl, portalPassword));
      message.success('Link and password copied to clipboard');
    } catch {
      message.error('Copy failed — please copy manually');
    }
  }

  async function postComment() {
    // The composer is a contenteditable — an emptied one still posts
    // `<p><br></p>`, so ask the shared emptiness check, never String.trim().
    if (!detail || isNoteEmpty(commentDraft)) return;
    setPostingComment(true);
    try {
      await postJson(
        `/api/admin/orders/${detail.orderId}/notes`,
        { body: commentDraft, kind: 'comment', visibility: 'shared' },
        'Failed to post the comment',
      );
      setCommentDraft('');
      await loadThreads(detail.orderId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to post the comment');
    } finally {
      setPostingComment(false);
    }
  }

  /** Add an internal order note (kind 'note') from the rail — plain text. */
  async function postOrderNote() {
    if (!detail || !noteDraft.trim()) return;
    setPostingNote(true);
    try {
      await postJson(
        `/api/admin/orders/${detail.orderId}/notes`,
        { body: noteDraft.trim(), kind: 'note' },
        'Failed to add the note',
      );
      setNoteDraft('');
      await loadThreads(detail.orderId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to add the note');
    } finally {
      setPostingNote(false);
    }
  }

  /** Attach a production file from the Comments rail (shared with the supplier). */
  async function attachFile(file: File) {
    setAttaching(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const cat = attachCategory.trim();
      if (cat) form.append('category', cat);
      await postForm(
        `/api/admin/purchase-orders/${poId}/files`,
        form,
        'Failed to attach the file',
      );
      message.success(`${file.name} attached`);
      await reloadFiles();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to attach the file');
    } finally {
      setAttaching(false);
    }
  }

  /** Re-cut an UNSENT PO's snapshot from live order data (409 once sent). */
  async function refreshFromOrder() {
    setRefreshing(true);
    try {
      await postJson(
        `/api/admin/purchase-orders/${poId}/refresh`,
        {},
        'Failed to refresh the purchase order',
      );
      message.success('Purchase order refreshed from the live order');
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to refresh the purchase order');
    } finally {
      setRefreshing(false);
    }
  }

  /**
   * Add a team-only image to one garment ON THE ORDER (internalOnly — hidden
   * from the customer), then fold it into this PO: a draft/approved PO re-cuts
   * its snapshot via the refresh route; once sent the refresh 409s and the
   * change needs a revision instead.
   */
  async function addGarmentImage(garmentId: string, file: File) {
    if (!detail) return;
    setUploadingImageFor(garmentId);
    try {
      const form = new FormData();
      form.append('file', file);
      const caption = (imageCaptions[garmentId] ?? '').trim();
      if (caption) form.append('caption', caption);
      form.append('internalOnly', 'true');
      await postForm(
        `/api/admin/orders/${detail.orderId}/garments/${garmentId}/images`,
        form,
        'Failed to upload the image',
      );
      setImageCaptions((prev) => ({ ...prev, [garmentId]: '' }));
      try {
        await postJson(
          `/api/admin/purchase-orders/${poId}/refresh`,
          {},
          'Failed to refresh the purchase order',
        );
        message.success('Image added — purchase order refreshed from the order');
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          // The image is safely on the order; the sent snapshot just doesn't
          // include it yet — that is what revisions are for.
          message.warning(
            'Image saved to the order, but this purchase order has already been sent — issue a revision to include it.',
          );
        } else {
          message.error(
            err instanceof Error ? err.message : 'Failed to refresh the purchase order',
          );
        }
      }
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to upload the image');
    } finally {
      setUploadingImageFor(null);
    }
  }

  if (loading && !detail) {
    return (
      <div style={{ textAlign: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!detail) {
    return <Alert type="error" message="Failed to load purchase order" showIcon />;
  }

  const latest = detail.revisions[0]; // newest first
  const summary = sizeSummary(latest.snapshot);
  const summaryByGarment = new Map(summary.perGarment.map((g) => [g.garmentId, g]));

  const legalTransitions = PO_STATUSES.filter((s) =>
    canTransition(detail.status as PoStatus, s),
  );
  const supplierHasEmail = Boolean(detail.supplier.email);
  const isDraft = detail.status === 'draft';
  // Mirrors sendPurchaseOrder's guards: a draft must be approved first, and a
  // received/completed/cancelled PO has nothing left to send.
  const canSend = !['draft', 'received', 'completed', 'cancelled'].includes(detail.status);
  // Mirrors refreshDraftSnapshot's guard: an UNSENT (draft/approved) PO tracks
  // the live order via refresh; once sent, changes go through revisions.
  const canRefresh = detail.status === 'draft' || detail.status === 'approved';
  // No revision noise before sending (David, 2026-08-06) — the history card
  // only appears from 'sent' onward, exactly when refresh stops being legal.
  const showRevisionHistory = !canRefresh;

  // Dirty checks — the save buttons only render when something actually
  // changed against what the last load brought back (David, 2026-08-06).
  const fmtDay = (d: Dayjs | null) => (d ? d.format('YYYY-MM-DD') : null);
  const datesDirty =
    fmtDay(deadline) !== detail.deadlineDate ||
    fmtDay(expectedShip) !== detail.expectedShipDate ||
    fmtDay(actualShip) !== detail.actualShipDate;
  const notesDirty = notes !== (detail.notes ?? '');

  // The Comments rail is ONE chronological stream of shared comments and
  // production-file uploads — the same merge rule as the supplier's activity
  // feed, so both sides read the same story.
  const commentFeed = buildActivityFeed<PoOrderNote, PoFileItem>({
    comments,
    files: files ?? [],
  });

  // Outstanding checklist items drive a HINT on the Send button (the card's
  // data is already loaded); the server remains the enforcement on POST /send.
  const checklistOutstanding = (checklistItems ?? []).filter((item) => !item.satisfied);
  const sendButton = (
    <Button
      icon={<MailOutlined />}
      disabled={!supplierHasEmail || !canSend}
      onClick={() => setSendModalOpen(true)}
    >
      Send to supplier
    </Button>
  );

  // The DISPLAY title (David, 2026-08-06): "2608-DY3-DAVID-BAIRD" once sent,
  // "DY3-DAVID-BAIRD" before. poNumber stays the canonical identity (URLs,
  // portal, emails) and is shown beneath whenever the two differ.
  const displayTitle = poDisplayTitle(detail);

  return (
    <div>
      <AdminPageHeader
        title={
          <Space size={12}>
            <span style={{ fontFamily: 'monospace' }}>{displayTitle}</span>
            <Tooltip title="Edit the customer ref in the PO title">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                aria-label="Edit customer ref"
                onClick={() => {
                  setRefDraft(detail.customerRef ?? '');
                  setRefModalOpen(true);
                }}
              />
            </Tooltip>
            <PoStatusBadge status={detail.status} />
            <Tag>v{detail.currentRevisionNumber}</Tag>
          </Space>
        }
        subtitle={
          <>
            {displayTitle !== detail.poNumber && (
              <>
                <Text type="secondary" style={{ fontFamily: 'monospace' }}>
                  {detail.poNumber}
                </Text>
                {' · '}
              </>
            )}
            {detail.supplier.name} · order{' '}
            <Link href={`/admin/orders/${detail.orderId}`}>{detail.order.orderNumber}</Link> (
            {detail.order.customerName})
          </>
        }
        extra={
          <Space>
            {isDraft && (
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => applyStatus('approved')}
              >
                Move to review
              </Button>
            )}
            {supplierHasEmail && canSend ? (
              checklistOutstanding.length > 0 ? (
                // Sendable, but the pre-send checklist would refuse — say so
                // here rather than after the modal's confirm.
                <Tooltip
                  title={`Pre-send checklist incomplete: ${checklistOutstanding
                    .map((item) => item.label)
                    .join('; ')}`}
                >
                  {sendButton}
                </Tooltip>
              ) : (
                sendButton
              )
            ) : (
              <Tooltip
                title={
                  !supplierHasEmail
                    ? 'Supplier has no email address'
                    : isDraft
                      ? 'Move the purchase order to Review before sending it'
                      : `A ${PO_STATUS[detail.status as PoStatus]?.label.toLowerCase() ?? detail.status} purchase order cannot be sent`
                }
              >
                {sendButton}
              </Tooltip>
            )}
            <a href={`/api/admin/purchase-orders/${poId}/pdf`}>
              <Button icon={<DownloadOutlined />}>Download PDF</Button>
            </a>
            <a href={`/api/admin/purchase-orders/${poId}/xlsx`}>
              <Button icon={<FileExcelOutlined />}>Download XLSX</Button>
            </a>
            {legalTransitions.length > 0 && (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: legalTransitions.map((s) => ({
                    key: s,
                    label: PO_STATUS[s].label,
                    danger: s === 'cancelled',
                  })),
                  onClick: ({ key }) => {
                    const next = key as PoStatus;
                    if (next === 'cancelled') {
                      modal.confirm({
                        title: 'Cancel this purchase order?',
                        content:
                          'A cancelled purchase order is terminal — it cannot be reactivated, and its sizing rows stop counting as covered.',
                        okText: 'Cancel purchase order',
                        okButtonProps: { danger: true },
                        cancelText: 'Keep',
                        onOk: () => applyStatus(next),
                      });
                    } else {
                      applyStatus(next);
                    }
                  },
                }}
              >
                <Button type="primary">
                  Advance status <DownOutlined />
                </Button>
              </Dropdown>
            )}
          </Space>
        }
      />

      {varianceInfo?.variance.hasVariance && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Order has changed since revision ${latest.revisionNumber} — ${varianceInfo.counts.added} added / ${varianceInfo.counts.modified} modified / ${varianceInfo.counts.removed} removed`}
          action={
            // Unsent POs refresh in place — revisions are for after sending.
            canRefresh ? (
              <Button
                size="small"
                type="primary"
                icon={<SyncOutlined />}
                loading={refreshing}
                onClick={() => void refreshFromOrder()}
              >
                Refresh from order
              </Button>
            ) : (
              <Button size="small" type="primary" onClick={() => setRevisionModalOpen(true)}>
                Issue revision
              </Button>
            )
          }
          description={
            <Collapse
              ghost
              size="small"
              items={[
                {
                  key: 'diff',
                  label: 'View differences',
                  children: <VarianceDiff variance={varianceInfo.variance} />,
                },
              ]}
            />
          }
        />
      )}

      {/* Two-column layout (David, 2026-08-06 round three): the row spreads to
          1600px — the main column FLUID (the old 1100px cap left dead space
          between the columns on big screens), the sticky right rail of
          reference material (order notes + supplier comments) pinned to the
          row's right edge. Same wrapper values as OrderDetailView — keep the
          two pages in step. */}
      <div
        data-testid="detail-layout"
        style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', maxWidth: 1600 }}
      >
      <div style={{ flex: '1 1 640px', minWidth: 0 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card title="Summary" size="small" styles={CARD_STYLES}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                Supplier
              </Text>
              <div>
                <Text strong>{detail.supplier.name}</Text>
              </div>
              {detail.supplier.contactPerson && <div>{detail.supplier.contactPerson}</div>}
              <div>
                {detail.supplier.email ?? <Text type="secondary">No email address</Text>}
              </div>
              {detail.supplier.phone && <div>{detail.supplier.phone}</div>}
              <div style={{ marginTop: 12 }}>
                <Text type="secondary">Order: </Text>
                <Link href={`/admin/orders/${detail.orderId}`}>{detail.order.orderNumber}</Link>
              </div>
              {/* The supplier colour book the job is matched against (David,
                  2026-08-05) — the factory-relevant edition, printed on the
                  PDF/XLSX. Edit offers the supplier's books, newest = default. */}
              <div style={{ marginTop: 4 }}>
                <Text type="secondary">Colour book: </Text>
                <Text strong>
                  {detail.colorBookName ?? <Text type="secondary">None</Text>}
                </Text>
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => setEditingColorBook((v) => !v)}
                  aria-label="Edit colour book"
                >
                  Edit
                </Button>
                {editingColorBook && (
                  <div style={{ marginTop: 6 }}>
                    <ColorBookSelect
                      supplierId={detail.supplier.id}
                      value={detail.colorBookId}
                      onChange={(id) => void changeColorBook(id)}
                      allowClear
                    />
                  </div>
                )}
              </div>
              {detail.sentAt && (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary">First sent: {formatDate(detail.sentAt)}</Text>
                </div>
              )}
            </div>
            <div>
              <div>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>
                  Notes to supplier
                </Text>
                <Input.TextArea
                  rows={3}
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything the supplier needs to know"
                />
              </div>
              {/* Dirty-only (David, 2026-08-06): no save button unless the
                  notes differ from what the last load brought back. */}
              {notesDirty && (
                <div style={{ marginTop: 12, textAlign: 'right' }}>
                  <Button type="primary" loading={savingSummary} onClick={saveSummary}>
                    Save notes
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>

<<<<<<< Updated upstream
        {/* The dates sit together just above the line items (David, 2026-08-06:
            "so we can copy things across as needed without scrolling"). */}
        <Card title="Dates" size="small" styles={CARD_STYLES}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>
                Customer deadline
              </Text>
              <Tooltip title="Auto-imported from the customer order, and re-synced if the order's deadline changes — the last write wins. Hidden from the supplier.">
                <DatePicker
                  style={{ width: '100%' }}
                  format="DD MMM YYYY"
                  value={deadline}
                  onChange={setDeadline}
                  placeholder="None set"
                  aria-label="Customer deadline"
                />
              </Tooltip>
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>
                Required ship date
              </Text>
              <DatePicker
                style={{ width: '100%' }}
                format="DD MMM YYYY"
                value={expectedShip}
                onChange={setExpectedShip}
                aria-label="Required ship date"
              />
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>
                Actual ship
              </Text>
              <DatePicker
                style={{ width: '100%' }}
                format="DD MMM YYYY"
                value={actualShip}
                onChange={setActualShip}
                aria-label="Actual ship date"
              />
            </div>
          </div>
          {/* Dirty-only (David, 2026-08-06): appears when a date changed. */}
          {datesDirty && (
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Button type="primary" loading={savingSummary} onClick={saveSummary}>
                Save dates
              </Button>
            </div>
          )}
        </Card>

        <Card
          title={`Lines — revision ${latest.revisionNumber}`}
          size="small"
          styles={CARD_STYLES}
          extra={
            <Space size={12}>
              {/* Unsent POs re-cut their snapshot from the live order in place
                  (David, 2026-08-06) — gone once sent, when refresh 409s. */}
              {canRefresh && (
                <Button
                  size="small"
                  icon={<SyncOutlined />}
                  loading={refreshing}
                  onClick={() => void refreshFromOrder()}
                >
                  Refresh from order
                </Button>
              )}
              <Text type="secondary">
                {summary.grandTotal} piece{summary.grandTotal === 1 ? '' : 's'} total
              </Text>
            </Space>
          }
        >
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {latest.snapshot.garments.map((g) => {
              const gSummary = summaryByGarment.get(g.garmentId);
              const strip = gSummary
                ? Object.entries(gSummary.counts)
                    .map(([size, n]) => `${size} ×${n}`)
                    .join(' · ')
                : '';
              const fabricPairs = Object.entries(g.selectedFabrics ?? {});
              const optionPairs = Object.entries(g.selectedOptions ?? {});
              // Signed by getPurchaseOrder for the latest revision (the only
              // one rendered inline): charts carry downloadUrl, images carry
              // url/thumbnailUrl.
              const charts = (g.sizeCharts ?? []) as SignedSnapshotChart[];
              const images = (g.images ?? []) as SignedSnapshotImage[];
              return (
                <div key={g.garmentId}>
                  <div style={{ marginBottom: 4 }}>
                    {/* The garment NAME leads the hierarchy (David, round
                        three; 18px round four — more daylight between it and
                        the section labels below). */}
                    <Text strong style={{ fontSize: 18, fontWeight: 700 }}>
                      {g.name}
                    </Text>
                    {g.garmentTypeName && (
                      <Text type="secondary" style={{ marginLeft: 8 }}>
                        {g.garmentTypeName}
                      </Text>
                    )}
                  </div>
                  {(fabricPairs.length > 0 || g.fabrics.length > 0 || optionPairs.length > 0) && (
                    <div style={DETAIL_COLUMNS_STYLE} data-testid={`garment-details-${g.garmentId}`}>
                      {(fabricPairs.length > 0 || g.fabrics.length > 0) && (
                        <div>
                          <SnapshotSectionLabel>Fabrics</SnapshotSectionLabel>
                          {fabricPairs.length > 0
                            ? fabricPairs.map(([part, fabric]) => (
                                <Text key={part} style={STACKED_ENTRY_STYLE}>
                                  {`${part}: ${fabric}`}
                                </Text>
                              ))
                            : g.fabrics.map((fabric) => (
                                <Text key={fabric} style={STACKED_ENTRY_STYLE}>
                                  {fabric}
                                </Text>
                              ))}
                        </div>
                      )}
                      {optionPairs.length > 0 && (
                        <div>
                          <SnapshotSectionLabel>Options</SnapshotSectionLabel>
                          {optionPairs.map(([label, value]) => (
                            <Text key={label} style={STACKED_ENTRY_STYLE}>
                              {`${label}: ${value}`}
                            </Text>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {charts.length > 0 && (
                    <>
                      <SnapshotSectionLabel>Size charts</SnapshotSectionLabel>
                      <Space size={4} wrap>
                        {charts.map((chart) =>
                          chart.downloadUrl ? (
                            <a
                              key={chart.id}
                              href={chart.downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Tag
                                icon={<PaperClipOutlined />}
                                style={{ marginInlineEnd: 0, cursor: 'pointer' }}
                              >
                                {chart.name}
                              </Tag>
                            </a>
                          ) : (
                            <Tag key={chart.id} style={{ marginInlineEnd: 0 }}>
                              {chart.name}
                            </Tag>
                          ),
                        )}
                      </Space>
                    </>
                  )}
                  {images.length > 0 && (
                    <>
                      <SnapshotSectionLabel>Images</SnapshotSectionLabel>
                      {/* Clickable thumbnails (David, 2026-08-06: "I actually
                          want to see the image in our admin view of the PO"). */}
                      <Space size={10} wrap align="start">
                        {images.map((img) => {
                          const thumb = img.thumbnailUrl ?? img.url ?? null;
                          const body = thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; next/image cannot optimise it
                            <img
                              src={thumb}
                              alt={img.caption ?? 'Garment mock-up'}
                              style={{
                                height: 84,
                                maxWidth: 160,
                                objectFit: 'contain',
                                borderRadius: 6,
                                border: '1px solid var(--ant-color-border-secondary, #d9d9d9)',
                                display: 'block',
                              }}
                            />
                          ) : (
                            <Tag style={{ marginInlineEnd: 0 }}>
                              {img.caption ?? 'Image unavailable'}
                            </Tag>
                          );
                          return (
                            <div key={img.id} style={{ textAlign: 'center' }}>
                              {img.url ? (
                                <a
                                  href={img.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`Open mock-up${img.caption ? ` ${img.caption}` : ''}`}
                                >
                                  {body}
                                </a>
                              ) : (
                                body
                              )}
                              {img.caption && (
                                <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                                  {img.caption}
                                </Text>
                              )}
                            </div>
                          );
                        })}
                      </Space>
                    </>
                  )}
                  {/* Supplement the order's images with production-grade shots
                      (David, 2026-08-06): posted to the ORDER as internalOnly
                      (never customer-visible), then an unsent PO re-cuts its
                      snapshot so the image appears above; a sent PO needs a
                      revision instead. */}
                  <div style={{ marginTop: 8 }}>
                    <Space size={6} wrap>
                      <Input
                        size="small"
                        maxLength={200}
                        placeholder="Caption (optional)"
                        aria-label={`Image caption for ${g.name}`}
                        value={imageCaptions[g.garmentId] ?? ''}
                        onChange={(e) =>
                          setImageCaptions((prev) => ({ ...prev, [g.garmentId]: e.target.value }))
                        }
                        style={{ width: 200 }}
                      />
                      <Upload
                        showUploadList={false}
                        accept="image/*"
                        beforeUpload={(file) => {
                          void addGarmentImage(g.garmentId, file as unknown as File);
                          return false;
                        }}
                      >
                        <Button
                          size="small"
                          icon={<UploadOutlined />}
                          loading={uploadingImageFor === g.garmentId}
                          aria-label={`Add image to ${g.name}`}
                        >
                          Add image
                        </Button>
                      </Upload>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                      Order images not ideal for production? Add a team-only image here — it rides
                      the purchase order to the factory and is never shown to the customer.
                    </Text>
                  </div>
                  <SnapshotSectionLabel>Sizing</SnapshotSectionLabel>
                  <Table
                    dataSource={g.lines}
                    columns={buildLineColumns(g)}
                    rowKey="sizingRowId"
                    size="small"
                    pagination={false}
                    locale={{ emptyText: 'No sizing rows in this snapshot' }}
                  />
                  {gSummary && gSummary.total > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {strip} — {gSummary.total} piece{gSummary.total === 1 ? '' : 's'}
                      </Text>
                    </div>
                  )}
                </div>
              );
            })}
          </Space>
        </Card>

        {/* Production files: layouts / test prints / production layouts,
            shared both ways with the supplier (David, 2026-08-05). The page
            owns the data so the Comments rail feed renders the same items. */}
        <PoFilesCard poId={poId} items={files} loadError={filesError} onChanged={reloadFiles} />

        {(latest.snapshot.assets ?? []).length > 0 && (
          <Card title="Design files" size="small" styles={CARD_STYLES}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {latest.snapshot.assets!.map((asset, i) => {
                // Signed here by the GET route (the stored snapshot only ever
                // keeps the storageKey) — see signPoAssets in src/lib/signed-urls.ts.
                const signed = asset as PoSnapshotAsset & { downloadUrl?: string | null };
                const link = signed.downloadUrl ?? signed.url;
                return (
                  <div key={`${asset.name}-${i}`}>
                    <Space size={6} wrap>
                      <Tag color={ASSET_KIND_COLOR[asset.kind]} style={{ marginInlineEnd: 0 }}>
                        {ASSET_KIND_LABEL[asset.kind]}
                      </Tag>
                      {link ? (
                        <a href={link} target="_blank" rel="noopener noreferrer">
                          <Space size={4}>
                            {asset.storageKey ? <PaperClipOutlined /> : <LinkOutlined />}
                            {asset.name}
                          </Space>
                        </a>
                      ) : (
                        <Text strong>{asset.name}</Text>
                      )}
                      {asset.garmentName && <Text type="secondary">({asset.garmentName})</Text>}
                      {asset.usage && <Text type="secondary">for {asset.usage}</Text>}
                    </Space>
                    {asset.notes && (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {asset.notes}
                        </Text>
                      </div>
                    )}
                  </div>
                );
              })}
            </Space>
          </Card>
        )}

        <Card title="Shipments" size="small" styles={CARD_STYLES}>
          {detail.shipments.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {detail.shipments.map((s) => (
                <Space key={s.id} size={12}>
                  <Text strong>{s.nickname ?? s.trackingNumber ?? 'Shipment'}</Text>
                  {s.carrier && <Text type="secondary">{s.carrier}</Text>}
                  <ShipmentStatusBadge status={s.status} />
                </Space>
              ))}
            </Space>
          ) : (
            <Text type="secondary">
              No shipments attached yet. Shipment management arrives with the Shipments page.
            </Text>
          )}
        </Card>

        <Card title="Supplier Portal" size="small" styles={CARD_STYLES}>
=======
        <Card title="Conditional reminders" size="small">
          <ConditionalReminders boardKey="purchase_order" entityId={poId} />
        </Card>

        <Card title="Supplier Portal" size="small">
>>>>>>> Stashed changes
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              The supplier&apos;s permanent link to this purchase order — view the latest
              revision, push the status forward, and leave a comment. Guarded by the
              supplier&apos;s portal password.
            </Text>

            {/* Same compact treatment as the customer link (ShareLinkPanel). */}
            <Space wrap size={8}>
              <Text code copyable={{ text: detail.portalUrl }} style={{ wordBreak: 'break-all' }}>
                {detail.portalUrl}
              </Text>
              <Button
                size="small"
                icon={<ExportOutlined />}
                href={detail.portalUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open
              </Button>
            </Space>

            {portalPassword === null && (
              <Alert
                type="warning"
                showIcon
                message="The supplier portal is closed"
                description={
                  <span>
                    {detail.supplier.name} has no portal password, so this link won&apos;t open
                    until an admin sets one on the{' '}
                    <Link href="/admin/suppliers">supplier record</Link>.
                  </span>
                }
              />
            )}

            {/* The password itself, big enough to spot (David, 2026-08-06). */}
            {portalPassword && (
              <div>
                <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                  Portal password
                </Text>
                <Text
                  strong
                  copyable
                  data-testid="portal-password"
                  style={{ fontSize: 17, fontFamily: 'monospace' }}
                >
                  {portalPassword}
                </Text>
              </div>
            )}

            {/* Link + password together, ready to paste into an email. */}
            {portalPassword && (
              <div
                style={{
                  padding: '10px 14px',
                  background: 'var(--ant-color-fill-tertiary)',
                  border: '1px solid var(--ant-color-border)',
                  borderRadius: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Text strong>For your email</Text>
                  <Button
                    type="primary"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={copyPortalSnippet}
                  >
                    Copy link + password
                  </Button>
                </div>
                <Text
                  type="secondary"
                  style={{ fontSize: 12, whiteSpace: 'pre-wrap', display: 'block', wordBreak: 'break-all' }}
                >
                  {portalEmailSnippet(detail.portalUrl, portalPassword)}
                </Text>
              </div>
            )}

            {detail.supplierLink.lastViewedAt && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Legacy emailed link last opened {formatDate(detail.supplierLink.lastViewedAt)}
              </Text>
            )}
          </Space>
        </Card>

        {/* Hidden while draft/approved (David, 2026-08-06: no revision noise
            before sending) — appears from 'sent' onward. */}
        {showRevisionHistory && (
        <Card title="Revision history" size="small" styles={CARD_STYLES}>
          <Timeline
            items={detail.revisions.map((r) => ({
              key: r.id,
              children: (
                <Space size={8} wrap>
                  <Text strong>Revision {r.revisionNumber}</Text>
                  <Text type="secondary">— {r.reason ?? 'Original'} —</Text>
                  <Text type="secondary">{formatDate(r.createdAt)}</Text>
                  <a
                    href={`/api/admin/purchase-orders/${poId}/pdf?rev=${r.revisionNumber}`}
                    aria-label={`PDF for revision ${r.revisionNumber}`}
                  >
                    PDF
                  </a>
                  <a
                    href={`/api/admin/purchase-orders/${poId}/xlsx?rev=${r.revisionNumber}`}
                    aria-label={`XLSX for revision ${r.revisionNumber}`}
                  >
                    XLSX
                  </a>
                </Space>
              ),
            }))}
          />
        </Card>
        )}

        <Card title="History" size="small" styles={CARD_STYLES}>
          {detail.history.length === 0 ? (
            <Text type="secondary">Nothing recorded yet.</Text>
          ) : (
            <Timeline
              items={detail.history.map((entry) => {
                const from = entry.payload?.from;
                const to = entry.payload?.to;
                const isStatus = entry.eventType === 'po.status_changed';
                return {
                  key: entry.id,
                  children: (
                    <Space size={8} wrap>
                      <Text strong>
                        {HISTORY_EVENT_LABEL[entry.eventType] ?? entry.eventType}
                      </Text>
                      {typeof from === 'string' && typeof to === 'string' && (
                        <Text>
                          {isStatus ? poStatusMeta(from).label : from} →{' '}
                          {isStatus ? poStatusMeta(to).label : to}
                        </Text>
                      )}
                      {entry.actorEmail && (
                        <Text type="secondary">{entry.actorEmail}</Text>
                      )}
                      <Text type="secondary">{formatDate(entry.createdAt)}</Text>
                    </Space>
                  ),
                };
              })}
            />
          )}
        </Card>

      </Space>
      </div>

      {/* The right rail: reference material that stays alongside the form
          while it scrolls. Sticky below the fixed shell header. */}
      <div
        style={{
          flex: '1 1 360px',
          maxWidth: 400,
          minWidth: 320,
          position: 'sticky',
          top: 80,
          alignSelf: 'flex-start',
          maxHeight: 'calc(100vh - 96px)',
          overflowY: 'auto',
        }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* The pre-send checklist (David, 2026-08-06) — above the notes, so
              production works down the rail: checks, then the points behind
              them. Sending is blocked server-side while anything is open. */}
          <PoChecklistCard
            items={checklistItems}
            loadError={checklistError}
            onToggle={handleChecklistToggle}
          />

          {/* Retitled from "Order notes (from the order)" (David, 2026-08-06)
              and given a composer — production points can be added right here. */}
          <Card title="Internal order notes" size="small" styles={CARD_STYLES}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                The team&apos;s order notes, brought through so production can check every point
                has been dealt with. Staff-only — never shown to the supplier or the customer.
              </Text>
              {orderNotes.length === 0 ? (
                <Text type="secondary">No order notes.</Text>
              ) : (
                orderNotes.map((note) => (
                  <div key={note.id}>
                    <Space size={6} wrap>
                      <Text strong style={{ fontSize: 13 }}>
                        {noteAuthor(note)}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDate(note.createdAt)}
                      </Text>
                    </Space>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{note.body}</div>
                  </div>
                ))
              )}
              <div>
                <Input.TextArea
                  rows={2}
                  maxLength={2000}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Add an order note…"
                  aria-label="New order note"
                />
                <div style={{ marginTop: 6 }}>
                  <Button
                    size="small"
                    icon={<SendOutlined />}
                    loading={postingNote}
                    disabled={!noteDraft.trim()}
                    onClick={() => void postOrderNote()}
                  >
                    Add note
                  </Button>
                </div>
              </div>
            </Space>
          </Card>

          {/* One chronological stream of shared comments AND production-file
              uploads (David, 2026-08-06) — mirrors the supplier's activity
              feed, image files rendering as inline thumbnails. */}
          <Card title="Comments" size="small" styles={CARD_STYLES}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                The conversation shared with the supplier on their portal — comments and file
                uploads in one stream. Anything posted here is visible to the supplier.
              </Text>
              {commentFeed.length === 0 ? (
                <Text type="secondary">No shared comments yet.</Text>
              ) : (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  {commentFeed.map((entry) => {
                    if (entry.kind === 'comment') {
                      const note = entry.comment;
                      return (
                        <div key={note.id}>
                          <Space size={6} wrap>
                            <Text strong style={{ fontSize: 13 }}>
                              {noteAuthor(note)}
                            </Text>
                            {note.authorKind === 'supplier' && (
                              <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                                Supplier
                              </Tag>
                            )}
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {formatDate(note.createdAt)}
                            </Text>
                          </Space>
                          {note.bodyHtml ? (
                            <div
                              className="bm-note-body"
                              style={{ fontSize: 13, lineHeight: 1.5 }}
                              // Sanitised again at the LAST point before the
                              // DOM (NotesThread's NoteBody rule) — rows can
                              // predate the sanitiser or come from another
                              // writer.
                              dangerouslySetInnerHTML={{
                                __html: sanitizeNoteHtml(note.bodyHtml),
                              }}
                            />
                          ) : (
                            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{note.body}</div>
                          )}
                        </div>
                      );
                    }
                    if (entry.kind === 'file') {
                      const f = entry.file;
                      const showThumb = Boolean(f.downloadUrl) && isImageFileName(f.fileName);
                      const fileComments = f.comments.filter((c) => !c.deleted);
                      return (
                        <div
                          key={f.id}
                          style={{
                            border: '1px solid var(--ant-color-border-secondary, #d9d9d9)',
                            borderRadius: 8,
                            padding: '8px 10px',
                          }}
                        >
                          <Space size={6} wrap>
                            {f.category && (
                              <Tag style={{ marginInlineEnd: 0 }}>{f.category}</Tag>
                            )}
                            {f.downloadUrl ? (
                              <a href={f.downloadUrl} target="_blank" rel="noopener noreferrer">
                                <Space size={4}>
                                  <PaperClipOutlined />
                                  {f.fileName}
                                </Space>
                              </a>
                            ) : (
                              <Text strong style={{ fontSize: 13 }}>
                                {f.fileName}
                              </Text>
                            )}
                            {f.uploadedByKind === 'supplier' && (
                              <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                                Supplier
                              </Tag>
                            )}
                          </Space>
                          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                            {[f.uploadedByLabel, formatDate(f.createdAt)]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                          {showThumb && (
                            <a href={f.downloadUrl!} target="_blank" rel="noopener noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; next/image cannot optimise it */}
                              <img
                                src={f.downloadUrl!}
                                alt={f.fileName}
                                style={{
                                  display: 'block',
                                  maxWidth: '100%',
                                  maxHeight: 200,
                                  objectFit: 'contain',
                                  borderRadius: 6,
                                  border: '1px solid var(--ant-color-border-secondary, #d9d9d9)',
                                  marginTop: 6,
                                }}
                              />
                            </a>
                          )}
                          {fileComments.map((c) => (
                            <div key={c.id} style={{ marginTop: 4, marginLeft: 8 }}>
                              <Space size={6} wrap>
                                <Text strong style={{ fontSize: 12 }}>
                                  {c.authorName ?? c.authorEmail ?? c.authorLabel ?? 'Unknown'}
                                </Text>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {formatDate(c.createdAt)}
                                </Text>
                              </Space>
                              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{c.body}</div>
                            </div>
                          ))}
                        </div>
                      );
                    }
                    return null;
                  })}
                </Space>
              )}
              <div>
                {/* Rich text (David, 2026-08-06): posts HTML, sanitised
                    server-side and again wherever it renders. */}
                <RichTextEditor
                  value={commentDraft}
                  onChange={setCommentDraft}
                  disabled={postingComment}
                  placeholder="Reply to the supplier…"
                  ariaLabel="New supplier comment"
                  minHeight={60}
                  onSubmit={() => void postComment()}
                />
                <Space size={6} wrap style={{ marginTop: 6 }}>
                  <Button
                    type="primary"
                    size="small"
                    icon={<SendOutlined />}
                    loading={postingComment}
                    disabled={isNoteEmpty(commentDraft)}
                    onClick={() => void postComment()}
                  >
                    Post to supplier
                  </Button>
                  <AutoComplete
                    size="small"
                    aria-label="Attachment category"
                    options={PO_FILE_CATEGORIES.map((c) => ({ value: c }))}
                    value={attachCategory}
                    onChange={setAttachCategory}
                    style={{ width: 150 }}
                  />
                  <Upload
                    showUploadList={false}
                    beforeUpload={(file) => {
                      void attachFile(file as unknown as File);
                      return false;
                    }}
                  >
                    <Button size="small" icon={<PaperClipOutlined />} loading={attaching}>
                      Attach file
                    </Button>
                  </Upload>
                </Space>
              </div>
            </Space>
          </Card>
        </Space>
      </div>
      </div>

      {/* Send preview (David, 2026-08-06): what's actually going to the
          supplier — subject, body, attachments — plus the optional message.
          A send refused by the checklist/gates lists its blockers in here. */}
      <SendPoModal
        open={sendModalOpen}
        poId={poId}
        revisionNumber={detail.currentRevisionNumber}
        onClose={() => setSendModalOpen(false)}
        onSent={(res) => {
          void handleSent(res);
          // A first send moved the checklist's PO from approved → sent; the
          // card's who/when column may also have gained audit context.
          void reloadChecklist();
        }}
      />

      <Modal
        title="Issue revision"
        open={revisionModalOpen}
        onOk={issueRevision}
        onCancel={() => setRevisionModalOpen(false)}
        confirmLoading={issuingRevision}
        okText="Issue revision"
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Re-snapshots this purchase order from the live order as revision{' '}
          {latest.revisionNumber + 1}. Send the amended PDF to the supplier afterwards.
        </Text>
        <Input.TextArea
          rows={3}
          maxLength={500}
          placeholder="Why is this revision being issued? (required)"
          value={revisionReason}
          onChange={(e) => setRevisionReason(e.target.value)}
        />
      </Modal>

      <Modal
        title="Customer ref (for the PO title)"
        open={refModalOpen}
        onOk={saveCustomerRef}
        onCancel={() => setRefModalOpen(false)}
        confirmLoading={savingRef}
        okText="Save ref"
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Appears in the PO title, e.g. DAVID-BAIRD — normalised to UPPERCASE-DASHED. Leave
          empty to drop it from the title. The canonical PO number never changes.
        </Text>
        <Input
          maxLength={60}
          value={refDraft}
          onChange={(e) => setRefDraft(e.target.value)}
          placeholder="e.g. DAVID-BAIRD"
          aria-label="Customer ref"
        />
      </Modal>
    </div>
  );
}
