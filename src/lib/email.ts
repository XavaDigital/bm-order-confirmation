/**
 * SMTP email delivery for Phase 7 — magic-link sending.
 *
 * Uses nodemailer with the credentials in SMTP_HOST / SMTP_USER / SMTP_PASS.
 * Currently wired to smtp.mailgun.org but works with any SMTP provider.
 */
import nodemailer from 'nodemailer';
import { env } from '@/lib/env';

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

function buildHtml(params: { toName: string; orderNumber: string; url: string }): string {
  const { toName, orderNumber, url } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Order Confirmation</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#161b22;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
          <tr>
            <td style="background:#0a0d10;border-bottom:3px solid #BF272D;padding:24px 32px;">
              <span style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:2px;text-transform:uppercase;">BEASTMODE</span>
              <span style="font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:3px;text-transform:uppercase;margin-left:12px;">Order Confirmation</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0 0 16px;">Hi ${toName},</p>
              <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 24px;">
                Your BeastMode order <strong style="color:#ffffff;">${orderNumber}</strong> is ready for your review and confirmation.
                Click the button below to view your order details, review sizing and mock-ups, and confirm.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#BF272D;border-radius:6px;">
                    <a href="${url}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">
                      Review &amp; Confirm Order
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color:rgba(255,255,255,0.4);font-size:12px;word-break:break-all;margin:0 0 24px;">
                Or copy this link: <a href="${url}" style="color:#BF272D;">${url}</a>
              </p>
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
              <p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.5;margin:0;">
                This link is unique to your order. Do not share it. If you have any questions,
                contact your BeastMode sales representative directly.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildText(params: { toName: string; orderNumber: string; url: string }): string {
  const { toName, orderNumber, url } = params;
  return [
    `Hi ${toName},`,
    '',
    `Your BeastMode order ${orderNumber} is ready for review and confirmation.`,
    '',
    `Click the link below to review and confirm:`,
    url,
    '',
    `If you have any questions, contact your BeastMode sales representative.`,
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
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Order Updated</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#161b22;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
          <tr>
            <td style="background:#0a0d10;border-bottom:3px solid #BF272D;padding:24px 32px;">
              <span style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:2px;text-transform:uppercase;">BEASTMODE</span>
              <span style="font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:3px;text-transform:uppercase;margin-left:12px;">Order Updated${revLabel}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0 0 16px;">Hi ${toName},</p>
              <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 24px;">
                We've updated your BeastMode order <strong style="color:#ffffff;">${orderNumber}</strong> based on your change request.
                Please review the updated details and confirm when you're happy.
              </p>
              ${priorComment ? `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#1c2128;border-left:3px solid #faad14;border-radius:4px;padding:16px 20px;">
                    <p style="color:rgba(255,255,255,0.5);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Your request</p>
                    <p style="color:rgba(255,255,255,0.85);font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap;">${priorComment}</p>
                  </td>
                </tr>
              </table>` : ''}
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#BF272D;border-radius:6px;">
                    <a href="${url}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">
                      Review &amp; Confirm Order
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color:rgba(255,255,255,0.4);font-size:12px;word-break:break-all;margin:0 0 24px;">
                Or copy this link: <a href="${url}" style="color:#BF272D;">${url}</a>
              </p>
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
              <p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.5;margin:0;">
                This link is unique to your order. Do not share it. If you have further questions,
                contact your BeastMode sales representative directly.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildRevisionText(params: SendMagicLinkParams): string {
  const { toName, orderNumber, url, priorComment, revisionNumber } = params;
  const lines = [
    `Hi ${toName},`,
    '',
    `We've updated your BeastMode order ${orderNumber}${revisionNumber && revisionNumber > 1 ? ` (revision ${revisionNumber})` : ''} based on your change request.`,
    '',
  ];
  if (priorComment) {
    lines.push('Your request:', priorComment, '');
  }
  lines.push('Please review the updated order and confirm when you\'re happy:', url, '', 'If you have further questions, contact your BeastMode sales representative.');
  return lines.join('\n');
}

export async function sendMagicLink(params: SendMagicLinkParams): Promise<void> {
  if (!env.SMTP_HOST) {
    throw new Error('SMTP is not configured (SMTP_HOST missing)');
  }

  const from = env.MAIL_FROM ?? `BeastMode Orders <orders@beastmode.co.nz>`;
  const transport = createTransport();
  const revisionNumber = params.revisionNumber ?? 0;

  const subject = params.isRevision
    ? `Your BeastMode order ${params.orderNumber} has been updated${revisionNumber > 1 ? ` — revision ${revisionNumber}` : ''}`
    : `Your BeastMode order ${params.orderNumber} is ready to confirm`;

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
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>You've been invited to BeastMode</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#161b22;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
          <tr>
            <td style="background:#0a0d10;border-bottom:3px solid #BF272D;padding:24px 32px;">
              <span style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:2px;text-transform:uppercase;">BEASTMODE</span>
              <span style="font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:3px;text-transform:uppercase;margin-left:12px;">Team Portal</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0 0 16px;">Hi ${toName},</p>
              <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 16px;">
                <strong style="color:#ffffff;">${inviterName}</strong> has invited you to join the BeastMode Order Portal as <strong style="color:#ffffff;">${roleLabel}</strong>.
              </p>
              <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 24px;">
                Click the button below to set your password and activate your account. This link expires in 72 hours.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#BF272D;border-radius:6px;">
                    <a href="${setupUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">
                      Set Up My Account
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color:rgba(255,255,255,0.4);font-size:12px;word-break:break-all;margin:0 0 24px;">
                Or copy this link: <a href="${setupUrl}" style="color:#BF272D;">${setupUrl}</a>
              </p>
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
              <p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.5;margin:0;">
                If you weren't expecting this invitation, you can ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendInviteEmail(params: SendInviteEmailParams): Promise<void> {
  if (!env.SMTP_HOST) throw new Error('SMTP is not configured (SMTP_HOST missing)');

  const from = env.MAIL_FROM ?? `BeastMode Orders <orders@beastmode.co.nz>`;
  const transport = createTransport();

  await transport.sendMail({
    from,
    to: `${params.toName} <${params.to}>`,
    subject: `You've been invited to the BeastMode Order Portal`,
    html: buildInviteHtml(params),
    text: [
      `Hi ${params.toName},`,
      '',
      `${params.inviterName} has invited you to join the BeastMode Order Portal as ${params.role === 'admin' ? 'Admin' : 'Sales Staff'}.`,
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

  const from = env.MAIL_FROM ?? `BeastMode Orders <orders@beastmode.co.nz>`;
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
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Changes Requested</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#161b22;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
          <tr>
            <td style="background:#0a0d10;border-bottom:3px solid #BF272D;padding:24px 32px;">
              <span style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:2px;text-transform:uppercase;">BEASTMODE</span>
              <span style="font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:3px;text-transform:uppercase;margin-left:12px;">Changes Requested</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0 0 16px;">Hi ${params.toName},</p>
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
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#BF272D;border-radius:6px;">
                    <a href="${params.adminOrderUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">
                      View Order
                    </a>
                  </td>
                </tr>
              </table>
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
              <p style="color:rgba(255,255,255,0.35);font-size:12px;line-height:1.5;margin:0;">
                Log in to the BeastMode Order Portal to review and respond to this request.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
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

  const from = env.MAIL_FROM ?? `BeastMode Orders <orders@beastmode.co.nz>`;
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
