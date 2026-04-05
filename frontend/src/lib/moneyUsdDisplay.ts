import { DEFAULT_CURRENCY_CODE, formatMoneyAmount, normalizeCurrencyCode, roundMoney2 } from './currencies';
import { convertAmountViaThb, hasRateFor, type ThbPerUnitMap } from './exchangeConversion';

export const USD_CURRENCY_CODE = 'USD';

/**
 * Convert an amount from `fromCurrency` to USD using Profile THB rates. Returns null if USD rate (or
 * non-THB `from` rate) is missing.
 */
export function convertToUsd(
  amount: number,
  fromCurrency: string | null | undefined,
  thbPerUnit: ThbPerUnitMap
): number | null {
  const from = normalizeCurrencyCode(fromCurrency ?? DEFAULT_CURRENCY_CODE);
  const n = roundMoney2(Number(amount) || 0);
  if (!hasRateFor(USD_CURRENCY_CODE, thbPerUnit)) return null;
  if (from !== DEFAULT_CURRENCY_CODE && !hasRateFor(from, thbPerUnit)) return null;
  return convertAmountViaThb(n, from, USD_CURRENCY_CODE, thbPerUnit);
}

/** THB-equivalent totals (dashboard/reports API) → number in USD for charts. Uses 0 if rate missing. */
export function thbEquivalentToUsdNumber(thbAmount: number, thbPerUnit: ThbPerUnitMap): number {
  const u = convertToUsd(Number(thbAmount) || 0, DEFAULT_CURRENCY_CODE, thbPerUnit);
  return u != null ? u : 0;
}

/** Display string in USD from THB-equivalent backend values. */
export function formatUsdOnlyFromThb(thbAmount: number, thbPerUnit: ThbPerUnitMap): string {
  const u = convertToUsd(Number(thbAmount) || 0, DEFAULT_CURRENCY_CODE, thbPerUnit);
  if (u == null) return '—';
  return formatMoneyAmount(u, USD_CURRENCY_CODE);
}

/** Display string in USD from an amount in any ISO currency. */
export function formatUsdOnlyFromAny(
  amount: number,
  fromCurrency: string | null | undefined,
  thbPerUnit: ThbPerUnitMap
): string {
  const u = convertToUsd(Number(amount) || 0, fromCurrency, thbPerUnit);
  if (u == null) return '—';
  return formatMoneyAmount(u, USD_CURRENCY_CODE);
}

/** CSV-friendly USD number from THB-equivalent, or empty string. */
export function thbEquivalentToUsdCsv(thbAmount: number, thbPerUnit: ThbPerUnitMap): string {
  const u = convertToUsd(Number(thbAmount) || 0, DEFAULT_CURRENCY_CODE, thbPerUnit);
  return u != null ? String(roundMoney2(u)) : '';
}
