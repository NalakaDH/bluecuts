import { roundMoney2 } from './currencies';

export type InvoicePaymentMode = 'later' | 'full' | 'partial';

/** UI payment method; Transfer maps to BankTransfer on the API. */
export type InvoicePayMethodUi = 'Cash' | 'Card' | 'Transfer';

export interface InvoicePaymentRow {
  id: string;
  method: InvoicePayMethodUi | null;
  amount: number;
}

export interface InvoicePaymentIntentResult {
  payment_mode: InvoicePaymentMode;
  payments: Array<{ method: string; amount: number }>;
}

export function paymentMethodForApi(method: InvoicePayMethodUi): string {
  if (method === 'Transfer') return 'BankTransfer';
  return method;
}

export function buildPaymentIntentPayload(
  mode: InvoicePaymentMode,
  rows: InvoicePaymentRow[]
): InvoicePaymentIntentResult {
  if (mode === 'later') {
    return { payment_mode: 'later', payments: [] };
  }
  const payments = rows
    .filter(r => r.method && r.amount > 0)
    .map(r => ({
      method: paymentMethodForApi(r.method as InvoicePayMethodUi),
      amount: roundMoney2(r.amount),
    }));
  return { payment_mode: mode, payments };
}

export function validatePaymentIntent(
  mode: InvoicePaymentMode,
  rows: InvoicePaymentRow[],
  total: number
): string | null {
  const totalR = roundMoney2(total);
  if (mode === 'later') return null;

  if (!rows.length) return 'Add at least one payment.';

  let sum = 0;
  for (const row of rows) {
    if (!row.method) return 'Select a payment method for each payment row.';
    if (!Number.isFinite(row.amount) || row.amount <= 0) {
      return 'Each payment amount must be greater than zero.';
    }
    sum = roundMoney2(sum + row.amount);
  }

  if (mode === 'full') {
    if (Math.abs(sum - totalR) > 0.01) {
      return `Payments must equal the invoice total (${totalR.toFixed(2)}).`;
    }
    return null;
  }

  if (sum >= totalR - 0.005) {
    return 'Partial payment must be less than the invoice total. Use pay in full instead.';
  }
  if (sum <= 0.005) return 'Enter a partial payment amount.';
  return null;
}

/** Memo convert invoice total (remaining lines + proportional order discount). */
export function computeMemoConvertInvoiceTotal(detail: {
  order_discount?: number;
  items: Array<{
    quantity: number;
    returned_qty: number;
    unit_price: number;
    line_total: number;
    weight_carats?: number | null;
  }>;
}): number {
  let remainingNetBeforeOrder = 0;
  const memoNetBeforeOrderAll = roundMoney2(
    detail.items.reduce((sum, l) => sum + (Number(l.line_total) || 0), 0)
  );
  for (const l of detail.items) {
    const q = Math.floor(Number(l.quantity) || 0);
    const rq = Math.floor(Number(l.returned_qty) || 0);
    const rem = Math.max(0, q - rq);
    if (rem <= 0) continue;
    const lineNet = q > 0 ? (Number(l.line_total) || 0) * (rem / q) : 0;
    remainingNetBeforeOrder += roundMoney2(lineNet);
  }
  const proportionalOrderDiscount =
    memoNetBeforeOrderAll > 0
      ? roundMoney2((Number(detail.order_discount) || 0) * (remainingNetBeforeOrder / memoNetBeforeOrderAll))
      : 0;
  return Math.max(0, roundMoney2(remainingNetBeforeOrder - proportionalOrderDiscount));
}

export function newPaymentRowId(): string {
  return `pay-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
