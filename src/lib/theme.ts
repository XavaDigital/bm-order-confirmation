/**
 * BeastMode theme tokens for antd (PROJECT_BRIEF.md §9).
 *
 * Reference brand: https://beastmode.co.nz — deep navy/charcoal surfaces, white
 * type, high contrast, bold UPPERCASE headings, vibrant sport accents.
 *
 * TODO(design): inspect the live site and replace the accent/exact hex + font
 * family with the real brand values. These are sensible placeholders.
 */
import type { ThemeConfig } from 'antd';
import { theme as antdAlgorithms } from 'antd';

export const BEASTMODE = {
  navy: '#0B1622',
  charcoal: '#161E2B',
  ink: '#0A0F16',
  accent: '#BF272D', // extracted from beastmode.co.nz logo SVG (.st2 class)
  accentAlt: '#FF6A00',
  paper: '#FFFFFF',
} as const;

/** Use in inline `style` props for display/hero headings (Bebas Neue with fallbacks). */
export const headingFont =
  "var(--font-heading), Impact, 'Arial Narrow', sans-serif";

const sharedToken = {
  colorPrimary: BEASTMODE.accent,
  colorInfo: BEASTMODE.accent,
  borderRadius: 4,
  // var(--font-sans) is injected by next/font/google as Inter (see layout.tsx)
  fontFamily:
    "var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};

/** Admin light mode. */
export const lightTheme: ThemeConfig = {
  algorithm: antdAlgorithms.defaultAlgorithm,
  token: { ...sharedToken },
};

/** Admin dark mode + the default for the customer-facing BeastMode pages. */
export const darkTheme: ThemeConfig = {
  algorithm: antdAlgorithms.darkAlgorithm,
  token: {
    ...sharedToken,
    colorBgBase: BEASTMODE.navy,
    colorBgContainer: BEASTMODE.charcoal,
  },
};
