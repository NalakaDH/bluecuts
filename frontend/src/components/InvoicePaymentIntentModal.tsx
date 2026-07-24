import React, { useEffect, useMemo, useState } from 'react';
import {
  type InvoicePayMethodUi,
  type InvoicePaymentMode,
  type InvoicePaymentRow,
  buildPaymentIntentPayload,
  newPaymentRowId,
  validatePaymentIntent,
} from '../lib/invoicePaymentIntent';
import { formatMoneyAmount, normalizeCurrencyCode, roundMoney2 } from '../lib/currencies';
import { GuardedAmountNumberInput } from './GuardedAmountNumberInput';

const IconX = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

const IconWallet = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
    <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
  </svg>
);

const IconPayFull = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const IconPayPartial = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v12" />
    <path d="M12 12h4.5a2.5 2.5 0 0 0 0-5H12" />
  </svg>
);

const IconPayLater = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const IconCash = () => (
  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2" />
    <path d="M6 12h.01M18 12h.01" />
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

const IconPlus = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const IconTrash = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const IconInfo = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
);

const PAYMENT_MODES: Array<{
  value: InvoicePaymentMode;
  label: string;
  hint: string;
  icon: React.ReactNode;
  tone: 'green' | 'amber' | 'slate';
}> = [
  {
    value: 'full',
    label: 'Pay in full now',
    hint: 'Collect the entire total before saving',
    icon: <IconPayFull />,
    tone: 'green',
  },
  {
    value: 'partial',
    label: 'Partial payment now',
    hint: 'Record one or more payments today',
    icon: <IconPayPartial />,
    tone: 'amber',
  },
  {
    value: 'later',
    label: 'Pay later',
    hint: 'Save as unpaid — collect anytime later',
    icon: <IconPayLater />,
    tone: 'slate',
  },
];

const PAY_METHODS: Array<{ id: InvoicePayMethodUi; label: string; icon: React.ReactNode }> = [
  { id: 'Cash', label: 'Cash', icon: <IconCash /> },
  { id: 'Card', label: 'Card', icon: <IconCard /> },
  { id: 'Transfer', label: 'Transfer', icon: <IconTransfer /> },
];

function currencyInputPrefix(code: string): string {
  const normalized = normalizeCurrencyCode(code);
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: normalized,
    }).formatToParts(0);
    return parts.find(p => p.type === 'currency')?.value ?? normalized;
  } catch {
    return normalized;
  }
}

export interface InvoicePaymentIntentModalProps {
  open: boolean;
  title?: string;
  subtitle?: string;
  total: number;
  currencyCode: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (payload: ReturnType<typeof buildPaymentIntentPayload>) => void;
}

export const InvoicePaymentIntentModal: React.FC<InvoicePaymentIntentModalProps> = ({
  open,
  title = 'How is this invoice being paid?',
  subtitle,
  total,
  currencyCode,
  busy = false,
  onCancel,
  onConfirm,
}) => {
  const [mode, setMode] = useState<InvoicePaymentMode>('full');
  const [rows, setRows] = useState<InvoicePaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode('full');
    setRows([{ id: newPaymentRowId(), method: null, amount: roundMoney2(total) }]);
    setError(null);
  }, [open, total]);

  const paidSum = useMemo(
    () => roundMoney2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)),
    [rows]
  );
  const balanceAfter = roundMoney2(Math.max(0, total - paidSum));
  const amountPrefix = useMemo(() => currencyInputPrefix(currencyCode), [currencyCode]);

  if (!open) return null;

  const setModeAndResetRows = (next: InvoicePaymentMode) => {
    setMode(next);
    setError(null);
    if (next === 'later') {
      setRows([]);
      return;
    }
    if (next === 'full') {
      setRows([{ id: newPaymentRowId(), method: null, amount: roundMoney2(total) }]);
      return;
    }
    setRows([{ id: newPaymentRowId(), method: null, amount: 0 }]);
  };

  const updateRow = (id: string, patch: Partial<InvoicePaymentRow>) => {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
    setError(null);
  };

  const addRow = () => {
    setRows(prev => [...prev, { id: newPaymentRowId(), method: null, amount: 0 }]);
  };

  const removeRow = (id: string) => {
    setRows(prev => (prev.length <= 1 ? prev : prev.filter(r => r.id !== id)));
  };

  const handleConfirm = () => {
    const msg = validatePaymentIntent(mode, rows, total);
    if (msg) {
      setError(msg);
      return;
    }
    onConfirm(buildPaymentIntentPayload(mode, rows));
  };

  const confirmLabel =
    mode === 'later'
      ? 'Create unpaid invoice'
      : mode === 'partial'
        ? 'Create invoice & record partial payment'
        : 'Create invoice & record payment';

  return (
    <div className="selling2-modal-overlay payment-intent-overlay" role="dialog" aria-modal="true" aria-labelledby="payment-intent-title">
      <div className="payment-intent-modal">
        <header className="payment-intent-header">
          <div className="payment-intent-header-main">
            <div className="payment-intent-header-icon" aria-hidden="true">
              <IconWallet />
            </div>
            <div>
              <h3 id="payment-intent-title" className="payment-intent-title">
                {title}
              </h3>
              {subtitle ? <p className="payment-intent-subtitle">{subtitle}</p> : null}
            </div>
          </div>
          <button type="button" className="payment-intent-close" onClick={onCancel} aria-label="Close" disabled={busy}>
            <IconX size={16} />
          </button>
        </header>

        <div className="payment-intent-total">
          <div className="payment-intent-total-label">
            <span className="payment-intent-total-eyebrow">Invoice total</span>
            <span className="payment-intent-total-code">{normalizeCurrencyCode(currencyCode)}</span>
          </div>
          <strong className="payment-intent-total-value">{formatMoneyAmount(total, currencyCode)}</strong>
        </div>

        <p className="payment-intent-section-label">When is payment collected?</p>
        <div className="payment-intent-modes" role="radiogroup" aria-label="Payment timing">
          {PAYMENT_MODES.map(({ value, label, hint, icon, tone }) => {
            const active = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                className={`payment-intent-mode payment-intent-mode--${tone}${active ? ' is-active' : ''}`}
                onClick={() => setModeAndResetRows(value)}
                disabled={busy}
              >
                <span className="payment-intent-mode-icon" aria-hidden="true">
                  {icon}
                </span>
                <span className="payment-intent-mode-copy">
                  <span className="payment-intent-mode-label">{label}</span>
                  <span className="payment-intent-mode-hint">{hint}</span>
                </span>
                <span className="payment-intent-mode-radio" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        {mode !== 'later' ? (
          <div className="payment-intent-payments">
            <div className="payment-intent-payments-head">
              <span className="payment-intent-label">Payment details</span>
              {mode === 'partial' ? (
                <button type="button" className="payment-intent-add" onClick={addRow} disabled={busy}>
                  <IconPlus />
                  Add payment
                </button>
              ) : null}
            </div>
            <ul className="payment-intent-rows">
              {rows.map((row, idx) => (
                <li key={row.id} className="payment-intent-row">
                  <div className="payment-intent-row-top">
                    <span className="payment-intent-row-badge">Payment {idx + 1}</span>
                    {rows.length > 1 ? (
                      <button
                        type="button"
                        className="payment-intent-remove"
                        onClick={() => removeRow(row.id)}
                        disabled={busy}
                        aria-label={`Remove payment ${idx + 1}`}
                      >
                        <IconTrash />
                      </button>
                    ) : null}
                  </div>
                  <div className="payment-intent-row-methods" role="group" aria-label={`Payment ${idx + 1} method`}>
                    {PAY_METHODS.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        className={`payment-intent-method payment-intent-method--${m.id.toLowerCase()}${row.method === m.id ? ' is-active' : ''}`}
                        onClick={() => updateRow(row.id, { method: m.id })}
                        disabled={busy}
                      >
                        <span className="payment-intent-method-icon" aria-hidden="true">
                          {m.icon}
                        </span>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <div className="payment-intent-row-amount">
                    <label className="payment-intent-amount-field">
                      <span className="payment-intent-amount-prefix">{amountPrefix}</span>
                      <GuardedAmountNumberInput
                        min={0}
                        step="0.01"
                        className="payment-intent-amount-input"
                        value={row.amount || ''}
                        onChange={e => {
                          const v = e.target.value;
                          updateRow(row.id, { amount: v === '' ? 0 : Math.max(0, Number(v) || 0) });
                        }}
                        placeholder="0.00"
                        disabled={busy}
                        aria-label={`Payment ${idx + 1} amount`}
                      />
                    </label>
                  </div>
                </li>
              ))}
            </ul>
            <div className="payment-intent-summary">
              <div className={`payment-intent-stat payment-intent-stat--paid${paidSum > 0 ? ' has-value' : ''}`}>
                <span className="payment-intent-stat-label">Paid now</span>
                <strong className="payment-intent-stat-value">{formatMoneyAmount(paidSum, currencyCode)}</strong>
              </div>
              <div
                className={`payment-intent-stat payment-intent-stat--balance${balanceAfter <= 0 ? ' is-settled' : ''}`}
              >
                <span className="payment-intent-stat-label">{mode === 'partial' ? 'Balance after' : 'Remaining'}</span>
                <strong className="payment-intent-stat-value">{formatMoneyAmount(balanceAfter, currencyCode)}</strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="payment-intent-later-note" role="note">
            <span className="payment-intent-later-icon" aria-hidden="true">
              <IconInfo />
            </span>
            <p>
              The invoice will be saved as <strong>Unpaid</strong>. You can record payment later from checkout or
              Payments.
            </p>
          </div>
        )}

        {error ? (
          <div className="payment-intent-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="payment-intent-actions">
          <button type="button" className="ghost-button payment-intent-btn payment-intent-btn--cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`primary-button payment-intent-btn payment-intent-btn--confirm payment-intent-btn--${mode}`}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
