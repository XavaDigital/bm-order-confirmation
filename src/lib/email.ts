/**
 * SMTP email delivery — magic links, staff notifications, roster nudges.
 *
 * Uses nodemailer with the credentials in SMTP_HOST / SMTP_USER / SMTP_PASS.
 * Currently wired to smtp.mailgun.org but works with any SMTP provider.
 *
 * Structure: every templated email renders through `wrapEmailLayout` (branded
 * shell), and the six "greeting + intro + button + copy-link + small-print"
 * emails go through `sendLinkEmail` so that skeleton exists once.
 */
import type { StaffRole } from '@/lib/roles';
import nodemailer from 'nodemailer';
import { env } from '@/lib/env';
import { APP_NAME, APP_TAGLINE, APP_PORTAL_NAME, SALES_REP_LABEL, EMAIL_FROM_DEFAULT } from '@/lib/config';
import { formatCurrency, formatDateLong, formatDateTimeLong } from '@/lib/format';

function createTransport() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 465,
    secure: env.SMTP_SECURE ?? true,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });
}

export function isEmailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

interface SendEmailParams {
  to: string;
  toName: string;
  cc?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

/** Shared guard + transport + envelope for every sender in this file. */
async function sendEmail(params: SendEmailParams): Promise<void> {
  if (!env.SMTP_HOST) {
    throw new Error('SMTP is not configured (SMTP_HOST missing)');
  }
  await createTransport().sendMail({
    from: env.MAIL_FROM ?? EMAIL_FROM_DEFAULT,
    to: `${params.toName} <${params.to}>`,
    ...(params.cc ? { cc: params.cc } : {}),
    subject: params.subject,
    html: params.html,
    text: params.text,
    ...(params.attachments?.length ? { attachments: params.attachments } : {}),
  });
}

/**
 * Minimal HTML escape for USER-CONTROLLED strings interpolated into email
 * HTML (names, customer comments) — R2 §1.1 / July assessment. System values
 * (order numbers, URLs we build) don't need it; anything a customer typed does.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Shared HTML shell — branded header, card, footer.
// ---------------------------------------------------------------------------

function wrapEmailLayout(params: { title: string; headerLabel: string; bodyHtml: string }): string {
  const { title, headerLabel, bodyHtml } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="background:#141414;border-bottom:3px solid #4f46e5;padding:24px 32px;">
              <span style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:2px;text-transform:uppercase;">${APP_NAME.toUpperCase()}</span>
              <span style="font-size:11px;color:#9aa0ab;letter-spacing:3px;text-transform:uppercase;margin-left:12px;">${headerLabel}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function emailButton(url: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#4f46e5;border-radius:6px;">
                    <a href="${url}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">
                      ${label}
                    </a>
                  </td>
                </tr>
              </table>`;
}

function emailCopyLinkLine(url: string): string {
  return `<p style="color:#6b7280;font-size:12px;word-break:break-all;margin:0 0 24px;">
                Or copy this link: <a href="${url}" style="color:#4f46e5;">${url}</a>
              </p>`;
}

/** Standard intro paragraph (the copy between the greeting and the button). */
function introP(innerHtml: string, marginBottomPx = 24): string {
  return `<p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 ${marginBottomPx}px;">${innerHtml}</p>`;
}

/** Highlighted quote/callout block (customer comment, hold-production, …). */
function calloutBlock(borderColor: string, innerHtml: string): string {
  return `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#f6f8fa;border-left:3px solid ${borderColor};border-radius:4px;padding:16px 20px;">${innerHtml}</td>
                </tr>
              </table>`;
}

interface LinkEmailParams {
  to: string;
  toName: string;
  subject: string;
  title: string;
  headerLabel: string;
  /** HTML between the greeting and the button (use `introP`, `calloutBlock`). */
  introHtml: string;
  buttonLabel: string;
  url: string;
  /** Small-print inner HTML under the divider. */
  footnoteHtml: string;
  /** Plain-text lines between "Hi X," and the URL. */
  textIntro: string[];
  /** Plain-text lines after the URL. */
  textFooter: string[];
}

/** The six link-style emails share this exact skeleton. */
async function sendLinkEmail(params: LinkEmailParams): Promise<void> {
  await sendEmail({
    to: params.to,
    toName: params.toName,
    subject: params.subject,
    html: wrapEmailLayout({
      title: params.title,
      headerLabel: params.headerLabel,
      bodyHtml: `<p style="color:#333b45;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(params.toName)},</p>
              ${params.introHtml}
              ${emailButton(params.url, params.buttonLabel)}
              ${emailCopyLinkLine(params.url)}
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
              <p style="color:#8b949e;font-size:12px;line-height:1.5;margin:0;">${params.footnoteHtml}</p>`,
    }),
    text: [`Hi ${params.toName},`, '', ...params.textIntro, params.url, '', ...params.textFooter].join('\n'),
  });
}

// ---------------------------------------------------------------------------
// Customer magic link — initial confirmation request + post-change revisions
// ---------------------------------------------------------------------------

export interface SendMagicLinkParams {
  to: string;
  toName: string;
  orderNumber: string;
  url: string;
  isRevision?: boolean;
  priorComment?: string;
  revisionNumber?: number;
}

export async function sendMagicLink(params: SendMagicLinkParams): Promise<void> {
  const { toName, orderNumber, url, priorComment } = params;
  const revisionNumber = params.revisionNumber ?? 0;

  if (!params.isRevision) {
    await sendLinkEmail({
      to: params.to,
      toName,
      subject: `Your ${APP_NAME} order ${orderNumber} is ready to confirm`,
      title: 'Order Confirmation',
      headerLabel: APP_TAGLINE,
      introHtml: introP(`
                Your ${APP_NAME} order <strong style="color:#1f2328;">${orderNumber}</strong> is ready for your review and confirmation.
                Click the button below to view your order details, review sizing and mock-ups, and confirm.
              `),
      buttonLabel: 'Review &amp; Confirm Order',
      url,
      footnoteHtml: `
                This link is unique to your order. Do not share it. If you have any questions,
                contact your ${SALES_REP_LABEL} directly.
              `,
      textIntro: [
        `Your ${APP_NAME} order ${orderNumber} is ready for review and confirmation.`,
        '',
        `Click the link below to review and confirm:`,
      ],
      textFooter: [`If you have any questions, contact your ${SALES_REP_LABEL}.`],
    });
    return;
  }

  const revLabel = revisionNumber > 1 ? ` (revision ${revisionNumber})` : '';
  const commentBlock = priorComment
    ? calloutBlock(
        '#faad14',
        `<p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Your request</p>
                    <p style="color:#1f2328;font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap;">${escapeHtml(priorComment)}</p>`,
      )
    : '';

  await sendLinkEmail({
    to: params.to,
    toName,
    subject: `Your ${APP_NAME} order ${orderNumber} has been updated${revisionNumber > 1 ? ` — revision ${revisionNumber}` : ''}`,
    title: 'Order Updated',
    headerLabel: `Order Updated${revLabel}`,
    introHtml:
      introP(`
                We've updated your ${APP_NAME} order <strong style="color:#1f2328;">${orderNumber}</strong> based on your change request.
                Please review the updated details and confirm when you're happy.
              `) + commentBlock,
    buttonLabel: 'Review &amp; Confirm Order',
    url,
    footnoteHtml: `
                This link is unique to your order. Do not share it. If you have further questions,
                contact your ${SALES_REP_LABEL} directly.
              `,
    textIntro: [
      `We've updated your ${APP_NAME} order ${orderNumber}${revLabel} based on your change request.`,
      '',
      ...(priorComment ? ['Your request:', priorComment, ''] : []),
      `Please review the updated order and confirm when you're happy:`,
    ],
    textFooter: [`If you have further questions, contact your ${SALES_REP_LABEL}.`],
  });
}

// ---------------------------------------------------------------------------
// Staff invite email — sent when an admin invites a new team member
// ---------------------------------------------------------------------------

export interface SendInviteEmailParams {
  to: string;
  toName: string;
  inviterName: string;
  role: StaffRole;
  setupUrl: string;
}

export async function sendInviteEmail(params: SendInviteEmailParams): Promise<void> {
  const roleLabel = params.role === 'admin' ? 'Admin' : 'Sales Staff';
  await sendLinkEmail({
    to: params.to,
    toName: params.toName,
    subject: `You've been invited to the ${APP_PORTAL_NAME}`,
    title: `You've been invited to ${APP_NAME}`,
    headerLabel: 'Team Portal',
    introHtml:
      introP(
        `<strong style="color:#1f2328;">${params.inviterName}</strong> has invited you to join the ${APP_PORTAL_NAME} as <strong style="color:#1f2328;">${roleLabel}</strong>.`,
        16,
      ) +
      introP(`
                Click the button below to set your password and activate your account. This link expires in 72 hours.
              `),
    buttonLabel: 'Set Up My Account',
    url: params.setupUrl,
    footnoteHtml: `
                If you weren't expecting this invitation, you can ignore this email.
              `,
    textIntro: [
      `${params.inviterName} has invited you to join the ${APP_PORTAL_NAME} as ${roleLabel}.`,
      '',
      `Set up your account here (expires in 72 hours):`,
    ],
    textFooter: [`If you weren't expecting this, you can ignore this email.`],
  });
}

// ---------------------------------------------------------------------------
// Staff password reset email — sent from the forgot-password flow
// ---------------------------------------------------------------------------

export interface SendPasswordResetEmailParams {
  to: string;
  toName: string;
  resetUrl: string;
}

export async function sendPasswordResetEmail(params: SendPasswordResetEmailParams): Promise<void> {
  await sendLinkEmail({
    to: params.to,
    toName: params.toName,
    subject: `Reset your ${APP_PORTAL_NAME} password`,
    title: `Reset your ${APP_PORTAL_NAME} password`,
    headerLabel: 'Password Reset',
    introHtml: introP(`
                We received a request to reset your ${APP_PORTAL_NAME} password. Click the button below to choose a new one. This link expires in 1 hour.
              `),
    buttonLabel: 'Reset My Password',
    url: params.resetUrl,
    footnoteHtml: `
                If you didn't request this, you can safely ignore this email — your password won't change.
              `,
    textIntro: [
      `We received a request to reset your ${APP_PORTAL_NAME} password.`,
      '',
      `Reset it here (expires in 1 hour):`,
    ],
    textFooter: [`If you didn't request this, you can safely ignore this email — your password won't change.`],
  });
}

// ---------------------------------------------------------------------------
// Sales staff notification — fired after a customer requests changes
// ---------------------------------------------------------------------------

export interface SendStaffChangeRequestParams {
  to: string;
  toName: string;
  customerName: string;
  orderNumber: string;
  comment: string;
  adminOrderUrl: string;
  cc?: string;
}

export async function sendStaffChangeRequestEmail(params: SendStaffChangeRequestParams): Promise<void> {
  await sendEmail({
    to: params.to,
    toName: params.toName,
    cc: params.cc,
    subject: `⚠️ ${params.customerName} requested changes on order ${params.orderNumber}`,
    text: [
      `Hi ${params.toName},`,
      '',
      `${params.customerName} has requested changes on order ${params.orderNumber}.`,
      '',
      `Their message:`,
      params.comment,
      '',
      `View the order: ${params.adminOrderUrl}`,
    ].join('\n'),
    html: wrapEmailLayout({
      title: 'Changes Requested',
      headerLabel: 'Changes Requested',
      bodyHtml: `<p style="color:#333b45;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(params.toName)},</p>
              ${introP(`<strong style="color:#1f2328;">${params.customerName}</strong> has requested changes on order <strong style="color:#1f2328;">${params.orderNumber}</strong>.`, 16)}
              ${calloutBlock('#4f46e5', `<p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Customer message</p>
                    <p style="color:#1f2328;font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap;">${escapeHtml(params.comment)}</p>`)}
              ${emailButton(params.adminOrderUrl, 'View Order')}
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
              <p style="color:#8b949e;font-size:12px;line-height:1.5;margin:0;">
                Log in to the ${APP_PORTAL_NAME} to review and respond to this request.
              </p>`,
    }),
  });
}

// ---------------------------------------------------------------------------
// Colour book / physical sample request — fired when a customer uses the
// standalone "Request Colour Sample" action (independent of confirming).
// ---------------------------------------------------------------------------

export interface SendStaffColorSampleRequestParams {
  to: string;
  toName: string;
  customerName: string;
  orderNumber: string;
  adminOrderUrl: string;
  cc?: string;
}

export async function sendStaffColorSampleRequestEmail(
  params: SendStaffColorSampleRequestParams,
): Promise<void> {
  await sendEmail({
    to: params.to,
    toName: params.toName,
    cc: params.cc,
    subject: `🎨 ${params.customerName} requested a colour sample for order ${params.orderNumber} — hold production`,
    text: [
      `Hi ${params.toName},`,
      '',
      `${params.customerName} has requested a colour book / physical sample for order ${params.orderNumber} before production begins.`,
      '',
      `Contact them to arrange colour matching, and hold production until it's resolved.`,
      '',
      `View the order: ${params.adminOrderUrl}`,
    ].join('\n'),
    html: wrapEmailLayout({
      title: 'Colour Sample Requested',
      headerLabel: 'Colour Sample Requested',
      bodyHtml: `<p style="color:#333b45;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(params.toName)},</p>
              ${introP(`<strong style="color:#1f2328;">${params.customerName}</strong> has requested a colour book / physical sample for order <strong style="color:#1f2328;">${params.orderNumber}</strong> before production begins.`, 16)}
              ${calloutBlock('#d46b08', `<p style="color:#faad14;font-size:13px;font-weight:bold;margin:0;">⚠️ Hold production</p>
                    <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:8px 0 0;">Contact the customer to arrange colour matching before releasing this order to production.</p>`)}
              ${emailButton(params.adminOrderUrl, 'View Order')}`,
    }),
  });
}

// ---------------------------------------------------------------------------
// Sales staff notification — fired after a customer confirms an order
// ---------------------------------------------------------------------------

export interface SendStaffConfirmationParams {
  to: string;
  toName: string;
  customerName: string;
  orderNumber: string;
  confirmedAt: Date;
  adminOrderUrl: string;
  /** Customer asked for a colour book / physical sample — production must hold. */
  colorSampleRequested?: boolean;
  cc?: string;
}

export async function sendStaffConfirmationEmail(params: SendStaffConfirmationParams): Promise<void> {
  const dateStr = formatDateTimeLong(params.confirmedAt);

  const sampleTextBlock = params.colorSampleRequested
    ? [
        '',
        '⚠️ COLOUR SAMPLE REQUESTED — HOLD PRODUCTION',
        'The customer asked for a colour book / physical sample for colour matching',
        'before production. Contact them to arrange it before releasing this order.',
      ]
    : [];

  const sampleHtmlBlock = params.colorSampleRequested
    ? `<div style="margin:16px 0;padding:12px 16px;border:2px solid #d46b08;border-radius:6px;background:#fff7e6;">
<p style="margin:0;font-weight:bold;color:#d46b08;">⚠️ Colour sample requested — hold production</p>
<p style="margin:8px 0 0;">The customer asked for a <strong>colour book / physical sample</strong> for colour matching before production. Contact them to arrange it before releasing this order.</p>
</div>`
    : '';

  await sendEmail({
    to: params.to,
    toName: params.toName,
    cc: params.cc,
    subject: params.colorSampleRequested
      ? `✅ ${params.customerName} confirmed order ${params.orderNumber} — ⚠️ colour sample requested`
      : `✅ ${params.customerName} confirmed order ${params.orderNumber}`,
    text: [
      `Hi ${params.toName},`,
      '',
      `${params.customerName} has confirmed order ${params.orderNumber} on ${dateStr}.`,
      ...sampleTextBlock,
      '',
      `View the order: ${params.adminOrderUrl}`,
    ].join('\n'),
    html: `<p>Hi ${escapeHtml(params.toName)},</p>
<p><strong>${params.customerName}</strong> has confirmed order <strong>${params.orderNumber}</strong> on ${dateStr}.</p>
${sampleHtmlBlock}
<p><a href="${params.adminOrderUrl}">View order in admin</a></p>`,
  });
}

// ---------------------------------------------------------------------------
// Customer receipt — sent after the customer confirms, so they have their
// own record of what they agreed to (staff already get a copy via
// sendStaffConfirmationEmail above). No magic link: the order is done, and
// tokens can't be recovered/resent from storage anyway (hashed at rest).
// ---------------------------------------------------------------------------

export interface SendCustomerReceiptParams {
  to: string;
  toName: string;
  orderNumber: string;
  confirmedAt: Date;
  garments: { name: string; quantity: number }[];
  orderValueAmount?: string | null;
  orderValueCurrency?: string | null;
  expectedShipDate?: string | null;
}

function buildReceiptMeta(params: SendCustomerReceiptParams): { label: string; value: string }[] {
  const { orderValueAmount, orderValueCurrency, expectedShipDate } = params;
  const meta: { label: string; value: string }[] = [];
  if (orderValueAmount) {
    meta.push({ label: 'Order value', value: `${orderValueCurrency ?? 'NZD'} ${formatCurrency(orderValueAmount)}` });
  }
  if (expectedShipDate) {
    meta.push({ label: 'Expected ship date', value: formatDateLong(expectedShipDate) });
  }
  return meta;
}

function buildReceiptHtml(params: SendCustomerReceiptParams): string {
  const { toName, orderNumber, confirmedAt, garments } = params;
  const dateStr = formatDateTimeLong(confirmedAt);

  const meta = buildReceiptMeta(params);
  const metaBlock = meta.length
    ? `<p style="color:#4b5563;font-size:14px;line-height:1.8;margin:0 0 20px;">
                ${meta.map((m) => `<strong style="color:#1f2328;">${m.label}:</strong> ${m.value}`).join('<br>')}
              </p>`
    : '';

  const garmentsBlock = garments.length
    ? `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
              ${garments
                .map(
                  (g) => `<tr>
                <td style="padding:6px 0;color:#333b45;font-size:14px;border-bottom:1px solid #e5e7eb;">${g.name}</td>
                <td style="padding:6px 0;color:#6b7280;font-size:14px;text-align:right;border-bottom:1px solid #e5e7eb;">${g.quantity > 0 ? `&times;${g.quantity}` : ''}</td>
              </tr>`,
                )
                .join('')}
            </table>`
    : '';

  return wrapEmailLayout({
    title: 'Order Confirmed',
    headerLabel: 'Order Confirmed',
    bodyHtml: `<p style="color:#333b45;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(toName)},</p>
              ${introP(`
                This confirms your ${APP_NAME} order <strong style="color:#1f2328;">${orderNumber}</strong> was confirmed on ${dateStr}. Here's a summary of what's on order:
              `)}
              ${metaBlock}
              ${garmentsBlock}
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
              <p style="color:#8b949e;font-size:12px;line-height:1.5;margin:0;">
                If anything above looks wrong, just reply to this email and we'll sort it out.
              </p>`,
  });
}

function buildReceiptText(params: SendCustomerReceiptParams): string {
  const { toName, orderNumber, confirmedAt, garments } = params;
  const dateStr = formatDateTimeLong(confirmedAt);

  const lines = [
    `Hi ${toName},`,
    '',
    `This confirms your ${APP_NAME} order ${orderNumber} was confirmed on ${dateStr}.`,
    '',
  ];
  const meta = buildReceiptMeta(params);
  for (const m of meta) lines.push(`${m.label}: ${m.value}`);
  if (meta.length > 0) lines.push('');
  if (garments.length > 0) {
    lines.push('Summary:');
    for (const g of garments) lines.push(g.quantity > 0 ? `- ${g.name} x${g.quantity}` : `- ${g.name}`);
    lines.push('');
  }
  lines.push(`If anything above looks wrong, just reply to this email and we'll sort it out.`);
  return lines.join('\n');
}

export async function sendCustomerReceiptEmail(params: SendCustomerReceiptParams): Promise<void> {
  await sendEmail({
    to: params.to,
    toName: params.toName,
    subject: `Your ${APP_NAME} order ${params.orderNumber} is confirmed`,
    html: buildReceiptHtml(params),
    text: buildReceiptText(params),
  });
}

// ---------------------------------------------------------------------------
// Supplier purchase order — PO PDF attached; sent when staff hit "Send to
// supplier" (PO_PLAN). Revision >1 = amended PO superseding earlier versions.
// ---------------------------------------------------------------------------

export interface SendSupplierPoEmailParams {
  to: string;
  toName: string;
  poNumber: string;
  orderNumber: string;
  revisionNumber: number;
  /** Optional reason shown for amended POs (revision > 1). */
  reason?: string | null;
  pdf: Buffer;
  /** The .xlsx twin of the PDF (AUTO_ORDER_EMAIL_PLAN.md Phase 1) — same revision snapshot, spreadsheet shape. */
  xlsx: Buffer;
  /**
   * True when `collectSnapshotAttachments` had to substitute thumbnails for
   * full-resolution garment images to stay under the SMTP size cap. Adds one
   * line to the email body rather than failing the send.
   */
  sizeReduced?: boolean;
  /**
   * Supplier portal link (SUPPLIER_PORTAL_PLAN.md), minted fresh on every
   * send. Optional so a caller with no email step for it (tests, older
   * callers) still compiles — omitted, the email just carries the PDF as
   * before.
   */
  portalUrl?: string | null;
  /**
   * Uploaded fonts/design files, size charts, and garment images riding
   * alongside the PDF/XLSX — the files themselves, because a signed URL
   * inside a sent email expires.
   */
  extraAttachments?: { filename: string; content: Buffer; contentType?: string }[];
}

export async function sendSupplierPoEmail(params: SendSupplierPoEmailParams): Promise<void> {
  const { poNumber, orderNumber, revisionNumber } = params;
  const amended = revisionNumber > 1;
  const portalBlock = params.portalUrl
    ? `${emailButton(params.portalUrl, 'Open Supplier Portal')}${emailCopyLinkLine(params.portalUrl)}`
    : '';

  const subject = amended
    ? `Amended purchase order ${poNumber} (revision ${revisionNumber}) — ${APP_NAME}`
    : `Purchase order ${poNumber} — ${APP_NAME}`;

  const supersedeLine = amended
    ? `This revision supersedes all previous versions of ${poNumber} — please discard earlier copies.`
    : '';
  const reasonBlock =
    amended && params.reason
      ? calloutBlock(
          '#faad14',
          `<p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Reason for amendment</p>
                    <p style="color:#1f2328;font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap;">${params.reason}</p>`,
        )
      : '';
  const sizeReducedBlock = params.sizeReduced
    ? `<p style="color:#8b949e;font-size:13px;line-height:1.5;margin:0 0 16px;">
        Full-resolution garment images were too large to attach — reduced-size copies are included instead.
      </p>`
    : '';

  await sendEmail({
    to: params.to,
    toName: params.toName,
    subject,
    html: wrapEmailLayout({
      title: amended ? 'Amended Purchase Order' : 'Purchase Order',
      headerLabel: amended ? `Purchase Order — Revision ${revisionNumber}` : 'Purchase Order',
      bodyHtml: `<p style="color:#333b45;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(params.toName)},</p>
              ${introP(`
                Please find attached ${amended ? `revision ${revisionNumber} of` : ''} purchase order <strong style="color:#1f2328;">${poNumber}</strong>
                (our order <strong style="color:#1f2328;">${orderNumber}</strong>).
                ${supersedeLine}
              `)}
              ${reasonBlock}
              ${sizeReducedBlock}
              ${portalBlock}
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
              <p style="color:#8b949e;font-size:12px;line-height:1.5;margin:0;">
                Please confirm receipt by replying to this email. If anything in the attached
                document is unclear, contact us before starting production.
                ${params.portalUrl ? ' You can also update the production status and leave a comment from the Supplier Portal link above.' : ''}
              </p>`,
    }),
    text: [
      `Hi ${params.toName},`,
      '',
      `Please find attached ${amended ? `revision ${revisionNumber} of ` : ''}purchase order ${poNumber} (our order ${orderNumber}).`,
      ...(supersedeLine ? ['', supersedeLine] : []),
      ...(amended && params.reason ? ['', `Reason for amendment: ${params.reason}`] : []),
      ...(params.sizeReduced
        ? ['', 'Full-resolution garment images were too large to attach — reduced-size copies are included instead.']
        : []),
      ...(params.portalUrl
        ? ['', `Update the production status or leave a comment here: ${params.portalUrl}`]
        : []),
      '',
      `Please confirm receipt by replying to this email. If anything in the attached document is unclear, contact us before starting production.`,
    ].join('\n'),
    attachments: [
      {
        filename: `${poNumber}${amended ? `-rev${revisionNumber}` : ''}.pdf`,
        content: params.pdf,
        contentType: 'application/pdf',
      },
      {
        filename: `${poNumber}${amended ? `-rev${revisionNumber}` : ''}.xlsx`,
        content: params.xlsx,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      ...(params.extraAttachments ?? []),
    ],
  });
}

// ---------------------------------------------------------------------------
// Workflow notification emails — pre-rendered by the notifications sender
// pass (src/server/notifications/email-sender.ts) from an inbox_items row.
// Unlike every other export in this file, the content isn't templated here:
// dispatchNotification() already built the html/text, this just delivers it.
// ---------------------------------------------------------------------------

export interface SendNotificationEmailParams {
  to: string;
  toName: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendNotificationEmail(params: SendNotificationEmailParams): Promise<void> {
  await sendEmail(params);
}

// ---------------------------------------------------------------------------
// Team roster — shared link to the manager, and per-member nudges
// (TEAM_ROSTER_PLAN.md Phase 7)
// ---------------------------------------------------------------------------

export interface SendRosterLinkParams {
  to: string;
  toName: string;
  orderNumber: string;
  clubName: string | null;
  url: string;
}

function rosterSubtitle(clubName: string | null): string {
  return clubName ? ` for ${clubName}` : '';
}

export async function sendRosterLinkEmail(params: SendRosterLinkParams): Promise<void> {
  const subtitle = rosterSubtitle(params.clubName);
  await sendLinkEmail({
    to: params.to,
    toName: params.toName,
    subject: `Team roster link for ${APP_NAME} order ${params.orderNumber}`,
    title: 'Team Roster',
    headerLabel: 'Team Roster',
    introHtml: introP(`
                Share the link below with your team${subtitle} so each person can pick their name and
                enter their own size for order <strong style="color:#1f2328;">${params.orderNumber}</strong>.
              `),
    buttonLabel: 'Open Team Roster',
    url: params.url,
    footnoteHtml: `
                Anyone with this link can add or edit a roster entry, so only share it with your team.
                If you have any questions, contact your ${SALES_REP_LABEL}.
              `,
    textIntro: [
      `Share this link with your team${subtitle} so each person can pick their name and enter their own size for order ${params.orderNumber}:`,
    ],
    textFooter: [
      `Anyone with this link can add or edit a roster entry, so only share it with your team.`,
      `If you have any questions, contact your ${SALES_REP_LABEL}.`,
    ],
  });
}

export interface SendRosterPageEmailParams {
  to: string;
  toName: string;
  orderNumber: string;
  clubName: string | null;
  url: string;
  /** The staff-readable team password, or null when the page has none. */
  password: string | null;
}

/**
 * The short typeable roster PAGE (David, 2026-08-04) — url + team password in
 * one email to the customer, mirroring the panel's copy-for-email snippet.
 */
export async function sendRosterPageEmail(params: SendRosterPageEmailParams): Promise<void> {
  const subtitle = rosterSubtitle(params.clubName);
  const passwordHtml = params.password
    ? `<p style="margin:16px 0 0;">Team password: <strong style="color:#1f2328;">${escapeHtml(params.password)}</strong></p>`
    : '';
  await sendLinkEmail({
    to: params.to,
    toName: params.toName,
    subject: `Team sizing page for ${APP_NAME} order ${params.orderNumber}`,
    title: 'Team Sizing',
    headerLabel: 'Team Roster',
    introHtml:
      introP(`
                Share the page below with your team${subtitle} so each person can add themselves and
                enter their own sizes for order <strong style="color:#1f2328;">${params.orderNumber}</strong>.
              `) + passwordHtml,
    buttonLabel: 'Open the Sizing Page',
    url: params.url,
    footnoteHtml: `
                Each person signs in with their email and can only edit the players they added.
                If you have any questions, contact your ${SALES_REP_LABEL}.
              `,
    textIntro: [
      `Share this page with your team${subtitle} so each person can add themselves and enter their own sizes for order ${params.orderNumber}:`,
      ...(params.password ? [``, `Team password: ${params.password}`] : []),
    ],
    textFooter: [
      `Each person signs in with their email and can only edit the players they added.`,
      `If you have any questions, contact your ${SALES_REP_LABEL}.`,
    ],
  });
}

export interface SendRosterMemberLinkParams {
  to: string;
  toName: string;
  orderNumber: string;
  clubName: string | null;
  url: string;
}

/** Bulk "email everyone their individual link" (TEAM_ROSTER_PLAN.md Phase 9) — a
 * personal, single-purpose link for one team member (not the shared roster link). */
export async function sendRosterMemberLinkEmail(params: SendRosterMemberLinkParams): Promise<void> {
  const subtitle = rosterSubtitle(params.clubName);
  await sendLinkEmail({
    to: params.to,
    toName: params.toName,
    subject: `Enter your size for ${APP_NAME} order ${params.orderNumber}`,
    title: 'Enter Your Size',
    headerLabel: 'Team Roster',
    introHtml: introP(`
                Use the link below to enter your size for order <strong style="color:#1f2328;">${params.orderNumber}</strong>${subtitle}. This link is just for you.
              `),
    buttonLabel: 'Enter My Size',
    url: params.url,
    footnoteHtml: `
                If you have any questions, contact your team manager or your ${SALES_REP_LABEL}.
              `,
    textIntro: [
      `Use this link to enter your size for order ${params.orderNumber}${subtitle}. This link is just for you:`,
    ],
    textFooter: [`If you have any questions, contact your team manager or your ${SALES_REP_LABEL}.`],
  });
}

export interface SendRosterReminderParams {
  to: string;
  toName: string;
  orderNumber: string;
  clubName: string | null;
  url: string;
}

export async function sendRosterReminderEmail(params: SendRosterReminderParams): Promise<void> {
  const subtitle = rosterSubtitle(params.clubName);
  await sendLinkEmail({
    to: params.to,
    toName: params.toName,
    subject: `Reminder: enter your size for ${APP_NAME} order ${params.orderNumber}`,
    title: 'Size Reminder',
    headerLabel: 'Reminder',
    introHtml: introP(`
                You haven't entered your size yet for order <strong style="color:#1f2328;">${params.orderNumber}</strong>${subtitle}.
                Click below to pick your name and submit your size — it only takes a minute.
              `),
    buttonLabel: 'Enter My Size',
    url: params.url,
    footnoteHtml: `
                If you have any questions, contact your team manager or your ${SALES_REP_LABEL}.
              `,
    textIntro: [
      `You haven't entered your size yet for order ${params.orderNumber}${subtitle}.`,
      `Open this link to pick your name and submit your size:`,
    ],
    textFooter: [`If you have any questions, contact your team manager or your ${SALES_REP_LABEL}.`],
  });
}
