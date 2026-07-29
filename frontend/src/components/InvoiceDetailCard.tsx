import React from 'react';
import { DEFAULT_CURRENCY_CODE, formatMoneyAmount } from '../lib/currencies';
import { dateFromServerUtc } from '../lib/serverTime';

export type InvoiceStatus = 'Unpaid' | 'Partial' | 'Paid';

export interface InvoiceItemRow {
  id: number;
  inventory_item_id: number;
  item_code: string | null;
  description: string | null;
  quantity: number;
  returned_qty?: number;
  unit_price: number;
  line_total: number;
  weight_grams?: number | null;
  weight_carats?: number | null;
  inv_category?: string | null;
  inv_item_type?: string | null;
  inventory_description?: string | null;
}

export interface InvoicePaymentRow {
  id: number;
  method: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export interface InvoiceDetail {
  id: number;
  invoice_no: string;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address_line1?: string | null;
  customer_address_line2?: string | null;
  customer_city?: string | null;
  customer_postal_code?: string | null;
  customer_country?: string | null;
  subtotal: number;
  discount: number;
  total: number;
  status: InvoiceStatus;
  created_at: string;
  updated_at: string;
  currency_code?: string | null;
  items: InvoiceItemRow[];
  payments: InvoicePaymentRow[];
  paid: number;
  derived_status: InvoiceStatus;
}

const iconSize = 16;

const IconCreditCard: React.FC = () => (
  <svg
    width={iconSize}
    height={iconSize}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <line x1="2" y1="10" x2="22" y2="10" />
    <line x1="6" y1="15" x2="10" y2="15" />
  </svg>
);

const IconCheck: React.FC = () => (
  <svg
    width={15}
    height={15}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconAlertCircle: React.FC = () => (
  <svg
    width={15}
    height={15}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

function invoiceLineGrossAmount(item: InvoiceItemRow): number {
  const ct = Number(item.weight_carats || 0);
  const qty = item.quantity || 0;
  const unit = Number(item.unit_price || 0);
  return Math.max(0, ct > 0 ? unit * ct * qty : unit * qty);
}

function invoiceLineDiscountAmount(item: InvoiceItemRow): number {
  const g = invoiceLineGrossAmount(item);
  const net = Number(item.line_total) || 0;
  return Math.max(0, g - net);
}

function invoiceLineDiscountPct(item: InvoiceItemRow): number {
  const g = invoiceLineGrossAmount(item);
  if (g <= 0) return 0;
  return (invoiceLineDiscountAmount(item) / g) * 100;
}

function invoiceLineDiscountPctPerCt(item: InvoiceItemRow): number | null {
  const ct = Number(item.weight_carats || 0);
  if (ct <= 0) return null;
  const listPricePerCt = Number(item.unit_price || 0);
  if (listPricePerCt <= 0) return null;
  const net = Number(item.line_total) || 0;
  const qty = item.quantity || 0;
  if (qty <= 0) return null;
  const netPerCt = net / (qty * ct);
  return Math.max(0, ((listPricePerCt - netPerCt) / listPricePerCt) * 100);
}

function itemCardTitle(item: InvoiceItemRow): string {
  const invDesc = (item.inventory_description || '').trim();
  if (
    invDesc &&
    !invDesc.includes(' · ') &&
    !/\d+(\.\d+)?\s*ct\b/i.test(invDesc) &&
    !/\d+(\.\d+)?\s*g\b/i.test(invDesc)
  ) {
    return invDesc;
  }

  const typeLine = [item.inv_category, item.inv_item_type].filter(Boolean).join(' ').trim();
  if (typeLine) return typeLine;

  const raw = (item.description || '').trim();
  if (!raw) return 'Line item';

  const segments = raw
    .split(/\s*·\s*/)
    .map(s => s.trim())
    .filter(Boolean);
  const nameSeg = segments.find(
    s =>
      !/^[A-Z0-9]{2,}$/i.test(s) &&
      !/^\d+(\.\d+)?\s*ct$/i.test(s) &&
      !/^\d+(\.\d+)?\s*g$/i.test(s)
  );
  return nameSeg || segments[0] || 'Line item';
}

function formatDetailDateTime(value: string): string {
  return dateFromServerUtc(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface InvoiceDetailCardProps {
  invoice: InvoiceDetail | null;
  loading?: boolean;
  error?: string | null;
  onClose?: () => void;
  onPrintInvoice?: (invoice: InvoiceDetail) => void;
  onPrintPayment?: (invoice: InvoiceDetail, paymentId: number) => void;
  onPay?: (invoiceId: number) => void;
  showPay?: boolean;
  showClose?: boolean;
  className?: string;
}

export const InvoiceDetailCard: React.FC<InvoiceDetailCardProps> = ({
  invoice,
  loading = false,
  error = null,
  onClose,
  onPrintInvoice,
  onPrintPayment,
  onPay,
  showPay = true,
  showClose = true,
  className = '',
}) => {
  const remaining = invoice ? Math.max(0, invoice.total - invoice.paid) : 0;
  const detailCurrency =
    invoice?.currency_code != null && invoice.currency_code !== ''
      ? invoice.currency_code
      : DEFAULT_CURRENCY_CODE;
  const hasReturns =
    invoice != null
      ? (invoice.items || []).some(it => Math.floor(Number(it.returned_qty || 0)) > 0)
      : false;
  const invoiceDiscountPct =
    invoice && invoice.subtotal > 0 ? (invoice.discount / invoice.subtotal) * 100 : 0;

  return (
    <div className={`pay-inv-detail-card pay-inv-detail-card--modern ${className}`.trim()}>
      {loading && (
        <div className="pay-inv-detail-placeholder">
          <p>Loading invoice details…</p>
        </div>
      )}
      {error && !loading && (
        <div className="pay-inv-detail-placeholder pay-inv-detail-placeholder--error">
          <p>{error}</p>
        </div>
      )}
      {invoice && !loading && !error && (
        <>
          <div className="pay-detail-hero">
            <div className="pay-detail-hero__main">
              <div className="pay-detail-hero__eyebrow">Invoice · {invoice.invoice_no}</div>
              <div className="pay-detail-hero__head-row">
                <div>
                  <div className="pay-detail-hero__customer">
                    {invoice.customer_name || 'Walk-in customer'}
                  </div>
                  <div className="pay-detail-hero__meta">
                    {formatDetailDateTime(invoice.created_at)}
                  </div>
                </div>
                <div className="pay-inv-detail-head-actions">
                  {onPrintInvoice ? (
                    <button
                      type="button"
                      className="pay-inv-btn-print"
                      onClick={() => onPrintInvoice(invoice)}
                    >
                      Print
                    </button>
                  ) : null}
                  {showClose && onClose ? (
                    <button
                      type="button"
                      className="pay-inv-btn-close pay-inv-btn-close--labelled"
                      aria-label="Close invoice details"
                      onClick={onClose}
                    >
                      Close
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="pay-detail-summary-grid">
            <div className="pay-detail-summary-card">
              <div className="pay-detail-summary-card__label">Total amount</div>
              <div className="pay-detail-summary-card__value">
                {formatMoneyAmount(invoice.total, detailCurrency)}
              </div>
            </div>
            <div className="pay-detail-summary-card">
              <div className="pay-detail-summary-card__label">Amount paid</div>
              <div className="pay-detail-summary-card__value pay-detail-summary-card__value--paid">
                {formatMoneyAmount(invoice.paid, detailCurrency)}
              </div>
            </div>
            <div className="pay-detail-summary-card">
              <div className="pay-detail-summary-card__label">Remaining</div>
              <div
                className={`pay-detail-summary-card__value ${
                  remaining > 0
                    ? 'pay-detail-summary-card__value--due'
                    : 'pay-detail-summary-card__value--paid'
                }`}
              >
                {formatMoneyAmount(remaining, detailCurrency)}
              </div>
            </div>
            {invoice.discount > 0 ? (
              <div className="pay-detail-summary-card pay-detail-summary-card--discount">
                <div className="pay-detail-summary-card__label">Invoice discount</div>
                <div className="pay-detail-summary-card__value">
                  {formatMoneyAmount(invoice.discount, detailCurrency)}
                </div>
                {invoice.subtotal > 0 ? (
                  <div className="pay-detail-summary-card__hint">
                    {invoiceDiscountPct.toFixed(1)}% of subtotal
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="pay-inv-detail-body pay-inv-detail-body--modern">
            <section className="pay-detail-section">
              <div className="pay-inv-section-heading">Items</div>
              <div className="pay-detail-item-list">
                {invoice.items.map(item => {
                  const ct = Number(item.weight_carats || 0);
                  const qty = item.quantity || 0;
                  const unit = Number(item.unit_price || 0);
                  const gross = invoiceLineGrossAmount(item);
                  const discAmt = invoiceLineDiscountAmount(item);
                  const discPct = invoiceLineDiscountPct(item);
                  const discPctCt = invoiceLineDiscountPctPerCt(item);
                  const net = Number(item.line_total) || 0;
                  const returnedQty = Math.floor(Number(item.returned_qty || 0));
                  const hasDiscount = discAmt > 0.005;
                  const effectivePerCt = ct > 0 && qty > 0 ? net / (qty * ct) : null;
                  return (
                    <article key={item.id} className="pay-detail-item-card">
                      <div className="pay-detail-item-card__head">
                        <div className="pay-detail-item-card__title-wrap">
                          <div className="pay-detail-item-card__title-row">
                            <div className="pay-detail-item-card__title">{itemCardTitle(item)}</div>
                          </div>
                          <div className="pay-inv-item-card-badges">
                            {item.item_code ? (
                              <span className="pay-inv-badge pay-inv-badge--code">{item.item_code}</span>
                            ) : null}
                            {item.inv_category ? (
                              <span className="pay-inv-badge pay-inv-badge--cat">{item.inv_category}</span>
                            ) : null}
                            {item.inv_item_type ? (
                              <span className="pay-inv-badge pay-inv-badge--type">{item.inv_item_type}</span>
                            ) : null}
                          </div>
                          <div className="pay-inv-item-card-badges pay-inv-item-card-badges--secondary">
                            {returnedQty > 0 ? (
                              <span className="pay-inv-badge pay-inv-badge--returned">
                                {returnedQty} returned
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="pay-detail-item-card__amount">
                          {formatMoneyAmount(net, detailCurrency)}
                        </div>
                      </div>

                      <div className="pay-detail-item-card__specs">
                        <div className="pay-detail-item-card__spec">
                          <span>Qty</span>
                          <strong>
                            {qty} pc{qty === 1 ? '' : 's'}
                          </strong>
                        </div>
                        <div className="pay-detail-item-card__spec">
                          <span>Weight</span>
                          <strong>
                            {ct > 0
                              ? `${ct} ct${item.weight_grams ? ` · ${item.weight_grams} g` : ''}`
                              : 'N/A'}
                          </strong>
                        </div>
                        <div className="pay-detail-item-card__spec">
                          <span>{ct > 0 ? 'List rate' : 'Unit price'}</span>
                          <strong>
                            {ct > 0
                              ? `${formatMoneyAmount(unit, detailCurrency)} /ct`
                              : formatMoneyAmount(unit, detailCurrency)}
                          </strong>
                        </div>
                      </div>

                      <div className="pay-detail-item-card__pricing">
                        <div className="pay-detail-item-card__pricing-row">
                          <span>List price</span>
                          <strong>
                            {ct > 0
                              ? `${formatMoneyAmount(unit, detailCurrency)} /ct`
                              : formatMoneyAmount(unit, detailCurrency)}
                          </strong>
                        </div>
                        <div className="pay-detail-item-card__pricing-row pay-detail-item-card__pricing-row--muted">
                          <span>
                            {ct > 0
                              ? `${formatMoneyAmount(unit, detailCurrency)} × ${ct} ct × ${qty} pc${
                                  qty === 1 ? '' : 's'
                                }`
                              : `${formatMoneyAmount(unit, detailCurrency)} × ${qty} pc${
                                  qty === 1 ? '' : 's'
                                }`}
                          </span>
                          <strong>{formatMoneyAmount(gross, detailCurrency)}</strong>
                        </div>
                        {hasDiscount ? (
                          <div className="pay-detail-item-card__pricing-row pay-detail-item-card__pricing-row--discount">
                            <span>
                              Discount
                              <span className="pay-inv-discount-badge">{discPct.toFixed(1)}% off</span>
                              {discPctCt !== null ? (
                                <span className="pay-inv-discount-badge pay-inv-discount-badge--ct">
                                  {discPctCt.toFixed(1)}% off /ct
                                </span>
                              ) : null}
                            </span>
                            <strong>-{formatMoneyAmount(discAmt, detailCurrency)}</strong>
                          </div>
                        ) : null}
                        <div className="pay-detail-item-card__pricing-row">
                          <span>Charged</span>
                          <strong>{formatMoneyAmount(net, detailCurrency)}</strong>
                        </div>
                        {effectivePerCt !== null ? (
                          <div className="pay-detail-item-card__pricing-note">
                            Effective rate: {formatMoneyAmount(effectivePerCt, detailCurrency)} /ct
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="pay-detail-section">
              <div className="pay-inv-section-heading">Payment history</div>
              {invoice.payments.length === 0 ? (
                <p className="pay-inv-no-payments">No payments recorded yet.</p>
              ) : (
                <div className="pay-detail-payments">
                  {invoice.payments.map(p => (
                    <div key={p.id} className="pay-detail-payment-card">
                      <div className="pay-detail-payment-card__head">
                        <div className="pay-detail-payment-card__meta">
                          <span className="pay-detail-payment-card__dot" aria-hidden="true" />
                          <div>
                            <div className="pay-detail-payment-card__method">{p.method}</div>
                            <div className="pay-detail-payment-card__date">
                              {formatDetailDateTime(p.created_at)}
                            </div>
                          </div>
                        </div>
                        <div className="pay-detail-payment-card__amount">
                          {formatMoneyAmount(p.amount, detailCurrency)}
                        </div>
                        {onPrintPayment ? (
                          <button
                            type="button"
                            className="pay-inv-payment-print-btn"
                            onClick={() => onPrintPayment(invoice, p.id)}
                          >
                            Print receipt
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="pay-detail-section">
              {remaining > 0 ? (
                <div
                  className={`pay-inv-status-banner pay-inv-status-banner--${(
                    invoice.derived_status || ''
                  ).toLowerCase()}`}
                  role="status"
                >
                  <div className="pay-inv-status-banner-icon">
                    <IconAlertCircle />
                  </div>
                  <div>
                    <div className="pay-inv-status-banner-title">
                      {invoice.derived_status === 'Partial' ? 'Partially paid' : 'Unpaid'}
                    </div>
                    <div className="pay-inv-status-banner-sub">
                      {formatMoneyAmount(remaining, detailCurrency)} still needs to be collected.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="pay-inv-status-banner pay-inv-status-banner--paid" role="status">
                  <div className="pay-inv-status-banner-icon pay-inv-status-banner-icon--ok">
                    <IconCheck />
                  </div>
                  <div>
                    <div className="pay-inv-status-banner-title">Fully paid</div>
                    <div className="pay-inv-status-banner-sub">No balance remaining.</div>
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="pay-inv-detail-footer pay-inv-detail-footer--modern">
            {hasReturns ? (
              <p className="pay-inv-pay-hint">This invoice includes returned item(s).</p>
            ) : null}
            {showPay && remaining > 0 && onPay ? (
              <>
                <button
                  type="button"
                  className="pay-inv-btn-pay"
                  onClick={() => onPay(invoice.id)}
                >
                  <IconCreditCard />
                  Pay invoice
                </button>
                <p className="pay-inv-pay-hint">
                  Open checkout to record the payment method, amount, and receipt.
                </p>
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};
