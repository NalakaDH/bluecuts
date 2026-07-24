import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { INVOICE_CHECKOUT_INVOICE_ID_KEY, SELLING_FROM_MEMO_CONVERT_INVOICE_KEY } from '../../constants/invoiceCheckout';
import type { PageId } from '../../components/layout/Layout';
import { InvoiceCheckoutPage } from '../payments/InvoiceCheckoutPage';
import { mapApiInvoiceToReceipt, openInvoiceReceiptWindow } from '../../lib/receiptDocument';
import {
  DEFAULT_CURRENCY_CODE,
  SUPPORTED_CURRENCIES,
  formatMoneyAmount,
  normalizeCurrencyCode,
  parseMoneyInput,
  roundMoney2,
} from '../../lib/currencies';
import type { ThbPerUnitMap } from '../../lib/exchangeConversion';
import { dateFromServerUtc } from '../../lib/serverTime';
import { formatUsdOnlyFromAny } from '../../lib/moneyUsdDisplay';
import {
  lotListLineGross,
  lotListUnitPerPiece,
  lotNeedsSoldCaratsInput,
  parseSoldCaratsInput,
  soldCaratsCartSuffix,
  validateSoldCaratsForLot,
} from '../../lib/lotCarats';
import { InvoicePaymentIntentModal } from '../../components/InvoicePaymentIntentModal';
import type { InvoicePaymentIntentResult } from '../../lib/invoicePaymentIntent';
import {
  offerPaidInvoicePrint,
  offerPaymentReceiptsPrint,
  paymentReceiptPayloadsFromRows,
} from '../../lib/paymentReceipt';
import { GuardedAmountNumberInput } from '../../components/GuardedAmountNumberInput';

/** Default invoice / checkout display currency for new sales on this page. */
const SELLING_DEFAULT_CURRENCY = 'USD';
const QUICK_ADD_STORAGE_KEY = 'bluecuts-quick-add-item';

function currencySymbolFor(code: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: normalizeCurrencyCode(code),
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0);
    return parts.find(p => p.type === 'currency')?.value ?? '';
  } catch {
    return '';
  }
}

const IconGemModal = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
    <line x1="12" y1="22" x2="12" y2="15.5" />
    <polyline points="22 8.5 12 15.5 2 8.5" />
  </svg>
);

const IconCartModal = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);

/**
 * Unit price prefill from inventory list: no FX conversion. Staff enters amounts in invoice currency
 * when it differs from the item's stored list currency.
 */
function sellingUnitPrefillFromList(
  item: InventoryItem,
  invoiceCurrency: string,
  qty = 1,
  soldCaratsRaw?: string | number | null
): number {
  const listCur = normalizeCurrencyCode(item.selling_currency ?? DEFAULT_CURRENCY_CODE);
  const inv = normalizeCurrencyCode(invoiceCurrency);
  if (listCur !== inv) return 0;
  if (lotNeedsSoldCaratsInput(item)) {
    const sold =
      typeof soldCaratsRaw === 'number' ? soldCaratsRaw : parseSoldCaratsInput(soldCaratsRaw);
    const perPc = lotListUnitPerPiece(item, sold, qty);
    return perPc != null ? perPc : 0;
  }
  return roundMoney2(Number(item.selling_total_price ?? 0));
}

/** Inventory list price per unit in `invoiceCurrency`, or null if not comparable (currency mismatch). */
function inventoryListUnitInInvoiceCurrency(
  item: InventoryItem,
  invoiceCurrency: string,
  qty = 1,
  soldCaratsRaw?: string | number | null
): number | null {
  const listCur = normalizeCurrencyCode(item.selling_currency ?? DEFAULT_CURRENCY_CODE);
  const inv = normalizeCurrencyCode(invoiceCurrency);
  if (listCur !== inv) return null;
  if (lotNeedsSoldCaratsInput(item)) {
    const sold =
      typeof soldCaratsRaw === 'number' ? soldCaratsRaw : parseSoldCaratsInput(soldCaratsRaw);
    return lotListUnitPerPiece(item, sold, qty);
  }
  const v = Number(item.selling_total_price ?? 0);
  if (!Number.isFinite(v) || v < 0) return null;
  return roundMoney2(v);
}

interface InventoryItem {
  id: number;
  category: string;
  item_type: string;
  pieces: number;
  /** Available pieces in stock (from API); falls back to `pieces` if missing */
  pieces_remaining?: number;
  weight_grams: number | null;
  weight_carats: number | null;
  selling_total_price: number | null;
  selling_carat_price: number | null;
  /** Currency `selling_total_price` is stored in (inventory / edited line) */
  selling_currency?: string | null;
  image_path: string | null;
  item_code: string | null;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Server: GET /api/inventory/activity-summary — keyed by inventory id string */
type InventoryActivitySummaryMap = Record<
  string,
  { sold_units?: number; last_sale_at?: string | null }
>;

const CATALOG_TAB_PREVIEW_LIMIT = 18;
/** Same limit — alias kept so scroll-height math and any older bundles stay valid */
const CATALOG_VISIBLE_SLOTS = CATALOG_TAB_PREVIEW_LIMIT;

function inventoryTimestampMs(raw: string | null | undefined): number {
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

/** Latest invoice sale time for this SKU (stock_movements.type = 'SALE'); 0 if never sold. */
function lastSaleAtMsFromSummary(item: InventoryItem, summary: InventoryActivitySummaryMap): number {
  const raw = summary[String(item.id)]?.last_sale_at;
  return inventoryTimestampMs(raw ?? undefined);
}

interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

type InvoiceStatus = 'Draft' | 'Unpaid' | 'Partial' | 'Paid';

interface InvoiceSummary {
  id: number;
  invoiceNo: string;
  customerName: string;
  total: number;
  paid: number;
  status: InvoiceStatus;
  createdAt: string;
  currencyCode: string;
}

/** Lines shown in “Invoice created” when the sale did not originate from the current cart (e.g. memo → invoice). */
type InvoiceCreatedLineView = {
  label: string;
  qty: number;
  gross: number;
  disc: number;
  net: number;
};

interface ApiInvoice {
  id: number;
  invoice_no: string;
  customer_name: string | null;
  total: number;
  paid: number;
  status: InvoiceStatus;
  created_at: string;
  currency_code?: string | null;
  payments?: { method: string; amount: number; created_at: string }[];
}

function mapApiInvoiceSummary(inv: ApiInvoice): InvoiceSummary {
  return {
    id: inv.id,
    invoiceNo: inv.invoice_no,
    customerName: inv.customer_name || 'Walk-in customer',
    total: inv.total,
    paid: inv.paid,
    status: inv.status,
    createdAt: inv.created_at,
    currencyCode: inv.currency_code || DEFAULT_CURRENCY_CODE,
  };
}

interface InvoiceDetailForEdit {
  id: number;
  invoice_no: string;
  customer_id: number | null;
  customer_name: string | null;
  subtotal: number;
  discount: number;
  total: number;
  status: InvoiceStatus;
  paid?: number;
  currency_code?: string | null;
  items: {
    id: number;
    inventory_item_id: number;
    item_code: string | null;
    description: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
}

const IconPlus = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconTrash = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);
const IconCheck = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);
const IconX = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" /><path d="M6 6l12 12" />
  </svg>
);

const IconPrinter = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9V2h12v7" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <path d="M6 14h12v8H6z" />
  </svg>
);

const IconEdit = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

const IconDelete = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const IconCreditCard = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <line x1="2" y1="10" x2="22" y2="10" />
    <line x1="6" y1="15" x2="10" y2="15" />
  </svg>
);

const IconInvoiceDoc = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

function customerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  const one = parts[0] ?? '';
  return (one.slice(0, 2) || '?').toUpperCase();
}

const IconCcUser = () => (
  <svg className="selling-pos-cc-btn-icon" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);

const IconCcCurrency = () => (
  <svg className="selling-pos-cc-btn-icon" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v12M8 9c0-1.7 1.8-3 4-3s4 1.3 4 3-1.8 3-4 3-4 1.3-4 3 1.8 3 4 3 4-1.3 4-3" />
  </svg>
);

interface SellingPageProps {
  token: string;
  onNavigate?: (page: PageId) => void;
  view?: 'compose' | 'invoices';
  onChangeView?: (view: 'compose' | 'invoices') => void;
}

const IconNewCustomerUser = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const IconSaveCustomer = () => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

export const SellingPage: React.FC<SellingPageProps> = ({
  token,
  onNavigate,
  view = 'compose',
  onChangeView,
}) => {
  const { showAlert, showConfirm } = useAlertDialog();
  const [availableItems, setAvailableItems] = useState<InventoryItem[]>([]);
  const [, setLoading] = useState(true);
  const [, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<InventoryItem[]>([]);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: '',
    phone: '',
    email: '',
    notes: '',
    address_line1: '',
    address_line2: '',
    city: '',
    postal_code: '',
    country: '',
  });

  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [discountType, setDiscountType] = useState<'pct' | 'flat'>('pct');
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [, setInvoiceMessage] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [, setNextInvoiceNumber] = useState(1);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const [itemQuantities, setItemQuantities] = useState<Record<number, number>>({});
  /** Per-line unit price in the selected invoice currency (manual; not recomputed when currency changes). */
  const [itemUnitPrices, setItemUnitPrices] = useState<Record<number, number>>({});
  const [itemNotes, setItemNotes] = useState<Record<number, string>>({});
  /** ISO 4217 for this sale / receipt. */
  const [saleCurrency, setSaleCurrency] = useState<string>(SELLING_DEFAULT_CURRENCY);
  const [thbPerUnit, setThbPerUnit] = useState<ThbPerUnitMap>({ THB: 1 });
  const [invoiceCreatedOpen, setInvoiceCreatedOpen] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<InvoiceSummary | null>(null);
  const [invoiceCreatedLineOverride, setInvoiceCreatedLineOverride] = useState<InvoiceCreatedLineView[] | null>(null);
  const [paymentIntentOpen, setPaymentIntentOpen] = useState(false);
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
  /** Picker for customer (search + list + new) or currency list. */
  const [ccModal, setCcModal] = useState<null | 'customer' | 'currency'>(null);
  /** Inventory ids whose thumbnail URL failed to load */
  const [cartImageLoadFailed, setCartImageLoadFailed] = useState<Set<number>>(() => new Set());
  const [savingDraft, setSavingDraft] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'top' | 'recent'>('all');
  const [inventoryActivitySummary, setInventoryActivitySummary] = useState<InventoryActivitySummaryMap>({});
  const [itemModalOpen, setItemModalOpen] = useState(false);
  /** Cart edit opens modal with existing qty/unit; catalog suggestion opens as new line. */
  const [itemModalFromCartEdit, setItemModalFromCartEdit] = useState(false);
  const [itemModalTarget, setItemModalTarget] = useState<InventoryItem | null>(null);
  const [itemModalQty, setItemModalQty] = useState(1);
  const [itemModalUnitPrice, setItemModalUnitPrice] = useState(0);
  /** Total carats for the qty being sold (multi-piece lots with weight). */
  const [itemSoldCarats, setItemSoldCarats] = useState<Record<number, string>>({});
  const [itemModalSoldCarats, setItemModalSoldCarats] = useState('');
  const itemModalUnitPriceManualRef = useRef(false);

  /** Inline edit: load invoice into the composer (same UI as new sale). */
  const [editingInvoiceId, setEditingInvoiceId] = useState<number | null>(null);
  const [editingInvoiceNo, setEditingInvoiceNo] = useState<string | null>(null);
  /** Pieces already committed on this invoice (for max qty = remaining + reserved). */
  const [reservedPiecesOnEdit, setReservedPiecesOnEdit] = useState<Record<number, number>>({});
  const [invoiceHydrateLoading, setInvoiceHydrateLoading] = useState(false);
  const sellingComposerRef = useRef<HTMLDivElement>(null);
  const itemModalUnitPriceInputRef = useRef<HTMLInputElement>(null);

  const getImageSrc = (imagePath: string | null): string => {
    if (!imagePath) return '';
    if (imagePath.startsWith('http')) return imagePath;
    const path = imagePath.startsWith('/') ? imagePath : `/uploads/${imagePath}`;
    return apiUrl(path);
  };

  const fetchInventoryActivitySummary = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/inventory/activity-summary'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setInventoryActivitySummary(data && typeof data === 'object' ? (data as InventoryActivitySummaryMap) : {});
    } catch {
      setInventoryActivitySummary({});
    }
  }, [token]);

  const fetchAvailable = useCallback(async (searchTerm?: string, opts?: { force?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('status', 'Available');
      /** Include SKUs that sold out so Top Sold / Recent tabs still show just-sold lines */
      params.set('for_selling_catalog', '1');
      params.set('limit', '200');
      if (searchTerm?.trim()) params.set('search', searchTerm.trim());
      if (opts?.force) params.set('_ts', String(Date.now()));
      const res = await fetch(apiUrl(`/api/inventory?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load inventory');
        throw new Error(msg);
      }
      const data = await res.json();
      setAvailableItems(data);
      /** Wait for sold / last_sale stats so Top Sold & Recent sort correctly after Refresh */
      await fetchInventoryActivitySummary();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load';
      setError(msg);
      setAvailableItems([]);
      showAlert({ title: 'Could not load inventory', message: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [token, showAlert, fetchInventoryActivitySummary]);

  useEffect(() => {
    void fetchAvailable();
  }, [fetchAvailable]);

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
    let cancelled = false;
    const clearMemoConvertKey = () => {
      try {
        window.sessionStorage.removeItem(SELLING_FROM_MEMO_CONVERT_INVOICE_KEY);
      } catch {
        // ignore
      }
    };
    (async () => {
      let raw: string | null = null;
      try {
        raw = window.sessionStorage.getItem(SELLING_FROM_MEMO_CONVERT_INVOICE_KEY);
      } catch {
        return;
      }
      if (!raw) return;
      let invoiceId = NaN;
      let memoSummary: Partial<ApiInvoice> | null = null;
      let memoPayments: ApiInvoice['payments'] | null = null;
      try {
        const p = JSON.parse(raw) as {
          invoiceId?: unknown;
          summary?: Partial<ApiInvoice>;
          payments?: ApiInvoice['payments'];
        };
        invoiceId = Number(p.invoiceId);
        memoSummary = p.summary ?? null;
        memoPayments = p.payments ?? null;
      } catch {
        clearMemoConvertKey();
        return;
      }
      if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
        clearMemoConvertKey();
        return;
      }

      try {
        const res = await fetch(apiUrl(`/api/invoices/${invoiceId}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          clearMemoConvertKey();
          return;
        }
        const data = (await res.json()) as ApiInvoice & {
          items?: Array<{
            inventory_item_id: number;
            item_code: string | null;
            description: string | null;
            quantity: number;
            unit_price: number;
            line_total: number;
          }>;
        };
        if (cancelled) return;

        setCheckoutOpen(false);

        const summary = mapApiInvoiceSummary({
          id: data.id,
          invoice_no: memoSummary?.invoice_no ?? data.invoice_no,
          customer_name: memoSummary?.customer_name ?? data.customer_name,
          total: memoSummary?.total ?? data.total,
          paid: memoSummary?.paid ?? data.paid,
          status: (memoSummary?.status as InvoiceStatus) ?? data.status,
          created_at: memoSummary?.created_at ?? data.created_at,
          currency_code: memoSummary?.currency_code ?? data.currency_code,
        });

        const rawItems = Array.isArray(data.items) ? data.items : [];
        const lines: InvoiceCreatedLineView[] = rawItems.map(it => {
          const label =
            (it.item_code && String(it.item_code).trim()) ||
            (it.description && String(it.description).trim()) ||
            `#${it.inventory_item_id}`;
          const qty = Math.max(0, Math.floor(Number(it.quantity || 0)));
          const unit = roundMoney2(Number(it.unit_price || 0));
          const net = roundMoney2(Number(it.line_total || 0));
          const gross = roundMoney2(unit * qty);
          return { label, qty, gross, disc: 0, net };
        });

        setInvoices(prev => (prev.some(r => r.id === summary.id) ? prev : [summary, ...prev]));
        setInvoiceCreatedLineOverride(lines.length > 0 ? lines : null);
        setCreatedInvoice(summary);
        setInvoiceCreatedOpen(true);
        clearMemoConvertKey();

        if (memoPayments?.length) {
          const payloads = paymentReceiptPayloadsFromRows({
            invoice_no: summary.invoiceNo,
            customer_name: summary.customerName === 'Walk-in customer' ? null : summary.customerName,
            currency_code: summary.currencyCode,
            invoice_total: summary.total,
            payments: memoPayments,
          });
          void (async () => {
            await offerPaymentReceiptsPrint(showConfirm, payloads);
            if (summary.status === 'Paid') {
              await offerPaidInvoicePrint(showConfirm, summary.invoiceNo, () => printInvoiceReceiptById(summary.id));
            }
          })();
        }
      } catch {
        if (!cancelled) clearMemoConvertKey();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const fetchInvoices = useCallback(async () => {
    setLoadingInvoices(true);
    setInvoicesError(null);
    try {
      const res = await fetch(apiUrl('/api/invoices'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load invoices');
        throw new Error(msg);
      }
      const data: ApiInvoice[] = await res.json();
      setInvoices(data.map(mapApiInvoiceSummary));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load invoices';
      setInvoicesError(msg);
      setInvoices([]);
      showAlert({ title: 'Could not load invoices', message: msg, variant: 'error' });
    } finally {
      setLoadingInvoices(false);
    }
  }, [token, showAlert]);

  const openInvoiceCheckout = (invoiceId: number) => {
    try {
      window.sessionStorage.setItem(INVOICE_CHECKOUT_INVOICE_ID_KEY, String(invoiceId));
    } catch {
      // ignore
    }
    setCheckoutOpen(true);
  };

  const closeCheckout = useCallback(() => {
    setCheckoutOpen(false);
    void fetchInvoices();
  }, [fetchInvoices]);

  useEffect(() => {
    if (!checkoutOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCheckout();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [checkoutOpen, closeCheckout]);

  useEffect(() => {
    const id = setTimeout(() => {
      void fetchAvailable(search);
    }, 300);
    return () => clearTimeout(id);
  }, [search, fetchAvailable]);

  const fetchCustomers = useCallback(async () => {
    const q = customerSearch.trim();
    if (!q) {
      setCustomers([]);
      return;
    }
    try {
      const params = new URLSearchParams();
      params.set('limit', '250');
      params.set('search', q);
      const res = await fetch(apiUrl(`/api/customers?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load customers'));
      const rows = await res.json();
      setCustomers(Array.isArray(rows) ? rows : []);
    } catch (e: unknown) {
      setCustomers([]);
    } finally {
    }
  }, [token, customerSearch]);

  useEffect(() => {
    const id = setTimeout(() => {
      void fetchCustomers();
    }, 300);
    return () => clearTimeout(id);
  }, [customerSearch, fetchCustomers]);

  useEffect(() => {
    void fetchInvoices();
  }, [fetchInvoices]);

  /** When carats or qty change on a lot line, prefill unit price from ct-based list (until manually edited). */
  useEffect(() => {
    if (!itemModalOpen || !itemModalTarget || !lotNeedsSoldCaratsInput(itemModalTarget)) return;
    if (itemModalUnitPriceManualRef.current) return;
    const sold = parseSoldCaratsInput(itemModalSoldCarats);
    if (sold == null) return;
    const listUnit = lotListUnitPerPiece(itemModalTarget, sold, itemModalQty);
    if (listUnit != null) setItemModalUnitPrice(listUnit);
  }, [itemModalOpen, itemModalTarget, itemModalSoldCarats, itemModalQty]);

  /** Pieces remaining on hand (for badges / modal tags). Does not include invoice-edit bonus stock. */
  const rawPiecesAvailForItem = (item: InventoryItem) =>
    Math.max(0, Math.floor(Number(item.pieces_remaining ?? item.pieces ?? 0)));

  const maxPcsForItem = (item: InventoryItem) => {
    const base = Math.floor(Number(item.pieces_remaining ?? item.pieces ?? 0));
    const inCart = cart.some(c => c.id === item.id);
    const bonus =
      editingInvoiceId != null && inCart
        ? Math.floor(Number(reservedPiecesOnEdit[item.id] ?? 0))
        : 0;
    return Math.max(1, base + bonus);
  };

  /** Editable unit price (amount charged per piece). */
  const lineSellUnitForItem = (item: InventoryItem): number => {
    const manual = itemUnitPrices[item.id];
    if (manual != null && Number.isFinite(manual)) return roundMoney2(manual);
    return sellingUnitPrefillFromList(item, saleCurrency);
  };

  /**
   * Unit price stored on the invoice line (`price` in API): list when sale is at or below inventory list
   * (so line discount = list − sell); otherwise the sell unit (premium over list).
   */
  const lineApiUnitPriceForItem = (item: InventoryItem): number => {
    const q = itemQuantities[item.id] ?? 1;
    const sell = lineSellUnitForItem(item);
    const list = inventoryListUnitInInvoiceCurrency(item, saleCurrency, q, itemSoldCarats[item.id]);
    if (list == null) return sell;
    if (sell > list) return sell;
    return list;
  };

  /** Line subtotal before line discount (matches backend gross). */
  const lineSubtotalGrossForItem = (item: InventoryItem) => {
    const unit = lineApiUnitPriceForItem(item);
    const q = itemQuantities[item.id] ?? 1;
    return roundMoney2(unit * q);
  };

  /** Amount charged for the line (sell unit × qty). */
  const lineSellTotalForItem = (item: InventoryItem) => {
    const unit = lineSellUnitForItem(item);
    const q = itemQuantities[item.id] ?? 1;
    return roundMoney2(unit * q);
  };

  /** Line discount = (inventory list − sell) × qty when sell is below list; otherwise 0. */
  const lineDerivedItemDiscount = (item: InventoryItem): number => {
    const sell = lineSellUnitForItem(item);
    const q = itemQuantities[item.id] ?? 1;
    const list = inventoryListUnitInInvoiceCurrency(item, saleCurrency, q, itemSoldCarats[item.id]);
    if (list == null || sell >= list) return 0;
    const perUnit = roundMoney2(list - sell);
    const raw = perUnit * q;
    const gross = lineSubtotalGrossForItem(item);
    return Math.min(gross, Math.max(0, roundMoney2(raw)));
  };

  const addToCart = useCallback((item: InventoryItem) => {
    const initialUnit = lotNeedsSoldCaratsInput(item)
      ? 0
      : sellingUnitPrefillFromList(item, saleCurrency);
    let inserted = false;
    setCart(prev => {
      if (prev.some(c => c.id === item.id)) return prev;
      inserted = true;
      return [...prev, item];
    });
    if (!inserted) return;
    setItemQuantities(prev => ({
      ...prev,
      [item.id]: 1,
    }));
    setItemUnitPrices(prev => ({ ...prev, [item.id]: roundMoney2(initialUnit) }));
  }, [saleCurrency]);

  useEffect(() => {
    const hydrateQuickAdd = async () => {
      let inventoryItemId: number | null = null;
      try {
        const raw = sessionStorage.getItem(QUICK_ADD_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { inventory_item_id?: number };
        const n = Number(parsed?.inventory_item_id);
        if (Number.isFinite(n) && n > 0) inventoryItemId = n;
      } catch {
        // Ignore malformed payload.
      } finally {
        try {
          sessionStorage.removeItem(QUICK_ADD_STORAGE_KEY);
        } catch {
          // Ignore.
        }
      }
      if (!inventoryItemId) return;
      try {
        const res = await fetch(apiUrl(`/api/inventory/${inventoryItemId}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const item = (await res.json()) as InventoryItem;
        addToCart(item);
      } catch {
        // Silent fallback: page remains usable without quick-add prefill.
      }
    };
    void hydrateQuickAdd();
  }, [token, addToCart]);

  const removeFromCart = (id: number) => {
    setCart((prev) => prev.filter((c) => c.id !== id));
    setItemQuantities(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setItemUnitPrices(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setItemNotes(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setItemSoldCarats(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const setQtyForItem = (item: InventoryItem, raw: number) => {
    const maxPcs = maxPcsForItem(item);
    let q = Math.floor(Number(raw));
    if (!Number.isFinite(q) || q < 1) q = 1;
    if (q > maxPcs) q = maxPcs;
    setItemQuantities(prev => ({ ...prev, [item.id]: q }));
    if (lotNeedsSoldCaratsInput(item)) {
      setItemSoldCarats(prev => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const bumpQtyForItem = (item: InventoryItem, delta: number) => {
    const current = itemQuantities[item.id] ?? 1;
    setQtyForItem(item, current + delta);
  };

  const confirmItemModalAdd = () => {
    if (!itemModalTarget) return;
    const item = itemModalTarget;
    const maxPcs = maxPcsForItem(item);
    const safeQty = Math.max(1, Math.min(maxPcs, Math.floor(Number(itemModalQty) || 1)));
    let safeUnit = Math.max(0, roundMoney2(Number(itemModalUnitPrice) || 0));
    if (lotNeedsSoldCaratsInput(item)) {
      const soldCt = parseSoldCaratsInput(itemModalSoldCarats);
      const err = validateSoldCaratsForLot(item.weight_carats, soldCt);
      if (err) {
        showAlert({ title: 'Carat weight required', message: err, variant: 'warning' });
        return;
      }
      const listUnit = lotListUnitPerPiece(item, soldCt, safeQty);
      if (listUnit != null && safeUnit <= 0) safeUnit = listUnit;
    }
    if (!itemModalFromCartEdit) {
      addToCart(item);
    }
    setItemQuantities(prev => ({ ...prev, [item.id]: safeQty }));
    setItemUnitPrices(prev => ({ ...prev, [item.id]: safeUnit }));
    if (lotNeedsSoldCaratsInput(item)) {
      setItemSoldCarats(prev => ({ ...prev, [item.id]: itemModalSoldCarats.trim() }));
    } else {
      setItemSoldCarats(prev => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
    setItemModalOpen(false);
    setItemModalTarget(null);
    setItemModalFromCartEdit(false);
    setItemModalSoldCarats('');
    setSearch('');
  };

  const cartTotal = cart.reduce((sum, i) => sum + lineSubtotalGrossForItem(i), 0);
  const itemsDiscountTotal = cart.reduce((sum, item) => sum + lineDerivedItemDiscount(item), 0);
  const parsedDiscount = Number.isFinite(discountAmount) ? discountAmount : 0;
  const afterLineDiscount = Math.max(0, cartTotal - itemsDiscountTotal);
  const orderDiscountValue =
    discountType === 'pct'
      ? roundMoney2((afterLineDiscount * Math.max(0, parsedDiscount)) / 100)
      : Math.max(0, parsedDiscount);
  const finalTotalRaw = afterLineDiscount - orderDiscountValue;
  const finalTotal = finalTotalRaw > 0 ? finalTotalRaw : 0;
  const itemModalListUnit =
    itemModalTarget != null
      ? sellingUnitPrefillFromList(
          itemModalTarget,
          saleCurrency,
          itemModalQty,
          itemModalSoldCarats
        )
      : 0;
  const itemModalListLineGross =
    itemModalTarget != null
      ? lotListLineGross(itemModalTarget, parseSoldCaratsInput(itemModalSoldCarats))
      : null;
  const itemModalPiecesAvail =
    itemModalTarget != null ? rawPiecesAvailForItem(itemModalTarget) : 0;
  const itemModalDiscount = Math.max(
    0,
    roundMoney2(
      (itemModalListLineGross ?? itemModalListUnit * Math.max(1, itemModalQty)) -
        itemModalUnitPrice * Math.max(1, itemModalQty)
    )
  );
  const itemModalListBasis = itemModalListLineGross ?? itemModalListUnit * Math.max(1, itemModalQty);
  const itemModalDiscountPct =
    itemModalListBasis > 0 ? roundMoney2((itemModalDiscount / itemModalListBasis) * 100) : 0;
  const itemModalSubtotal = roundMoney2(Math.max(0, itemModalUnitPrice) * Math.max(1, itemModalQty));
  const itemModalPremium = Math.max(
    0,
    roundMoney2(itemModalUnitPrice * Math.max(1, itemModalQty) - itemModalListBasis)
  );
  const itemModalPremiumPct =
    itemModalListBasis > 0 ? roundMoney2((itemModalPremium / itemModalListBasis) * 100) : 0;
  const modalPriceDiff = roundMoney2(itemModalListBasis - itemModalUnitPrice * Math.max(1, itemModalQty));
  const modalShowSavingBanner = modalPriceDiff > 0.005;
  const modalShowAboveBanner = modalPriceDiff < -0.005;

  const handleNewCustomerChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNewCustomer(prev => ({ ...prev, [name]: value }));
  };

  /** Open printable sale invoice (same template as Payments / Memos). */
  const printInvoiceReceiptById = async (invoiceId: number) => {
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
      const msg = err instanceof Error ? err.message : 'Failed to open receipt';
      showAlert({ title: 'Could not open receipt', message: msg, variant: 'error' });
    }
  };

  const saveCustomer = async (): Promise<boolean> => {
    if (!newCustomer.name.trim()) {
      showAlert({
        title: 'Customer required',
        message: 'Customer name is required.',
        variant: 'warning',
      });
      return false;
    }
    try {
      setCustomerSaving(true);
      const res = await fetch(apiUrl('/api/customers'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newCustomer.name.trim(),
          phone: newCustomer.phone || null,
          email: newCustomer.email || null,
          notes: newCustomer.notes || null,
          address_line1: newCustomer.address_line1.trim() || null,
          address_line2: newCustomer.address_line2.trim() || null,
          city: newCustomer.city.trim() || null,
          postal_code: newCustomer.postal_code.trim() || null,
          country: newCustomer.country.trim() || null,
        }),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to save customer');
        throw new Error(msg);
      }
      const created: Customer = await res.json();
      setSelectedCustomer(created);
      setCustomers(prev => [created, ...prev]);
      setNewCustomer({
        name: '',
        phone: '',
        email: '',
        notes: '',
        address_line1: '',
        address_line2: '',
        city: '',
        postal_code: '',
        country: '',
      });
      showAlert({
        title: 'Customer saved',
        message: `${created.name} was added to your customers.`,
        variant: 'success',
      });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save customer';
      showAlert({ title: 'Could not save customer', message: msg, variant: 'error' });
      return false;
    } finally {
      setCustomerSaving(false);
    }
  };

  const applySaleCurrency = useCallback(
    (code: string) => {
      const next = normalizeCurrencyCode(code);
      setSaleCurrency(next);
      setItemUnitPrices(prev => {
        const nextPrices: Record<number, number> = {};
        for (const it of cart) {
          const q = itemQuantities[it.id] ?? 1;
          nextPrices[it.id] = sellingUnitPrefillFromList(it, next, q, itemSoldCarats[it.id]);
        }
        return nextPrices;
      });
    },
    [cart, itemQuantities, itemSoldCarats]
  );

  useEffect(() => {
    if (!ccModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCcModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ccModal]);

  const validateCartForInvoice = (): boolean => {
    if (cart.length === 0) {
      showAlert({
        title: 'No items',
        message: 'Add at least one item before creating an invoice.',
        variant: 'warning',
      });
      return false;
    }
    for (const item of cart) {
      if (!lotNeedsSoldCaratsInput(item)) continue;
      const soldCt = parseSoldCaratsInput(itemSoldCarats[item.id]);
      const err = validateSoldCaratsForLot(item.weight_carats, soldCt);
      if (err) {
        showAlert({
          title: 'Carat weight required',
          message: `${item.item_code || item.category || 'Item'}: ${err}`,
          variant: 'warning',
        });
        return false;
      }
    }
    return true;
  };

  const buildInvoiceItemsBody = () =>
    cart.map(item => {
      const soldCt = lotNeedsSoldCaratsInput(item) ? parseSoldCaratsInput(itemSoldCarats[item.id]) : null;
      return {
        inventory_item_id: item.id,
        price: lineApiUnitPriceForItem(item),
        quantity: itemQuantities[item.id] ?? 1,
        discount: lineDerivedItemDiscount(item),
        item_code: item.item_code,
        ...(soldCt != null ? { weight_carats: soldCt } : {}),
      };
    });

  const finalizeCreatedInvoice = async (
    created: ApiInvoice & {
      customer_id?: number | null;
      subtotal?: number;
      discount?: number;
    }
  ) => {
    const summary = mapApiInvoiceSummary(created);
    setInvoices(prev => [summary, ...prev]);
    setNextInvoiceNumber(n => n + 1);
    setInvoiceMessage(`Invoice ${summary.invoiceNo} created.`);
    const payLabel =
      summary.status === 'Paid'
        ? 'Payment recorded in full.'
        : summary.status === 'Partial'
          ? 'Partial payment recorded.'
          : 'You can record payment from checkout or Payments.';
    showAlert({
      title: 'Invoice created',
      message: `${summary.invoiceNo} is ready. ${payLabel}`,
      variant: 'success',
    });
    const createdLineViews: InvoiceCreatedLineView[] = cart.map(row => {
      const q = itemQuantities[row.id] ?? 1;
      const gross = lineSubtotalGrossForItem(row);
      const disc = lineDerivedItemDiscount(row);
      const net = lineSellTotalForItem(row);
      const label = row.item_code || `#${row.id}`;
      return { label, qty: q, gross, disc, net };
    });
    resetInvoice();
    setInvoiceCreatedLineOverride(createdLineViews);
    setCreatedInvoice(summary);
    setInvoiceCreatedOpen(true);
    await Promise.all([fetchAvailable(), fetchInvoices()]);

    const payments = Array.isArray(created.payments) ? created.payments : [];
    if (payments.length) {
      const payloads = paymentReceiptPayloadsFromRows({
        invoice_no: summary.invoiceNo,
        customer_name: created.customer_name,
        currency_code: summary.currencyCode,
        invoice_total: summary.total,
        payments,
      });
      void (async () => {
        await offerPaymentReceiptsPrint(showConfirm, payloads);
        if (summary.status === 'Paid') {
          await offerPaidInvoicePrint(showConfirm, summary.invoiceNo, () => printInvoiceReceiptById(summary.id));
        }
      })();
    }
  };

  const submitCreateInvoiceWithPayment = async (paymentIntent: InvoicePaymentIntentResult) => {
    setCreatingInvoice(true);
    setInvoiceMessage(null);
    try {
      const body = {
        customer_id: selectedCustomer ? selectedCustomer.id : null,
        discount: orderDiscountValue,
        currency_code: saleCurrency,
        items: buildInvoiceItemsBody(),
        payment_mode: paymentIntent.payment_mode,
        payments: paymentIntent.payments,
      };
      const res = await fetch(apiUrl('/api/invoices'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to create invoice');
        throw new Error(msg);
      }
      const created = (await res.json()) as ApiInvoice & {
        customer_id?: number | null;
        subtotal?: number;
        discount?: number;
      };
      setPaymentIntentOpen(false);
      await finalizeCreatedInvoice(created);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save invoice';
      showAlert({ title: 'Could not save invoice', message: msg, variant: 'error' });
    } finally {
      setCreatingInvoice(false);
    }
  };

  const createInvoice = async () => {
    if (!validateCartForInvoice()) return;

    if (editingInvoiceId == null) {
      setPaymentIntentOpen(true);
      return;
    }

    setCreatingInvoice(true);
    setInvoiceMessage(null);
    try {
      const body = {
        customer_id: selectedCustomer ? selectedCustomer.id : null,
        discount: orderDiscountValue,
        currency_code: saleCurrency,
        items: buildInvoiceItemsBody(),
      };

      const res = await fetch(apiUrl(`/api/invoices/${editingInvoiceId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to update invoice');
        throw new Error(msg);
      }
      const updated = (await res.json()) as ApiInvoice;
      const summary = mapApiInvoiceSummary(updated);
      setInvoices(prev => prev.map(row => (row.id === summary.id ? summary : row)));
      resetInvoice();
      setInvoiceMessage(`Invoice ${summary.invoiceNo} updated.`);
      showAlert({
        title: 'Invoice updated',
        message: `${summary.invoiceNo} was saved successfully.`,
        variant: 'success',
      });
      await fetchAvailable(search);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save invoice';
      showAlert({ title: 'Could not save invoice', message: msg, variant: 'error' });
    } finally {
      setCreatingInvoice(false);
    }
  };

  const handleSellingPayClick = (inv: InvoiceSummary) => {
    const remaining = roundMoney2(Math.max(0, inv.total - inv.paid));
    if (remaining <= 0) return;
    setInvoiceCreatedOpen(false);
    openInvoiceCheckout(inv.id);
  };

  const filteredInvoices = invoices.filter(inv => {
    const matchesSearch =
      !invoiceSearch.trim() ||
      inv.invoiceNo.toLowerCase().includes(invoiceSearch.trim().toLowerCase());
    const matchesStatus =
      invoiceStatusFilter === 'all' ? true : inv.status === invoiceStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const resetInvoice = () => {
    setCart([]);
    setItemQuantities({});
    setItemUnitPrices({});
    setItemNotes({});
    setItemSoldCarats({});
    setDiscountAmount(0);
    setDiscountType('pct');
    setSaleCurrency(SELLING_DEFAULT_CURRENCY);
    setSelectedCustomer(null);
    setCustomerSearch('');
    setCustomers([]);
    setSearch('');
    setInvoiceMessage(null);
    setDraftMessage(null);
    setEditingInvoiceId(null);
    setEditingInvoiceNo(null);
    setReservedPiecesOnEdit({});
  };

  const cancelInvoiceEdit = () => {
    resetInvoice();
    fetchAvailable(search);
  };

  const saveDraft = async () => {
    if (cart.length === 0) {
      showAlert({
        title: 'No items',
        message: 'Add at least one item before saving a draft.',
        variant: 'warning',
      });
      return;
    }
    setSavingDraft(true);
    setDraftMessage(null);
    try {
      const payload = {
        selectedCustomer,
        discountAmount,
        discountType,
        itemQuantities,
        itemUnitPrices,
        itemNotes,
        itemSoldCarats,
        cart,
        saleCurrency,
      };
      const res = await fetch(apiUrl('/api/selling/drafts'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ payload }),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to save draft');
        throw new Error(msg);
      }
      setDraftMessage('Draft saved.');
      showAlert({
        title: 'Draft saved',
        message: 'Your sale cart was saved. You can load it again with “Load draft”.',
        variant: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save draft';
      showAlert({ title: 'Could not save draft', message: msg, variant: 'error' });
    } finally {
      setSavingDraft(false);
    }
  };

  const loadLatestDraft = async () => {
    setLoadingDraft(true);
    setDraftMessage(null);
    try {
      const res = await fetch(apiUrl('/api/selling/drafts/latest'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 404) {
        showAlert({ title: 'No draft', message: 'No saved draft was found.', variant: 'info' });
        return;
      }
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load draft');
        throw new Error(msg);
      }
      const data: {
        id: number;
        payload: {
          selectedCustomer: Customer | null;
          discountAmount: number;
          discountType?: 'pct' | 'flat';
          itemQuantities?: Record<number, number>;
          itemUnitPrices?: Record<number, number>;
          itemNotes?: Record<number, string>;
          itemSoldCarats?: Record<number, string>;
          cart: InventoryItem[];
          saleCurrency?: string;
        };
      } = await res.json();
      const payload = data.payload || ({} as any);
      setSelectedCustomer(payload.selectedCustomer || null);
      setDiscountAmount(roundMoney2(Number(payload.discountAmount || 0)));
      setDiscountType(payload.discountType === 'flat' ? 'flat' : 'pct');
      const invoiceCur =
        payload.saleCurrency && typeof payload.saleCurrency === 'string'
          ? normalizeCurrencyCode(payload.saleCurrency)
          : SELLING_DEFAULT_CURRENCY;
      setSaleCurrency(invoiceCur);
      const rawCart: InventoryItem[] = Array.isArray(payload.cart) ? payload.cart : [];
      const savedQ =
        payload.itemQuantities && typeof payload.itemQuantities === 'object'
          ? (payload.itemQuantities as Record<number, number>)
          : {};
      const savedUnitPrices =
        payload.itemUnitPrices && typeof payload.itemUnitPrices === 'object'
          ? (payload.itemUnitPrices as Record<number, number>)
          : {};
      const savedNotes =
        payload.itemNotes && typeof payload.itemNotes === 'object'
          ? (payload.itemNotes as Record<number, string>)
          : {};
      const savedSoldCarats =
        payload.itemSoldCarats && typeof payload.itemSoldCarats === 'object'
          ? (payload.itemSoldCarats as Record<number, string>)
          : {};
      const nextQ: Record<number, number> = {};
      rawCart.forEach(it => {
        const maxP = Math.max(1, Math.floor(Number(it.pieces_remaining ?? it.pieces ?? 1)));
        const v = Math.floor(Number(savedQ[it.id]) || 1);
        nextQ[it.id] = Math.max(1, Math.min(maxP, Number.isFinite(v) ? v : 1));
      });
      setItemQuantities(nextQ);
      const nextUnitPrices: Record<number, number> = {};
      rawCart.forEach(it => {
        const saved = savedUnitPrices[it.id];
        if (saved != null && Number.isFinite(Number(saved))) {
          nextUnitPrices[it.id] = roundMoney2(Number(saved));
        } else {
          nextUnitPrices[it.id] = sellingUnitPrefillFromList(it, invoiceCur);
        }
      });
      setItemUnitPrices(nextUnitPrices);
      setItemNotes(savedNotes);
      setItemSoldCarats(savedSoldCarats);
      setCart(rawCart);
      setEditingInvoiceId(null);
      setEditingInvoiceNo(null);
      setReservedPiecesOnEdit({});
      setDraftMessage('Draft loaded.');
      showAlert({
        title: 'Draft loaded',
        message: 'Your saved sale cart was restored.',
        variant: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load draft';
      showAlert({ title: 'Could not load draft', message: msg, variant: 'error' });
    } finally {
      setLoadingDraft(false);
    }
  };

  /** Load invoice into the main composer (search, cart, customer, discounts) — no modal. */
  const beginInlineInvoiceEdit = async (inv: InvoiceSummary) => {
    if (inv.paid > 0) return;
    setInvoiceHydrateLoading(true);
    setDraftMessage(null);
    try {
      const res = await fetch(apiUrl(`/api/invoices/${inv.id}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load invoice');
        throw new Error(msg);
      }
      const data = (await res.json()) as InvoiceDetailForEdit;
      if (Number(data.paid || 0) > 0) {
        throw new Error('This invoice has payments and cannot be edited.');
      }

      const reserved: Record<number, number> = {};
      const cartRows: InventoryItem[] = [];
      const quantities: Record<number, number> = {};
      const unitPrices: Record<number, number> = {};
      const soldCarats: Record<number, string> = {};

      for (const line of data.items) {
        const invRes = await fetch(apiUrl(`/api/inventory/${line.inventory_item_id}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!invRes.ok) {
          const msg = await parseErrorResponse(invRes, 'Failed to load inventory item');
          throw new Error(msg);
        }
        const row = (await invRes.json()) as InventoryItem;
        cartRows.push(row);
        const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
        quantities[row.id] = qty;
        reserved[row.id] = qty;
        const lineTotal = Number(line.line_total || 0);
        unitPrices[row.id] = roundMoney2(qty > 0 ? lineTotal / qty : 0);
        const lineCt = (line as { weight_carats?: number | null }).weight_carats;
        if (lineCt != null && Number.isFinite(Number(lineCt)) && Number(lineCt) > 0) {
          soldCarats[row.id] = String(lineCt);
        }
      }

      let itemsDiscSum = 0;
      for (const line of data.items) {
        const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
        const lg = qty * Number(line.unit_price || 0);
        itemsDiscSum += Math.max(0, lg - Number(line.line_total || 0));
      }
      const orderDisc = Math.max(0, Number(data.discount ?? 0) - itemsDiscSum);

      setCart(cartRows);
      setItemQuantities(quantities);
      setItemUnitPrices(unitPrices);
      setItemSoldCarats(soldCarats);
      setDiscountAmount(orderDisc);
      setReservedPiecesOnEdit(reserved);
      setEditingInvoiceId(data.id);
      setEditingInvoiceNo(data.invoice_no);
      setSaleCurrency(data.currency_code || SELLING_DEFAULT_CURRENCY);

      if (data.customer_id != null) {
        const cRes = await fetch(apiUrl(`/api/customers/${data.customer_id}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cRes.ok) {
          const customerPayload = (await cRes.json()) as
            | Customer
            | { customer?: Customer | null };
          setSelectedCustomer(
            customerPayload && 'customer' in customerPayload
              ? customerPayload.customer || null
              : (customerPayload as Customer)
          );
        } else {
          setSelectedCustomer({
            id: data.customer_id,
            name: data.customer_name || 'Customer',
            phone: null,
            email: null,
            notes: null,
          });
        }
      } else {
        setSelectedCustomer(null);
      }
      setCustomerSearch('');
      setCustomers([]);

      window.setTimeout(() => {
        sellingComposerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load invoice for editing';
      showAlert({ title: 'Could not load invoice', message: msg, variant: 'error' });
    } finally {
      setInvoiceHydrateLoading(false);
    }
  };

  const confirmDeleteInvoice = async (inv: InvoiceSummary) => {
    if (inv.paid > 0) return;
    const ok = await showConfirm({
      title: 'Delete invoice?',
      message: `Delete ${inv.invoiceNo}? Sold pieces will be returned to inventory.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      setInvoicesError(null);
      const res = await fetch(apiUrl(`/api/invoices/${inv.id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to delete invoice');
        throw new Error(msg);
      }
      setInvoices(prev => prev.filter(i => i.id !== inv.id));
      if (inv.id === editingInvoiceId) {
        resetInvoice();
        fetchAvailable(search);
      }
      showAlert({
        title: 'Invoice deleted',
        message: `${inv.invoiceNo} was removed and stock was adjusted.`,
        variant: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete invoice';
      setInvoicesError(msg);
      showAlert({ title: 'Could not delete invoice', message: msg, variant: 'error' });
    }
  };

  const itemSuggestions =
    search.trim().length === 0
      ? []
      : availableItems
          .filter(it => {
            const q = search.trim().toLowerCase();
            const code = (it.item_code || '').toLowerCase();
            const cat = (it.category || '').toLowerCase();
            return code.includes(q) || cat.includes(q);
          })
          .slice(0, 8);

  const openItemModalWithItem = (item: InventoryItem, fromCartEdit: boolean) => {
    const q = fromCartEdit ? itemQuantities[item.id] ?? 1 : 1;
    const safeQty = Math.max(1, Math.floor(Number(q) || 1));
    const soldRaw = fromCartEdit ? itemSoldCarats[item.id] ?? '' : '';
    const defaultUnit = fromCartEdit
      ? lineSellUnitForItem(item)
      : sellingUnitPrefillFromList(item, saleCurrency, safeQty, soldRaw);
    itemModalUnitPriceManualRef.current = fromCartEdit;
    setItemModalFromCartEdit(fromCartEdit);
    setItemModalTarget(item);
    setItemModalQty(safeQty);
    setItemModalUnitPrice(defaultUnit);
    setItemModalSoldCarats(soldRaw);
    setItemModalOpen(true);
  };

  const addSuggestedItem = (item: InventoryItem) => {
    openItemModalWithItem(item, false);
  };

  const openItemModal = (item: InventoryItem) => {
    openItemModalWithItem(item, false);
  };

  const openItemModalEditFromCart = (item: InventoryItem) => {
    openItemModalWithItem(item, true);
  };

  const catalogItems = useMemo(() => {
    const items = [...availableItems];

    if (catalogFilter === 'all') {
      items.sort((a, b) => {
        const tb = inventoryTimestampMs(b.created_at ?? b.updated_at);
        const ta = inventoryTimestampMs(a.created_at ?? a.updated_at);
        return tb - ta;
      });
      return items;
    }

    /**
     * Top Sold & Recent: show items that sold most recently on an invoice first (last SALE movement).
     * Never-sold lines tie-break by inventory updated_at so the grid still feels ordered.
     */
    if (catalogFilter === 'top' || catalogFilter === 'recent') {
      items.sort((a, b) => {
        const tb = lastSaleAtMsFromSummary(b, inventoryActivitySummary);
        const ta = lastSaleAtMsFromSummary(a, inventoryActivitySummary);
        if (tb !== ta) return tb - ta;
        return (
          inventoryTimestampMs(b.updated_at ?? b.created_at) -
          inventoryTimestampMs(a.updated_at ?? a.created_at)
        );
      });
      return items.slice(0, CATALOG_TAB_PREVIEW_LIMIT);
    }

    return items;
  }, [availableItems, catalogFilter, inventoryActivitySummary]);

  /** Catalog column: viewport shows a taller card area before scrolling. */
  const sellingCatalogSectionRef = useRef<HTMLElement | null>(null);
  const sellingCatalogScrollRef = useRef<HTMLDivElement>(null);
  const sellingCatalogCardsRef = useRef<HTMLDivElement>(null);
  const [catalogScrollMaxPx, setCatalogScrollMaxPx] = useState<number | null>(null);

  const updateCatalogScrollMaxHeight = useCallback(() => {
    const section = sellingCatalogSectionRef.current;
    const scrollEl = sellingCatalogScrollRef.current;
    const grid = sellingCatalogCardsRef.current;
    if (!section || !scrollEl || !grid) {
      setCatalogScrollMaxPx(null);
      return;
    }
    const firstCard = grid.querySelector<HTMLElement>('.selling-pos-card');
    if (!firstCard) {
      setCatalogScrollMaxPx(null);
      return;
    }
    const gStyle = getComputedStyle(grid);
    const gapRaw = gStyle.rowGap && gStyle.rowGap !== 'normal' ? gStyle.rowGap : gStyle.gap;
    const gap = Math.max(0, parseFloat(String(gapRaw).replace('px', '')) || 12);
    const colStr = gStyle.gridTemplateColumns;
    const nCols = Math.max(1, colStr.split(/\s+/).filter(Boolean).length);
    const rows = Math.ceil(CATALOG_VISIBLE_SLOTS / nCols);
    const cardH = firstCard.getBoundingClientRect().height;
    const slotBlock = rows * cardH + (rows - 1) * gap;
    const sectionRect = section.getBoundingClientRect();
    const scrollRect = scrollEl.getBoundingClientRect();
    const available = Math.max(0, sectionRect.bottom - scrollRect.top);
    const h = available > 8 ? Math.min(slotBlock, available) : slotBlock;
    setCatalogScrollMaxPx(Math.max(120, Math.ceil(h)));
  }, []);

  useLayoutEffect(() => {
    updateCatalogScrollMaxHeight();
  }, [updateCatalogScrollMaxHeight, catalogItems, search, catalogFilter]);

  useEffect(() => {
    const section = sellingCatalogSectionRef.current;
    if (!section) return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => updateCatalogScrollMaxHeight()));
    });
    ro.observe(section);
    return () => ro.disconnect();
  }, [updateCatalogScrollMaxHeight]);

  useEffect(() => {
    const grid = sellingCatalogCardsRef.current;
    if (!grid) return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => updateCatalogScrollMaxHeight());
    });
    ro.observe(grid);
    return () => ro.disconnect();
  }, [updateCatalogScrollMaxHeight, catalogItems.length]);

  const cartQtyById = cart.reduce<Record<number, number>>((acc, item) => {
    acc[item.id] = itemQuantities[item.id] ?? 1;
    return acc;
  }, {});

  const invoiceCreatedModalLineViews: InvoiceCreatedLineView[] =
    invoiceCreatedLineOverride ??
    cart.map(row => {
      const q = itemQuantities[row.id] ?? 1;
      const gross = lineSubtotalGrossForItem(row);
      const disc = lineDerivedItemDiscount(row);
      const net = lineSellTotalForItem(row);
      const label = row.item_code || `#${row.id}`;
      return { label, qty: q, gross, disc, net };
    });

  const invoiceCreatedModalItemsPcs = invoiceCreatedModalLineViews.reduce((n, l) => n + l.qty, 0);
  const invoiceCreatedModalLineCount = invoiceCreatedModalLineViews.length;

  return (
    <div className="page page-selling">
      {editingInvoiceId != null && editingInvoiceNo && (
        <div className="selling-inline-edit-banner" role="status">
          <div className="selling-inline-edit-banner-inner">
            <span>
              Editing <strong>{editingInvoiceNo}</strong> — add or remove items, change quantities or unit prices, then click{' '}
              <strong>Update invoice</strong>.
            </span>
            <button type="button" className="selling-inline-edit-cancel" onClick={cancelInvoiceEdit}>
              Cancel edit
            </button>
          </div>
        </div>
      )}
      {invoiceHydrateLoading && (
        <div className="selling-inline-edit-loading" aria-live="polite">
          Loading invoice into editor…
        </div>
      )}

      {view === 'compose' && (
        <div className="selling2-grid selling-pos-grid selling-pos-composer" ref={sellingComposerRef}>
          <section className="selling-pos-catalog" ref={sellingCatalogSectionRef}>
          <div className="selling-pos-topbar">
            <div className="selling-pos-search-inline">
              <div className="selling2-search selling2-search--gem">
                <span className="selling2-search-icon" aria-hidden="true">
                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                </span>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="selling2-search-input"
                  placeholder="Search by name, code, or category..."
                />
              </div>
            </div>
            <div className="selling-pos-tabs" role="tablist" aria-label="Catalog filters">
              {([
                ['all', 'All'],
                ['top', 'Top Sold'],
                ['recent', 'Recent'],
              ] as const).map(([id, label]) => {
                const active = catalogFilter === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`selling-pos-tab${active ? ' is-active' : ''}`}
                    onClick={() => setCatalogFilter(id)}
                    role="tab"
                    aria-selected={active}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          {search.trim() && itemSuggestions.length > 0 && (
            <div className="selling-pos-suggest-inline">
              {itemSuggestions.map(it => (
                <button key={it.id} type="button" className="selling-pos-suggest-chip" onClick={() => addSuggestedItem(it)}>
                  {it.item_code || `#${it.id}`}
                </button>
              ))}
            </div>
          )}

          {catalogItems.length === 0 ? (
            <div className="selling-pos-catalog-body selling-pos-catalog-body--empty">
              <div className="selling2-empty selling2-empty--gem">
                <div className="selling2-empty-title">No available items</div>
                <div className="selling2-empty-sub">Try another search or category filter.</div>
              </div>
            </div>
          ) : (
            <div
              className="selling-pos-catalog-body"
              ref={sellingCatalogScrollRef}
              style={catalogScrollMaxPx != null ? { maxHeight: catalogScrollMaxPx } : undefined}
            >
              <div className="selling-pos-cards" ref={sellingCatalogCardsRef}>
              {catalogItems.map(it => {
                const codeLabel = it.item_code || `#${it.id}`;
                const itemLabel = it.category || codeLabel;
                const inCart = cart.some(c => c.id === it.id);
                const addedQty = cartQtyById[it.id] || 0;
                const avail = rawPiecesAvailForItem(it);
                const imgSrc = getImageSrc(it.image_path);
                const showPlaceholder = !imgSrc || cartImageLoadFailed.has(it.id);
                return (
                  <article key={it.id} className={`selling-pos-card${inCart ? ' is-in-cart' : ''}`}>
                    <div className="selling-pos-card-media">
                      {imgSrc && !cartImageLoadFailed.has(it.id) ? (
                        <img
                          className="selling-pos-card-image"
                          src={imgSrc}
                          alt={codeLabel}
                          loading="lazy"
                          onError={() => setCartImageLoadFailed(prev => new Set(prev).add(it.id))}
                        />
                      ) : null}
                      {showPlaceholder ? <span className="selling2-item-thumb-placeholder">No img</span> : null}
                      <span className={`selling-pos-stock-badge${avail > 0 ? ' is-available' : ''}`}>
                        {avail > 0 ? `Available · ${avail} pcs` : 'Out of stock'}
                      </span>
                    </div>
                    <div className="selling-pos-card-body">
                      <div className="selling-pos-card-code">{codeLabel}</div>
                      <strong className="selling-pos-card-title">{itemLabel}</strong>
                      <div className="selling-pos-card-sub">
                        {(it.item_type || 'Item').replace(/_/g, ' ')}
                        {it.weight_carats != null ? ` · ${it.weight_carats} ct` : ''}
                      </div>
                      <div className="selling-pos-card-price-row">
                        <span className="selling-pos-card-price">
                          {formatUsdOnlyFromAny(
                            Number(it.selling_total_price ?? 0),
                            it.selling_currency ?? DEFAULT_CURRENCY_CODE,
                            thbPerUnit
                          )}
                        </span>
                        <span className="selling-pos-card-currency">USD</span>
                      </div>
                      <button
                        type="button"
                        className={`selling-pos-card-add${inCart ? ' is-in-cart' : ''}`}
                        onClick={() => openItemModal(it)}
                        disabled={avail <= 0}
                      >
                        {!inCart ? 'Add to Cart' : `Add More (${addedQty})`}
                      </button>
                    </div>
                  </article>
                );
              })}
              </div>
            </div>
          )}
          </section>

          <section className="selling-pos-summary" aria-label="Current order">
            <div className="selling-pos-summary-head">
              <h3>Current Order</h3>
              <span className="selling-pos-order-count-pill" aria-label={`${cart.reduce((sum, item) => sum + (itemQuantities[item.id] ?? 1), 0)} items`}>
                {cart.length === 0
                  ? '0 items'
                  : `${cart.reduce((sum, item) => sum + (itemQuantities[item.id] ?? 1), 0)} ${
                      cart.reduce((s, i) => s + (itemQuantities[i.id] ?? 1), 0) === 1 ? 'item' : 'items'
                    }`}
              </span>
            </div>

            <div className="selling-pos-cc selling-pos-cc--bar">
              <div className="selling-pos-cc-row">
                <div className="selling-pos-cc-pair">
                  <button
                    type="button"
                    className="selling-pos-cc-btn"
                    onClick={() => setCcModal('customer')}
                  >
                    <IconCcUser />
                    <span
                      className={`selling-pos-cc-btn-text${selectedCustomer ? '' : ' is-placeholder'}`}
                      title={selectedCustomer ? selectedCustomer.name : undefined}
                    >
                      {selectedCustomer ? selectedCustomer.name : 'Add customer'}
                    </span>
                  </button>
                  {selectedCustomer && (
                    <button
                      type="button"
                      className="selling-pos-cc-inline-clear"
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedCustomer(null);
                      }}
                      aria-label="Remove customer"
                      title="Remove customer"
                    >
                      <IconX size={14} />
                    </button>
                  )}
                </div>
                <div className="selling-pos-cc-pair">
                  <button type="button" className="selling-pos-cc-btn" onClick={() => setCcModal('currency')}>
                    <IconCcCurrency />
                    <span
                      className="selling-pos-cc-btn-text"
                      title={
                        SUPPORTED_CURRENCIES.find(c => c.code === normalizeCurrencyCode(saleCurrency))?.label ?? saleCurrency
                      }
                    >
                      {SUPPORTED_CURRENCIES.find(c => c.code === normalizeCurrencyCode(saleCurrency))?.label ?? saleCurrency}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <div className="selling-pos-cart-scroll">
              <div className="selling-pos-cart-lines">
              {cart.length === 0 ? (
                <div className="selling-pos-cart-empty">No items in the bill yet.</div>
              ) : (
                cart.map(it => {
                const qty = itemQuantities[it.id] ?? 1;
                const maxPcs = maxPcsForItem(it);
                const lineNet = lineSellTotalForItem(it);
                const lineDiscount = lineDerivedItemDiscount(it);
                const imgSrc = getImageSrc(it.image_path);
                const showPlaceholder = !imgSrc || cartImageLoadFailed.has(it.id);
                const codeLabel = it.item_code || `#${it.id}`;
                const displayName = (it.category || codeLabel).replace(/_/g, ' ');
                const typeCtLabel = `${(it.item_type || 'item').replace(/_/g, ' ').toLowerCase()}${soldCaratsCartSuffix(
                  itemSoldCarats[it.id],
                  it.weight_carats
                )}`;
                return (
                  <div key={it.id} className="selling-pos-line">
                    <div className="selling-pos-line-thumb">
                      {imgSrc && !cartImageLoadFailed.has(it.id) ? (
                        <img
                          className="selling2-item-thumb"
                          src={imgSrc}
                          alt=""
                          loading="lazy"
                          onError={() => setCartImageLoadFailed(prev => new Set(prev).add(it.id))}
                        />
                      ) : null}
                      {showPlaceholder ? <span className="selling2-item-thumb-placeholder">No img</span> : null}
                    </div>
                    <div className="selling-pos-line-main">
                      <div className="selling-pos-line-head">
                        <div className="selling-pos-line-name">{displayName}</div>
                        <div className="selling-pos-line-meta">
                          <span className="selling-pos-line-name-prefix">{typeCtLabel}</span>
                        </div>
                      </div>
                      <div className="selling-pos-line-code-wrap">
                        <span className="selling-pos-line-meta-badge">{codeLabel}</span>
                      </div>
                      <div className="selling-pos-line-price-row">
                        <span className="selling-pos-line-unit">{formatMoneyAmount(lineSellUnitForItem(it), saleCurrency)}</span>
                        {lineDiscount > 0 ? (
                          <span className="selling-pos-line-discount">-{formatMoneyAmount(lineDiscount, saleCurrency)} off</span>
                        ) : null}
                      </div>
                      {itemNotes[it.id] ? <div className="selling-pos-line-note">Note added</div> : null}
                      <div className="selling-pos-line-controls">
                        <button type="button" onClick={() => bumpQtyForItem(it, -1)} disabled={qty <= 1}>−</button>
                        <input
                          type="number"
                          value={qty}
                          min={1}
                          max={maxPcs}
                          step={1}
                          onChange={e => setQtyForItem(it, Number(e.target.value))}
                        />
                        <button type="button" onClick={() => bumpQtyForItem(it, 1)} disabled={qty >= maxPcs}>+</button>
                        <span className="selling-pos-line-equals">= {formatMoneyAmount(lineNet, saleCurrency)}</span>
                      </div>
                    </div>
                    <div className="selling-pos-line-side">
                      <GuardedAmountNumberInput
                        id={`sell-line-unit-${it.id}`}
                        className="selling2-unit-price-input"
                        value={lineSellUnitForItem(it)}
                        min={0}
                        step={0.01}
                        title={`Unit price (${saleCurrency})`}
                        onChange={e =>
                          setItemUnitPrices(prev => ({
                            ...prev,
                            [it.id]: Math.max(0, roundMoney2(parseMoneyInput(e.target.value))),
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="selling-pos-line-action"
                        onClick={() => openItemModalEditFromCart(it)}
                        aria-label="Edit line details"
                        title="Edit line details"
                      >
                        <IconEdit />
                      </button>
                      <button type="button" className="selling2-trash" onClick={() => removeFromCart(it.id)} aria-label="Remove">
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                );
                })
              )}
            </div>
            </div>

            <div className="selling-pos-summary-foot">
            <div className="selling-pos-summary-math">
              <div className="selling2-summary-row"><span>Subtotal</span><strong>{formatMoneyAmount(cartTotal, saleCurrency)}</strong></div>
              <div className="selling2-summary-row"><span>Line discount</span><span className="selling2-neg">−{formatMoneyAmount(itemsDiscountTotal, saleCurrency)}</span></div>
              <div className="selling2-summary-row">
                <span>Order discount</span>
                <div className="selling-pos-order-discount-input">
                  <GuardedAmountNumberInput
                    value={discountAmount}
                    onChange={e => setDiscountAmount(parseMoneyInput(e.target.value))}
                    min={0}
                  />
                  <div className="selling-pos-discount-type">
                    <button
                      type="button"
                      className={discountType === 'pct' ? 'is-active' : ''}
                      onClick={() => setDiscountType('pct')}
                    >
                      %
                    </button>
                    <button
                      type="button"
                      className={discountType === 'flat' ? 'is-active' : ''}
                      onClick={() => setDiscountType('flat')}
                    >
                      {saleCurrency}
                    </button>
                  </div>
                </div>
              </div>
              <div className="selling-pos-total-row">
                <span>Net total</span>
                <strong>{formatMoneyAmount(finalTotal, saleCurrency)}</strong>
              </div>
            </div>

            {draftMessage && <div className="selling-state selling2-draft-message">{draftMessage}</div>}

            <button
              type="button"
              className="selling2-btn-primary"
              onClick={createInvoice}
              disabled={creatingInvoice || cart.length === 0 || invoiceHydrateLoading}
            >
              {creatingInvoice
                ? editingInvoiceId
                  ? 'Updating…'
                  : 'Creating…'
                : editingInvoiceId
                  ? 'Update invoice'
                  : 'Create Invoice'}
            </button>

            <div className="selling2-draft-actions selling2-gem-btn-row">
              <button type="button" className="selling2-draft-btn selling2-draft-btn--new" onClick={resetInvoice}>
                New Bill
              </button>
              <button
                type="button"
                className="selling2-draft-btn selling2-draft-btn--save"
                onClick={saveDraft}
                disabled={savingDraft || cart.length === 0 || editingInvoiceId != null}
                title={editingInvoiceId != null ? 'Save draft is disabled while editing an invoice' : undefined}
              >
                {savingDraft ? 'Saving…' : 'Save Draft'}
              </button>
              <button
                type="button"
                className="selling2-draft-btn selling2-draft-btn--load"
                onClick={loadLatestDraft}
                disabled={loadingDraft}
              >
                {loadingDraft ? 'Loading…' : 'Load Draft'}
              </button>
            </div>
            </div>
          </section>
          </div>
      )}

      {view === 'invoices' && (
      <section className="selling-invoices-card selling-invoices-gem" id="selling-invoice-section">
        <header className="selling-invoices-gem-head">
          <div className="selling-invoices-gem-head-top">
            <div className="selling-invoices-gem-title-group">
              <div className="selling-invoices-gem-title-icon" aria-hidden="true">
                <IconInvoiceDoc />
              </div>
              <h3 className="selling-invoices-gem-title">Recent Invoices</h3>
              <span className="selling-invoices-gem-count" aria-label={`${invoices.length} invoices`}>
                {loadingInvoices ? '…' : invoices.length}
              </span>
            </div>
            <div className="selling-invoices-gem-search-wrap">
              <span className="selling-invoices-gem-search-icon" aria-hidden="true">
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </span>
              <input
                type="search"
                className="selling-invoices-gem-search"
                placeholder="Search by invoice number…"
                value={invoiceSearch}
                onChange={e => setInvoiceSearch(e.target.value)}
              />
            </div>
            <button type="button" className="selling2-btn-primary selling-invoices-create-btn" onClick={() => onChangeView?.('compose')}>
              Create Invoice
            </button>
          </div>
          <div className="selling-invoices-gem-tabs" role="tablist" aria-label="Invoice status filters">
            {(
              [
                ['all', 'all', 'All'],
                ['unpaid', 'Unpaid', 'Unpaid'],
                ['partial', 'Partial', 'Partial'],
                ['paid', 'Paid', 'Paid'],
              ] as const
            ).map(([dataFilter, value, label]) => {
              const active = invoiceStatusFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  className={`selling-invoices-gem-tab${active ? ' is-active' : ''}`}
                  data-filter={dataFilter}
                  onClick={() => setInvoiceStatusFilter(value)}
                  role="tab"
                  aria-selected={active}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </header>

        {invoicesError && (
          <div className="selling-invoices-gem-error selling-state selling-state-error">
            <p>{invoicesError}</p>
          </div>
        )}

        <div className="selling-invoices-table-wrap selling-invoices-gem-table-wrap">
          <table className="selling-invoices-table" aria-label="Invoices">
            <thead>
              <tr>
                <th scope="col">Invoice #</th>
                <th scope="col">Date</th>
                <th scope="col">Customer</th>
                <th scope="col">Total</th>
                <th scope="col">Paid</th>
                <th scope="col">Balance</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadingInvoices ? (
                <tr>
                  <td colSpan={8} className="selling-empty-cell">
                    Loading invoices…
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="selling-empty-cell">
                    No invoices yet. Create an invoice above to see it here.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map(inv => {
                  const remaining = inv.total - inv.paid;
                  const hasLoan = remaining > 0;
                  return (
                    <tr key={inv.id}>
                      <td className="selling-invoice-id">{inv.invoiceNo}</td>
                      <td className="selling-invoice-date">{dateFromServerUtc(inv.createdAt).toLocaleDateString()}</td>
                      <td className="selling-invoice-customer">{inv.customerName}</td>
                      <td className="selling-invoice-total">
                        {formatMoneyAmount(inv.total, inv.currencyCode)}
                      </td>
                      <td>
                        <span className="selling-invoice-paid">
                          {formatMoneyAmount(inv.paid, inv.currencyCode)}
                        </span>
                      </td>
                      <td>
                        {hasLoan ? (
                          <span className="selling-invoice-balance">
                            {formatMoneyAmount(remaining, inv.currencyCode)}
                          </span>
                        ) : (
                          <span className="selling-invoice-balance-zero">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`selling-invoice-status selling-invoice-status--${inv.status.toLowerCase()}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="selling-invoice-actions">
                        <div className="selling-invoice-actions-inner">
                          <button
                            type="button"
                            className="selling-invoice-action-btn selling-invoice-action-btn--pay"
                            title={hasLoan ? `Pay ${inv.invoiceNo}` : 'Fully paid — no balance'}
                            aria-label={hasLoan ? `Pay ${inv.invoiceNo}` : `Fully paid — ${inv.invoiceNo}`}
                            disabled={!hasLoan}
                            onClick={() => handleSellingPayClick(inv)}
                          >
                            <IconCreditCard />
                          </button>
                          <button
                            type="button"
                            className="selling-invoice-action-btn selling-invoice-action-btn--edit"
                            title={
                              inv.paid > 0
                                ? 'Cannot edit — invoice has payments'
                                : `Edit ${inv.invoiceNo}`
                            }
                            disabled={inv.paid > 0 || invoiceHydrateLoading}
                            onClick={() => {
                              onChangeView?.('compose');
                              beginInlineInvoiceEdit(inv);
                            }}
                          >
                            <IconEdit />
                          </button>
                          <button
                            type="button"
                            className="selling-invoice-action-btn selling-invoice-action-btn--print"
                            title={`Print receipt — ${inv.invoiceNo}`}
                            onClick={() => printInvoiceReceiptById(inv.id)}
                          >
                            <IconPrinter />
                          </button>
                          <button
                            type="button"
                            className="selling-invoice-action-btn selling-invoice-action-btn--delete"
                            title={
                              inv.paid > 0
                                ? 'Cannot delete — invoice has payments'
                                : `Delete ${inv.invoiceNo}`
                            }
                            disabled={inv.paid > 0}
                            onClick={() => confirmDeleteInvoice(inv)}
                          >
                            <IconDelete />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {checkoutOpen && (
        <div
          className="pay-checkout-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Invoice checkout"
          onMouseDown={e => {
            if (e.target === e.currentTarget) closeCheckout();
          }}
        >
          <div className="pay-checkout-modal" onMouseDown={e => e.stopPropagation()}>
            <InvoiceCheckoutPage token={token} embedded onNavigate={() => closeCheckout()} />
          </div>
        </div>
      )}

      {itemModalOpen && itemModalTarget && (
        <div className="selling2-modal-overlay" role="dialog" aria-modal="true">
          <div className="selling2-modal selling-pos-item-modal">
            <header className="selling-pos-item-modal-header">
              <div className="selling-pos-item-modal-header-left">
                <div className="selling-pos-item-modal-header-icon" aria-hidden="true">
                  <IconGemModal />
                </div>
                <div>
                  <div className="selling-pos-item-modal-header-title">Item Details</div>
                  <div className="selling-pos-item-modal-header-sub">Point of Sale</div>
                </div>
              </div>
              <button
                type="button"
                className="selling-pos-item-modal-close-btn"
                onClick={() => {
                  setItemModalOpen(false);
                  setItemModalTarget(null);
                  setItemModalFromCartEdit(false);
                }}
                aria-label="Close"
              >
                <IconX size={14} />
              </button>
            </header>
            <div className="selling2-modal-body selling-pos-item-modal-body">
              <section className="selling-pos-item-modal-gem">
                <div className="selling-pos-item-modal-thumb">
                  {getImageSrc(itemModalTarget.image_path) ? (
                    <img src={getImageSrc(itemModalTarget.image_path)} alt="" />
                  ) : (
                    <span className="selling-pos-item-modal-thumb-ph" aria-hidden="true">
                      💎
                    </span>
                  )}
                </div>
                <div className="selling-pos-item-modal-gem-main">
                  <h4 className="selling-pos-item-modal-name">
                    {(itemModalTarget.category || 'Item').replace(/_/g, ' ')}
                  </h4>
                  <div className="selling-pos-item-modal-tags">
                    <span className="selling-pos-item-modal-tag">
                      Type <b>{(itemModalTarget.item_type || '—').replace(/_/g, ' ')}</b>
                    </span>
                    <span className="selling-pos-item-modal-tag selling-pos-item-modal-tag--hi">
                      Carat{' '}
                      <b>{itemModalTarget.weight_carats != null ? `${itemModalTarget.weight_carats} ct` : '—'}</b>
                    </span>
                    <span
                      className={`selling-pos-item-modal-tag selling-pos-item-modal-tag--stock${
                        itemModalPiecesAvail > 0 ? ' is-in-stock' : ' is-out-of-stock'
                      }`}
                    >
                      {itemModalPiecesAvail > 0 ? (
                        <>
                          Available · <b>{itemModalPiecesAvail} pcs</b>
                        </>
                      ) : (
                        <b>Out of stock</b>
                      )}
                    </span>
                  </div>
                </div>
                <div className="selling-pos-item-modal-code-aside" aria-label="Item code">
                  <span className="selling-pos-item-modal-code-badge">
                    {itemModalTarget.item_code ? itemModalTarget.item_code : `#${itemModalTarget.id}`}
                  </span>
                </div>
              </section>

              <section className="selling-pos-item-modal-pricing">
                <div className="selling-pos-item-modal-eyebrow">Pricing</div>
                <div className="selling-pos-item-modal-price-grid selling-pos-item-modal-price-grid--single">
                  <div className="selling-pos-item-modal-price-cell">
                    <div className="selling-pos-item-modal-price-cell-label">
                      {itemModalTarget && lotNeedsSoldCaratsInput(itemModalTarget)
                        ? 'List price (this sale)'
                        : 'Selling Price'}
                    </div>
                    <div className="selling-pos-item-modal-price-cell-value selling-pos-item-modal-price-cell-value--sell">
                      {itemModalListLineGross != null
                        ? formatMoneyAmount(itemModalListLineGross, saleCurrency)
                        : formatMoneyAmount(itemModalListUnit, saleCurrency)}
                    </div>
                    {itemModalTarget &&
                    lotNeedsSoldCaratsInput(itemModalTarget) &&
                    itemModalTarget.selling_carat_price != null &&
                    Number(itemModalTarget.selling_carat_price) > 0 ? (
                      <div className="selling-pos-item-modal-carats-hint">
                        {formatMoneyAmount(Number(itemModalTarget.selling_carat_price), saleCurrency)}/ct
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="selling-pos-item-modal-unit-row">
                  <div className="selling-pos-item-modal-unit-label">
                    <IconEdit />
                    <span>
                      {itemModalTarget && lotNeedsSoldCaratsInput(itemModalTarget)
                        ? 'Price per pc'
                        : 'Unit Price'}
                    </span>
                  </div>
                  <div className="selling-pos-item-modal-unit-input-wrap">
                    <span className="selling-pos-item-modal-unit-currency">{currencySymbolFor(saleCurrency)}</span>
                    <GuardedAmountNumberInput
                      ref={itemModalUnitPriceInputRef}
                      className="selling-pos-item-modal-unit-input"
                      value={itemModalUnitPrice}
                      min={0}
                      step={0.01}
                      onChange={e => {
                        itemModalUnitPriceManualRef.current = true;
                        setItemModalUnitPrice(Math.max(0, parseMoneyInput(e.target.value)));
                      }}
                      aria-label={`Unit price (${saleCurrency})`}
                    />
                  </div>
                </div>

                {modalShowSavingBanner ? (
                  <div className="selling-pos-item-modal-savings selling-pos-item-modal-savings--save">
                    <div className="selling-pos-item-modal-savings-left">
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                        <line x1="7" y1="7" x2="7.01" y2="7" />
                      </svg>
                      <span>Saving {formatMoneyAmount(itemModalDiscount, saleCurrency)}</span>
                    </div>
                    <span className="selling-pos-item-modal-savings-pct">{itemModalDiscountPct}% off</span>
                  </div>
                ) : null}
                {modalShowAboveBanner ? (
                  <div className="selling-pos-item-modal-savings selling-pos-item-modal-savings--above">
                    <div className="selling-pos-item-modal-savings-left">
                      <span>
                        {formatMoneyAmount(itemModalPremium, saleCurrency)} above list
                      </span>
                    </div>
                    <span className="selling-pos-item-modal-savings-pct">+{itemModalPremiumPct}%</span>
                  </div>
                ) : null}
              </section>

              {itemModalTarget && lotNeedsSoldCaratsInput(itemModalTarget) ? (
                <section className="selling-pos-item-modal-pricing">
                  <div className="selling-pos-item-modal-unit-row">
                    <div className="selling-pos-item-modal-unit-label">
                      <span>Carats sold</span>
                    </div>
                    <div className="selling-pos-item-modal-unit-input-wrap">
                      <GuardedAmountNumberInput
                        className="selling-pos-item-modal-unit-input"
                        value={itemModalSoldCarats}
                        min={0}
                        step={0.001}
                        placeholder="0.000"
                        onChange={e => {
                          itemModalUnitPriceManualRef.current = false;
                          setItemModalSoldCarats(e.target.value);
                        }}
                        aria-label="Total carat weight for pieces being sold"
                      />
                      <span className="selling-pos-item-modal-unit-currency">ct</span>
                    </div>
                  </div>
                  <p className="selling-pos-item-modal-carats-hint">
                    Enter total weight for {itemModalQty} pc{itemModalQty === 1 ? '' : 's'} (lot has{' '}
                    {itemModalTarget.weight_carats} ct remaining).
                  </p>
                </section>
              ) : null}

              <section className="selling-pos-item-modal-bottom">
                <div className="selling-pos-item-modal-qty-row">
                  <span className="selling-pos-item-modal-qty-label">Quantity</span>
                  <div className="selling-pos-item-modal-stepper">
                    <button
                      type="button"
                      className="selling-pos-item-modal-step-btn"
                      onClick={() => setItemModalQty(prev => Math.max(1, prev - 1))}
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="selling-pos-item-modal-step-sep" aria-hidden="true" />
                    <span className="selling-pos-item-modal-step-val">{itemModalQty}</span>
                    <span className="selling-pos-item-modal-step-sep" aria-hidden="true" />
                    <button
                      type="button"
                      className="selling-pos-item-modal-step-btn"
                      onClick={() =>
                        setItemModalQty(prev =>
                          Math.min(maxPcsForItem(itemModalTarget), prev + 1)
                        )
                      }
                      disabled={itemModalQty >= maxPcsForItem(itemModalTarget)}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="selling-pos-item-modal-subtotal-bar">
                  <span className="selling-pos-item-modal-subtotal-label">Subtotal</span>
                  <span className="selling-pos-item-modal-subtotal-value">
                    {formatMoneyAmount(itemModalSubtotal, saleCurrency)}
                  </span>
                </div>
              </section>
            </div>
            <footer className="selling2-modal-footer selling-pos-item-modal-footer">
              <button
                type="button"
                className="selling-pos-item-modal-btn selling-pos-item-modal-btn--cancel"
                onClick={() => {
                  setItemModalOpen(false);
                  setItemModalTarget(null);
                  setItemModalFromCartEdit(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="selling-pos-item-modal-btn selling-pos-item-modal-btn--add"
                onClick={confirmItemModalAdd}
                aria-label={itemModalFromCartEdit ? 'Save changes' : 'Add to cart'}
              >
                {itemModalFromCartEdit ? <IconCheck /> : <IconCartModal />}
                {itemModalFromCartEdit ? 'Save changes' : 'Add to Cart'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {ccModal === 'customer' && (
        <div
          className="selling2-modal-overlay selling-pos-cc-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="selling-cc-customer-title"
          onClick={() => setCcModal(null)}
        >
          <div
            className="selling2-modal selling-pos-cc-modal selling-pos-cc-modal--pickers selling-pos-cc-modal--customer"
            onClick={e => e.stopPropagation()}
          >
            <div className="selling2-modal-header selling-pos-cc-modal-head selling-pos-cc-modal-head--customer">
              <div className="selling-pos-cc-modal-head-main">
                <span className="selling-pos-cc-modal-head-icon" aria-hidden="true">
                  <IconCcUser />
                </span>
                <div>
                  <h3 id="selling-cc-customer-title">Select customer</h3>
                  <p className="selling-pos-cc-modal-head-sub">Search your list or add someone new</p>
                </div>
              </div>
              <button
                type="button"
                className="selling2-modal-close selling-pos-cc-modal-close"
                onClick={() => setCcModal(null)}
                aria-label="Close"
              >
                <IconX />
              </button>
            </div>
            <div className="selling2-modal-body selling-pos-cc-modal-body">
              <label className="selling-pos-cc-modal-search-label" htmlFor="selling-cc-customer-search">
                Find customer
              </label>
              <div className="selling2-customer-search selling2-customer-search--gem selling-pos-cc-modal-search">
                <span className="selling2-search-icon" aria-hidden="true">
                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                </span>
                <input
                  id="selling-cc-customer-search"
                  type="search"
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  className="selling2-search-input"
                  placeholder="Name or phone number…"
                  autoFocus
                />
              </div>
              <div className="selling-pos-cc-modal-list selling-pos-cc-modal-list--customers">
                {customers.length === 0 ? (
                  <div className="selling-pos-cc-modal-empty">
                    <span className="selling-pos-cc-modal-empty-icon selling-pos-cc-modal-empty-icon--users" aria-hidden="true">
                      <IconNewCustomerUser />
                    </span>
                    <strong className="selling-pos-cc-modal-empty-title">No customers to show</strong>
                    <p className="selling-pos-cc-modal-empty-text">
                      Type in the search box above to find an existing customer.
                    </p>
                  </div>
                ) : (
                  customers.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      className="selling-pos-cc-customer-option"
                      onClick={() => {
                        setSelectedCustomer(c);
                        setCustomerSearch('');
                        setCustomers([]);
                        setCcModal(null);
                      }}
                    >
                      <span className="selling-pos-cc-customer-option-avatar" aria-hidden="true">
                        {customerInitials(c.name)}
                      </span>
                      <span className="selling-pos-cc-customer-option-body">
                        <span className="selling-pos-cc-customer-option-name">{c.name}</span>
                        <span className="selling-pos-cc-customer-option-sub">
                          {c.phone ? (
                            <span className="selling-pos-cc-customer-option-phone">{c.phone}</span>
                          ) : null}
                          {c.phone && c.email ? <span className="selling-pos-cc-customer-option-dot"> · </span> : null}
                          {c.email ? (
                            <span className="selling-pos-cc-customer-option-email">{c.email}</span>
                          ) : null}
                          {!c.phone && !c.email ? (
                            <span className="selling-pos-cc-customer-option-muted">No phone or email on file</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="selling-pos-cc-customer-option-chevron" aria-hidden="true">
                        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m9 18 6-6 6-6" />
                        </svg>
                      </span>
                    </button>
                  ))
                )}
              </div>
              <button
                type="button"
                className="selling-pos-cc-modal-new selling-pos-cc-modal-new--prominent"
                onClick={() => {
                  setCcModal(null);
                  setNewCustomerModalOpen(true);
                }}
              >
                <span className="selling-pos-cc-modal-new-icon-wrap" aria-hidden="true">
                  <IconPlus />
                </span>
                <span className="selling-pos-cc-modal-new-copy">
                  <span className="selling-pos-cc-modal-new-title">Add new customer</span>
                  <span className="selling-pos-cc-modal-new-sub">Create a profile for a walk-in or new buyer</span>
                </span>
              </button>
            </div>
            <div className="selling2-modal-footer selling-pos-cc-modal-foot">
              <button type="button" className="ghost-button selling-pos-cc-modal-foot-close" onClick={() => setCcModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {ccModal === 'currency' && (
        <div
          className="selling2-modal-overlay selling-pos-cc-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="selling-cc-currency-title"
          onClick={() => setCcModal(null)}
        >
          <div
            className="selling2-modal selling-pos-cc-modal selling-pos-cc-modal--pickers selling-pos-cc-modal--currency"
            onClick={e => e.stopPropagation()}
          >
            <div className="selling2-modal-header selling-pos-cc-modal-head">
              <h3 id="selling-cc-currency-title">Select currency</h3>
              <button
                type="button"
                className="selling2-modal-close selling-pos-cc-modal-close"
                onClick={() => setCcModal(null)}
                aria-label="Close"
              >
                <IconX />
              </button>
            </div>
            <div className="selling2-modal-body selling-pos-cc-modal-body">
              <div className="selling-pos-cc-modal-list selling-pos-cc-modal-list--currency">
                {SUPPORTED_CURRENCIES.map(c => {
                  const active = normalizeCurrencyCode(saleCurrency) === c.code;
                  return (
                    <button
                      key={c.code}
                      type="button"
                      className={`selling-pos-cc-cur-option${active ? ' is-selected' : ''}`}
                      onClick={() => {
                        applySaleCurrency(c.code);
                        setCcModal(null);
                      }}
                    >
                      <span className="selling-pos-cc-cur-code">{c.code}</span>
                      <span className="selling-pos-cc-cur-label">{c.label}</span>
                      {active ? (
                        <span className="selling-pos-cc-cur-check" aria-hidden="true">
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="selling2-modal-footer selling-pos-cc-modal-foot">
              <button type="button" className="ghost-button selling-pos-cc-modal-foot-close" onClick={() => setCcModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {newCustomerModalOpen && (
        <div
          className="selling-new-customer-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="selling-new-customer-title"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setNewCustomerModalOpen(false);
          }}
        >
          <div className="selling-new-customer-modal" onMouseDown={e => e.stopPropagation()}>
            <header className="selling-new-customer-head">
              <div className="selling-new-customer-head-left">
                <div className="selling-new-customer-avatar" aria-hidden="true">
                  <IconNewCustomerUser />
                </div>
                <span id="selling-new-customer-title" className="selling-new-customer-title">
                  Add New Customer
                </span>
              </div>
              <div className="selling-new-customer-head-right">
                <button
                  type="button"
                  className="selling-new-customer-icon-btn selling-new-customer-icon-btn--close"
                  onClick={() => setNewCustomerModalOpen(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </header>

            <div className="selling-new-customer-body">
              <div className="selling-new-customer-group">
                <div className="selling-new-customer-group-heading">Contact info</div>

                <div className="selling-new-customer-field">
                  <div className="selling-new-customer-label">
                    Full name <span className="selling-new-customer-req">*</span>
                  </div>
                  <input
                    className="selling-new-customer-input"
                    name="name"
                    type="text"
                    autoComplete="name"
                    placeholder="e.g. Amal Perera"
                    value={newCustomer.name}
                    onChange={handleNewCustomerChange}
                  />
                </div>

                <div className="selling-new-customer-field">
                  <div className="selling-new-customer-label">
                    Phone <span className="selling-new-customer-opt">— optional</span>
                  </div>
                  <input
                    className="selling-new-customer-input"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="0771234567"
                    value={newCustomer.phone}
                    onChange={handleNewCustomerChange}
                  />
                </div>

                <div className="selling-new-customer-field">
                  <div className="selling-new-customer-label">
                    Email <span className="selling-new-customer-opt">— optional</span>
                  </div>
                  <input
                    className="selling-new-customer-input"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="customer@example.com"
                    value={newCustomer.email}
                    onChange={handleNewCustomerChange}
                  />
                </div>
              </div>

              <div className="selling-new-customer-group">
                <div className="selling-new-customer-group-heading selling-new-customer-group-heading--colored">
                  Billing address{' '}
                  <span className="selling-new-customer-heading-note">· optional, shown on receipts</span>
                </div>

                <div className="selling-new-customer-field">
                  <div className="selling-new-customer-label">Address line 1</div>
                  <input
                    className="selling-new-customer-input"
                    name="address_line1"
                    type="text"
                    autoComplete="address-line1"
                    placeholder="Street, building"
                    value={newCustomer.address_line1}
                    onChange={handleNewCustomerChange}
                  />
                </div>

                <div className="selling-new-customer-field">
                  <div className="selling-new-customer-label">Address line 2</div>
                  <input
                    className="selling-new-customer-input"
                    name="address_line2"
                    type="text"
                    autoComplete="address-line2"
                    placeholder="Unit, district…"
                    value={newCustomer.address_line2}
                    onChange={handleNewCustomerChange}
                  />
                </div>

                <div className="selling-new-customer-row2">
                  <div className="selling-new-customer-field">
                    <div className="selling-new-customer-label">City</div>
                    <input
                      className="selling-new-customer-input"
                      name="city"
                      type="text"
                      autoComplete="address-level2"
                      placeholder="City"
                      value={newCustomer.city}
                      onChange={handleNewCustomerChange}
                    />
                  </div>
                  <div className="selling-new-customer-field">
                    <div className="selling-new-customer-label">Postal code</div>
                    <input
                      className="selling-new-customer-input"
                      name="postal_code"
                      type="text"
                      autoComplete="postal-code"
                      placeholder="00100"
                      value={newCustomer.postal_code}
                      onChange={handleNewCustomerChange}
                    />
                  </div>
                </div>

                <div className="selling-new-customer-field">
                  <div className="selling-new-customer-label">Country</div>
                  <input
                    className="selling-new-customer-input"
                    name="country"
                    type="text"
                    autoComplete="country-name"
                    placeholder="e.g. Sri Lanka"
                    value={newCustomer.country}
                    onChange={handleNewCustomerChange}
                  />
                </div>
              </div>

              <div className="selling-new-customer-group">
                <div className="selling-new-customer-group-heading">
                  Notes <span className="selling-new-customer-heading-note">· optional</span>
                </div>
                <div className="selling-new-customer-field">
                  <textarea
                    className="selling-new-customer-textarea"
                    name="notes"
                    placeholder="Any special instructions or details about this customer…"
                    rows={4}
                    value={newCustomer.notes}
                    onChange={handleNewCustomerChange}
                  />
                </div>
              </div>
            </div>

            <footer className="selling-new-customer-foot">
              <button type="button" className="selling-new-customer-btn selling-new-customer-btn--cancel" onClick={() => setNewCustomerModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="selling-new-customer-btn selling-new-customer-btn--save"
                onClick={async () => {
                  const ok = await saveCustomer();
                  if (ok) {
                    setNewCustomerModalOpen(false);
                    setCcModal(null);
                  }
                }}
                disabled={customerSaving}
              >
                <IconSaveCustomer />
                {customerSaving ? 'Saving…' : 'Save Customer'}
              </button>
            </footer>
          </div>
        </div>
      )}

      <InvoicePaymentIntentModal
        open={paymentIntentOpen}
        total={finalTotal}
        currencyCode={saleCurrency}
        busy={creatingInvoice}
        onCancel={() => setPaymentIntentOpen(false)}
        onConfirm={payload => void submitCreateInvoiceWithPayment(payload)}
      />

      {invoiceCreatedOpen && createdInvoice && (
        <div className="selling2-modal-overlay" role="dialog" aria-modal="true">
          <div className="selling2-created">
            <button
              type="button"
              className="selling2-modal-close selling2-created-close"
              onClick={() => {
                setInvoiceCreatedLineOverride(null);
                setInvoiceCreatedOpen(false);
              }}
              aria-label="Close"
            >
              <IconX />
            </button>
            <div className="selling2-created-check" aria-hidden="true"><IconCheck /></div>
            <h3 className="selling2-created-title">Invoice Created!</h3>
            <div className="selling2-created-number">
              <div className="selling2-created-number-label">Invoice Number</div>
              <div className="selling2-created-number-value">{createdInvoice.invoiceNo}</div>
            </div>
            <div className="selling2-created-meta">
              <div><span>Customer</span><span>{createdInvoice.customerName}</span></div>
              <div>
                <span>Total Amount</span>
                <span>{formatMoneyAmount(createdInvoice.total, createdInvoice.currencyCode)}</span>
              </div>
              <div>
                <span>Status</span>
                <span>{createdInvoice.status}</span>
              </div>
              {createdInvoice.paid > 0 ? (
                <div>
                  <span>Paid</span>
                  <span>{formatMoneyAmount(createdInvoice.paid, createdInvoice.currencyCode)}</span>
                </div>
              ) : null}
              {createdInvoice.status === 'Partial' ? (
                <div>
                  <span>Balance</span>
                  <span>
                    {formatMoneyAmount(
                      Math.max(0, createdInvoice.total - createdInvoice.paid),
                      createdInvoice.currencyCode
                    )}
                  </span>
                </div>
              ) : null}
              <div>
                <span>Items</span>
                <span>
                  {invoiceCreatedModalItemsPcs} pcs
                  {invoiceCreatedModalLineCount > 1 ? ` · ${invoiceCreatedModalLineCount} lines` : ''}
                </span>
              </div>
              <div><span>Date</span><span>{dateFromServerUtc(createdInvoice.createdAt).toLocaleDateString()}</span></div>
            </div>
            {invoiceCreatedModalLineViews.length > 0 && (
              <div className="selling2-created-lines" aria-label="Invoice line details">
                <div className="selling2-created-lines-title">Line details</div>
                <ul className="selling2-created-lines-list">
                  {invoiceCreatedModalLineViews.map((row, idx) => (
                    <li key={`${row.label}-${idx}`} className="selling2-created-line">
                      <span className="selling2-created-line-name">{row.label}</span>
                      <span className="selling2-created-line-amounts">
                        <span className="selling2-created-line-gross">
                          {formatMoneyAmount(row.gross, createdInvoice.currencyCode)}
                        </span>
                        {row.disc > 0 ? (
                          <span className="selling2-created-line-disc">
                            −{formatMoneyAmount(row.disc, createdInvoice.currencyCode)}
                          </span>
                        ) : null}
                        <span className="selling2-created-line-net">
                          {formatMoneyAmount(row.net, createdInvoice.currencyCode)}
                        </span>
                        <span className="selling2-created-line-qty">×{row.qty}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              className="primary-button selling2-created-btn"
              onClick={() => createdInvoice && printInvoiceReceiptById(createdInvoice.id)}
            >
              <span className="btn-icon" aria-hidden="true"><IconPrinter /></span>
              Print invoice
            </button>
            {createdInvoice.status !== 'Paid' ? (
              <button
                type="button"
                className="ghost-button selling2-created-btn"
                onClick={() => {
                  setInvoiceCreatedLineOverride(null);
                  setInvoiceCreatedOpen(false);
                  if (createdInvoice) openInvoiceCheckout(createdInvoice.id);
                }}
              >
                {createdInvoice.status === 'Partial' ? 'Add payment' : 'Continue to Checkout'}
              </button>
            ) : null}
            <button
              type="button"
              className="ghost-button selling2-created-btn selling2-created-btn-muted"
              onClick={() => {
                setInvoiceCreatedLineOverride(null);
                setInvoiceCreatedOpen(false);
                resetInvoice();
              }}
            >
              Start New Invoice
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
