import React, { useCallback, useEffect, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import type { ThbPerUnitMap } from '../../lib/exchangeConversion';
import { mapApiInvoiceToReceipt, openInvoiceReceiptWindow } from '../../lib/receiptDocument';
import { formatUsdOnlyFromThb } from '../../lib/moneyUsdDisplay';
import { DEFAULT_CURRENCY_CODE, formatMoneyAmount, roundMoney2 } from '../../lib/currencies';
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
  createdAt: string;
  currencyCode: string;
}

interface InvoiceItemRow {
  id: number;
  inventory_item_id: number;
  item_code: string | null;
  description: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  weight_grams?: number | null;
  weight_carats?: number | null;
  inv_category?: string | null;
  inv_item_type?: string | null;
  inventory_description?: string | null;
}

function invoiceLineGrossAmount(item: InvoiceItemRow): number {
  return Math.max(0, (item.quantity || 0) * Number(item.unit_price || 0));
}

/** Per-line discount (gross − stored net line_total). */
function invoiceLineDiscountAmount(item: InvoiceItemRow): number {
  const g = invoiceLineGrossAmount(item);
  const net = Number(item.line_total) || 0;
  return Math.max(0, g - net);
}

function itemCardTitle(item: InvoiceItemRow): string {
  return (
    item.description ||
    item.inventory_description ||
    item.inv_category ||
    item.inv_item_type ||
    'Line item'
  );
}

function itemCardSubline(item: InvoiceItemRow, currencyCode: string): string {
  const parts: string[] = [];
  if (item.item_code) parts.push(`Code ${item.item_code}`);
  else parts.push(`#${item.inventory_item_id}`);
  if (item.weight_carats != null && String(item.weight_carats) !== '') {
    parts.push(`${item.weight_carats} ct`);
  }
  if (item.weight_grams != null && String(item.weight_grams) !== '') {
    parts.push(`${item.weight_grams} g`);
  }
  parts.push(`${item.quantity} × ${formatMoneyAmount(item.unit_price, currencyCode)}`);
  let s = parts.join(' · ');
  if (invoiceLineDiscountAmount(item) > 0) {
    s += ` · line disc. −${formatMoneyAmount(invoiceLineDiscountAmount(item), currencyCode)}`;
  }
  return s;
}

function itemCodeLetter(item: InvoiceItemRow): string {
  const raw = item.item_code?.trim() || String(item.inventory_item_id);
  return raw.charAt(0).toUpperCase() || '?';
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
              onNavigate={() => {
                closeCheckout();
              }}
            />
          </div>
        </div>
      )}
      <section
        className="payments-kpi-grid payments-kpi-grid--inv-ui"
        aria-label="Payments summary stats"
      >
        <div className="dashT-kpi-sum dashT-kpi-sum--green">
          <div className="dashT-kpi-sum__top">
            <span className="dashT-kpi-sum__label">Total Collected</span>
            <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--green" aria-hidden="true">
              <IconCheck />
            </div>
          </div>
          <div className="dashT-kpi-sum__value">{formatUsdOnlyFromThb(kpiPaidAmountThb, thbPerUnit)}</div>
          <div className="payments-kpi-sub">
            All time · paid invoices · USD from Profile rates (matches search and status filter)
          </div>
        </div>

        <div className="dashT-kpi-sum dashT-kpi-sum--orange">
          <div className="dashT-kpi-sum__top">
            <span className="dashT-kpi-sum__label">Outstanding</span>
            <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--orange" aria-hidden="true">
              <IconAlertCircle />
            </div>
          </div>
          <div className="dashT-kpi-sum__value">{formatUsdOnlyFromThb(kpiOutstandingThb, thbPerUnit)}</div>
          <div className="payments-kpi-sub">
            {kpiUnpaidCount + kpiPartialCount > 0
              ? `${kpiUnpaidCount} unpaid · ${kpiPartialCount} partial · same scope as list`
              : 'No balance in scope'}
          </div>
        </div>

        <div className="dashT-kpi-sum dashT-kpi-sum--blue">
          <div className="dashT-kpi-sum__top">
            <span className="dashT-kpi-sum__label">Total Invoices</span>
            <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--blue" aria-hidden="true">
              <IconCreditCard />
            </div>
          </div>
          <div className="dashT-kpi-sum__value">{kpiTotalInvoices}</div>
          <div className="payments-kpi-sub">
            {kpiPaidCount} paid · {kpiUnpaidCount} unpaid
            {listTruncated ? ' · list shows first 500; refine search' : ''}
          </div>
        </div>
      </section>

      <section className="payments-layout payments-layout--inv-ui">
        <div className="pay-inv-list-panel">
          <div className="pay-inv-list-card">
            <div className="pay-inv-list-card-header">
              <div className="pay-inv-list-card-top">
                <h2 className="pay-inv-list-title">Invoices</h2>
              </div>
              {error && (
                <div className="pay-inv-inline-error" role="alert">
                  {error}
                </div>
              )}
              <div className="pay-inv-search">
                <IconSearch />
                <input
                  type="search"
                  placeholder="Search by invoice number or customer…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  aria-label="Search invoices"
                />
              </div>
              <div className="pay-inv-filter-tabs" role="tablist" aria-label="Invoice status filters">
                {(['all', 'Unpaid', 'Partial', 'Paid'] as const).map(key => {
                  const label = key === 'all' ? 'All' : key;
                  const active = statusFilter === key;
                  let tabClass = 'pay-inv-filter-tab';
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

            <div className="pay-inv-row-list" aria-label="Invoices for payment">
              {loading ? (
                <div className="pay-inv-row-empty">Loading invoices…</div>
              ) : invoices.length === 0 ? (
                <div className="pay-inv-row-empty">No invoices to display yet.</div>
              ) : (
                invoices.map(inv => {
                  const isSelected = selectedInvoiceId === inv.id;
                  const st = (inv.status || 'Unpaid').toLowerCase() as 'paid' | 'unpaid' | 'partial';
                  const createdLabel = new Date(inv.createdAt).toLocaleString(undefined, {
                    month: 'numeric',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  });
                  const balanceLabel =
                    inv.remaining <= 0
                      ? 'Fully paid'
                      : `${formatMoneyAmount(inv.remaining, inv.currencyCode)} due`;
                  return (
                    <button
                      type="button"
                      key={inv.id}
                      className={`pay-inv-row${isSelected ? ' pay-inv-row--selected' : ''}`}
                      onClick={() => handleRowClick(inv.id)}
                    >
                      <div className={`pay-inv-row-icon pay-inv-row-icon--${st}`}>
                        {inv.status === 'Paid' ? (
                          <IconCheck />
                        ) : inv.status === 'Partial' ? (
                          <IconPartial />
                        ) : (
                          <IconAlertCircle />
                        )}
                      </div>
                      <div className="pay-inv-row-main">
                        <div className="pay-inv-row-line1">
                          <span className="pay-inv-num">{inv.invoiceNo}</span>
                          <span className="pay-inv-dot" aria-hidden="true">
                            ·
                          </span>
                          <span className={`pay-inv-status pay-inv-status--${st}`}>{inv.status}</span>
                        </div>
                        <div className="pay-inv-row-line2">
                          <span className="pay-inv-customer">{inv.customerName}</span>
                          <span className="pay-inv-dot" aria-hidden="true">
                            ·
                          </span>
                          <span className="pay-inv-date">{createdLabel}</span>
                        </div>
                      </div>
                      <div className="pay-inv-row-right" aria-label="Invoice amounts">
                        <div className="pay-inv-total">
                          {formatMoneyAmount(inv.total, inv.currencyCode)}
                        </div>
                        <div
                          className={`pay-inv-balance ${
                            inv.remaining <= 0 ? 'pay-inv-balance--zero' : 'pay-inv-balance--due'
                          }`}
                        >
                          {balanceLabel}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <aside className="pay-inv-detail-aside">
          {!selectedInvoiceId && !detailLoading && !detailError ? (
            <div className="pay-inv-detail-empty">
              <div className="pay-inv-detail-empty-icon" aria-hidden="true">
                <IconCreditCard />
              </div>
              <h3 className="pay-inv-detail-empty-title">Select an invoice</h3>
              <p className="pay-inv-detail-empty-text">
                Choose an invoice from the list to view details, print, or pay.
              </p>
            </div>
          ) : (
            <div className="pay-inv-detail-card">
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
                  <div className="pay-inv-detail-head">
                    <div className="pay-inv-detail-head-top">
                      <div>
                        <div className="pay-inv-detail-eyebrow">
                          Invoice · {selectedInvoice.invoice_no}
                        </div>
                        <div className="pay-inv-detail-customer-name">
                          {selectedInvoice.customer_name || 'Walk-in customer'}
                        </div>
                        <div className="pay-inv-detail-when">
                          {new Date(selectedInvoice.created_at).toLocaleString(undefined, {
                            month: 'numeric',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </div>
                      </div>
                      <div className="pay-inv-detail-head-actions">
                        <button
                          type="button"
                          className="pay-inv-btn-print"
                          onClick={() => printInvoiceReceipt(selectedInvoice)}
                        >
                          <IconPrinter />
                          Print
                        </button>
                        <button
                          type="button"
                          className="pay-inv-btn-close"
                          aria-label="Close invoice details"
                          onClick={handleCloseDetail}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div className="pay-inv-amount-grid">
                      <div className="pay-inv-amount-tile pay-inv-amount-tile--total">
                        <div className="pay-inv-amount-label">Total amount</div>
                        <div className="pay-inv-amount-value">
                          {formatMoneyAmount(selectedInvoice.total, detailCurrency)}
                        </div>
                      </div>
                      <div className="pay-inv-amount-tile pay-inv-amount-tile--paid">
                        <div className="pay-inv-amount-label">Amount paid</div>
                        <div className="pay-inv-amount-value">
                          {formatMoneyAmount(selectedInvoice.paid, detailCurrency)}
                        </div>
                      </div>
                      <div
                        className={`pay-inv-amount-tile ${
                          selectedRemaining <= 0
                            ? 'pay-inv-amount-tile--cleared'
                            : selectedInvoice.derived_status === 'Partial'
                              ? 'pay-inv-amount-tile--partial'
                              : 'pay-inv-amount-tile--due'
                        }`}
                      >
                        <div className="pay-inv-amount-label">Remaining</div>
                        <div className="pay-inv-amount-value">
                          {formatMoneyAmount(selectedRemaining, detailCurrency)}
                        </div>
                      </div>
                    </div>
                    {selectedInvoice.discount > 0 && (
                      <p className="pay-inv-invoice-discount">
                        Invoice discount:{' '}
                        {formatMoneyAmount(selectedInvoice.discount, detailCurrency)}
                      </p>
                    )}
                  </div>

                  <div className="pay-inv-detail-body">
                    <div>
                      <div className="pay-inv-section-heading">Items</div>
                      {selectedInvoice.items.map(item => (
                        <div key={item.id} className="pay-inv-item-row">
                          <div className="pay-inv-item-left">
                            <div className="pay-inv-item-code">{itemCodeLetter(item)}</div>
                            <div>
                              <div className="pay-inv-item-title">{itemCardTitle(item)}</div>
                              <div className="pay-inv-item-meta">{itemCardSubline(item, detailCurrency)}</div>
                            </div>
                          </div>
                          <div className="pay-inv-item-price">
                            {formatMoneyAmount(item.line_total, detailCurrency)}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div>
                      <div className="pay-inv-section-heading">Payment history</div>
                      {selectedInvoice.payments.length === 0 ? (
                        <p className="pay-inv-no-payments">No payments recorded yet.</p>
                      ) : (
                        <div className="pay-inv-payment-timeline">
                          {selectedInvoice.payments.map(p => (
                            <div key={p.id} className="pay-inv-payment-entry">
                              <div className="pay-inv-payment-dot">
                                <IconCheck />
                              </div>
                              <div className="pay-inv-payment-body">
                                <div className="pay-inv-payment-row-line">
                                  <div>
                                    <div className="pay-inv-payment-method">{p.method}</div>
                                    <div className="pay-inv-payment-when">
                                      {new Date(p.created_at).toLocaleString(undefined, {
                                        month: 'numeric',
                                        day: 'numeric',
                                        year: 'numeric',
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        second: '2-digit',
                                      })}
                                    </div>
                                  </div>
                                  <div className="pay-inv-payment-amt">
                                    {formatMoneyAmount(p.amount, detailCurrency)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

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
                            {formatMoneyAmount(selectedRemaining, detailCurrency)} balance remaining
                            on this invoice.
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
                            No balance remaining on this invoice.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pay-inv-detail-footer">
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
                          Opens invoice checkout to choose payment method, currency, and amount
                          tendered.
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
  );
}

