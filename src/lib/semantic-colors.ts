/**
 * Semantic accent colors for ad-hoc admin UI (icons, badges, stat values,
 * borders). These are the antd default-palette hexes that were previously
 * hardcoded inline across `src/components/admin` and `src/app/admin`.
 *
 * NOT for order-status colors — those live in the `src/lib/status.ts`
 * registry (`ORDER_STATUS` / `orderStatusMeta`). Email templates keep their
 * own inline hexes (HTML email cannot import from here).
 */
export const SEMANTIC = {
  /** antd green — success / confirmed / delivered accents. */
  success: '#52c41a',
  /** antd gold — warning / pending / stale accents. */
  warning: '#faad14',
  /** antd red — error / destructive / revoked accents. */
  error: '#ff4d4f',
  /** antd blue — informational / link / neutral-action accents. */
  info: '#1677ff',
  /** antd volcano — colour-sample "hold production" accent. */
  hold: '#d46b08',
  /** antd purple — "customer viewed" accent. */
  viewed: '#722ed1',
  /** antd cyan — duplication accent. */
  duplicate: '#13c2c2',
} as const;
