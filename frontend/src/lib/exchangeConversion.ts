import { DEFAULT_CURRENCY_CODE, normalizeCurrencyCode, roundMoney2 } from './currencies';

/** Map: ISO code → how many THB one unit of that currency is worth (e.g. USD → 34 means 1 USD = 34 THB). */
export type ThbPerUnitMap = Record<string, number>;

/**
 * Convert a money amount from one currency to another using THB as bridge.
 * Missing or non-positive rates return the original amount (caller may warn).
 */
export function convertAmountViaThb(
  amount: number,
  fromCurrency: string | null | undefined,
  toCurrency: string | null | undefined,
  thbPerUnit: ThbPerUnitMap
): number {
  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);
  const n = Number(amount) || 0;
  if (from === to) return roundMoney2(n);

  const rFrom = from === DEFAULT_CURRENCY_CODE ? 1 : thbPerUnit[from];
  const rTo = to === DEFAULT_CURRENCY_CODE ? 1 : thbPerUnit[to];
  if (rFrom == null || rTo == null || rFrom <= 0 || rTo <= 0) {
    return roundMoney2(n);
  }

  const inThb = from === DEFAULT_CURRENCY_CODE ? n : n * rFrom;
  const out = to === DEFAULT_CURRENCY_CODE ? inThb : inThb / rTo;
  return roundMoney2(out);
}

export function hasRateFor(code: string, thbPerUnit: ThbPerUnitMap): boolean {
  const c = normalizeCurrencyCode(code);
  if (c === DEFAULT_CURRENCY_CODE) return true;
  const r = thbPerUnit[c];
  return r != null && r > 0;
}
