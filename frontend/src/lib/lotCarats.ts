import { roundMoney2 } from './currencies';

export interface LotPriceItem {
  item_type?: string | null;
  pieces?: number;
  weight_carats?: number | null;
  selling_total_price?: number | null;
  selling_carat_price?: number | null;
}

/** True when the item has carat weight — sold/priced by ct (lots and single stones). */
export function itemNeedsSoldCaratsInput(item: {
  item_type?: string | null;
  pieces?: number;
  weight_carats?: number | null;
}): boolean {
  const ct = item.weight_carats;
  return ct != null && Number.isFinite(Number(ct)) && Number(ct) > 0;
}

/** @deprecated Use itemNeedsSoldCaratsInput — same rule for lots and singles. */
export function lotNeedsSoldCaratsInput(item: {
  item_type?: string | null;
  pieces?: number;
  weight_carats?: number | null;
}): boolean {
  return itemNeedsSoldCaratsInput(item);
}

export function parseSoldCaratsInput(raw: string | number | null | undefined): number | null {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

export function validateSoldCaratsForLot(
  remainingCt: number | null | undefined,
  soldCt: number | null
): string | null {
  if (soldCt == null) return 'Enter the carat weight being sold.';
  if (remainingCt != null && Number.isFinite(Number(remainingCt)) && soldCt > Number(remainingCt) + 0.001) {
    return `Cannot exceed remaining weight (${Number(remainingCt)} ct).`;
  }
  return null;
}

/** Inventory list price per carat (prefers selling_carat_price; else total ÷ remaining ct). */
export function listPricePerCt(item: LotPriceItem): number | null {
  if (!itemNeedsSoldCaratsInput(item)) return null;
  const perCt = item.selling_carat_price;
  if (perCt != null && Number.isFinite(Number(perCt)) && Number(perCt) >= 0) {
    return roundMoney2(Number(perCt));
  }
  const lotTotal = item.selling_total_price;
  const lotCt = item.weight_carats;
  if (
    lotTotal != null &&
    Number.isFinite(Number(lotTotal)) &&
    lotCt != null &&
    Number.isFinite(Number(lotCt)) &&
    Number(lotCt) > 0
  ) {
    return roundMoney2(Number(lotTotal) / Number(lotCt));
  }
  return null;
}

/**
 * List line amount from carats sold.
 * Prefers selling_carat_price × ct; else proportional share of selling_total_price.
 */
export function lotListLineGross(item: LotPriceItem, soldCarats: number | null): number | null {
  if (!itemNeedsSoldCaratsInput(item)) return null;
  if (soldCarats == null || soldCarats <= 0) return null;

  const perCt = listPricePerCt(item);
  if (perCt != null) return roundMoney2(perCt * soldCarats);

  return null;
}

/** Line amount when unit price is per carat. */
export function lineGrossFromPerCt(pricePerCt: number, soldCarats: number | null): number {
  if (soldCarats == null || soldCarats <= 0) return 0;
  return roundMoney2(Math.max(0, Number(pricePerCt) || 0) * soldCarats);
}

/**
 * @deprecated Prefer listPricePerCt — unit price is now per ct, not per piece.
 * Kept for callers that still divide line gross by qty.
 */
export function lotListUnitPerPiece(
  item: LotPriceItem,
  soldCarats: number | null,
  qty: number
): number | null {
  const perCt = listPricePerCt(item);
  if (perCt != null) return perCt;
  const gross = lotListLineGross(item, soldCarats);
  if (gross == null) return null;
  const q = Math.max(1, Math.floor(Number(qty) || 1));
  return roundMoney2(gross / q);
}

/** Cart/catalog suffix for sold carats entered by the user. */
export function soldCaratsCartSuffix(
  soldRaw: string | number | null | undefined,
  lotRemainingCt?: number | null
): string {
  const sold = typeof soldRaw === 'number' ? soldRaw : parseSoldCaratsInput(soldRaw);
  if (sold != null) return ` · ${sold} ct`;
  if (lotRemainingCt != null && Number.isFinite(Number(lotRemainingCt)) && Number(lotRemainingCt) > 0) {
    return ` · ${Number(lotRemainingCt)} ct`;
  }
  return '';
}
