/**
 * "Has this order changed since the customer agreed to it?" (David, 2026-08-07)
 *
 * A confirmation is a record of what someone actually agreed to. Edit the order
 * afterwards and that record quietly stops describing the job — the signature is
 * still on file, but for a different order. This module is the detection half of
 * the fix: it compares the order AS IT IS NOW against the snapshot the customer
 * signed, and says what moved.
 *
 * DERIVED, not tracked. There is no "dirty" column and no hook on the two dozen
 * paths that can edit an order — every one of them would eventually be missed,
 * and a change-tracking flag that is wrong is worse than none. Instead the
 * current order is re-projected through the SAME `buildConfirmationSnapshot`
 * used at confirmation time and the two are compared. Anything that changes the
 * agreement necessarily changes the snapshot.
 *
 * Two severities, because they earn different reactions:
 *  - MATERIAL — the commercial substance: what is being made, how many, what
 *    size, what it costs, where it goes. The customer has not agreed to this
 *    version. Raises the banner and holds the purchase order.
 *  - MINOR — everything else that is nonetheless part of the signed record
 *    (dates, notes, the invoice link). Worth showing so nobody is surprised,
 *    not worth stopping production or re-asking a customer over.
 *
 * Pure: no I/O, exported whole for tests.
 */

export type ChangeSeverity = 'material' | 'minor';

export interface OrderChange {
  /** Stable machine key — `garment:Home Jersey:sizing`, `orderValueAmount`. */
  key: string;
  severity: ChangeSeverity;
  /** What a person reads. Written to stand alone in a list. */
  label: string;
}

export interface ReconfirmationDiff {
  changes: OrderChange[];
  /** Any material change at all — the thing the banner and the gate ask about. */
  hasMaterialChanges: boolean;
}

type Snapshot = Record<string, unknown>;

/**
 * Snapshots written before 2026-07-26 use snake_case keys (see the KEY
 * CONVENTION note on `confirmations.confirmedSnapshot`). A diff that could not
 * read them would report every field of every older order as changed the moment
 * this shipped.
 */
function read(snapshot: Snapshot, camel: string, snake: string): unknown {
  const value = snapshot[camel];
  return value === undefined ? snapshot[snake] : value;
}

/**
 * JSON with object keys in a fixed order.
 *
 * The stored side of every comparison has been through Postgres `jsonb`, which
 * does NOT preserve key order, while the live side carries JavaScript insertion
 * order. A plain `JSON.stringify` comparison therefore reports two identical
 * objects as different — which made every re-confirmed order still read as
 * "the customer has not seen this", and would have held its purchase order
 * forever. Arrays keep their order: a list is not a set.
 */
function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // undefined and null are both "not set" across snapshot generations.
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Compare by value, not identity — snapshot values are plain JSON. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // null and undefined both mean "not set" across snapshot generations.
  if (a == null && b == null) return true;
  return canonical(a) === canonical(b);
}

/** Money as the customer would say it: "1200 NZD", or "not set". */
function describeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'not set';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

interface FieldRule {
  camel: string;
  snake: string;
  severity: ChangeSeverity;
  label: string;
}

/**
 * Top-level fields, and how much each one matters.
 *
 * `orderValueAmount` and the delivery address are material because they are the
 * commercial terms. Dates and notes are minor: staff move a ship date routinely
 * and re-asking the customer to sign for it would train them to click through
 * without reading, which costs more than it protects.
 */
const FIELD_RULES: readonly FieldRule[] = [
  { camel: 'orderValueAmount', snake: 'order_value_amount', severity: 'material', label: 'Order value' },
  { camel: 'orderValueCurrency', snake: 'order_value_currency', severity: 'material', label: 'Currency' },
  { camel: 'shippingAddress', snake: 'shipping_address', severity: 'material', label: 'Delivery address' },
  { camel: 'clubName', snake: 'club_name', severity: 'minor', label: 'Club name' },
  { camel: 'expectedShipDate', snake: 'expected_ship_date', severity: 'minor', label: 'Expected ship date' },
  { camel: 'deadlineDate', snake: 'deadline_date', severity: 'minor', label: 'Deadline' },
  { camel: 'invoiceUrl', snake: 'invoice_url', severity: 'minor', label: 'Invoice link' },
  { camel: 'generalNotes', snake: 'general_notes', severity: 'minor', label: 'General notes' },
];

interface GarmentLike {
  name?: unknown;
  sizing?: unknown;
  selectedOptions?: unknown;
  selectedFabrics?: unknown;
  fabrics?: unknown;
  sizeChartNames?: unknown;
  notes?: unknown;
}

function garmentsOf(snapshot: Snapshot): GarmentLike[] {
  const raw = snapshot.garments;
  return Array.isArray(raw) ? (raw as GarmentLike[]) : [];
}

function garmentName(garment: GarmentLike, index: number): string {
  const name = typeof garment.name === 'string' ? garment.name.trim() : '';
  // Unnamed garments still have to be distinguishable in the list.
  return name || `Garment ${index + 1}`;
}

/**
 * How many items a garment is for — the number people actually check. Summed
 * from the sizing rows, each of which carries its own quantity.
 */
function totalQuantity(garment: GarmentLike): number {
  const rows = Array.isArray(garment.sizing) ? (garment.sizing as Array<Record<string, unknown>>) : [];
  return rows.reduce((sum, row) => {
    const qty = row?.quantity;
    return sum + (typeof qty === 'number' && Number.isFinite(qty) ? qty : 1);
  }, 0);
}

/**
 * Garments are matched BY NAME rather than by position, so reordering the list
 * is not reported as every garment changing. A renamed garment therefore reads
 * as one removed and one added, which is the honest description — the customer
 * agreed to a line called something else.
 */
function diffGarments(previous: Snapshot, current: Snapshot): OrderChange[] {
  const before = garmentsOf(previous);
  const after = garmentsOf(current);
  const beforeByName = new Map(before.map((g, i) => [garmentName(g, i), g]));
  const afterByName = new Map(after.map((g, i) => [garmentName(g, i), g]));
  const changes: OrderChange[] = [];

  for (const [name] of beforeByName) {
    if (!afterByName.has(name)) {
      changes.push({ key: `garment:${name}:removed`, severity: 'material', label: `Garment removed: ${name}` });
    }
  }
  for (const [name] of afterByName) {
    if (!beforeByName.has(name)) {
      changes.push({ key: `garment:${name}:added`, severity: 'material', label: `Garment added: ${name}` });
    }
  }

  for (const [name, latest] of afterByName) {
    const original = beforeByName.get(name);
    if (!original) continue;

    // Quantity is called out separately from the sizing rows, because "20 → 24"
    // is the change people can act on without opening the order.
    const wasQty = totalQuantity(original);
    const nowQty = totalQuantity(latest);
    if (wasQty !== nowQty) {
      changes.push({
        key: `garment:${name}:quantity`,
        severity: 'material',
        label: `${name}: quantity ${wasQty} → ${nowQty}`,
      });
    }
    if (!same(original.sizing, latest.sizing)) {
      changes.push({
        key: `garment:${name}:sizing`,
        severity: 'material',
        label: `${name}: sizes or names changed`,
      });
    }
    if (
      !same(original.selectedOptions, latest.selectedOptions) ||
      !same(original.selectedFabrics, latest.selectedFabrics) ||
      !same(original.fabrics, latest.fabrics)
    ) {
      changes.push({
        key: `garment:${name}:options`,
        severity: 'material',
        label: `${name}: fabric or options changed`,
      });
    }
    if (!same(original.sizeChartNames, latest.sizeChartNames)) {
      changes.push({
        key: `garment:${name}:sizeCharts`,
        severity: 'minor',
        label: `${name}: size charts changed`,
      });
    }
    if (!same(original.notes, latest.notes)) {
      changes.push({ key: `garment:${name}:notes`, severity: 'minor', label: `${name}: notes changed` });
    }
  }

  return changes;
}

/**
 * What has moved since the customer signed.
 *
 * @param previous the stored `confirmedSnapshot` of the latest confirmation
 * @param current  the same order re-projected through `buildConfirmationSnapshot`
 */
export function diffAgainstConfirmation(previous: Snapshot, current: Snapshot): ReconfirmationDiff {
  const changes: OrderChange[] = [];

  for (const rule of FIELD_RULES) {
    const was = read(previous, rule.camel, rule.snake);
    const now = read(current, rule.camel, rule.snake);
    if (same(was, now)) continue;
    changes.push({
      key: rule.camel,
      severity: rule.severity,
      label: `${rule.label}: ${describeValue(was)} → ${describeValue(now)}`,
    });
  }

  changes.push(...diffGarments(previous, current));

  return {
    changes,
    hasMaterialChanges: changes.some((c) => c.severity === 'material'),
  };
}
