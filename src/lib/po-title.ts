/**
 * The purchase order's DISPLAY title (David, 2026-08-06):
 * "2608-DY3-DAVID-BAIRD" — YYMM of the SEND date, the canonical poNumber,
 * then the human-readable customer ref. Before the PO is sent there is no
 * date to imply, so the title is just "DY3-DAVID-BAIRD".
 *
 * Presentation only: poNumber remains the identity everywhere (URLs, portal,
 * emails' canonical reference). The ref is normalised to the uppercase-dashed
 * shape David's existing titles use.
 */
export function normalizePoCustomerRef(ref: string): string {
  return ref
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function poDisplayTitle(po: {
  poNumber: string;
  customerRef?: string | null;
  sentAt?: Date | string | null;
}): string {
  const parts: string[] = [];
  if (po.sentAt) {
    const d = typeof po.sentAt === 'string' ? new Date(po.sentAt) : po.sentAt;
    if (!Number.isNaN(d.getTime())) {
      const yy = String(d.getFullYear() % 100).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      parts.push(`${yy}${mm}`);
    }
  }
  parts.push(po.poNumber);
  if (po.customerRef?.trim()) parts.push(normalizePoCustomerRef(po.customerRef));
  return parts.join('-');
}
