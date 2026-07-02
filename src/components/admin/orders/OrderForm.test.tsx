import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form } from 'antd';
import type { FormInstance } from 'antd';
import { OrderForm, toApiPayload, type OrderFormValues } from './OrderForm';

function Harness({
  initialValues,
  disabled,
  onFormReady,
}: {
  initialValues?: Partial<OrderFormValues>;
  disabled?: boolean;
  onFormReady: (form: FormInstance<OrderFormValues>) => void;
}) {
  const [form] = Form.useForm<OrderFormValues>();
  onFormReady(form);
  return <OrderForm form={form} initialValues={initialValues} disabled={disabled} />;
}

function renderForm(initialValues?: Partial<OrderFormValues>, disabled?: boolean) {
  let form!: FormInstance<OrderFormValues>;
  render(<Harness initialValues={initialValues} disabled={disabled} onFormReady={(f) => (form = f)} />);
  return { getForm: () => form };
}

describe('OrderForm', () => {
  it('defaults orderValueCurrency to NZD and shippingMode to prefilled when no initialValues given', () => {
    const { getForm } = renderForm();
    const values = getForm().getFieldsValue();

    expect(values.orderValueCurrency).toBe('NZD');
    expect(values.shippingMode).toBe('prefilled');
  });

  it('fails validation with "Required" on customerName and customerEmail when submitted blank', async () => {
    const { getForm } = renderForm();

    await expect(getForm().validateFields()).rejects.toBeTruthy();
    expect(await screen.findAllByText('Required')).toHaveLength(2);
  });

  it('shows an email format error for an invalid address', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByPlaceholderText('jane@teamclub.co.nz'), 'not-an-email');
    await user.tab();

    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();
  });

  it('shows a URL format error for an invalid invoice URL', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByPlaceholderText(/xero.com/), 'not-a-url');
    await user.tab();

    expect(await screen.findByText('Enter a valid URL')).toBeInTheDocument();
  });

  it('validates successfully once required fields are filled', async () => {
    const user = userEvent.setup();
    const { getForm } = renderForm();

    await user.type(screen.getByPlaceholderText('Jane Smith'), 'Jane Coach');
    await user.type(screen.getByPlaceholderText('jane@teamclub.co.nz'), 'jane@example.com');

    const values = await getForm().validateFields();
    expect(values.customerName).toBe('Jane Coach');
    expect(values.customerEmail).toBe('jane@example.com');
  });

  it('pre-fills initialValues, including formatting a date for the DatePicker', () => {
    renderForm({ customerName: 'Jane Coach', clubName: 'Wildcats', expectedShipDate: '2026-03-01' });

    expect(screen.getByPlaceholderText('Jane Smith')).toHaveValue('Jane Coach');
    expect(screen.getByPlaceholderText('Westside FC')).toHaveValue('Wildcats');
    expect(screen.getByDisplayValue('01 Mar 2026')).toBeInTheDocument();
  });

  it('disables every field when disabled is true', () => {
    renderForm(undefined, true);

    expect(screen.getByPlaceholderText('Jane Smith')).toBeDisabled();
    expect(screen.getByPlaceholderText('jane@teamclub.co.nz')).toBeDisabled();
  });
});

describe('toApiPayload', () => {
  it('passes through non-dayjs values unchanged', () => {
    const result = toApiPayload({ customerName: 'Jane', expectedShipDate: null, deadlineDate: undefined });
    expect(result.customerName).toBe('Jane');
    expect(result.expectedShipDate).toBeNull();
    expect(result.deadlineDate).toBeNull();
  });

  it('formats dayjs date fields to YYYY-MM-DD strings', async () => {
    const dayjs = (await import('dayjs')).default;
    const result = toApiPayload({
      expectedShipDate: dayjs('2026-03-01T00:00:00Z'),
      deadlineDate: dayjs('2026-04-15T00:00:00Z'),
    });
    expect(result.expectedShipDate).toBe('2026-03-01');
    expect(result.deadlineDate).toBe('2026-04-15');
  });
});
