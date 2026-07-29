import React, { useCallback, useEffect, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import type { ThbPerUnitMap } from '../../lib/exchangeConversion';
import { mapApiInvoiceToReceipt, openInvoiceReceiptWindow } from '../../lib/receiptDocument';
import { openPaymentReceiptForInvoicePayment } from '../../lib/paymentReceipt';
import { formatUsdOnlyFromThb } from '../../lib/moneyUsdDisplay';
import { DEFAULT_CURRENCY_CODE, formatMoneyAmount, roundMoney2 } from '../../lib/currencies';
import { dateFromServerUtc } from '../../lib/serverTime';
import { INVOICE_CHECKOUT_INVOICE_ID_KEY } from '../../constants/invoiceCheckout';
import type { PageId } from '../../components/layout/Layout';
import { InvoiceCheckoutPage } from './InvoiceCheckoutPage';

type InvoiceStatus = 'Unpaid' | 'Partial' | 'Paid';
type InvoiceListFilter = 'all' | InvoiceStatus;

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

const IconSearch: React.FC = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
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

const IconPartial: React.FC = () => (
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
    <path d="M12 6v6l4 2" />
  </svg>
);

const IconPrinter: React.FC = () => (
  <svg
    width={13}
    height={13}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);

interface PaymentInvoiceRow {
  id: number;
  invoiceNo: string;
  customerName: string;
  total: number;
  paid: number;
  remaining: number;
  status: InvoiceStatus;
  returnedQty: number;
  createdAt: string;
  currencyCode: string;
}

interface InvoiceItemRow {
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

function invoiceLineGrossAmount(item: InvoiceItemRow): number {
  const ct = Number(item.weight_carats || 0);
  const qty = item.quantity || 0;
  const unit = Number(item.unit_price || 0);
  // When weight is set, unit_price is $/ct → gross = unit × ct × qty
  // When no weight, unit_price is $/pc → gross = unit × qty
  return Math.max(0, ct > 0 ? unit * ct * qty : unit * qty);
}

/** Per-line discount (gross − stored net line_total). */
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

/** Discount % on $/ct — how much the $/ct rate was reduced relative to list. */
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

function itemCodeLetter(item: InvoiceItemRow): string {
  const raw = item.item_code?.trim() || String(item.inventory_item_id);
  return raw.charAt(0).toUpperCase() || '?';
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

function formatDetailDateTimeWithSeconds(value: string): string {
  return dateFromServerUtc(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface PaymentRow {
  id: number;
  method: string;
  amount: number;
  note: string | null;
  created_at: string;
}

interface InvoiceDetail {
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
  payments: PaymentRow[];
  paid: number;
  derived_status: InvoiceStatus;
}

interface PaymentPageProps {
  onNavigate?: (page: PageId) => void;
  token: string;
}

interface InvoiceStatsResponse {
  invoices_count: number;
  unpaid_count: number;
  partial_count: number;
  paid_count: number;
  return_eligible_count: number;
  outstanding_thb: number;
  collected_thb: number;
}

export const PaymentPage: React.FC<PaymentPageProps> = ({ onNavigate, token }) => {
  const { showAlert } = useAlertDialog();
  const [thbPerUnit, setThbPerUnit] = useState<ThbPerUnitMap>({ THB: 1 });
  const [statusFilter, setStatusFilter] = useState<InvoiceListFilter>('all');
  const [search, setSearch] = useState('');
  const [invoices, setInvoices] = useState<PaymentInvoiceRow[]>([]);
  const [invoiceStats, setInvoiceStats] = useState<InvoiceStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listParams = new URLSearchParams();
      listParams.set('limit', '500');
      if (search.trim()) listParams.set('search', search.trim());
      if (statusFilter !== 'all') listParams.set('status', statusFilter);

      const statsParams = new URLSearchParams();
      if (search.trim()) statsParams.set('search', search.trim());
      if (statusFilter !== 'all') statsParams.set('status', statusFilter);

      const [res, statsRes] = await Promise.all([
        fetch(apiUrl(`/api/invoices?${listParams.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(apiUrl(`/api/invoices/stats?${statsParams.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load invoices');
        throw new Error(msg);
      }
      if (!statsRes.ok) {
        const msg = await parseErrorResponse(statsRes, 'Failed to load invoice totals');
        throw new Error(msg);
      }
      const statsJson: InvoiceStatsResponse = await statsRes.json();
      setInvoiceStats(statsJson);
      const data: {
        id: number;
        invoice_no: string;
        customer_name: string | null;
        total: number;
        paid: number;
        status: InvoiceStatus;
        returned_qty?: number;
        created_at: string;
        currency_code?: string | null;
      }[] = await res.json();
      setInvoices(
        data.map(inv => ({
          id: inv.id,
          invoiceNo: inv.invoice_no,
          customerName: inv.customer_name || 'Walk-in customer',
          total: inv.total,
          paid: inv.paid,
          remaining: inv.total - inv.paid,
          status: inv.status,
          returnedQty: Math.max(0, Math.floor(Number(inv.returned_qty || 0))),
          createdAt: inv.created_at,
          currencyCode: inv.currency_code || DEFAULT_CURRENCY_CODE,
        }))
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load invoices';
      setError(msg);
      setInvoices([]);
      setInvoiceStats(null);
      showAlert({ title: 'Could not load invoices', message: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [token, showAlert, search, statusFilter]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl('/api/exchange-rates'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data?.thb_per_unit && typeof data.thb_per_unit === 'object') {
          setThbPerUnit(data.thb_per_unit as ThbPerUnitMap);
        }
      } catch {
        // keep defaults
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const fetchInvoiceDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    setDetailError(null);
    setSelectedInvoice(null);
    try {
      const res = await fetch(apiUrl(`/api/invoices/${id}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load invoice details');
        throw new Error(msg);
      }
      const data: InvoiceDetail = await res.json();
      if (data.derived_status == null && data.status) {
        data.derived_status = data.status;
      }
      setSelectedInvoice(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load invoice details';
      setDetailError(msg);
      setSelectedInvoice(null);
      showAlert({ title: 'Could not load invoice', message: msg, variant: 'error' });
    } finally {
      setDetailLoading(false);
    }
  }, [token, showAlert]);

  const handleRowClick = (id: number) => {
    setSelectedInvoiceId(id);
    void fetchInvoiceDetail(id);
  };

  const handleCloseDetail = () => {
    setSelectedInvoiceId(null);
    setSelectedInvoice(null);
    setDetailError(null);
  };

  /** Dedicated invoice checkout page (not full Selling page). */
  const handlePayClick = (id: number) => {
    try {
      window.sessionStorage.setItem(INVOICE_CHECKOUT_INVOICE_ID_KEY, String(id));
    } catch {
      // Ignore storage errors and still navigate.
    }
    setCheckoutOpen(true);
  };

  const closeCheckout = useCallback(() => {
    setCheckoutOpen(false);
    // Refresh list + stats so the paid/remaining status updates immediately.
    void fetchInvoices();
    // Refresh selected invoice detail too (if still selected).
    if (selectedInvoiceId != null) {
      void fetchInvoiceDetail(selectedInvoiceId);
    }
  }, [fetchInvoices, selectedInvoiceId, fetchInvoiceDetail]);

  useEffect(() => {
    if (!checkoutOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCheckout();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [checkoutOpen, closeCheckout]);

  const kpiUnpaidCount = invoiceStats?.unpaid_count ?? 0;
  const kpiPartialCount = invoiceStats?.partial_count ?? 0;
  const kpiTotalInvoices = invoiceStats?.invoices_count ?? 0;
  const kpiOutstandingThb = roundMoney2(invoiceStats?.outstanding_thb ?? 0);
  const kpiPaidAmountThb = roundMoney2(invoiceStats?.collected_thb ?? 0);
  const listTruncated =
    invoices.length >= 500 && (invoiceStats?.invoices_count ?? 0) > 500;
  const kpiPaidCount = invoiceStats?.paid_count ?? 0;

  const selectedRemaining = selectedInvoice
    ? Math.max(0, selectedInvoice.total - selectedInvoice.paid)
    : 0;

  const detailCurrency =
    selectedInvoice?.currency_code != null && selectedInvoice.currency_code !== ''
      ? selectedInvoice.currency_code
      : DEFAULT_CURRENCY_CODE;
  const selectedHasReturns =
    selectedInvoice != null
      ? (selectedInvoice.items || []).some(it => Math.floor(Number(it.returned_qty || 0)) > 0)
      : false;
  const selectedInvoiceDiscountPct =
    selectedInvoice && selectedInvoice.subtotal > 0
      ? (selectedInvoice.discount / selectedInvoice.subtotal) * 100
      : 0;

  const printInvoiceReceipt = (inv: InvoiceDetail) => {
    openInvoiceReceiptWindow(
        mapApiInvoiceToReceipt({
        invoice_no: inv.invoice_no,
        created_at: inv.created_at,
        customer_name: inv.customer_name,
        customer_phone: inv.customer_phone,
        customer_email: inv.customer_email,
        customer_address_line1: inv.customer_address_line1,
        customer_address_line2: inv.customer_address_line2,
        customer_city: inv.customer_city,
        customer_postal_code: inv.customer_postal_code,
        customer_country: inv.customer_country,
        subtotal: inv.subtotal,
        discount: inv.discount,
        total: inv.total,
        paid: inv.paid,
        status: inv.status,
        currency_code: inv.currency_code,
        items: inv.items.map(it => ({
          item_code: it.item_code,
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price,
          line_total: it.line_total,
          weight_grams: it.weight_grams,
          weight_carats: it.weight_carats,
          inv_category: it.inv_category,
          inv_item_type: it.inv_item_type,
          inventory_description: it.inventory_description,
        })),
        payments: inv.payments.map(p => ({
          method: p.method,
          amount: p.amount,
          created_at: p.created_at,
        })),
      })
    );
  };

  const printPaymentReceipt = (inv: InvoiceDetail, paymentId: number) => {
    const currency =
      inv.currency_code != null && inv.currency_code !== ''
        ? inv.currency_code
        : DEFAULT_CURRENCY_CODE;
    const ok = openPaymentReceiptForInvoicePayment({
      invoice_no: inv.invoice_no,
      customer_name: inv.customer_name,
      currency_code: currency,
      invoice_total: inv.total,
      payments: inv.payments.map(p => ({
        id: p.id,
        method: p.method,
        amount: p.amount,
        created_at: p.created_at,
      })),
      paymentId,
    });
    if (!ok) {
      showAlert({
        title: 'Could not print',
        message: 'Payment receipt could not be opened.',
        variant: 'error',
      });
    }
  };

  return (
    <div className="page page-payments">
      {checkoutOpen && (
        <div
          className="pay-checkout-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Invoice checkout"
          onMouseDown={e => {
            if (e.target === e.currentTarget) closeCheckout();
          }}
        >
          <div className="pay-checkout-modal" onMouseDown={e => e.stopPropagation()}>
            <InvoiceCheckoutPage
              token={token}
              embedded
              onNavigate={() => {
                closeCheckout();
              }}
            />
          </div>
        </div>
      )}
      <div className="pay-shell">
        <section className="pay-hero" aria-label="Payments page header">
          <div>
            <p className="pay-hero__eyebrow">Finance workspace</p>
            <h1 className="pay-hero__title">Payment</h1>
            <p className="pay-hero__subtitle">
              Review invoices, inspect every line item in detail, track discounts per carat,
              print receipts, and collect outstanding balances.
            </p>
          </div>
          <div className="pay-hero__meta">
            <span className="pay-hero__meta-pill">{kpiTotalInvoices} invoices in scope</span>
            {listTruncated ? (
              <span className="pay-hero__meta-note">Showing first 500 matches. Refine search.</span>
            ) : (
              <span className="pay-hero__meta-note">Filters apply to totals and the invoice list.</span>
            )}
          </div>
        </section>

        <section className="pay-stat-grid" aria-label="Payments summary stats">
          <article className="pay-stat-card pay-stat-card--success">
            <div className="pay-stat-card__label">Total collected</div>
            <div className="pay-stat-card__value">
              {formatUsdOnlyFromThb(kpiPaidAmountThb, thbPerUnit)}
            </div>
            <div className="pay-stat-card__sub">Paid invoices converted with profile rates.</div>
          </article>
          <article className="pay-stat-card pay-stat-card--warning">
            <div className="pay-stat-card__label">Outstanding balance</div>
            <div className="pay-stat-card__value">
              {formatUsdOnlyFromThb(kpiOutstandingThb, thbPerUnit)}
            </div>
            <div className="pay-stat-card__sub">
              {kpiUnpaidCount} unpaid and {kpiPartialCount} partial invoices.
            </div>
          </article>
          <article className="pay-stat-card pay-stat-card--primary">
            <div className="pay-stat-card__label">Total invoices</div>
            <div className="pay-stat-card__value">{kpiTotalInvoices}</div>
            <div className="pay-stat-card__sub">
              {kpiPaidCount} paid across the current search and status scope.
            </div>
          </article>
        </section>

        <section className="pay-workspace">
          <div className="pay-panel pay-panel--list">
            <div className="pay-panel__header pay-panel__header--list">
              <div>
                <p className="pay-panel__eyebrow">Invoices</p>
                <h2 className="pay-panel__title">Payment Queue</h2>
              </div>
              <div className="pay-panel__header-note">
                {loading ? 'Refreshing…' : `${invoices.length} result${invoices.length === 1 ? '' : 's'}`}
              </div>
            </div>

            <div className="pay-list-toolbar">
              {error && (
                <div className="pay-inv-inline-error" role="alert">
                  {error}
                </div>
              )}
              <div className="pay-inv-search pay-inv-search--modern">
                <IconSearch />
                <input
                  type="search"
                  placeholder="Search invoice no. or customer"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  aria-label="Search invoices"
                />
              </div>
              <div className="pay-inv-filter-tabs" role="tablist" aria-label="Invoice status filters">
                {(['all', 'Unpaid', 'Partial', 'Paid'] as const).map(key => {
                  const label = key === 'all' ? 'All' : key;
                  const active = statusFilter === key;
                  let tabClass = 'pay-inv-filter-tab pay-inv-filter-tab--modern';
                  if (active) {
                    tabClass +=
                      key === 'all'
                        ? ' pay-inv-filter-tab--active'
                        : ` pay-inv-filter-tab--active-${key.toLowerCase()}`;
                  }
                  return (
                    <button
                      key={key}
                      type="button"
                      className={tabClass}
                      onClick={() => setStatusFilter(key)}
                      role="tab"
                      aria-selected={active}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pay-inv-row-list pay-inv-row-list--modern" aria-label="Invoices for payment">
              {loading ? (
                <div className="pay-inv-row-empty">Loading invoices…</div>
              ) : invoices.length === 0 ? (
                <div className="pay-inv-row-empty">No invoices match the current filters.</div>
              ) : (
                invoices.map(inv => {
                  const isSelected = selectedInvoiceId === inv.id;
                  const st = (inv.status || 'Unpaid').toLowerCase() as 'paid' | 'unpaid' | 'partial';
                  const hasReturns = inv.returnedQty > 0;
                  return (
                    <button
                      type="button"
                      key={inv.id}
                      className={`pay-inv-row pay-inv-row--modern${isSelected ? ' pay-inv-row--selected' : ''}`}
                      onClick={() => handleRowClick(inv.id)}
                    >
                      <div className="pay-inv-row-main">
                        <div className="pay-inv-row-line1 pay-inv-row-line1--modern">
                          <span className="pay-inv-num">{inv.invoiceNo}</span>
                          <span className={`pay-chip pay-chip--${st}`}>{inv.status}</span>
                          {hasReturns ? <span className="pay-chip pay-chip--return">Return</span> : null}
                        </div>
                        <div className="pay-inv-customer">{inv.customerName}</div>
                        <div className="pay-inv-row-line2 pay-inv-row-line2--modern">
                          <span className="pay-inv-date">{formatDetailDateTime(inv.createdAt)}</span>
                          <span className="pay-inv-dot" aria-hidden="true">
                            ·
                          </span>
                          <span>
                            Paid {formatMoneyAmount(inv.paid, inv.currencyCode)} of{' '}
                            {formatMoneyAmount(inv.total, inv.currencyCode)}
                          </span>
                        </div>
                      </div>
                      <div className="pay-inv-row-right pay-inv-row-right--modern" aria-label="Invoice amounts">
                        <div className="pay-inv-total">
                          {formatMoneyAmount(inv.remaining > 0 ? inv.remaining : inv.total, inv.currencyCode)}
                        </div>
                        <div
                          className={`pay-inv-balance ${
                            inv.remaining <= 0 ? 'pay-inv-balance--zero' : 'pay-inv-balance--due'
                          }`}
                        >
                          {inv.remaining <= 0 ? 'Settled' : 'Due now'}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <aside className="pay-panel pay-panel--detail">
            {!selectedInvoiceId && !detailLoading && !detailError ? (
              <div className="pay-inv-detail-empty pay-inv-detail-empty--modern">
                <div className="pay-inv-detail-empty-icon" aria-hidden="true">
                  <IconCreditCard />
                </div>
                <h3 className="pay-inv-detail-empty-title">Select an invoice</h3>
                <p className="pay-inv-detail-empty-text">
                  Pick an invoice from the left to inspect line items, discount percentages, and
                  payment history.
                </p>
              </div>
            ) : (
              <div className="pay-inv-detail-card pay-inv-detail-card--modern">
                {detailLoading && (
                  <div className="pay-inv-detail-placeholder">
                    <p>Loading invoice details…</p>
                  </div>
                )}
                {detailError && !detailLoading && (
                  <div className="pay-inv-detail-placeholder pay-inv-detail-placeholder--error">
                    <p>{detailError}</p>
                  </div>
                )}
                {selectedInvoice && !detailLoading && !detailError && (
                  <>
                    <div className="pay-detail-hero">
                      <div className="pay-detail-hero__main">
                        <div className="pay-detail-hero__eyebrow">
                          Invoice · {selectedInvoice.invoice_no}
                        </div>
                        <div className="pay-detail-hero__head-row">
                          <div>
                            <div className="pay-detail-hero__customer">
                              {selectedInvoice.customer_name || 'Walk-in customer'}
                            </div>
                            <div className="pay-detail-hero__meta">
                              {formatDetailDateTime(selectedInvoice.created_at)}
                            </div>
                          </div>
                          <div className="pay-inv-detail-head-actions">
                            <button
                              type="button"
                              className="pay-inv-btn-print"
                              onClick={() => printInvoiceReceipt(selectedInvoice)}
                            >
                              Print
                            </button>
                            <button
                              type="button"
                              className="pay-inv-btn-close pay-inv-btn-close--labelled"
                              aria-label="Close invoice details"
                              onClick={handleCloseDetail}
                            >
                              Close
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pay-detail-summary-grid">
                      <div className="pay-detail-summary-card">
                        <div className="pay-detail-summary-card__label">Total amount</div>
                        <div className="pay-detail-summary-card__value">
                          {formatMoneyAmount(selectedInvoice.total, detailCurrency)}
                        </div>
                      </div>
                      <div className="pay-detail-summary-card">
                        <div className="pay-detail-summary-card__label">Amount paid</div>
                        <div className="pay-detail-summary-card__value pay-detail-summary-card__value--paid">
                          {formatMoneyAmount(selectedInvoice.paid, detailCurrency)}
                        </div>
                      </div>
                      <div className="pay-detail-summary-card">
                        <div className="pay-detail-summary-card__label">Remaining</div>
                        <div
                          className={`pay-detail-summary-card__value ${
                            selectedRemaining > 0
                              ? 'pay-detail-summary-card__value--due'
                              : 'pay-detail-summary-card__value--paid'
                          }`}
                        >
                          {formatMoneyAmount(selectedRemaining, detailCurrency)}
                        </div>
                      </div>
                      {selectedInvoice.discount > 0 ? (
                        <div className="pay-detail-summary-card pay-detail-summary-card--discount">
                          <div className="pay-detail-summary-card__label">Invoice discount</div>
                          <div className="pay-detail-summary-card__value">
                            {formatMoneyAmount(selectedInvoice.discount, detailCurrency)}
                          </div>
                          {selectedInvoice.subtotal > 0 ? (
                            <div className="pay-detail-summary-card__hint">
                              {selectedInvoiceDiscountPct.toFixed(1)}% of subtotal
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="pay-inv-detail-body pay-inv-detail-body--modern">
                      <section className="pay-detail-section">
                        <div className="pay-inv-section-heading">Items</div>
                        <div className="pay-detail-item-list">
                          {selectedInvoice.items.map(item => {
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
                                  <div className="pay-inv-item-code">{itemCodeLetter(item)}</div>
                                  <div className="pay-detail-item-card__title-wrap">
                                    <div className="pay-detail-item-card__title-row">
                                      <div className="pay-detail-item-card__title">
                                        {itemCardTitle(item)}
                                      </div>
                                    </div>
                                    <div className="pay-inv-item-card-badges">
                                      {item.item_code ? (
                                        <span className="pay-inv-badge pay-inv-badge--code">
                                          {item.item_code}
                                        </span>
                                      ) : null}
                                      {item.inv_category ? (
                                        <span className="pay-inv-badge pay-inv-badge--cat">
                                          {item.inv_category}
                                        </span>
                                      ) : null}
                                      {item.inv_item_type ? (
                                        <span className="pay-inv-badge pay-inv-badge--type">
                                          {item.inv_item_type}
                                        </span>
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
                                        <span className="pay-inv-discount-badge">
                                          {discPct.toFixed(1)}% off
                                        </span>
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
                        {selectedInvoice.payments.length === 0 ? (
                          <p className="pay-inv-no-payments">No payments recorded yet.</p>
                        ) : (
                          <div className="pay-detail-payments">
                            {selectedInvoice.payments.map(p => (
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
                                  <button
                                    type="button"
                                    className="pay-inv-payment-print-btn"
                                    onClick={() => printPaymentReceipt(selectedInvoice, p.id)}
                                  >
                                    Print receipt
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>

                      <section className="pay-detail-section">
                        {selectedRemaining > 0 ? (
                          <div
                            className={`pay-inv-status-banner pay-inv-status-banner--${(
                              selectedInvoice.derived_status || ''
                            ).toLowerCase()}`}
                            role="status"
                          >
                            <div className="pay-inv-status-banner-icon">
                              <IconAlertCircle />
                            </div>
                            <div>
                              <div className="pay-inv-status-banner-title">
                                {selectedInvoice.derived_status === 'Partial'
                                  ? 'Partially paid'
                                  : 'Unpaid'}
                              </div>
                              <div className="pay-inv-status-banner-sub">
                                {formatMoneyAmount(selectedRemaining, detailCurrency)} still needs to be
                                collected.
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
                              <div className="pay-inv-status-banner-sub">
                                No balance remaining.
                              </div>
                            </div>
                          </div>
                        )}
                      </section>
                    </div>

                    <div className="pay-inv-detail-footer pay-inv-detail-footer--modern">
                      {selectedHasReturns ? (
                        <p className="pay-inv-pay-hint">This invoice includes returned item(s).</p>
                      ) : null}
                      {selectedRemaining > 0 ? (
                        <>
                          <button
                            type="button"
                            className="pay-inv-btn-pay"
                            onClick={() => handlePayClick(selectedInvoice.id)}
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
            )}
          </aside>
        </section>
      </div>
    </div>
  );
}

