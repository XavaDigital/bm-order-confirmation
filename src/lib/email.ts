/**
 * SMTP email delivery for Phase 7 — magic-link sending.
 *
 * Uses nodemailer with the credentials in SMTP_HOST / SMTP_USER / SMTP_PASS.
 * Currently wired to smtp.mailgun.org but works with any SMTP provider.
 */
import nodemailer from 'nodemailer';
import { env } from '@/lib/env';
import { APP_NAME, APP_TAGLINE, APP_PORTAL_NAME, SALES_REP_LABEL, EMAIL_FROM_DEFAULT } from '@/lib/config';
import { formatCurrency, formatDateLong } from '@/lib/format';

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

// ---------------------------------------------------------------------------
// Shared HTML shell — every templated email below (branded header, card,
// footer) renders through this so the markup only needs to exist once.
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
            <td style="background:#0a0d10;border-bottom:3px solid #BF272D;padding:24px 32px;">
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
                  <td style="background:#BF272D;border-radius:6px;">
                    <a href="${url}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">
                      ${label}
                    </a>
                  </td>
                </tr>
              </table>`;
}

function emailCopyLinkLine(url: string): string {
  return `<p style="color:rgba(255,255,255,0.4);font-size:12px;word-break:break-all;margin:0 0 24px;">
                Or copy this link: <a href="${url}" style="color:#BF272D;">${url}</a>
              </p>`;
}

function buildHtml(params: { toName: string; orderNumber: string; url: string }): string {
  const { toName, orderNumber, url } = params;
  return wrapEmailLayout({
    title: 'Order Confirmation',
    headerLabel: APP_TAGLINE,
    bodyHtml: `<p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0 0 16px;">Hi ${toName},</p>
              <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 24px;">
                Your ${APP_NAME} order <strong style="color:#ffffff;">${orderNumber}</strong> is ready for your review and confirmation.
                Click the button below to view your order details, review sizing and mock-ups, and confirm.
              </p>
              ${emailButton(url, 'Review &amp; Confirm Order')}
              ${emailCopyLinkLine(url)}
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
              <p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.5;margin:0;">
                This link is unique to your order. Do not share it. If you have any questions,
                contact your ${SALES_REP_LABEL} directly.
              </p>`,
  });
}

function buildText(params: { toName: string; orderNumber: string; url: string }): string {
  const { toName, orderNumber, url } = params;
  return [
    `Hi ${toName},`,
    '',
    `Your ${APP_NAME} order ${orderNumber} is ready for review and confirmation.`,
    '',
    `Click the link below to review and confirm:`,
    url,
    '',
    `If you have any questions, contact your ${SALES_REP_LABEL}.`,
  ].join('\n');
}

export interface SendMagicLinkParams {
  to: string;
  toName: string;
  orderNumber: string;
  url: string;
  isRevision?: boolean;
  priorComment?: string;
  revisionNumber?: number;
}

function buildRevisionHtml(params: SendMagicLinkParams): string {
  const { toName, orderNumber, url, priorComment, revisionNumber } = params;
  const revLabel = revisionNumber && revisionNumber > 1 ? ` (revision ${revisionNumber})` : '';
  const commentBlock = priorComment
    ? `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#1c2128;border-left:3px solid #faad14;border-radius:4px;padding:16px 20px;">
                    <p style="color:rgba(255,255,255,0.5);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Your request</p>
                    <p style="color:rgba(255,255,255,0.85);font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap;">${priorComment}</p>
                  </td>
                </tr>
              </table>`
    : '';
  return wrapEmailLayout({
    title: 'Order Updated',
    headerLabel: `Order Updated${revLabel}`,
    bodyHtml: `<p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0 0 16px;">Hi ${toName},</p>
              <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 24px;">
                We've updated your ${APP_NAME} order <strong style="color:#ffffff;">${orderNumber}</strong> based on your change request.
                Please review the updated details and confirm when you're happy.
              </p>
              ${commentBlock}
              ${emailButton(url, 'Review &amp; Confirm Order')}
              ${emailCopyLinkLine(url)}
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
              <p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.5;margin:0;">
                This link is unique to your order. Do not share it. If you have further questions,
                contact your ${SALES_REP_LABEL} directly.
              </p>`,
  });
}

function buildRevisionText(params: SendMagicLinkParams): string {
  const { toName, orderNumber, url, priorComment, revisionNumber } = params;
  const lines = [
    `Hi ${toName},`,
    '',
    `We've updated your ${APP_NAME} order ${orderNumber}${revisionNumber && revisionNumber > 1 ? ` (revision ${revisionNumber})` : ''} based on your change request.`,
    '',
  ];
  if (priorComment) {
    lines.push('Your request:', priorComment, '');
  }
  lines.push('Please review the updated order and confirm when you\'re happy:', url, '', `If you have further questions, contact your ${SALES_REP_LABEL}.`);
  return lines.join('\n');
}

export async function sendMagicLink(params: SendMagicLinkParams): Promise<void> {
  if (!env.SMTP_HOST) {
    throw new Error('SMTP is not configured (SMTP_HOST missing)');
  }

  const from = env.MAIL_FROM ?? EMAIL_FROM_DEFAULT;
  const transport = createTransport();
  const revisionNumber = params.revisionNumber ?? 0;

  const subject = params.isRevision
    ? `Your ${APP_NAME} order ${params.orderNumber} has been updated${revisionNumber > 1 ? ` — revision ${revisionNumber}` : ''}`
    : `Your ${APP_NAME} order ${params.orderNumber} is ready to confirm`;

  await transport.sendMail({
    from,
    to: `${params.toName} <${params.to}>`,
    subject,
    html: params.isRevision ? buildRevisionHtml(params) : buildHtml(params),
    text: params.isRevision ? buildRevisionText(params) : buildText(params),
  });
}

export function isEmailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
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

function buildInviteHtml(params: SendInviteEmailParams): string {
  const { toName, inviterName, role, setupUrl } = params;
  const roleLabel = role === 'admin' ? 'Admin' : 'Sales Staff';
  return wrapEmailLayout({
    title: `You've been invited to ${APP_NAME}`,
    headerLabel: 'Team Portal',
    bodyHtml: `<p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0 0 16px;">Hi ${toName},</p>
              <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 16px;">
                <strong style="color:#ffffff;">${inviterName}</strong> has invited you to join the ${APP_PORTAL_NAME} as <strong style="color:#ffffff;">${roleLabel}</strong>.
              </p>
              <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 24px;">
                Click the button below to set your password and activate your account. This link expires in 72 hours.
              </p>
              ${emailButton(setupUrl, 'Set Up My Account')}
              ${emailCopyLinkLine(setupUrl)}
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
              <p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.5;margin:0;">
                If you weren't expecting this invitation, you can ignore this email.
              </p>`,
  });
}

export async function sendInviteEmail(params: SendInviteEmailParams): Promise<void> {
  if (!env.SMTP_HOST) throw new Error('SMTP is not configured (SMTP_HOST missing)');

  const from = env.MAIL_FROM ?? EMAIL_FROM_DEFAULT;
  const transport = createTransport();

  await transport.sendMail({
    from,
    to: `${params.toName} <${params.to}>`,
    subject: `You've been invited to the ${APP_PORTAL_NAME}`,
    html: buildInviteHtml(params),
    text: [
      `Hi ${params.toName},`,
      '',
      `${params.inviterName} has invited you to join the ${APP_PORTAL_NAME} as ${params.role === 'admin' ? 'Admin' : 'Sales Staff'}.`,
      '',
      `Set up your account here (expires in 72 hours):`,
      params.setupUrl,
      '',
      `If you weren't expecting this, you can ignore this email.`,
    ].join('\n'),
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
  if (!env.SMTP_HOST) throw new Error('SMTP is not configured');

  const from = env.MAIL_FROM ?? EMAIL_FROM_DEFAULT;
  const transport = createTransport();

  await transport.sendMail({
    from,
    to: `${params.toName} <${params.to}>`,
    ...(params.cc ? { cc: params.cc } : {}),
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
              <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 16px;">
                <strong style="color:#ffffff;">${params.customerName}</strong> has requested changes on order <strong style="color:#ffffff;">${params.orderNumber}</strong>.
              </p>
              <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#1c2128;border-left:3px solid #BF272D;border-radius:4px;padding:16px 20px;">
                    <p style="color:rgba(255,255,255,0.5);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Customer message</p>
                    <p style="color:rgba(255,255,255,0.85);font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap;">${params.comment}</p>
                  </td>
                </tr>
              </table>
              ${emailButton(params.adminOrderUrl, 'View Order')}
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
              <p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.5;margin:0;">
                Log in to the ${APP_PORTAL_NAME} to review and respond to this request.
              </p>`,
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
  cc?: string;
}

export async function sendStaffConfirmationEmail(params: SendStaffConfirmationParams): Promise<void> {
  if (!env.SMTP_HOST) throw new Error('SMTP is not configured');

  const from = env.MAIL_FROM ?? EMAIL_FROM_DEFAULT;
  const transport = createTransport();

  const dateStr = params.confirmedAt.toLocaleString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  await transport.sendMail({
    from,
    to: `${params.toName} <${params.to}>`,
    ...(params.cc ? { cc: params.cc } : {}),
    subject: `✅ ${params.customerName} confirmed order ${params.orderNumber}`,
    text: [
      `Hi ${params.toName},`,
      '',
      `${params.customerName} has confirmed order ${params.orderNumber} on ${dateStr}.`,
      '',
      `View the order: ${params.adminOrderUrl}`,
    ].join('\n'),
    html: `<p>Hi ${params.toName},</p>
<p><strong>${params.customerName}</strong> has confirmed order <strong>${params.orderNumber}</strong> on ${dateStr}.</p>
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
  const dateStr = confirmedAt.toLocaleString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

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
              <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 24px;">
                This confirms your ${APP_NAME} order <strong style="color:#ffffff;">${orderNumber}</strong> was confirmed on ${dateStr}. Here's a summary of what's on order:
              </p>
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
  const dateStr = confirmedAt.toLocaleString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

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
  if (!env.SMTP_HOST) throw new Error('SMTP is not configured');

  const from = env.MAIL_FROM ?? EMAIL_FROM_DEFAULT;
  const transport = createTransport();

  await transport.sendMail({
    from,
    to: `${params.toName} <${params.to}>`,
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
  if (!env.SMTP_HOST) throw new Error('SMTP is not configured (SMTP_HOST missing)');

  const from = env.MAIL_FROM ?? EMAIL_FROM_DEFAULT;
  const transport = createTransport();
  const subtitle = rosterSubtitle(params.clubName);

  await transport.sendMail({
    from,
    to: `${params.toName} <${params.to}>`,
    subject: `Team roster link for ${APP_NAME} order ${params.orderNumber}`,
    html: wrapEmailLayout({
      title: 'Team Roster',
      headerLabel: 'Team Roster',
      bodyHtml: `<p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0 0 16px;">Hi ${params.toName},</p>
              <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 24px;">
                Share the link below with your team${subtitle} so each person can pick their name and
                enter their own size for order <strong style="color:#ffffff;">${params.orderNumber}</strong>.
              </p>
              ${emailButton(params.url, 'Open Team Roster')}
              ${emailCopyLinkLine(params.url)}
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
              <p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.5;margin:0;">
                Anyone with this link can add or edit a roster entry, so only share it with your team.
                If you have any questions, contact your ${SALES_REP_LABEL}.
              </p>`,
    }),
    text: [
      `Hi ${params.toName},`,
      '',
      `Share this link with your team${subtitle} so each person can pick their name and enter their own size for order ${params.orderNumber}:`,
      params.url,
      '',
      `Anyone with this link can add or edit a roster entry, so only share it with your team.`,
      `If you have any questions, contact your ${SALES_REP_LABEL}.`,
    ].join('\n'),
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
  if (!env.SMTP_HOST) throw new Error('SMTP is not configured (SMTP_HOST missing)');

  const from = env.MAIL_FROM ?? EMAIL_FROM_DEFAULT;
  const transport = createTransport();
  const subtitle = rosterSubtitle(params.clubName);

  await transport.sendMail({
    from,
    to: `${params.toName} <${params.to}>`,
    subject: `Reminder: enter your size for ${APP_NAME} order ${params.orderNumber}`,
    html: wrapEmailLayout({
      title: 'Size Reminder',
      headerLabel: 'Reminder',
      bodyHtml: `<p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0 0 16px;">Hi ${params.toName},</p>
              <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 24px;">
                You haven't entered your size yet for order <strong style="color:#ffffff;">${params.orderNumber}</strong>${subtitle}.
                Click below to pick your name and submit your size — it only takes a minute.
              </p>
              ${emailButton(params.url, 'Enter My Size')}
              ${emailCopyLinkLine(params.url)}
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
              <p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.5;margin:0;">
                If you have any questions, contact your team manager or your ${SALES_REP_LABEL}.
              </p>`,
    }),
    text: [
      `Hi ${params.toName},`,
      '',
      `You haven't entered your size yet for order ${params.orderNumber}${subtitle}.`,
      `Open this link to pick your name and submit your size:`,
      params.url,
      '',
      `If you have any questions, contact your team manager or your ${SALES_REP_LABEL}.`,
    ].join('\n'),
  });
}
