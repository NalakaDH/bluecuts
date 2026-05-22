import React, { useEffect, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { INVOICE_CHECKOUT_INVOICE_ID_KEY } from '../../constants/invoiceCheckout';
import type { PageId } from '../../components/layout/Layout';
import { mapApiInvoiceToReceipt, openInvoiceReceiptWindow } from '../../lib/receiptDocument';
import {
  DEFAULT_CURRENCY_CODE,
  SUPPORTED_CURRENCIES,
  normalizeCurrencyCode,
  formatMoneyAmount,
  formatMoneyWhole,
  parseMoneyInput,
  roundMoney2,
} from '../../lib/currencies';
import { convertAmountViaThb, hasRateFor, type ThbPerUnitMap } from '../../lib/exchangeConversion';

type InvoiceStatus = 'Unpaid' | 'Partial' | 'Paid';
type PayMethod = 'Cash' | 'Card' | 'Transfer';

const IconX = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

const IconReceipt = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
  </svg>
);

const IconCheckCircle = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const IconAlert = () => (
  <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4M12 16h.01" />
  </svg>
);

const IconPrinter = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);

const IconCash = () => (
  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M12 12h.01M6 12h.01M18 12h.01" />
  </svg>
);

const IconCard = () => (
  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="1" y="4" width="22" height="16" rx="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

const IconTransfer = () => (
  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 3h4v4" />
    <path d="M21 3l-7 7" />
    <path d="M7 21H3v-4" />
    <path d="M3 21l7-7" />
  </svg>
);

const IconCircleCheck = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

interface InvoiceCheckoutPageProps {
  token: string;
  onNavigate: (page: PageId) => void;
  /** When true (Payments/Selling overlay), layout is narrower with sticky footer. */
  embedded?: boolean;
}

export const InvoiceCheckoutPage: React.FC<InvoiceCheckoutPageProps> = ({
  token,
  onNavigate,
  embedded = false,
}) => {
  const { showAlert } = useAlertDialog();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [invoiceNo, setInvoiceNo] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [due, setDue] = useState(0);
  const [invoiceCurrency, setInvoiceCurrency] = useState<string>(DEFAULT_CURRENCY_CODE);
  const [displayCurrency, setDisplayCurrency] = useState<string>(DEFAULT_CURRENCY_CODE);
  const [thbPerUnit, setThbPerUnit] = useState<ThbPerUnitMap>({ THB: 1 });
  const [checkoutMethod, setCheckoutMethod] = useState<PayMethod>('Cash');
  const [checkoutAmount, setCheckoutAmount] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus>('Unpaid');
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [printLoading, setPrintLoading] = useState(false);

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

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(INVOICE_CHECKOUT_INVOICE_ID_KEY);
    } catch {
      const msg = 'Could not read checkout session.';
      setError(msg);
      showAlert({ title: 'Checkout', message: msg, variant: 'error' });
      setLoading(false);
      return;
    }
    if (!raw) {
      setError(null);
      setLoading(false);
      return;
    }
    window.sessionStorage.removeItem(INVOICE_CHECKOUT_INVOICE_ID_KEY);
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) {
      const msg = 'Invalid invoice.';
      setError(msg);
      showAlert({ title: 'Checkout', message: msg, variant: 'error' });
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      setSuccessMessage(null);
      try {
        const res = await fetch(apiUrl(`/api/invoices/${id}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const msg = await parseErrorResponse(res, 'Failed to load invoice');
          throw new Error(msg);
        }
        const data: {
          id: number;
          invoice_no: string;
          customer_name: string | null;
          total: number;
          paid: number;
          status: InvoiceStatus;
          currency_code?: string | null;
        } = await res.json();
        const invCur = normalizeCurrencyCode(data.currency_code);
        const remaining = roundMoney2(Math.max(0, Number(data.total || 0) - Number(data.paid || 0)));
        setInvoiceId(data.id);
        setInvoiceNo(data.invoice_no);
        setCustomerName(data.customer_name || 'Walk-in customer');
        setInvoiceTotal(roundMoney2(Number(data.total || 0)));
        setInvoiceCurrency(invCur);
        setDisplayCurrency(invCur);
        setDue(remaining);
        setPaidAmount(roundMoney2(Number(data.paid || 0)));
        setInvoiceStatus(data.status);
        setCheckoutAmount(remaining);
        setCheckoutMethod('Cash');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to load invoice';
        setError(msg);
        setInvoiceId(null);
        showAlert({ title: 'Could not load invoice', message: msg, variant: 'error' });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, showAlert]);

  const needsConversion =
    normalizeCurrencyCode(displayCurrency) !== normalizeCurrencyCode(invoiceCurrency);
  const fxMissing =
    needsConversion &&
    (!hasRateFor(invoiceCurrency, thbPerUnit) || !hasRateFor(displayCurrency, thbPerUnit));

  const dueDisplay = convertAmountViaThb(due, invoiceCurrency, displayCurrency, thbPerUnit);
  const totalDisplay = convertAmountViaThb(invoiceTotal, invoiceCurrency, displayCurrency, thbPerUnit);
  const paidDisplay = convertAmountViaThb(paidAmount, invoiceCurrency, displayCurrency, thbPerUnit);
  const change = Math.max(0, checkoutAmount - dueDisplay);
  const isCash = checkoutMethod === 'Cash';
  const canPay = invoiceId != null && due > 0;

  const handleDisplayCurrencyChange = (nextRaw: string) => {
    const next = normalizeCurrencyCode(nextRaw);
    const inv = invoiceCurrency;
    const prev = displayCurrency;
    if (checkoutAmount > 0) {
      const inInv = convertAmountViaThb(checkoutAmount, prev, inv, thbPerUnit);
      setCheckoutAmount(convertAmountViaThb(inInv, inv, next, thbPerUnit));
    } else {
      setCheckoutAmount(convertAmountViaThb(due, inv, next, thbPerUnit));
    }
    setDisplayCurrency(next);
  };

  const completePayment = async () => {
    if (!invoiceId || due <= 0) return;
    if (!checkoutAmount || checkoutAmount <= 0) {
      const msg = 'Payment amount must be greater than zero.';
      setError(msg);
      showAlert({ title: 'Invalid payment', message: msg, variant: 'warning' });
      return;
    }
    const amountInInvoice = roundMoney2(
      convertAmountViaThb(checkoutAmount, displayCurrency, invoiceCurrency, thbPerUnit)
    );
    if (!amountInInvoice || amountInInvoice <= 0) {
      const msg = 'Payment amount must be greater than zero.';
      setError(msg);
      showAlert({ title: 'Invalid payment', message: msg, variant: 'warning' });
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(apiUrl(`/api/invoices/${invoiceId}/payments`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          method: checkoutMethod,
          amount: amountInInvoice,
        }),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to record payment');
        throw new Error(msg);
      }
      const data: {
        invoice: { invoice_no: string; total: number; paid: number; status: InvoiceStatus };
      } = await res.json();
      const remaining = roundMoney2(Math.max(0, data.invoice.total - data.invoice.paid));
      setSuccessMessage(`Payment recorded for ${data.invoice.invoice_no}.`);
      showAlert({
        title: 'Payment recorded',
        message: `Payment for ${data.invoice.invoice_no} was saved successfully.`,
        variant: 'success',
      });
      setDue(remaining);
      setPaidAmount(roundMoney2(Number(data.invoice.paid || 0)));
      setInvoiceStatus(data.invoice.status);
      setCheckoutAmount(
        remaining > 0
          ? roundMoney2(convertAmountViaThb(remaining, invoiceCurrency, displayCurrency, thbPerUnit))
          : 0
      );
      if (remaining <= 0) {
        setTimeout(() => onNavigate('payments'), 1600);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record payment';
      setError(msg);
      showAlert({ title: 'Payment failed', message: msg, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => onNavigate('payments');

  const handlePrintReceipt = async () => {
    if (!invoiceId) return;
    setPrintLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/invoices/${invoiceId}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load invoice');
        throw new Error(msg);
      }
      const data = (await res.json()) as {
        invoice_no: string;
        created_at: string;
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
        paid?: number;
        status?: string;
        derived_status?: string;
        items: {
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
        }[];
        payments?: { method: string; amount: number; created_at: string }[];
        currency_code?: string | null;
      };
      openInvoiceReceiptWindow(
        mapApiInvoiceToReceipt({
          invoice_no: data.invoice_no,
          created_at: data.created_at,
          customer_name: data.customer_name,
          customer_phone: data.customer_phone,
          customer_email: data.customer_email,
          customer_address_line1: data.customer_address_line1,
          customer_address_line2: data.customer_address_line2,
          customer_city: data.customer_city,
          customer_postal_code: data.customer_postal_code,
          customer_country: data.customer_country,
          subtotal: data.subtotal,
          discount: data.discount,
          total: data.total,
          paid: data.paid,
          status: data.status ?? data.derived_status,
          currency_code: data.currency_code,
          items: data.items,
          payments: data.payments,
        })
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not print receipt';
      showAlert({ title: 'Print failed', message: msg, variant: 'error' });
    } finally {
      setPrintLoading(false);
    }
  };

  const payMethods: Array<{ id: PayMethod; label: string; icon: React.ReactNode }> = [
    { id: 'Cash', label: 'Cash', icon: <IconCash /> },
    { id: 'Card', label: 'Card', icon: <IconCard /> },
    { id: 'Transfer', label: 'Transfer', icon: <IconTransfer /> },
  ];

  if (loading) {
    return (
      <div className={`page page-invoice-checkout${embedded ? ' page-invoice-checkout--embedded' : ''}`}>
        <div className="invoice-checkout-ui">
          <div className="invoice-checkout-ui-card invoice-checkout-ui-state-card" aria-busy="true" aria-live="polite">
            <div className="invoice-checkout-ui-skeleton">
              <div className="invoice-checkout-ui-sk invoice-checkout-ui-sk-hero" />
              <div className="invoice-checkout-ui-sk invoice-checkout-ui-sk-line invoice-checkout-ui-sk-short" />
              <div className="invoice-checkout-ui-sk invoice-checkout-ui-sk-line" />
              <div className="invoice-checkout-ui-sk invoice-checkout-ui-sk-line invoice-checkout-ui-sk-medium" />
            </div>
            <p className="invoice-checkout-ui-loading-text">Loading invoice…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!invoiceId && !error) {
    return (
      <div className={`page page-invoice-checkout${embedded ? ' page-invoice-checkout--embedded' : ''}`}>
        <div className="invoice-checkout-ui">
          <div className="invoice-checkout-ui-card invoice-checkout-ui-state-card">
            <div className="invoice-checkout-ui-state-icon" aria-hidden="true">
              <IconReceipt />
            </div>
            <h2 className="invoice-checkout-ui-state-title">No checkout session</h2>
            <p className="invoice-checkout-ui-state-text">
              Open this screen from Payments by choosing <strong>Pay</strong> on an invoice.
            </p>
            <button type="button" className="invoice-checkout-ui-record invoice-checkout-ui-full-btn" onClick={goBack}>
              Back to Payments
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error && !invoiceId) {
    return (
      <div className={`page page-invoice-checkout${embedded ? ' page-invoice-checkout--embedded' : ''}`}>
        <div className="invoice-checkout-ui">
          <div className="invoice-checkout-ui-card invoice-checkout-ui-state-card">
            <div className="invoice-checkout-ui-state-icon invoice-checkout-ui-state-icon--warn" aria-hidden="true">
              <IconAlert />
            </div>
            <h2 className="invoice-checkout-ui-state-title">Couldn&apos;t open checkout</h2>
            <p className="invoice-checkout-ui-state-text invoice-checkout-ui-state-text--error">{error}</p>
            <button type="button" className="invoice-checkout-ui-record invoice-checkout-ui-full-btn" onClick={goBack}>
              Back to Payments
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`page page-invoice-checkout${embedded ? ' page-invoice-checkout--embedded' : ''}`}>
      <div className="invoice-checkout-ui">
        <div className="invoice-checkout-ui-card" role="region" aria-labelledby="invoice-checkout-title">
          <header className="invoice-checkout-ui-topbar">
            <div className="invoice-checkout-ui-topbar-left">
              <div className="invoice-checkout-ui-topbar-icon" aria-hidden="true">
                <IconReceipt />
              </div>
              <div>
                <div className="invoice-checkout-ui-eyebrow">Collect payment</div>
                <h3 id="invoice-checkout-title" className="invoice-checkout-ui-title">
                  Checkout
                </h3>
              </div>
            </div>
            <div className="invoice-checkout-ui-topbar-right">
              <button
                type="button"
                className="invoice-checkout-ui-icon-btn"
                onClick={() => void handlePrintReceipt()}
                disabled={!invoiceId || printLoading}
              >
                <IconPrinter />
                {printLoading ? 'Printing…' : 'Print'}
              </button>
              <button
                type="button"
                className="invoice-checkout-ui-icon-btn invoice-checkout-ui-icon-btn--close"
                onClick={goBack}
                aria-label="Close and return to payments"
              >
                <IconX size={16} />
              </button>
            </div>
          </header>

          {successMessage ? (
            <div className="invoice-checkout-ui-flash invoice-checkout-ui-flash--success" role="status">
              <IconCheckCircle />
              <span>{successMessage}</span>
            </div>
          ) : null}
          {error && invoiceId ? (
            <div className="invoice-checkout-ui-flash invoice-checkout-ui-flash--error" role="alert">
              <IconAlert />
              <span>{error}</span>
            </div>
          ) : null}

          {due <= 0 ? (
            <div className="invoice-checkout-ui-paid">
              <div className="invoice-checkout-ui-paid-icon" aria-hidden="true">
                <IconCheckCircle />
              </div>
              <div className="invoice-checkout-ui-paid-title">Fully paid</div>
              <p className="invoice-checkout-ui-paid-sub">No balance remaining on this invoice.</p>
              <div className="invoice-checkout-ui-paid-actions">
                <button
                  type="button"
                  className="invoice-checkout-ui-print invoice-checkout-ui-full-btn"
                  onClick={() => void handlePrintReceipt()}
                  disabled={!invoiceId || printLoading}
                >
                  <IconPrinter />
                  {printLoading ? 'Printing…' : 'Print receipt'}
                </button>
                <button type="button" className="invoice-checkout-ui-cancel invoice-checkout-ui-full-btn" onClick={goBack}>
                  {successMessage ? 'Back to Payments now' : 'Back to Payments'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="invoice-checkout-ui-main">
                <section className="invoice-checkout-ui-summary" aria-labelledby="checkout-summary-heading">
                  <h4 id="checkout-summary-heading" className="invoice-checkout-ui-summary-heading">
                    Invoice summary
                  </h4>
                  <dl className="invoice-checkout-ui-details">
                    <div className="invoice-checkout-ui-detail-row">
                      <dt>Invoice number</dt>
                      <dd>
                        <span className="invoice-checkout-ui-detail-inv">
                          <IconReceipt />
                          {invoiceNo}
                        </span>
                      </dd>
                    </div>
                    <div className="invoice-checkout-ui-detail-row">
                      <dt>Customer</dt>
                      <dd>{customerName}</dd>
                    </div>
                    <div className="invoice-checkout-ui-detail-row">
                      <dt>Invoice total</dt>
                      <dd>{formatMoneyAmount(totalDisplay, displayCurrency)}</dd>
                    </div>
                    <div className="invoice-checkout-ui-detail-row">
                      <dt>Already paid</dt>
                      <dd>{formatMoneyAmount(paidDisplay, displayCurrency)}</dd>
                    </div>
                    <div className="invoice-checkout-ui-detail-row invoice-checkout-ui-detail-row--due">
                      <dt>Balance due</dt>
                      <dd className="invoice-checkout-ui-detail-due">{formatMoneyAmount(dueDisplay, displayCurrency)}</dd>
                    </div>
                    <div className="invoice-checkout-ui-detail-row">
                      <dt>Status</dt>
                      <dd>
                        <span className={`invoice-checkout-ui-status invoice-checkout-ui-status--${invoiceStatus.toLowerCase()}`}>
                          {invoiceStatus}
                        </span>
                      </dd>
                    </div>
                  </dl>
                  {needsConversion && !fxMissing ? (
                    <p className="invoice-checkout-ui-summary-fx">
                      Stored in {invoiceCurrency}: total {formatMoneyAmount(invoiceTotal, invoiceCurrency)}, balance{' '}
                      {formatMoneyAmount(due, invoiceCurrency)}
                    </p>
                  ) : null}
                </section>

                <section className="invoice-checkout-ui-form">
                  <div>
                    <label className="invoice-checkout-ui-label">Payment method</label>
                    <div className="invoice-checkout-ui-method-row" role="group" aria-label="Payment method">
                      {payMethods.map(method => (
                        <button
                          key={method.id}
                          type="button"
                          className={`invoice-checkout-ui-method-btn${checkoutMethod === method.id ? ' is-active' : ''}`}
                          onClick={() => setCheckoutMethod(method.id)}
                        >
                          {method.icon}
                          {method.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="invoice-checkout-ui-label">Currency</label>
                    <div className="invoice-checkout-ui-select-wrap">
                      <select
                        className="invoice-checkout-ui-select"
                        value={displayCurrency}
                        onChange={e => handleDisplayCurrencyChange(e.target.value)}
                        aria-label="Currency for amounts entered at checkout"
                      >
                        {SUPPORTED_CURRENCIES.map(c => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="invoice-checkout-ui-pay-block">
                    <div className="invoice-checkout-ui-pay-block-head">
                      <span className="invoice-checkout-ui-label">Payment amount</span>
                      <p className="invoice-checkout-ui-pay-hint">
                        {isCash
                          ? 'How much the customer hands over. Change is calculated from the balance due.'
                          : 'Amount to record on this invoice (card or transfer).'}
                      </p>
                    </div>
                    <div className="invoice-checkout-ui-pay-card">
                      <div className="invoice-checkout-ui-pay-due-strip">
                        <div className="invoice-checkout-ui-pay-due-text">
                          <span className="invoice-checkout-ui-pay-due-label">Balance due</span>
                          <strong className="invoice-checkout-ui-pay-due-value">
                            {formatMoneyAmount(dueDisplay, displayCurrency)}
                          </strong>
                        </div>
                        <button
                          type="button"
                          className="invoice-checkout-ui-pay-exact-btn"
                          onClick={() => setCheckoutAmount(dueDisplay)}
                        >
                          Pay exact balance
                        </button>
                      </div>
                      <label className="invoice-checkout-ui-pay-field-label" htmlFor="checkout-payment-amount">
                        {isCash ? 'Cash received' : 'Amount paying now'}
                      </label>
                      <input
                        id="checkout-payment-amount"
                        className="invoice-checkout-ui-pay-input"
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        value={checkoutAmount || ''}
                        onChange={e => {
                          const v = e.target.value;
                          setCheckoutAmount(v === '' ? 0 : parseMoneyInput(v));
                        }}
                        placeholder={dueDisplay > 0 ? String(dueDisplay) : '0'}
                        aria-describedby={isCash ? 'checkout-change-hint' : undefined}
                      />
                      {isCash ? (
                        <div
                          id="checkout-change-hint"
                          className={`invoice-checkout-ui-pay-change${change > 0 ? ' has-change' : ''}`}
                          aria-live="polite"
                        >
                          <span className="invoice-checkout-ui-pay-change-label">Change to return</span>
                          <span className="invoice-checkout-ui-pay-change-value">
                            {formatMoneyAmount(change, displayCurrency)}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <div className="invoice-checkout-ui-quick-header">
                      <label className="invoice-checkout-ui-label invoice-checkout-ui-label--inline">Quick add</label>
                      <button type="button" className="invoice-checkout-ui-quick-clear" onClick={() => setCheckoutAmount(0)}>
                        Clear
                      </button>
                    </div>
                    <div className="invoice-checkout-ui-quick-grid">
                      {[100, 500, 1000, 5000].map(amount => (
                        <button
                          key={amount}
                          type="button"
                          className="invoice-checkout-ui-chip"
                          onClick={() => setCheckoutAmount(prev => roundMoney2(prev + amount))}
                        >
                          +{formatMoneyWhole(amount, displayCurrency)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(needsConversion || fxMissing) && (
                    <div className="invoice-checkout-ui-fx-note">
                      {needsConversion && !fxMissing ? (
                        <span>
                          You enter tender and quick amounts in <strong>{displayCurrency}</strong>. They are converted to{' '}
                          <strong>{invoiceCurrency}</strong> before the payment is saved.
                        </span>
                      ) : null}
                      {fxMissing ? (
                        <span>
                          Missing rate for this pair. Set THB rates under Profile → Exchange rates so conversion is correct.
                        </span>
                      ) : null}
                    </div>
                  )}
                </section>
              </div>

              <footer className="invoice-checkout-ui-footer">
                <button type="button" className="invoice-checkout-ui-cancel" onClick={goBack}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="invoice-checkout-ui-print"
                  onClick={() => void handlePrintReceipt()}
                  disabled={!invoiceId || printLoading}
                >
                  <IconPrinter />
                  {printLoading ? 'Printing…' : 'Print'}
                </button>
                <button
                  type="button"
                  className="invoice-checkout-ui-record"
                  onClick={completePayment}
                  disabled={saving || !canPay}
                >
                  <IconCircleCheck />
                  {saving ? 'Recording…' : 'Record payment'}
                </button>
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
