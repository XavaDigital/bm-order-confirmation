import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn(async (_opts: Record<string, unknown>) => ({ messageId: 'test-message-id' }));
  const createTransport = vi.fn(() => ({ sendMail }));
  return { sendMail, createTransport };
});

vi.mock('nodemailer', () => ({
  default: { createTransport },
  createTransport,
}));

vi.mock('@/lib/env', () => ({
  env: {
    SMTP_HOST: undefined as string | undefined,
    SMTP_PORT: 465,
    SMTP_USER: undefined as string | undefined,
    SMTP_PASS: undefined as string | undefined,
    SMTP_SECURE: true,
    MAIL_FROM: undefined as string | undefined,
  },
}));

import { env } from '@/lib/env';
import {
  isEmailConfigured,
  sendInviteEmail,
  sendMagicLink,
  sendStaffChangeRequestEmail,
  sendStaffConfirmationEmail,
  sendCustomerReceiptEmail,
} from './email';

beforeEach(() => {
  sendMail.mockClear();
  createTransport.mockClear();
  env.SMTP_HOST = undefined;
  env.SMTP_USER = undefined;
  env.SMTP_PASS = undefined;
  env.MAIL_FROM = undefined;
});

function configureSmtp() {
  env.SMTP_HOST = 'smtp.mailgun.org';
  env.SMTP_USER = 'user@mailgun.org';
  env.SMTP_PASS = 'secret';
}

describe('isEmailConfigured', () => {
  it('is false when SMTP_HOST is missing', () => {
    expect(isEmailConfigured()).toBe(false);
  });

  it('is false when only some SMTP vars are set', () => {
    env.SMTP_HOST = 'smtp.mailgun.org';
    expect(isEmailConfigured()).toBe(false);
  });

  it('is true when all three SMTP vars are set', () => {
    configureSmtp();
    expect(isEmailConfigured()).toBe(true);
  });
});

describe('sendMagicLink', () => {
  it('throws when SMTP is not configured', async () => {
    await expect(
      sendMagicLink({ to: 'a@b.com', toName: 'A', orderNumber: 'OC-1', url: 'http://x' }),
    ).rejects.toThrow('SMTP is not configured');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends the initial-confirmation email with the default from address', async () => {
    configureSmtp();
    await sendMagicLink({ to: 'a@b.com', toName: 'A Coach', orderNumber: 'OC-1', url: 'http://x/o/tok' });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = sendMail.mock.calls[0][0];
    expect(call.from).toBe('BeastMode Orders <orders@beastmode.co.nz>');
    expect(call.to).toBe('A Coach <a@b.com>');
    expect(call.subject).toBe('Your BeastMode order OC-1 is ready to confirm');
    expect(call.html).toContain('http://x/o/tok');
    expect(call.text).toContain('http://x/o/tok');
  });

  it('uses MAIL_FROM when set', async () => {
    configureSmtp();
    env.MAIL_FROM = 'Custom <custom@example.com>';
    await sendMagicLink({ to: 'a@b.com', toName: 'A', orderNumber: 'OC-1', url: 'http://x' });
    expect(sendMail.mock.calls[0][0].from).toBe('Custom <custom@example.com>');
  });

  it('sends a revision email with the prior comment and revision number in the subject', async () => {
    configureSmtp();
    await sendMagicLink({
      to: 'a@b.com',
      toName: 'A',
      orderNumber: 'OC-2',
      url: 'http://x',
      isRevision: true,
      priorComment: 'Please change the size',
      revisionNumber: 2,
    });

    const call = sendMail.mock.calls[0][0];
    expect(call.subject).toBe('Your BeastMode order OC-2 has been updated — revision 2');
    expect(call.html).toContain('Please change the size');
    expect(call.text).toContain('Please change the size');
  });

  it('omits the revision suffix and comment block when revisionNumber is 1 and no comment given', async () => {
    configureSmtp();
    await sendMagicLink({
      to: 'a@b.com',
      toName: 'A',
      orderNumber: 'OC-3',
      url: 'http://x',
      isRevision: true,
      revisionNumber: 1,
    });

    const call = sendMail.mock.calls[0][0];
    expect(call.subject).toBe('Your BeastMode order OC-3 has been updated');
    expect(call.html).not.toContain('Your request');
  });
});

describe('sendInviteEmail', () => {
  it('throws when SMTP is not configured', async () => {
    await expect(
      sendInviteEmail({
        to: 'a@b.com',
        toName: 'A',
        inviterName: 'Boss',
        role: 'sales',
        setupUrl: 'http://x',
      }),
    ).rejects.toThrow('SMTP is not configured');
  });

  it('labels the role correctly for admin invites', async () => {
    configureSmtp();
    await sendInviteEmail({
      to: 'a@b.com',
      toName: 'A',
      inviterName: 'Boss',
      role: 'admin',
      setupUrl: 'http://x/accept',
    });
    const call = sendMail.mock.calls[0][0];
    expect(call.subject).toBe("You've been invited to the BeastMode Order Portal");
    expect(call.html).toContain('Admin');
    expect(call.text).toContain('http://x/accept');
  });

  it('labels the role correctly for sales invites', async () => {
    configureSmtp();
    await sendInviteEmail({
      to: 'a@b.com',
      toName: 'A',
      inviterName: 'Boss',
      role: 'sales',
      setupUrl: 'http://x/accept',
    });
    expect(sendMail.mock.calls[0][0].html).toContain('Sales Staff');
  });
});

describe('sendStaffChangeRequestEmail', () => {
  it('throws when SMTP is not configured', async () => {
    await expect(
      sendStaffChangeRequestEmail({
        to: 'staff@b.com',
        toName: 'Staff',
        customerName: 'Cust',
        orderNumber: 'OC-1',
        comment: 'change please',
        adminOrderUrl: 'http://x',
      }),
    ).rejects.toThrow('SMTP is not configured');
  });

  it('includes cc when provided and omits it otherwise', async () => {
    configureSmtp();
    await sendStaffChangeRequestEmail({
      to: 'staff@b.com',
      toName: 'Staff',
      customerName: 'Cust',
      orderNumber: 'OC-1',
      comment: 'change please',
      adminOrderUrl: 'http://x',
      cc: 'team@b.com',
    });
    expect(sendMail.mock.calls[0][0].cc).toBe('team@b.com');

    sendMail.mockClear();
    await sendStaffChangeRequestEmail({
      to: 'staff@b.com',
      toName: 'Staff',
      customerName: 'Cust',
      orderNumber: 'OC-1',
      comment: 'change please',
      adminOrderUrl: 'http://x',
    });
    expect(sendMail.mock.calls[0][0].cc).toBeUndefined();
  });

  it('embeds the customer comment and order link in the body', async () => {
    configureSmtp();
    await sendStaffChangeRequestEmail({
      to: 'staff@b.com',
      toName: 'Staff',
      customerName: 'Cust',
      orderNumber: 'OC-9',
      comment: 'the sizing is wrong',
      adminOrderUrl: 'http://admin/orders/9',
    });
    const call = sendMail.mock.calls[0][0];
    expect(call.subject).toContain('Cust requested changes on order OC-9');
    expect(call.text).toContain('the sizing is wrong');
    expect(call.html).toContain('the sizing is wrong');
    expect(call.html).toContain('http://admin/orders/9');
  });
});

describe('sendStaffConfirmationEmail', () => {
  it('throws when SMTP is not configured', async () => {
    await expect(
      sendStaffConfirmationEmail({
        to: 'staff@b.com',
        toName: 'Staff',
        customerName: 'Cust',
        orderNumber: 'OC-1',
        confirmedAt: new Date(),
        adminOrderUrl: 'http://x',
      }),
    ).rejects.toThrow('SMTP is not configured');
  });

  it('sends a confirmation summary email', async () => {
    configureSmtp();
    await sendStaffConfirmationEmail({
      to: 'staff@b.com',
      toName: 'Staff',
      customerName: 'Cust',
      orderNumber: 'OC-4',
      confirmedAt: new Date('2026-01-15T10:30:00Z'),
      adminOrderUrl: 'http://admin/orders/4',
    });
    const call = sendMail.mock.calls[0][0];
    expect(call.subject).toContain('Cust confirmed order OC-4');
    expect(call.text).toContain('http://admin/orders/4');
    expect(call.html).toContain('http://admin/orders/4');
  });
});

describe('sendCustomerReceiptEmail', () => {
  it('throws when SMTP is not configured', async () => {
    await expect(
      sendCustomerReceiptEmail({
        to: 'cust@b.com',
        toName: 'Jane Coach',
        orderNumber: 'OC-1',
        confirmedAt: new Date(),
        garments: [],
      }),
    ).rejects.toThrow('SMTP is not configured');
  });

  it('sends a receipt with the garment summary, order value, ship date, and no magic link', async () => {
    configureSmtp();
    await sendCustomerReceiptEmail({
      to: 'cust@b.com',
      toName: 'Jane Coach',
      orderNumber: 'OC-5',
      confirmedAt: new Date('2026-01-15T10:30:00Z'),
      garments: [
        { name: 'Home Jersey', quantity: 3 },
        { name: 'Away Jersey', quantity: 2 },
      ],
      orderValueAmount: '1240.00',
      orderValueCurrency: 'NZD',
      expectedShipDate: '2026-08-01',
    });

    const call = sendMail.mock.calls[0][0];
    expect(call.to).toBe('Jane Coach <cust@b.com>');
    expect(call.subject).toBe('Your BeastMode order OC-5 is confirmed');
    expect(call.html).toContain('Home Jersey');
    expect(call.html).toContain('&times;3');
    expect(call.text).toContain('- Home Jersey x3');
    expect(call.text).toContain('- Away Jersey x2');
    expect(call.html).not.toContain('/o/');
    expect(call.html).toContain('NZD 1,240.00');
    expect(call.html).toContain('1 August 2026');
    expect(call.text).toContain('Order value: NZD 1,240.00');
    expect(call.text).toContain('Expected ship date: 1 August 2026');
  });

  it('omits the order value / ship date lines when not provided', async () => {
    configureSmtp();
    await sendCustomerReceiptEmail({
      to: 'cust@b.com',
      toName: 'Jane',
      orderNumber: 'OC-8',
      confirmedAt: new Date(),
      garments: [{ name: 'Home Jersey', quantity: 1 }],
    });

    const call = sendMail.mock.calls[0][0];
    expect(call.html).not.toContain('Order value');
    expect(call.html).not.toContain('Expected ship date');
    expect(call.text).not.toContain('Order value');
    expect(call.text).not.toContain('Expected ship date');
  });

  it('omits the garment summary block when there are no garments', async () => {
    configureSmtp();
    await sendCustomerReceiptEmail({
      to: 'cust@b.com',
      toName: 'Jane',
      orderNumber: 'OC-6',
      confirmedAt: new Date(),
      garments: [],
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].text).not.toContain('Summary:');
  });

  it('lists a garment with no sizing rows without an "x0" quantity', async () => {
    configureSmtp();
    await sendCustomerReceiptEmail({
      to: 'cust@b.com',
      toName: 'Jane',
      orderNumber: 'OC-7',
      confirmedAt: new Date(),
      garments: [{ name: 'Rain Jacket', quantity: 0 }],
    });

    const call = sendMail.mock.calls[0][0];
    expect(call.html).toContain('Rain Jacket');
    expect(call.html).not.toContain('x0');
    expect(call.html).not.toContain('&times;0');
    expect(call.text).toContain('- Rain Jacket');
    expect(call.text).not.toContain('x0');
  });
});
