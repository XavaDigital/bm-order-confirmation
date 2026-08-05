/**
 * Production files on a PO (David, 2026-08-05).
 *
 * Suppliers upload their working files at each stage — the layout before test
 * print, the test print itself, the production layout with every size and
 * name applied — and staff comment on each file to ask for changes. A file's
 * comment thread (order_notes rows carrying poFileId, always 'shared') is
 * where "change this, because…" lives; files grouped by category, in upload
 * order, plus those threads ARE the progression record David asked for
 * ("easily see … what was changed and why").
 *
 * Objects live under po-files/{poId}/ in S3 for essentially eternity —
 * soft-delete hides a mistaken upload from the lists but never touches the
 * object.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '@/db';
import { orderNotes, poFiles, purchaseOrders } from '@/db/schema';
import { getFileBuffer, getSignedUrl, poFileKey, uploadFile } from '@/lib/storage';
import { buildZip, type ZipEntry } from '@/lib/zip';
import { logger } from '@/lib/logger';
import { emitOrderEvent, recordAuditEvent } from '@/server/events/outbox';
import { addOrderNote, type OrderNoteDto } from '@/server/orders/notes-service';
import { ConflictError, NotFoundError } from '@/server/orders/service';

export interface PoFileDto {
  id: string;
  poId: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  category: string | null;
  uploadedByKind: 'staff' | 'supplier';
  uploadedByLabel: string | null;
  statusAtUpload: string;
  createdAt: Date;
  /** Short-lived signed link — never stored. */
  downloadUrl: string | null;
  comments: OrderNoteDto[];
}

async function loadPoOrThrow(poId: string) {
  const po = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, poId) });
  if (!po) throw new NotFoundError('Purchase order');
  return po;
}

/** Live files of a PO, oldest first (upload order = progression order), with signed links + threads. */
export async function listPoFiles(poId: string): Promise<PoFileDto[]> {
  const po = await loadPoOrThrow(poId);
  const rows = await db.query.poFiles.findMany({
    where: and(eq(poFiles.poId, poId), isNull(poFiles.deletedAt)),
    orderBy: (f, { asc }) => [asc(f.createdAt)],
  });
  if (rows.length === 0) return [];

  // One notes read for all files — per-file queries would be N round trips.
  const notes = await db.query.orderNotes.findMany({
    where: inArray(
      orderNotes.poFileId,
      rows.map((r) => r.id),
    ),
    orderBy: (n, { asc }) => [asc(n.createdAt)],
    with: {
      garment: { columns: { id: true, name: true } },
      author: { columns: { id: true, name: true, email: true } },
    },
  });
  // Same projection rules as notes-service's toNoteDto (deleted rows keep
  // their place but lose content) — duplicated here because that mapper is
  // module-private and this read batches all threads in one query.
  const threads = new Map<string, OrderNoteDto[]>(rows.map((r) => [r.id, []]));
  for (const note of notes) {
    const deleted = note.deletedAt !== null;
    const dto: OrderNoteDto = {
      id: note.id,
      orderId: note.orderId,
      garmentId: note.garmentId ?? null,
      garmentName: note.garment?.name ?? null,
      poFileId: note.poFileId ?? null,
      bodyHtml: deleted ? null : (note.bodyHtml ?? null),
      body: deleted ? '' : note.body,
      kind: note.kind,
      authorKind: note.authorKind,
      authorName: note.author?.name ?? null,
      authorEmail: note.author?.email ?? note.authorLabel ?? null,
      authorLabel: note.authorLabel ?? null,
      authorStaffUserId: note.authorStaffUserId ?? null,
      visibility: note.visibility,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      edited: !deleted && note.updatedAt.getTime() - note.createdAt.getTime() > 1000,
      deleted,
    };
    threads.get(note.poFileId!)?.push(dto);
  }

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      poId: row.poId,
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      category: row.category,
      uploadedByKind: row.uploadedByKind,
      uploadedByLabel: row.uploadedByLabel,
      statusAtUpload: row.statusAtUpload,
      createdAt: row.createdAt,
      downloadUrl: await getSignedUrl(row.storageKey).catch(() => null),
      comments: threads.get(row.id) ?? [],
    })),
  );
}

/**
 * Store the bytes and create the file row in one motion. `statusAtUpload` is
 * stamped from the PO's current status — that is what lets the file list read
 * as a timeline ("uploaded during Test print").
 */
export async function addPoFile(
  poId: string,
  input: {
    fileName: string;
    data: Buffer;
    contentType: string | null;
    category?: string | null;
    uploadedByKind: 'staff' | 'supplier';
    uploadedByLabel: string | null;
  },
): Promise<PoFileDto> {
  const po = await loadPoOrThrow(poId);

  // Random prefix: two uploads of "layout.pdf" must not overwrite each other —
  // the object store is append-only by convention (files kept forever).
  const key = poFileKey(poId, `${randomBytes(6).toString('base64url')}-${input.fileName}`);
  await uploadFile(key, input.data, input.contentType ?? 'application/octet-stream');

  const [row] = await db
    .insert(poFiles)
    .values({
      poId,
      fileName: input.fileName,
      storageKey: key,
      contentType: input.contentType,
      sizeBytes: input.data.length,
      category: input.category?.trim() || null,
      uploadedByKind: input.uploadedByKind,
      uploadedByLabel: input.uploadedByLabel,
      statusAtUpload: po.status,
    })
    .returning();

  await db.transaction(async (tx) => {
    await emitOrderEvent(tx, {
      aggregateId: po.orderId,
      eventType: 'po.file_uploaded',
      payload: {
        poId,
        poNumber: po.poNumber,
        fileId: row.id,
        fileName: row.fileName,
        category: row.category,
        uploadedByKind: row.uploadedByKind,
        uploadedByLabel: row.uploadedByLabel,
        statusAtUpload: row.statusAtUpload,
      },
    });
    await recordAuditEvent(
      {
        aggregateId: po.orderId,
        eventType: 'po.file_uploaded',
        payload: { poId, poNumber: po.poNumber, fileId: row.id, fileName: row.fileName },
        actorEmail: row.uploadedByLabel,
      },
      tx,
    );
  });

  return {
    id: row.id,
    poId: row.poId,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    category: row.category,
    uploadedByKind: row.uploadedByKind,
    uploadedByLabel: row.uploadedByLabel,
    statusAtUpload: row.statusAtUpload,
    createdAt: row.createdAt,
    downloadUrl: await getSignedUrl(row.storageKey).catch(() => null),
    comments: [],
  };
}

/** A comment on one production file — always 'shared' (both sides read the thread). */
export async function addPoFileComment(
  poId: string,
  fileId: string,
  body: string,
  author: {
    authorKind: 'staff' | 'supplier';
    authorLabel: string | null;
    actorStaffUserId?: string | null;
    actorEmail?: string | null;
  },
): Promise<OrderNoteDto> {
  const po = await loadPoOrThrow(poId);
  const file = await db.query.poFiles.findFirst({ where: eq(poFiles.id, fileId) });
  if (!file || file.poId !== poId || file.deletedAt) throw new NotFoundError('File');

  return addOrderNote(
    po.orderId,
    {
      body,
      authorKind: author.authorKind,
      authorLabel: author.authorLabel,
      poFileId: fileId,
      visibility: 'shared',
    },
    { actorStaffUserId: author.actorStaffUserId, actorEmail: author.actorEmail },
  );
}

/** Hide a mistaken upload. The S3 object stays — files are kept forever. */
export async function softDeletePoFile(
  poId: string,
  fileId: string,
  meta?: { actorEmail?: string | null },
): Promise<void> {
  const po = await loadPoOrThrow(poId);
  const file = await db.query.poFiles.findFirst({ where: eq(poFiles.id, fileId) });
  if (!file || file.poId !== poId) throw new NotFoundError('File');
  if (file.deletedAt) return;

  await db
    .update(poFiles)
    .set({ deletedAt: new Date() })
    .where(eq(poFiles.id, fileId));
  await recordAuditEvent({
    aggregateId: po.orderId,
    eventType: 'po.file_removed',
    payload: { poId, poNumber: po.poNumber, fileId, fileName: file.fileName },
    actorEmail: meta?.actorEmail ?? null,
  });
}

/**
 * Everything on the PO as one zip (David, 2026-08-05: "download all of the
 * files for the order as a zip"): the latest revision's design/font assets,
 * size charts and mock-up images, plus every live production file. Unreadable
 * objects are skipped with a warning — one lost object must not kill the
 * bundle (same stance as the email attachments).
 */
export async function buildPoZip(poId: string): Promise<{ fileName: string; data: Buffer }> {
  const po = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, poId),
    with: { revisions: { orderBy: (r, { desc }) => [desc(r.revisionNumber)], limit: 1 } },
  });
  if (!po) throw new NotFoundError('Purchase order');
  const snapshot = po.revisions[0]?.snapshot;

  const wanted: { name: string; storageKey: string }[] = [];
  for (const asset of snapshot?.assets ?? []) {
    if (asset.storageKey) {
      const ext = asset.storageKey.split('.').pop() ?? 'bin';
      wanted.push({ name: `assets/${asset.name}.${ext}`, storageKey: asset.storageKey });
    }
  }
  const chartKeys = new Set<string>();
  for (const garment of snapshot?.garments ?? []) {
    for (const chart of garment.sizeCharts ?? []) {
      if (chart.storageKey && !chartKeys.has(chart.storageKey)) {
        chartKeys.add(chart.storageKey);
        const ext = chart.storageKey.split('.').pop() ?? 'bin';
        wanted.push({ name: `size-charts/${chart.name}.${ext}`, storageKey: chart.storageKey });
      }
    }
    for (const image of garment.images ?? []) {
      const ext = image.storageKey.split('.').pop() ?? 'bin';
      wanted.push({
        name: `images/${garment.name}/${image.caption ?? image.id}.${ext}`,
        storageKey: image.storageKey,
      });
    }
  }
  const files = await db.query.poFiles.findMany({
    where: and(eq(poFiles.poId, poId), isNull(poFiles.deletedAt)),
    orderBy: (f, { asc }) => [asc(f.createdAt)],
  });
  for (const file of files) {
    wanted.push({
      name: `production-files/${file.category ?? 'uncategorised'}/${file.fileName}`,
      storageKey: file.storageKey,
    });
  }

  if (wanted.length === 0) throw new ConflictError('This purchase order has no files to download');

  const entries: ZipEntry[] = [];
  for (const item of wanted) {
    try {
      entries.push({ name: item.name, data: await getFileBuffer(item.storageKey) });
    } catch (err) {
      logger.warn('[po/zip] file skipped — could not read from storage', {
        poId,
        key: item.storageKey,
        err,
      });
    }
  }
  if (entries.length === 0) {
    throw new ConflictError('None of the files could be read from storage');
  }

  return { fileName: `${po.poNumber}-files.zip`, data: buildZip(entries) };
}
