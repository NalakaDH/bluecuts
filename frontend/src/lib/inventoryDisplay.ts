/** Categories shorter than this are treated as legacy codes and hidden from list UI. */
export const INVENTORY_CATEGORY_MIN_DISPLAY_LENGTH = 3;

export function categoryLooksLikeShortCode(category: string | null | undefined): boolean {
  return (category?.trim().length ?? 0) < INVENTORY_CATEGORY_MIN_DISPLAY_LENGTH;
}

export const ITEM_TYPE_OPTIONS: readonly string[] = ['cut single', 'cut lot', 'rough single', 'rough lot'];

export const ITEM_TYPE_LABELS: Record<string, string> = {
  'cut single': 'Cut — single stone',
  'cut lot': 'Cut — lot (multiple)',
  'rough single': 'Rough — single piece',
  'rough lot': 'Rough — lot (multiple)',
};

const SINGLE_ITEM_TYPES = new Set<string>(['cut single', 'rough single']);

export function normalizeItemType(raw: string): string | null {
  const n = raw.trim().toLowerCase();
  return ITEM_TYPE_OPTIONS.find((t) => t.toLowerCase() === n) ?? null;
}

export function isSingleItemTypeForm(raw: string): boolean {
  const n = normalizeItemType(raw);
  return n != null && SINGLE_ITEM_TYPES.has(n);
}

export function formatItemTypeDisplay(raw: string): string {
  const n = normalizeItemType(raw);
  if (n) return ITEM_TYPE_LABELS[n] ?? n;
  const t = raw.trim();
  return t || '—';
}

/** Main list heading: full category, else description, else item code, else item id. */
export function inventoryItemPrimaryLabel(item: {
  id: number;
  category: string;
  description?: string | null;
  item_code?: string | null;
}): string {
  const cat = item.category?.trim() ?? '';
  if (!categoryLooksLikeShortCode(cat)) return cat;
  const d = item.description?.trim();
  if (d) return d.length > 72 ? `${d.slice(0, 69)}…` : d;
  const code = item.item_code?.trim();
  if (code) return code;
  return `Item #${item.id}`;
}

/** Secondary lines: omit short category codes entirely. */
export function inventoryCategoryDisplay(category: string | null | undefined): string | null {
  const c = category?.trim() ?? '';
  if (categoryLooksLikeShortCode(c)) return null;
  return c || null;
}
