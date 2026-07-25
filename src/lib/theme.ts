/**
 * Fleet "MailFlow aesthetic" theme tokens for antd — indigo accent, Inter,
 * neutral dark ramp, quiet borders. Visual parity with bm-sales (SalesFlow)
 * and bm-email (MailFlow):
 *   - dark ramp follows MailFlow (bm-email web-client App.tsx): page #191919,
 *     panels/inputs #212121, elevated #2a2a2a, header/sidebar chrome #141414;
 *   - sidebar/menu treatment follows SalesFlow (client ThemeContext.tsx).
 * Components inherit from these tokens — avoid re-hardcoding colors.
 */
import type { ThemeConfig } from 'antd';
import { theme as antdAlgorithms } from 'antd';

export const BRAND = {
  primary: '#4f46e5', // indigo — light mode accent
  primaryDark: '#6366f1', // indigo — dark mode accent
  pageDark: '#191919',
  panelDark: '#212121',
  chromeDark: '#141414', // header + sidebar in dark mode
} as const;

// var(--font-sans) is injected by next/font/google as Inter (see layout.tsx)
const fontFamily =
  "var(--font-sans), 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";

const boxShadowTertiary =
  '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)';

/** Admin light mode. */
export const lightTheme: ThemeConfig = {
  algorithm: antdAlgorithms.defaultAlgorithm,
  token: {
    colorPrimary: BRAND.primary,
    colorInfo: BRAND.primary,
    borderRadius: 8,
    fontFamily,
    colorBgLayout: '#f8fafc',
    colorText: '#1e293b',
    colorTextSecondary: '#64748b',
    colorBorder: '#e2e8f0',
    colorBorderSecondary: '#eef2f7',
    boxShadowTertiary,
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      siderBg: '#ffffff',
      triggerBg: '#f8fafc',
      triggerColor: '#64748b',
    },
    Menu: {
      itemBg: '#ffffff',
      subMenuItemBg: '#f8fafc',
      itemSelectedBg: '#eef2ff',
      itemSelectedColor: BRAND.primary,
      itemHoverBg: '#f1f5f9',
      itemBorderRadius: 8,
      itemMarginInline: 8,
    },
  },
};

/** Admin dark mode + the default for the customer-facing pages. */
export const darkTheme: ThemeConfig = {
  algorithm: antdAlgorithms.darkAlgorithm,
  token: {
    colorPrimary: BRAND.primaryDark,
    colorInfo: BRAND.primaryDark,
    borderRadius: 8,
    fontFamily,
    colorBgLayout: BRAND.pageDark,
    colorBgContainer: BRAND.panelDark,
    colorBgElevated: '#2a2a2a',
    colorBorder: '#333333',
    colorBorderSecondary: '#2a2a2a',
    // Explicit text ramp: nested ConfigProviders MERGE tokens, so anywhere the
    // dark theme nests inside the app-level light provider, the light theme's
    // slate colorText would otherwise leak through the dark algorithm.
    colorText: 'rgba(255,255,255,0.88)',
    colorTextSecondary: '#a6a6a6',
    colorTextTertiary: '#737373',
    colorTextQuaternary: '#5c5c5c',
    boxShadowTertiary,
  },
  components: {
    Layout: {
      headerBg: BRAND.chromeDark,
      siderBg: BRAND.chromeDark,
      triggerBg: BRAND.panelDark,
      // The area behind the rounded content panel matches the chrome, so the
      // sidebar/header/page frame reads as one surface (SalesFlow shell).
      bodyBg: BRAND.chromeDark,
    },
    Menu: {
      darkItemBg: BRAND.chromeDark,
      darkSubMenuItemBg: '#0f0f0f',
      darkItemSelectedBg: BRAND.primaryDark,
      darkItemSelectedColor: '#ffffff',
      darkItemHoverBg: BRAND.panelDark,
      itemBg: 'transparent',
      itemSelectedBg: BRAND.primaryDark,
      itemSelectedColor: '#ffffff',
      itemHoverBg: '#2a2a2a',
      itemBorderRadius: 8,
      itemMarginInline: 8,
    },
    Table: {
      headerBg: '#1f1f1f',
      rowHoverBg: '#262626',
    },
    Button: {
      // Header buttons: a whisper darker than the chrome, not black fills —
      // reads as "available", not "active" (MailFlow convention).
      defaultBg: '#101010',
      defaultHoverBg: '#262626',
    },
    Tooltip: {
      colorBgSpotlight: '#262626',
    },
  },
};
