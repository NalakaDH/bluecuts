import React, { useEffect, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { INVOICE_CHECKOUT_INVOICE_ID_KEY } from '../../constants/invoiceCheckout';
import type { PageId } from '../../components/layout/Layout';
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
type PayMethod = 'Cash' | 'Card' | 'QR';

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

interface InvoiceCheckoutPageProps {
  token: string;
  onNavigate: (page: PageId) => void;
}

export const InvoiceCheckoutPage: React.FC<InvoiceCheckoutPageProps> = ({ token, onNavigate }) => {
  const { showAlert } = useAlertDialog();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [invoiceNo, setInvoiceNo] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [due, setDue] = useState(0);
  const [invoiceCurrency, setInvoiceCurrency] = useState<string>(DEFAULT_CURRENCY_CODE);
  const [displayCurrency, setDisplayCurrency] = useState<string>(DEFAULT_CURRENCY_CODE);
  const [thbPerUnit, setThbPerUnit] = useState<ThbPerUnitMap>({ THB: 1 });
  const [checkoutMethod, setCheckoutMethod] = useState<PayMethod>('Cash');
  const [checkoutAmount, setCheckoutAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
        setInvoiceCurrency(invCur);
        setDisplayCurrency(invCur);
        setDue(remaining);
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
  const change = Math.max(0, checkoutAmount - dueDisplay);
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

  const payMethods: PayMethod[] = ['Cash', 'Card', 'QR'];

  if (loading) {
    return (
      <div className="page page-invoice-checkout">
        <div className="invoice-checkout-shell">
          <div className="invoice-checkout-center">
            <div className="checkout-modal invoice-checkout-card invoice-checkout-card--page" aria-busy="true" aria-live="polite">
              <div className="invoice-checkout-skeleton">
                <div className="invoice-checkout-skeleton-hero" />
                <div className="invoice-checkout-skeleton-line invoice-checkout-skeleton-line--short" />
                <div className="invoice-checkout-skeleton-line" />
                <div className="invoice-checkout-skeleton-line invoice-checkout-skeleton-line--medium" />
              </div>
              <p className="invoice-checkout-loading-text">Loading invoice…</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!invoiceId && !error) {
    return (
      <div className="page page-invoice-checkout">
        <div className="invoice-checkout-shell">
          <div className="invoice-checkout-center">
            <div className="checkout-modal invoice-checkout-card invoice-checkout-card--page invoice-checkout-card--empty">
              <div className="invoice-checkout-empty-visual" aria-hidden="true">
                <IconReceipt />
              </div>
              <h2 className="invoice-checkout-empty-title">No checkout session</h2>
              <p className="invoice-checkout-empty-text">Open this screen from Payments by choosing <strong>Pay</strong> on an invoice.</p>
              <button type="button" className="invoice-checkout-primary-btn invoice-checkout-full" onClick={goBack}>
                Back to Payments
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !invoiceId) {
    return (
      <div className="page page-invoice-checkout">
        <div className="invoice-checkout-shell">
          <div className="invoice-checkout-center">
            <div className="checkout-modal invoice-checkout-card invoice-checkout-card--page invoice-checkout-card--empty">
              <div className="invoice-checkout-empty-visual invoice-checkout-empty-visual--warn" aria-hidden="true">
                <IconAlert />
              </div>
              <h2 className="invoice-checkout-empty-title">Couldn&apos;t open checkout</h2>
              <p className="invoice-checkout-error-block">{error}</p>
              <button type="button" className="invoice-checkout-primary-btn invoice-checkout-full" onClick={goBack}>
                Back to Payments
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-invoice-checkout">
      <div className="invoice-checkout-shell">
        <button type="button" className="invoice-checkout-nav-back" onClick={goBack}>
          <span aria-hidden="true">←</span> Payments
        </button>
        <div className="invoice-checkout-center">
          <div className="checkout-modal invoice-checkout-card invoice-checkout-card--page" role="region" aria-labelledby="invoice-checkout-title">
            <header className="invoice-checkout-topbar">
              <div className="invoice-checkout-topbar-text">
                <p className="invoice-checkout-eyebrow">Collect payment</p>
                <h3 id="invoice-checkout-title" className="invoice-checkout-heading">
                  Checkout
                </h3>
              </div>
              <button type="button" className="checkout-close invoice-checkout-close" onClick={goBack} aria-label="Close and return to payments">
                <IconX size={20} />
              </button>
            </header>

            {successMessage && (
              <div className="invoice-checkout-flash invoice-checkout-flash--success invoice-checkout-flash--banner" role="status">
                <span className="invoice-checkout-flash-icon" aria-hidden="true">
                  <IconCheckCircle />
                </span>
                <span>{successMessage}</span>
              </div>
            )}
            {error && invoiceId && (
              <p className="invoice-checkout-error-inline invoice-checkout-error-inline--banner">{error}</p>
            )}

            {due <= 0 ? (
              <div className="invoice-checkout-paid">
                <div className="invoice-checkout-paid-icon" aria-hidden="true">
                  <IconCheckCircle />
                </div>
                <p className="invoice-checkout-paid-title">Fully paid</p>
                <p className="invoice-checkout-paid-sub">No balance remaining on this invoice.</p>
                {successMessage ? (
                  <p className="invoice-checkout-paid-hint">Taking you back to Payments…</p>
                ) : null}
                <button type="button" className="invoice-checkout-secondary-btn invoice-checkout-full" onClick={goBack}>
                  {successMessage ? 'Back to Payments now' : 'Back to Payments'}
                </button>
              </div>
            ) : (
              <>
                <div className="invoice-checkout-grid">
                  <div className="invoice-checkout-col invoice-checkout-col--summary">
                    <div className="invoice-checkout-hero">
                      <div className="invoice-checkout-hero-top">
                        <span className="invoice-checkout-badge">
                          <span className="invoice-checkout-badge-icon" aria-hidden="true">
                            <IconReceipt />
                          </span>
                          {invoiceNo}
                        </span>
                      </div>
                      <p className="invoice-checkout-customer">{customerName}</p>
                      <p className="invoice-checkout-due-label">Amount due</p>
                      <div className="invoice-checkout-due-value">{formatMoneyAmount(dueDisplay, displayCurrency)}</div>
                      {needsConversion && !fxMissing && (
                        <p className="invoice-checkout-hero-sub">
                          Invoice balance: {formatMoneyAmount(due, invoiceCurrency)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="invoice-checkout-col invoice-checkout-col--form">
                    <div className="checkout-body invoice-checkout-body invoice-checkout-body--grid">
                      <div className="invoice-checkout-section">
                        <span className="checkout-field-label invoice-checkout-label">How are they paying?</span>
                        <div className="invoice-checkout-method-row" role="group" aria-label="Payment method">
                          {payMethods.map(m => (
                            <button
                              key={m}
                              type="button"
                              className={`invoice-checkout-method-btn${checkoutMethod === m ? ' invoice-checkout-method-btn--active' : ''}`}
                              onClick={() => setCheckoutMethod(m)}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="checkout-field checkout-field--currency">
                        <span className="checkout-field-label invoice-checkout-label">Pay in currency</span>
                        <div className="checkout-select-wrap">
                          <select
                            className="checkout-select"
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
                        {(needsConversion || fxMissing) && (
                          <div className="checkout-currency-notes">
                            {needsConversion && (
                              <p className="checkout-currency-hint">
                                You enter tender and quick amounts in <strong>{displayCurrency}</strong>. They are converted to{' '}
                                <strong>{invoiceCurrency}</strong> (invoice currency) using Profile exchange rates (THB base)
                                before the payment is saved.
                              </p>
                            )}
                            {fxMissing && (
                              <p className="checkout-currency-hint checkout-currency-hint--warn">
                                Missing rate for this pair. Set THB rates under Profile → Exchange rates so conversion is correct.
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="invoice-checkout-tender-block">
                        <div className="checkout-tender-row">
                          <label className="checkout-field checkout-field-half">
                            <span className="checkout-field-label invoice-checkout-label">Amount tendered</span>
                            <input
                              className="checkout-input invoice-checkout-input"
                              type="number"
                              min={0}
                              step="0.01"
                              inputMode="decimal"
                              value={checkoutAmount || ''}
                              onChange={e => {
                                const v = e.target.value;
                                setCheckoutAmount(v === '' ? 0 : parseMoneyInput(v));
                              }}
                              placeholder="0"
                            />
                          </label>
                          <div className="checkout-field checkout-field-half">
                            <span className="checkout-field-label invoice-checkout-label">Change</span>
                            <div className="checkout-change-box invoice-checkout-change" aria-live="polite">
                              {formatMoneyAmount(change, displayCurrency)}
                            </div>
                          </div>
                        </div>
                        <button type="button" className="invoice-checkout-exact-btn" onClick={() => setCheckoutAmount(dueDisplay)}>
                          Use exact amount due
                        </button>
                      </div>

                      <div className="checkout-quick-section invoice-checkout-quick">
                        <div className="checkout-quick-header">
                          <span className="checkout-quick-title">Quick add</span>
                          <button type="button" className="checkout-quick-clear" onClick={() => setCheckoutAmount(0)}>
                            Clear
                          </button>
                        </div>
                        <div className="checkout-quick-buttons">
                          {[100, 500, 1000, 5000].map(amount => (
                            <button
                              key={amount}
                              type="button"
                              className="checkout-quick-chip"
                              onClick={() => setCheckoutAmount(prev => roundMoney2(prev + amount))}
                            >
                              +{formatMoneyWhole(amount, displayCurrency)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <footer className="checkout-footer invoice-checkout-footer">
                  <button type="button" className="checkout-btn-back invoice-checkout-footer-back" onClick={goBack}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="checkout-btn-proceed invoice-checkout-record-btn"
                    onClick={completePayment}
                    disabled={saving || !canPay}
                  >
                    {saving ? 'Recording…' : 'Record payment'}
                  </button>
                </footer>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
