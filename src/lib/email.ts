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
  });
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
<body style="margin:0;padding:0;background:#0d1117;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#161b22;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
          <tr>
            <td style="background:#141414;border-bottom:3px solid #4f46e5;padding:24px 32px;">
              <span style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:2px;text-transform:uppercase;">${APP_NAME.toUpperCase()}</span>
              <span style="font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:3px;text-transform:uppercase;margin-left:12px;">${headerLabel}</span>
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
  return `<p style="color:rgba(255,255,255,0.4);font-size:12px;word-break:break-all;margin:0 0 24px;">
                Or copy this link: <a href="${url}" style="color:#4f46e5;">${url}</a>
              </p>`;
}

/** Standard intro paragraph (the copy between the greeting and the button). */
function introP(innerHtml: string, marginBottomPx = 24): string {
  return `<p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 ${marginBottomPx}px;">${innerHtml}</p>`;
}

/** Highlighted quote/callout block (customer comment, hold-production, …). */
function calloutBlock(borderColor: string, innerHtml: string): string {
  return `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#212121;border-left:3px solid ${borderColor};border-radius:4px;padding:16px 20px;">${innerHtml}</td>
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
      bodyHtml: `<p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0 0 16px;">Hi ${params.toName},</p>
              ${params.introHtml}
              ${emailButton(params.url, params.buttonLabel)}
              ${emailCopyLinkLine(params.url)}
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
              <p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.5;margin:0;">${params.footnoteHtml}</p>`,
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
                Your ${APP_NAME} order <strong style="color:#ffffff;">${orderNumber}</strong> is ready for your review and confirmation.
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
        `<p style="color:rgba(255,255,255,0.5);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Your request</p>
                    <p style="color:rgba(255,255,255,0.85);font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap;">${priorComment}</p>`,
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
                We've updated your ${APP_NAME} order <strong style="color:#ffffff;">${orderNumber}</strong> based on your change request.
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
  role: 'sales' | 'admin';
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
        `<strong style="color:#ffffff;">${params.inviterName}</strong> has invited you to join the ${APP_PORTAL_NAME} as <strong style="color:#ffffff;">${roleLabel}</strong>.`,
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
      bodyHtml: `<p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0 0 16px;">Hi ${params.toName},</p>
              ${introP(`<strong style="color:#ffffff;">${params.customerName}</strong> has requested changes on order <strong style="color:#ffffff;">${params.orderNumber}</strong>.`, 16)}
              ${calloutBlock('#4f46e5', `<p style="color:rgba(255,255,255,0.5);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Customer message</p>
                    <p style="color:rgba(255,255,255,0.85);font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap;">${params.comment}</p>`)}
              ${emailButton(params.adminOrderUrl, 'View Order')}
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
              <p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.5;margin:0;">
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
      bodyHtml: `<p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0 0 16px;">Hi ${params.toName},</p>
              ${introP(`<strong style="color:#ffffff;">${params.customerName}</strong> has requested a colour book / physical sample for order <strong style="color:#ffffff;">${params.orderNumber}</strong> before production begins.`, 16)}
              ${calloutBlock('#d46b08', `<p style="color:#faad14;font-size:13px;font-weight:bold;margin:0;">⚠️ Hold production</p>
                    <p style="color:rgba(255,255,255,0.65);font-size:14px;line-height:1.6;margin:8px 0 0;">Contact the customer to arrange colour matching before releasing this order to production.</p>`)}
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
    html: `<p>Hi ${params.toName},</p>
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
    ? `<p style="color:rgba(255,255,255,0.65);font-size:14px;line-height:1.8;margin:0 0 20px;">
                ${meta.map((m) => `<strong style="color:#ffffff;">${m.label}:</strong> ${m.value}`).join('<br>')}
              </p>`
    : '';

  const garmentsBlock = garments.length
    ? `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
              ${garments
                .map(
                  (g) => `<tr>
                <td style="padding:6px 0;color:rgba(255,255,255,0.8);font-size:14px;border-bottom:1px solid rgba(255,255,255,0.08);">${g.name}</td>
                <td style="padding:6px 0;color:rgba(255,255,255,0.5);font-size:14px;text-align:right;border-bottom:1px solid rgba(255,255,255,0.08);">${g.quantity > 0 ? `&times;${g.quantity}` : ''}</td>
              </tr>`,
                )
                .join('')}
            </table>`
    : '';

  return wrapEmailLayout({
    title: 'Order Confirmed',
    headerLabel: 'Order Confirmed',
    bodyHtml: `<p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0 0 16px;">Hi ${toName},</p>
              ${introP(`
                This confirms your ${APP_NAME} order <strong style="color:#ffffff;">${orderNumber}</strong> was confirmed on ${dateStr}. Here's a summary of what's on order:
              `)}
              ${metaBlock}
              ${garmentsBlock}
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
              <p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.5;margin:0;">
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
                enter their own size for order <strong style="color:#ffffff;">${params.orderNumber}</strong>.
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
                Use the link below to enter your size for order <strong style="color:#ffffff;">${params.orderNumber}</strong>${subtitle}. This link is just for you.
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
                You haven't entered your size yet for order <strong style="color:#ffffff;">${params.orderNumber}</strong>${subtitle}.
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
