import type { ShowConfirmOptions } from '../components/AlertDialog';
import { formatMoneyAmount, normalizeCurrencyCode, roundMoney2 } from './currencies';
import {
  openPaymentReceiptWindow,
  type ReceiptPaymentPayload,
} from './receiptDocument';

type ShowConfirmFn = (options: ShowConfirmOptions) => Promise<boolean>;

export interface PaymentRowForReceipt {
  id?: number;
  method: string;
  amount: number;
  created_at: string;
}

export function buildPaymentReceiptPayload(args: {
  invoice_no: string;
  customer_name: string | null;
  currency_code: string;
  invoice_total: number;
  paid_before: number;
  payment: PaymentRowForReceipt;
  paid_after: number;
}): ReceiptPaymentPayload {
  const total = roundMoney2(args.invoice_total);
  const paidAfter = roundMoney2(args.paid_after);
  const balance = roundMoney2(Math.max(0, total - paidAfter));
  const status =
    total > 0 && paidAfter >= total - 0.005 ? 'Paid' : paidAfter > 0.005 ? 'Partial' : 'Unpaid';

  return {
    invoice_no: args.invoice_no,
    customer_name: args.customer_name,
    currency_code: normalizeCurrencyCode(args.currency_code),
    invoice_total: total,
    paid_before: roundMoney2(args.paid_before),
    payment_amount: roundMoney2(args.payment.amount),
    payment_method: args.payment.method,
    payment_date: args.payment.created_at,
    paid_after: paidAfter,
    balance_remaining: balance,
    invoice_status: status,
  };
}

/** One payment receipt per row, in payment order. */
export function paymentReceiptPayloadsFromRows(args: {
  invoice_no: string;
  customer_name: string | null;
  currency_code: string;
  invoice_total: number;
  payments: PaymentRowForReceipt[];
}): ReceiptPaymentPayload[] {
  let running = 0;
  const out: ReceiptPaymentPayload[] = [];
  for (const p of args.payments) {
    const paidBefore = running;
    running = roundMoney2(running + (Number(p.amount) || 0));
    out.push(
      buildPaymentReceiptPayload({
        invoice_no: args.invoice_no,
        customer_name: args.customer_name,
        currency_code: args.currency_code,
        invoice_total: args.invoice_total,
        paid_before: paidBefore,
        payment: p,
        paid_after: running,
      })
    );
  }
  return out;
}

/** Print a stored payment receipt by payment id (payments sorted chronologically). */
export function openPaymentReceiptForInvoicePayment(args: {
  invoice_no: string;
  customer_name: string | null;
  currency_code: string;
  invoice_total: number;
  payments: PaymentRowForReceipt[];
  paymentId: number;
}): boolean {
  const sorted = [...args.payments].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (ta !== tb) return ta - tb;
    return (a.id ?? 0) - (b.id ?? 0);
  });
  const idx = sorted.findIndex(p => p.id === args.paymentId);
  if (idx < 0) return false;
  const payloads = paymentReceiptPayloadsFromRows({
    invoice_no: args.invoice_no,
    customer_name: args.customer_name,
    currency_code: args.currency_code,
    invoice_total: args.invoice_total,
    payments: sorted,
  });
  const payload = payloads[idx];
  if (!payload) return false;
  openPaymentReceiptWindow(payload);
  return true;
}

export async function offerPaymentReceiptPrint(
  showConfirm: ShowConfirmFn,
  payload: ReceiptPaymentPayload
): Promise<void> {
  const ok = await showConfirm({
    title: 'Payment recorded',
    message: `Print payment receipt for ${formatMoneyAmount(payload.payment_amount, payload.currency_code)} (${payload.invoice_no})?`,
    confirmLabel: 'Print receipt',
    cancelLabel: 'Not now',
  });
  if (ok) openPaymentReceiptWindow(payload);
}

export async function offerPaymentReceiptsPrint(
  showConfirm: ShowConfirmFn,
  payloads: ReceiptPaymentPayload[]
): Promise<void> {
  if (!payloads.length) return;
  if (payloads.length === 1) {
    await offerPaymentReceiptPrint(showConfirm, payloads[0]);
    return;
  }
  const ok = await showConfirm({
    title: 'Payments recorded',
    message: `Print ${payloads.length} payment receipts for ${payloads[0].invoice_no}?`,
    confirmLabel: 'Print receipts',
    cancelLabel: 'Not now',
  });
  if (!ok) return;
  for (const p of payloads) {
    openPaymentReceiptWindow(p);
  }
}

export async function offerPaidInvoicePrint(
  showConfirm: ShowConfirmFn,
  invoiceNo: string,
  onPrintInvoice: () => void | Promise<void>
): Promise<void> {
  const ok = await showConfirm({
    title: 'Invoice paid in full',
    message: `Print final invoice receipt for ${invoiceNo}?`,
    confirmLabel: 'Print invoice',
    cancelLabel: 'Not now',
  });
  if (ok) await onPrintInvoice();
}
