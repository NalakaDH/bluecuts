import React, { useCallback, useEffect, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { mapApiInvoiceToReceipt, openInvoiceReceiptWindow } from '../../lib/receiptDocument';
import { DEFAULT_CURRENCY_CODE, formatMoneyAmount, roundMoney2 } from '../../lib/currencies';
import { INVOICE_CHECKOUT_INVOICE_ID_KEY } from '../../constants/invoiceCheckout';
import type { PageId } from '../../components/layout/Layout';

type InvoiceStatus = 'Unpaid' | 'Partial' | 'Paid';
type InvoiceListFilter = 'all' | InvoiceStatus;

const iconSize = 16;

const IconEye: React.FC = () => (
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
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

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

const IconDownload: React.FC = () => (
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
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
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
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Card' | 'QR' | 'BankTransfer'>('Cash');
  const [paymentSaving, setPaymentSaving] = useState(false);
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

  const fetchInvoiceDetail = async (id: number) => {
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
  };

  const handleRowClick = (id: number) => {
    setSelectedInvoiceId(id);
  };

  const handleToggleDetails = (id: number) => {
    const panelOpen = detailLoading || !!selectedInvoice || !!detailError;
    if (panelOpen && selectedInvoiceId === id) {
      // Toggle off when double-clicking the same invoice
      setSelectedInvoiceId(null);
      setSelectedInvoice(null);
      setDetailError(null);
      return;
    }
    setSelectedInvoiceId(id);
    fetchInvoiceDetail(id);
  };

  /** Dedicated invoice checkout page (not full Selling page). */
  const handlePayClick = (id: number) => {
    try {
      window.sessionStorage.setItem(INVOICE_CHECKOUT_INVOICE_ID_KEY, String(id));
    } catch {
      // Ignore storage errors and still navigate.
    }
    onNavigate?.('invoiceCheckout');
  };

  const detailsOpen = detailLoading || !!selectedInvoice || !!detailError;

  const kpiUnpaidCount = invoiceStats?.unpaid_count ?? 0;
  const kpiPartialCount = invoiceStats?.partial_count ?? 0;
  const kpiTotalInvoices = invoiceStats?.invoices_count ?? 0;
  const kpiOutstandingThb = roundMoney2(invoiceStats?.outstanding_thb ?? 0);
  const kpiPaidAmountThb = roundMoney2(invoiceStats?.collected_thb ?? 0);
  const listTruncated =
    invoices.length >= 500 && (invoiceStats?.invoices_count ?? 0) > 500;

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

  const printInvoiceById = async (id: number) => {
    try {
      const res = await fetch(apiUrl(`/api/invoices/${id}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: InvoiceDetail = await res.json();
      if (data.derived_status == null && data.status) data.derived_status = data.status;
      printInvoiceReceipt(data);
    } catch {
      // ignore
    }
  };

  return (
    <div className="page page-payments">
      <section className="payments-kpi-grid" aria-label="Payments summary stats">
        <div className="payments-kpi-card payments-kpi-card--red">
          <div className="payments-kpi-label">Outstanding Balance</div>
          <div className="payments-kpi-value">
            {formatMoneyAmount(kpiOutstandingThb, DEFAULT_CURRENCY_CODE)}
          </div>
          <div className="payments-kpi-sub">
            {kpiUnpaidCount} unpaid · full totals for current search & status (not capped by table)
          </div>
        </div>

        <div className="payments-kpi-card payments-kpi-card--amber">
          <div className="payments-kpi-label">Partial Payments</div>
          <div className="payments-kpi-value">{kpiPartialCount}</div>
          <div className="payments-kpi-sub">Invoices with balance (same scope)</div>
        </div>

        <div className="payments-kpi-card payments-kpi-card--blue">
          <div className="payments-kpi-label">Total Invoices</div>
          <div className="payments-kpi-value">{kpiTotalInvoices}</div>
          <div className="payments-kpi-sub">
            Matching filter
            {listTruncated ? ' · Table shows first 500; refine search' : ''}
          </div>
        </div>

        <div className="payments-kpi-card payments-kpi-card--green">
          <div className="payments-kpi-label">Paid Amount</div>
          <div className="payments-kpi-value">
            {formatMoneyAmount(kpiPaidAmountThb, DEFAULT_CURRENCY_CODE)}
          </div>
          <div className="payments-kpi-sub">Payments recorded · THB equivalent (server rates)</div>
        </div>
      </section>

      <section
        className={detailsOpen ? 'payments-layout' : 'payments-layout payments-layout--single'}
      >
        <section className="selling-invoices-card payments-invoices-list">
          <div className="selling-invoices-card-head">
            <h3 className="selling-section-title">Invoices</h3>
            <button
              type="button"
              className="primary-button payments-new-invoice-btn"
              onClick={() => onNavigate && onNavigate('selling')}
            >
              <span className="payments-plus-icon" aria-hidden="true">
                +
              </span>
              New Invoice
            </button>
          </div>

          {error && (
            <div className="selling-state selling-state-error">
              <p>{error}</p>
            </div>
          )}

          <div className="selling-invoices-toolbar">
            <div className="selling-invoices-search-wrap">
              <span className="selling-invoices-search-icon" aria-hidden="true">
                <IconSearch />
              </span>
              <input
                type="search"
                className="selling-invoices-search"
                placeholder="Search by invoice number"
                value={search}
                onChange={e => setSearch(e.target.value)}
                aria-label="Search invoices"
              />
            </div>
            <div className="selling-invoices-filters" role="tablist" aria-label="Invoice status filters">
              {(['all', 'Unpaid', 'Partial', 'Paid'] as const).map(key => {
                const label = key === 'all' ? 'All' : key;
                const active = statusFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`selling-invoices-filter${active ? ' is-active' : ''}`}
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

          <div className="selling-invoices-table-wrap">
            <table className="selling-invoices-table" aria-label="Invoices for payment">
              <thead>
                <tr>
                  <th scope="col">Invoice #</th>
                  <th scope="col">Date</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Total</th>
                  <th scope="col">Paid</th>
                  <th scope="col">Balance</th>
                  <th scope="col">Status</th>
                  {!detailsOpen && <th scope="col">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={detailsOpen ? 7 : 8} className="selling-empty-cell">
                      Loading invoices…
                    </td>
                  </tr>
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={detailsOpen ? 7 : 8} className="selling-empty-cell">
                      No invoices to display yet.
                    </td>
                  </tr>
                ) : (
                  invoices.map(inv => {
                    const isSelected = selectedInvoiceId === inv.id;
                    return (
                      <tr
                        key={inv.id}
                        className={isSelected ? 'is-selected' : undefined}
                        onClick={() => handleRowClick(inv.id)}
                        onDoubleClick={() => handleToggleDetails(inv.id)}
                      >
                        <td className="selling-invoice-id">{inv.invoiceNo}</td>
                        <td>{new Date(inv.createdAt).toLocaleDateString()}</td>
                        <td className="selling-invoice-customer">{inv.customerName}</td>
                        <td className="selling-invoice-total">
                          {formatMoneyAmount(inv.total, inv.currencyCode)}
                        </td>
                        <td>
                          <span className="selling-invoice-paid">
                            {formatMoneyAmount(inv.paid, inv.currencyCode)}
                          </span>
                        </td>
                        <td>
                          {inv.remaining > 0 ? (
                            <span className="selling-invoice-balance">
                              {formatMoneyAmount(inv.remaining, inv.currencyCode)}
                            </span>
                          ) : (
                            <span className="selling-invoice-balance-zero">—</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`selling-invoice-status selling-invoice-status--${(inv.status || '').toLowerCase()}`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        {!detailsOpen && (
                          <td className="selling-invoice-actions">
                            <div className="selling-invoice-actions-inner payments-invoice-action-row">
                              <button
                                type="button"
                                className="selling-invoice-action-btn selling-invoice-action-btn--view"
                                title="View details"
                                aria-label={`View ${inv.invoiceNo}`}
                                onClick={e => {
                                  e.stopPropagation();
                                  handleToggleDetails(inv.id);
                                }}
                              >
                                <IconEye />
                              </button>
                              {inv.remaining > 0 && (
                                <button
                                  type="button"
                                  className="selling-invoice-action-btn selling-invoice-action-btn--pay"
                                  title="Pay invoice"
                                  aria-label={`Pay ${inv.invoiceNo}`}
                                  onClick={e => {
                                    e.stopPropagation();
                                    handlePayClick(inv.id);
                                  }}
                                >
                                  <IconCreditCard />
                                </button>
                              )}
                              <button
                                type="button"
                                className="selling-invoice-action-btn selling-invoice-action-btn--print"
                                title="Print receipt"
                                aria-label={`Print receipt ${inv.invoiceNo}`}
                                onClick={e => {
                                  e.stopPropagation();
                                  void printInvoiceById(inv.id);
                                }}
                              >
                                <IconDownload />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        { (detailLoading || selectedInvoice || detailError) && (
          <aside className="payments-detail-column">
            <div className="payments-detail-card">
              <div className="payments-detail-header-row">
            <div className="payments-detail-title-block">
              <h3 className="payments-section-title">Payment details</h3>
              {selectedInvoice && (
                <p className="payments-detail-subtitle">
                  Invoice:{' '}
                  <span className="payments-detail-invoice-id">
                    {selectedInvoice.invoice_no}
                  </span>
                </p>
              )}
            </div>
            <div className="payments-detail-header-actions">
              <button
                type="button"
                className="primary-button small payments-detail-print-btn"
                onClick={() => {
                  if (selectedInvoice) printInvoiceReceipt(selectedInvoice);
                }}
              >
                <span className="btn-icon">
                  <IconDownload />
                </span>
                Print
              </button>
              <button
                type="button"
                className="payments-detail-close"
                aria-label="Close payment details"
                onClick={() => {
                  setSelectedInvoiceId(null);
                  setSelectedInvoice(null);
                  setDetailError(null);
                }}
              >
                ✕
              </button>
            </div>
          </div>
          {detailLoading && (
            <div className="payments-placeholder-panel">
              <p>Loading invoice details…</p>
            </div>
          )}
          {detailError && (
            <div className="payments-placeholder-panel">
              <p>{detailError}</p>
            </div>
          )}
          {selectedInvoice && !detailLoading && !detailError && (
            <div className="payments-detail-content">
              <div className="payments-detail-header">
                <div className="payments-detail-customer">
                  <div className="payments-detail-name">
                    {selectedInvoice.customer_name || 'Walk-in customer'}
                  </div>
                  <div className="payments-detail-date">
                    {new Date(selectedInvoice.created_at).toLocaleString()}
                  </div>
                </div>

                <div className="payments-detail-summary">
                  <div className="payments-summary-card payments-summary-card--total">
                    <span className="payments-summary-label">Total amount</span>
                    <span className="payments-summary-value">
                      {formatMoneyAmount(selectedInvoice.total, detailCurrency)}
                    </span>
                  </div>
                  <div className="payments-summary-card payments-summary-card--paid">
                    <span className="payments-summary-label">Amount paid</span>
                    <span className="payments-summary-value">
                      {formatMoneyAmount(selectedInvoice.paid, detailCurrency)}
                    </span>
                  </div>
                  <div className="payments-summary-card payments-summary-card--remaining">
                    <span className="payments-summary-label">Remaining</span>
                    <span className="payments-summary-value">
                      {formatMoneyAmount(
                        selectedInvoice.total - selectedInvoice.paid,
                        detailCurrency
                      )}
                    </span>
                  </div>
                </div>

                <div className="payments-detail-status-row">
                  <span className="payments-detail-status-label">Status:</span>
                  <span
                    className={`payments-detail-status-value payments-detail-status-value--${(selectedInvoice.derived_status || '').toLowerCase()}`}
                  >
                    {selectedInvoice.derived_status}
                  </span>
                  {selectedInvoice.discount > 0 && (
                    <span className="payments-detail-discount">
                      Discount: {formatMoneyAmount(selectedInvoice.discount, detailCurrency)}
                    </span>
                  )}
                </div>
              </div>

              <div className="payments-detail-items">
                <h5>Items</h5>
                <div className="payments-detail-items-card">
                  {selectedInvoice.items.map(item => (
                    <div key={item.id} className="payments-detail-item-row">
                      <div className="payments-detail-item-main">
                        <div className="payments-detail-item-name">
                          {item.item_code || `#${item.inventory_item_id}`}{' '}
                          {item.description && <span>· {item.description}</span>}
                        </div>
                        <div className="payments-detail-item-meta">
                          {item.quantity} × {formatMoneyAmount(item.unit_price, detailCurrency)}
                          {invoiceLineDiscountAmount(item) > 0 ? (
                            <span className="payments-detail-item-discount">
                              {' '}
                              · line disc. −{formatMoneyAmount(invoiceLineDiscountAmount(item), detailCurrency)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="payments-detail-item-total">
                        {formatMoneyAmount(item.line_total, detailCurrency)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="payments-detail-payments">
                <h5>Payment history</h5>
                {selectedInvoice.payments.length === 0 ? (
                  <p className="payments-detail-empty">No payments recorded yet.</p>
                ) : (
                  <div className="payments-detail-payments-card">
                    {selectedInvoice.payments.map(p => (
                      <div key={p.id} className="payments-detail-payment-row">
                        <div className="payments-detail-payment-main">
                          <div className="payments-detail-payment-method">{p.method}</div>
                          <div className="payments-detail-payment-date">
                            {new Date(p.created_at).toLocaleString()}
                          </div>
                        </div>
                        <div className="payments-detail-payment-amount">
                          {formatMoneyAmount(p.amount, detailCurrency)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="payments-detail-pay-actions">
                {selectedRemaining > 0 ? (
                  <>
                    <button
                      type="button"
                      className="primary-button payments-detail-pay-btn"
                      onClick={() => handlePayClick(selectedInvoice.id)}
                    >
                      <span className="btn-icon" aria-hidden="true">
                        <IconCreditCard />
                      </span>
                      Pay invoice
                    </button>
                    <p className="payments-detail-pay-hint">
                      Opens invoice checkout to choose payment method, currency, and amount tendered.
                    </p>
                  </>
                ) : (
                  <div className="payments-detail-paid-banner" role="status">
                    <span className="payments-detail-paid-banner-title">Fully paid</span>
                    <span className="payments-detail-paid-banner-sub">No balance remaining on this invoice.</span>
                  </div>
                )}
              </div>
            </div>
          )}
            </div>
          </aside>
        )}
      </section>
    </div>
  );
}

