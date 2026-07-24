import { roundMoney2 } from './currencies';

const SINGLE_INVENTORY_ITEM_TYPES = new Set(['cut single', 'rough single']);

export interface LotPriceItem {
  item_type?: string | null;
  pieces?: number;
  weight_carats?: number | null;
  selling_total_price?: number | null;
  selling_carat_price?: number | null;
}

export function lotNeedsSoldCaratsInput(item: {
  item_type?: string | null;
  pieces?: number;
  weight_carats?: number | null;
}): boolean {
  const type = String(item.item_type || '').trim().toLowerCase();
  if (SINGLE_INVENTORY_ITEM_TYPES.has(type)) return false;
  const pcs = Math.max(1, Math.floor(Number(item.pieces ?? 1)));
  if (pcs <= 1) return false;
  const ct = item.weight_carats;
  return ct != null && Number.isFinite(Number(ct)) && Number(ct) > 0;
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
  if (soldCt == null) return 'Enter the carat weight for the pieces being sold.';
  if (remainingCt != null && Number.isFinite(Number(remainingCt)) && soldCt > Number(remainingCt) + 0.001) {
    return `Cannot exceed remaining lot weight (${Number(remainingCt)} ct).`;
  }
  return null;
}

/**
 * List line amount for a partial lot sale from carats sold.
 * Prefers selling_carat_price × ct; else proportional share of lot selling_total_price.
 */
export function lotListLineGross(item: LotPriceItem, soldCarats: number | null): number | null {
  if (!lotNeedsSoldCaratsInput(item)) return null;
  if (soldCarats == null || soldCarats <= 0) return null;

  const perCt = item.selling_carat_price;
  if (perCt != null && Number.isFinite(Number(perCt)) && Number(perCt) >= 0) {
    return roundMoney2(Number(perCt) * soldCarats);
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
    return roundMoney2(Number(lotTotal) * (soldCarats / Number(lotCt)));
  }

  return null;
}

/** Inventory list unit price per piece for this partial sale (for discount math). */
export function lotListUnitPerPiece(
  item: LotPriceItem,
  soldCarats: number | null,
  qty: number
): number | null {
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
