/**
 * Pages the owner can grant to staff (stored in DB; profile is always allowed in UI).
 * Keep in sync with backend STAFF_PERMISSION_PAGE_IDS in server.js.
 */
export const ASSIGNABLE_STAFF_PAGE_IDS = [
  'dashboard',
  'updateInventory',
  'checkInventory',
  'selling',
  'payments',
  'invoiceCheckout',
  'customers',
  'memo',
  'returns',
  'reports',
] as const;

export type StaffAssignablePageId = (typeof ASSIGNABLE_STAFF_PAGE_IDS)[number];

export const ASSIGNABLE_STAFF_PAGE_LABELS: Record<StaffAssignablePageId, string> = {
  dashboard: 'Dashboard',
  updateInventory: 'Update Inventory',
  checkInventory: 'Check Inventory',
  selling: 'Selling',
  payments: 'Payments & Loans',
  invoiceCheckout: 'Invoice Checkout',
  customers: 'Customers',
  memo: 'Memos',
  returns: 'Return & Restock',
  reports: 'Reports & Analytics',
};

/** Legacy default when DB has no allowed_pages. */
export const DEFAULT_STAFF_ALLOWED_PAGES: StaffAssignablePageId[] = [
  'updateInventory',
  'selling',
  'memo',
];

const assignableSet = new Set<string>(ASSIGNABLE_STAFF_PAGE_IDS);

/** Optional rules for staff nav access (e.g. cloud dashboard vs local POS). */
export type StaffNavAccessOptions = {
  /**
   * When true (default), staff with Check Inventory may open Stock count (not stored in API).
   * Set false for the cloud dashboard so only explicit pages appear.
   */
  linkStockCountToCheckInventory?: boolean;
};

export function normalizeStaffAllowedPagesFromApi(raw: string[] | null | undefined): StaffAssignablePageId[] {
  if (!raw || !raw.length) return [...DEFAULT_STAFF_ALLOWED_PAGES];
  const filtered = raw.filter((p): p is StaffAssignablePageId => assignableSet.has(p));
  return filtered.length ? filtered : [...DEFAULT_STAFF_ALLOWED_PAGES];
}

/** Staff: null from API means "use default list" until first save. */
export function staffCanAccessPage(
  role: 'owner' | 'staff',
  page: string,
  allowedPages: string[] | null | undefined,
  navOptions?: StaffNavAccessOptions | null
): boolean {
  if (page === 'profile') return true;
  if (role === 'owner') return true;
  const pages =
    allowedPages && allowedPages.length > 0 ? allowedPages : DEFAULT_STAFF_ALLOWED_PAGES;
  if (page === 'inventoryReport') {
    return pages.includes('inventoryReport');
  }
  if (page === 'invoiceCheckout' && pages.includes('payments')) return true;
  const linkStock = navOptions?.linkStockCountToCheckInventory !== false;
  if (page === 'stockCount') return linkStock && pages.includes('checkInventory');
  return pages.includes(page);
}

export function firstAllowedStaffPage(allowedPages: string[] | null | undefined): string {
  const pages =
    allowedPages && allowedPages.length > 0 ? allowedPages : DEFAULT_STAFF_ALLOWED_PAGES;
  return pages[0] || 'updateInventory';
}
