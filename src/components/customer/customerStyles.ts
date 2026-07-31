/**
 * Shared inline-style constants for the customer surface (`/o/**`).
 * Previously copy-pasted across the three customer views — keep visual
 * changes here so all pages stay in lockstep.
 */
import type { CSSProperties } from 'react';
import { BRAND } from '@/lib/theme';

/** Standard content card on the customer pages. */
export const CARD_STYLE: CSSProperties = {
  background: BRAND.panelDark,
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  marginBottom: 24,
};

/** Passed to antd `<Card styles={CARD_BODY_STYLES}>`. */
export const CARD_BODY_STYLES: { body: CSSProperties } = {
  body: { padding: '20px 24px' },
};

/**
 * Small uppercase letter-spaced field label. Views that need a different
 * bottom margin spread it: `{ ...FIELD_LABEL_STYLE, marginBottom: 10 }`.
 */
export const FIELD_LABEL_STYLE: CSSProperties = {
  // 0.45 measured ~4.37:1 against the panel background — just under the 4.5:1
  // WCAG AA minimum for small text. 0.55 clears it (~5.8:1).
  color: 'rgba(255,255,255,0.55)',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 1,
  display: 'block',
  marginBottom: 8,
};

/** Amber warning surface for antd `<Alert type="warning">` on dark pages. */
export const WARNING_SURFACE_STYLE: CSSProperties = {
  background: 'rgba(250,173,20,0.08)',
  border: '1px solid rgba(250,173,20,0.3)',
};

/** Passed to antd `<Descriptions styles={DESCRIPTIONS_STYLES}>`. */
export const DESCRIPTIONS_STYLES: { label: CSSProperties; content: CSSProperties } = {
  // See FIELD_LABEL_STYLE above — same contrast fix (0.45 → 0.55).
  label: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  content: { color: 'rgba(255,255,255,0.9)' },
};

/** Bordered inner box (per-garment blocks, add-yourself form) on the roster pages. */
export const GARMENT_BOX_STYLE: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
  background: 'rgba(255,255,255,0.02)',
};
