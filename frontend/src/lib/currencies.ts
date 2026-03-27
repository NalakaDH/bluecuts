/** ISO 4217 codes supported for sales & memos (primary: THB). */
export const SUPPORTED_CURRENCIES = [
  { code: 'THB', label: 'THB — Thai Baht' },
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — British Pound' },
  { code: 'CNY', label: 'CNY — Chinese Yuan' },
  { code: 'JPY', label: 'JPY — Japanese Yen' },
  { code: 'CHF', label: 'CHF — Swiss Franc' },
  { code: 'HKD', label: 'HKD — Hong Kong Dollar' },
  { code: 'SGD', label: 'SGD — Singapore Dollar' },
  { code: 'AUD', label: 'AUD — Australian Dollar' },
  { code: 'MYR', label: 'MYR — Malaysian Ringgit' },
] as const;

export const DEFAULT_CURRENCY_CODE = 'THB';

/** Round a monetary amount to 2 decimal places (reduces float drift from APIs and arithmetic). */
export function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Parse a typed money field into a 2-decimal value. Uses digit structure from the string so
 * "10.50" stays exact; optional third decimal rounds half-up into cents.
 */
export function parseMoneyInput(raw: string): number {
  const s = String(raw ?? '')
    .trim()
    .replace(/,/g, '');
  if (s === '' || /^[+-]?\.?$/.test(s)) return 0;

  const neg = s.startsWith('-');
  const u = s.replace(/^[-+]/, '');
  const parts = u.split('.');
  const intRaw = (parts[0] || '').replace(/\D/g, '');
  const intPart = intRaw === '' ? 0 : parseInt(intRaw, 10);
  if (!Number.isFinite(intPart)) return 0;

  const fracDigits = (parts[1] || '').replace(/\D/g, '');
  const p = (fracDigits + '000').slice(0, 3);
  const d0 = p[0] ?? '0';
  const d1 = p[1] ?? '0';
  const d2 = p[2] ?? '0';
  let cents = intPart * 100 + parseInt(d0 + d1, 10);
  if (parseInt(d2, 10) >= 5) cents += 1;
  if (neg) cents = -cents;
  return cents / 100;
}

const ALLOWED: Set<string> = new Set(SUPPORTED_CURRENCIES.map(c => c.code));

export function normalizeCurrencyCode(raw: string | null | undefined): string {
  const code = String(raw ?? DEFAULT_CURRENCY_CODE)
    .trim()
    .toUpperCase();
  return ALLOWED.has(code) ? code : DEFAULT_CURRENCY_CODE;
}

export function currencyLabelForCode(code: string | null | undefined): string {
  const c = normalizeCurrencyCode(code);
  const row = SUPPORTED_CURRENCIES.find(x => x.code === c);
  return row ? row.label.replace(/^[^—]+—\s*/, '') : c;
}

/** Full line for receipt meta row, e.g. "THB (Thai Baht)". */
export function currencyReceiptLabel(code: string | null | undefined): string {
  const c = normalizeCurrencyCode(code);
  const row = SUPPORTED_CURRENCIES.find(x => x.code === c);
  if (!row) return c;
  const name = row.label.split('—')[1]?.trim() || row.label;
  return `${c} (${name})`;
}

export function formatMoneyAmount(n: number, currencyCode: string | null | undefined): string {
  const code = normalizeCurrencyCode(currencyCode);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(n) || 0);
  } catch {
    return `${code} ${(Number(n) || 0).toFixed(2)}`;
  }
}

/** Integer-style prices (inventory list) — still uses locale grouping. */
export function formatMoneyWhole(n: number | null, currencyCode: string | null | undefined): string {
  const code = normalizeCurrencyCode(currencyCode);
  if (n == null) return formatMoneyAmount(0, code);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Number(n) || 0);
  } catch {
    return `${code} ${Math.round(Number(n) || 0).toLocaleString()}`;
  }
}
