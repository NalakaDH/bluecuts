import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import type { PageId } from '../../components/layout/Layout';
import { SELLING_FROM_MEMO_CONVERT_INVOICE_KEY } from '../../constants/invoiceCheckout';
import { apiUrl, parseErrorResponse } from '../../api';
import { memoReceiptLineRemainingAmounts, openMemoReceiptWindow } from '../../lib/receiptDocument';
import {
  DEFAULT_CURRENCY_CODE,
  SUPPORTED_CURRENCIES,
  formatMoneyAmount,
  normalizeCurrencyCode,
  parseMoneyInput,
  roundMoney2,
} from '../../lib/currencies';
import type { ThbPerUnitMap } from '../../lib/exchangeConversion';
import { formatUsdOnlyFromAny, formatUsdOnlyFromThb } from '../../lib/moneyUsdDisplay';
import {
  itemNeedsSoldCaratsInput,
  lineGrossFromPerCt,
  listPricePerCt,
  lotListLineGross,
  parseSoldCaratsInput,
  soldCaratsCartSuffix,
  validateSoldCaratsForLot,
} from '../../lib/lotCarats';
import { InvoicePaymentIntentModal } from '../../components/InvoicePaymentIntentModal';
import { GuardedAmountNumberInput } from '../../components/GuardedAmountNumberInput';
import {
  computeMemoConvertInvoiceTotal,
  type InvoicePaymentIntentResult,
} from '../../lib/invoicePaymentIntent';

/** Default memo currency for new memos (matches Selling). */
const MEMO_DEFAULT_CURRENCY = 'USD';

/** Matches Selling POS catalog preview row count for Top Sold / Recent tabs. */
const MEMO_CATALOG_TAB_PREVIEW_LIMIT = 18;

const QUICK_ADD_STORAGE_KEY = 'bluecuts-quick-add-item';
const MEMO_DRAFT_STORAGE_KEY = 'bluecuts-memo-draft';

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

const IconCheck = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconEdit = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const IconCcUser = () => (
  <svg className="selling-pos-cc-btn-icon" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);

function customerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  const one = parts[0] ?? '';
  return (one.slice(0, 2) || '?').toUpperCase();
}

const IconCcCurrency = () => (
  <svg className="selling-pos-cc-btn-icon" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v12M8 9c0-1.7 1.8-3 4-3s4 1.3 4 3-1.8 3-4 3-4 1.3-4 3 1.8 3 4 3 4-1.3 4-3" />
  </svg>
);

const IconNewCustomerUser = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const IconSaveCustomer = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

function memoItemImageSrc(imagePath?: string | null): string {
  if (!imagePath) return '';
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
  const path = imagePath.startsWith('/') ? imagePath : `/uploads/${imagePath}`;
  return apiUrl(path);
}

type MemoStatus = 'Open' | 'Partially Returned' | 'Closed';
type MemoListFilter = 'all' | MemoStatus;

interface MemoRow {
  id: number;
  memo_no: string;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: MemoStatus;
  memo_date: string;
  due_date: string | null;
  notes: string | null;
  converted_invoice_id: number | null;
  created_at: string;
  updated_at: string;
  items_count: number;
  total_value: number;
  currency_code?: string | null;
}

interface MemoItemRow {
  id: number;
  inventory_item_id: number;
  item_code: string | null;
  description: string | null;
  quantity: number;
  returned_qty: number;
  unit_price: number;
  line_total: number;
  image_path: string | null;
  category: string | null;
  item_type: string | null;
  weight_grams?: number | null;
  weight_carats?: number | null;
}

interface MemoDetail {
  id: number;
  memo_no: string;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address_line1?: string | null;
  customer_address_line2?: string | null;
  customer_city?: string | null;
  customer_postal_code?: string | null;
  customer_country?: string | null;
  status: MemoStatus;
  memo_date: string;
  due_date: string | null;
  notes: string | null;
  converted_invoice_id: number | null;
  created_at: string;
  updated_at: string;
  currency_code?: string | null;
  order_discount?: number;
  items: MemoItemRow[];
}

interface MemoKpiStats {
  memos_in_scope: number;
  open_memo_count: number;
  overdue_memo_count: number;
  items_on_open_memos: number;
  open_memos_value_thb: number;
}

interface CustomerRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

interface InventoryItem {
  id: number;
  category: string;
  item_type: string;
  pieces: number;
  pieces_remaining?: number | null;
  selling_total_price?: number | null;
  /** Currency the inventory selling price is stored in */
  selling_currency?: string | null;
  selling_carat_price?: number | null;
  image_path?: string | null;
  item_code?: string | null;
  item_sticker?: string | null;
  description?: string | null;
  weight_carats?: number | null;
  status?: string;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Server: GET /api/inventory/activity-summary — keyed by inventory id string (same as Selling). */
type InventoryActivitySummaryMap = Record<
  string,
  { sold_units?: number; last_sale_at?: string | null }
>;

function inventoryTimestampMs(raw: string | null | undefined): number {
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function lastSaleAtMsFromSummary(item: InventoryItem, summary: InventoryActivitySummaryMap): number {
  const raw = summary[String(item.id)]?.last_sale_at;
  return inventoryTimestampMs(raw ?? undefined);
}

interface MemoCartItem {
  /** Set when editing an existing memo line (server `memo_items.id`). */
  memoItemId?: number;
  inventory_item_id: number;
  label: string;
  maxQty: number;
  quantity: number;
  unit_price: number;
  /** Original list price & currency (prefill when memo currency matches) */
  source_unit_price: number;
  source_carat_price?: number | null;
  source_currency: string;
  item_code?: string | null;
  description?: string | null;
  image_path?: string | null;
  category?: string;
  item_type?: string;
  weight_carats?: number | null;
  /** When editing an existing memo: returned quantity on this line (read-only). */
  memoReturnedQty?: number;
}

type MemoDraftPayload = {
  savedAt: string;
  memoDate: string;
  dueDate: string;
  memoCurrency: string;
  memoOrderDiscount: number;
  memoDiscountType: 'pct' | 'flat';
  itemSearch: string;
  selectedCustomer: CustomerRow | null;
  cart: MemoCartItem[];
};

function memoUnitPrefillFromList(
  item: InventoryItem,
  memoCur: string,
  qty = 1,
  soldCaratsRaw?: string | number | null
): number {
  void qty;
  void soldCaratsRaw;
  const listCur = normalizeCurrencyCode(item.selling_currency ?? DEFAULT_CURRENCY_CODE);
  const inv = normalizeCurrencyCode(memoCur);
  if (listCur !== inv) return 0;
  if (itemNeedsSoldCaratsInput(item)) {
    const perCt = listPricePerCt(item);
    return perCt != null ? perCt : 0;
  }
  return roundMoney2(Number(item.selling_total_price ?? 0));
}

function memoUnitPrefillFromCartLine(
  c: MemoCartItem,
  memoCur: string,
  available: InventoryItem[]
): number {
  const inv = resolveInventoryItemForMemoLine(c, available);
  return memoUnitPrefillFromList(inv, memoCur, memoLineQty(c), memoCartSoldCaratsValue(c));
}

function listUnitForMemoCartLine(
  c: MemoCartItem,
  memoCur: string,
  available: InventoryItem[]
): number | null {
  const listCur = normalizeCurrencyCode(c.source_currency ?? DEFAULT_CURRENCY_CODE);
  if (listCur !== normalizeCurrencyCode(memoCur)) return null;
  const inv = resolveInventoryItemForMemoLine(c, available);
  if (itemNeedsSoldCaratsInput(inv) || (c.weight_carats != null && Number(c.weight_carats) > 0)) {
    const perCt = listPricePerCt({
      ...inv,
      weight_carats: inv.weight_carats ?? c.weight_carats,
      selling_carat_price: inv.selling_carat_price ?? c.source_carat_price,
      selling_total_price: inv.selling_total_price ?? c.source_unit_price,
    });
    if (perCt != null) return perCt;
  }
  const v = Number(c.source_unit_price ?? 0);
  if (!Number.isFinite(v) || v < 0) return null;
  return roundMoney2(v);
}

function memoLineSellUnit(c: MemoCartItem): number {
  return roundMoney2(Number(c.unit_price) || 0);
}

function memoLineApiUnit(c: MemoCartItem, memoCur: string, available: InventoryItem[]): number {
  const sell = memoLineSellUnit(c);
  const list = listUnitForMemoCartLine(c, memoCur, available);
  if (list == null) return sell;
  if (sell > list) return sell;
  return list;
}

function memoLineQty(c: MemoCartItem): number {
  return Math.max(1, Math.floor(Number(c.quantity) || 1));
}

function memoLineSubtotalGross(c: MemoCartItem, memoCur: string, available: InventoryItem[]): number {
  const unit = memoLineApiUnit(c, memoCur, available);
  const soldCt = memoCartSoldCaratsValue(c);
  if (soldCt != null) return lineGrossFromPerCt(unit, soldCt);
  return roundMoney2(unit * memoLineQty(c));
}

function memoLineDerivedDiscount(
  c: MemoCartItem,
  memoCur: string,
  available: InventoryItem[]
): number {
  const qty = memoLineQty(c);
  const sell = memoLineSellUnit(c);
  const list = listUnitForMemoCartLine(c, memoCur, available);
  if (list == null || sell >= list) return 0;
  const soldCt = memoCartSoldCaratsValue(c);
  const raw =
    soldCt != null
      ? lineGrossFromPerCt(list - sell, soldCt)
      : roundMoney2(roundMoney2(list - sell) * qty);
  const gross = memoLineSubtotalGross(c, memoCur, available);
  return Math.min(gross, Math.max(0, roundMoney2(raw)));
}

function memoLineSellTotal(c: MemoCartItem): number {
  const sell = memoLineSellUnit(c);
  const soldCt = memoCartSoldCaratsValue(c);
  if (soldCt != null) return lineGrossFromPerCt(sell, soldCt);
  return roundMoney2(sell * memoLineQty(c));
}

function resolveInventoryItemForMemoLine(c: MemoCartItem, available: InventoryItem[]): InventoryItem {
  const found = available.find(a => a.id === c.inventory_item_id);
  if (found) return found;
  const maxPx = Math.max(1, Math.floor(Number(c.maxQty) || 1));
  return {
    id: c.inventory_item_id,
    category: c.category || 'Item',
    item_type: c.item_type || '',
    pieces: maxPx,
    pieces_remaining: maxPx,
    selling_total_price: c.source_unit_price,
    selling_carat_price: c.source_carat_price ?? null,
    selling_currency: c.source_currency,
    image_path: c.image_path ?? null,
    item_code: c.item_code ?? null,
    description: c.description ?? null,
    weight_carats: c.weight_carats ?? null,
  };
}

function memoCartSoldCaratsValue(c: MemoCartItem): number | null {
  const v = c.weight_carats;
  if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return null;
  return Number(v);
}

/** Net unit (charged) from stored memo line — per ct when weight_carats set, else per pc. */
function memoDetailNetUnit(it: MemoItemRow): number {
  const lt = Number(it.line_total) || 0;
  const ct = it.weight_carats != null ? Number(it.weight_carats) : NaN;
  if (Number.isFinite(ct) && ct > 0) return roundMoney2(lt / ct);
  const q = Math.max(1, Math.floor(Number(it.quantity) || 1));
  return roundMoney2(lt / q);
}

function memoDetailRemainingLineValue(it: MemoItemRow): number {
  const q = Math.max(1, Math.floor(Number(it.quantity) || 1));
  const remaining = Math.max(0, (it.quantity || 0) - (it.returned_qty || 0));
  const lt = Number(it.line_total) || 0;
  return roundMoney2((lt * remaining) / q);
}

interface MemoPageProps {
  token: string;
  onNavigate?: (page: PageId) => void;
  view?: 'create' | 'open';
  onChangeView?: (view: 'create' | 'open') => void;
}

const IconSearch: React.FC = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IconClipboardCreate: React.FC = () => (
  <svg
    width={26}
    height={26}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.85"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M9 14h6M9 10h4M9 18h4" />
  </svg>
);

const kpiIco = 15;
const IconKpiMemoClipboard: React.FC = () => (
  <svg
    width={kpiIco}
    height={kpiIco}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M9 14h6" />
  </svg>
);
const IconKpiAlertCircle: React.FC = () => (
  <svg
    width={kpiIco}
    height={kpiIco}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);
const IconKpiPackage: React.FC = () => (
  <svg
    width={kpiIco}
    height={kpiIco}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);
const IconKpiBanknote: React.FC = () => (
  <svg
    width={kpiIco}
    height={kpiIco}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="3" />
    <path d="M6 12h.01M18 12h.01" />
  </svg>
);

const IconPlus: React.FC = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconPlusSm: React.FC = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconTrash: React.FC = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const IconX: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

const IconCalendarMemo: React.FC = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const IconMemoListTab: React.FC = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const iconRow = 16;

const IconEye: React.FC = () => (
  <svg
    width={iconRow}
    height={iconRow}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconPrinter: React.FC = () => (
  <svg
    width={iconRow}
    height={iconRow}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" rx="1" />
  </svg>
);

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ISO YYYY-MM-DD compare; invalid if due is strictly before memo start. */
function memoDueBeforeMemoDate(memoDateStr: string, dueDateStr: string): boolean {
  const due = dueDateStr.trim();
  if (!due) return false;
  const start = memoDateStr.trim() || todayIso();
  return due < start;
}

/** Open memo with due date before today (for detail modal emphasis). */
function memoDetailDueOverdue(d: MemoDetail): boolean {
  if (d.status === 'Closed') return false;
  const due = (d.due_date || '').trim();
  if (!due) return false;
  return due < todayIso();
}

/** Memo detail modal — human-readable date (e.g. Apr 30, 2026). */
function formatMemoDetailDisplayDate(iso: string): string {
  const s = (iso || '').trim();
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : `${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function memoDetailStatusPill(status: MemoStatus): React.ReactNode {
  if (status === 'Closed') {
    return (
      <span className="memo-detail-v2-pill memo-detail-v2-pill--green">
        <span className="memo-detail-v2-pill-dot" />
        Closed
      </span>
    );
  }
  if (status === 'Open') {
    return (
      <span className="memo-detail-v2-pill memo-detail-v2-pill--blue">
        <span className="memo-detail-v2-pill-dot" />
        Open
      </span>
    );
  }
  return (
    <span className="memo-detail-v2-pill memo-detail-v2-pill--amber">
      <span className="memo-detail-v2-pill-dot" />
      Partially returned
    </span>
  );
}

/** Ensure category/type from inventory appears on memo receipts when the stored line is short. */
function memoLineDescription(it: MemoItemRow): string {
  const base = (it.description || '').trim();
  const typeBit = [it.category, it.item_type].filter(Boolean).join(' ').trim();
  if (!typeBit) return base || (it.item_code || '').trim() || '—';
  if (!base) return typeBit;
  if (base.toLowerCase().includes(typeBit.toLowerCase())) return base;
  return `${base} · ${typeBit}`;
}

/** Memo detail modal item column: carats line only. */
function memoDetailModalItemCt(it: MemoItemRow): string | null {
  if (it.weight_carats != null && Number(it.weight_carats) > 0) {
    return `${it.weight_carats} ct`;
  }
  return null;
}

/** Memo detail modal item column: type line only (inventory item_type). */
function memoDetailModalItemType(it: MemoItemRow): string | null {
  const ty = (it.item_type || '').trim().replace(/_/g, ' ');
  return ty || null;
}

function memoDetailCustomerInitial(name: string | null | undefined): string {
  const t = (name || 'Walk-in').trim();
  return t ? t.charAt(0).toUpperCase() : '?';
}

function memoDetailDisplayCustomer(d: MemoDetail): string {
  const n = (d.customer_name || '').trim();
  if (n) return n;
  return 'Walk-in Customer';
}

function detailToComposerCart(d: MemoDetail): MemoCartItem[] {
  const cur = normalizeCurrencyCode(d.currency_code || DEFAULT_CURRENCY_CODE);
  return d.items.map(it => {
    const q = Math.max(1, Math.floor(Number(it.quantity) || 0));
    const rq = Math.floor(Number(it.returned_qty) || 0);
    const sellUnit = memoDetailNetUnit(it);
    const storedGrossUnit = roundMoney2(Number(it.unit_price || 0));
    return {
      memoItemId: it.id,
      inventory_item_id: it.inventory_item_id,
      label: memoLineDescription(it),
      maxQty: Math.max(q, 1),
      quantity: q,
      unit_price: sellUnit,
      source_unit_price: storedGrossUnit,
      source_currency: cur,
      item_code: it.item_code,
      description: it.description,
      image_path: it.image_path ?? null,
      category: it.category ?? '',
      item_type: it.item_type ?? '',
      weight_carats: it.weight_carats ?? null,
      memoReturnedQty: rq > 0 ? rq : undefined,
    };
  });
}

const IconPencil12 = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const IconTrash12 = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14H6L5 6" />
  </svg>
);

const IconPrint12 = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);

const IconMemoDetailDoc20 = () => (
  <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
    />
  </svg>
);

const IconMemoDetailClose13 = () => (
  <svg width={13} height={13} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const IconReturnSelected12 = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 11l3-3m0 0l3 3m-3-3v8m0-13a9 9 0 110 18 9 9 0 010-18z" />
  </svg>
);

const IconReturnAll12 = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

const IconConvertMemo12 = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
    />
  </svg>
);

export const MemoPage: React.FC<MemoPageProps> = ({
  token,
  onNavigate,
  view = 'create',
  onChangeView,
}) => {
  const { showAlert, showConfirm } = useAlertDialog();

  // create memo form
  const [memoDate, setMemoDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
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
  const [cartImageLoadFailed, setCartImageLoadFailed] = useState<Set<number>>(() => new Set());
  const [itemSearch, setItemSearch] = useState('');
  const [availableItems, setAvailableItems] = useState<InventoryItem[]>([]);
  const [memoCatalogLoading, setMemoCatalogLoading] = useState(false);
  const [memoCatalogFilter, setMemoCatalogFilter] = useState<'all' | 'top' | 'recent'>('all');
  const [inventoryActivitySummary, setInventoryActivitySummary] = useState<InventoryActivitySummaryMap>({});
  const [cart, setCart] = useState<MemoCartItem[]>([]);
  const [memoCurrency, setMemoCurrency] = useState<string>(MEMO_DEFAULT_CURRENCY);
  const [memoOrderDiscount, setMemoOrderDiscount] = useState<number>(0);
  const [memoDiscountType, setMemoDiscountType] = useState<'pct' | 'flat'>('pct');
  const [thbPerUnit, setThbPerUnit] = useState<ThbPerUnitMap>({ THB: 1 });
  const [creating, setCreating] = useState(false);
  // memo list
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MemoListFilter>('all');
  const [memos, setMemos] = useState<MemoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // detail modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MemoDetail | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [memoConvertPaymentOpen, setMemoConvertPaymentOpen] = useState(false);
  const [memoConvertSnapshot, setMemoConvertSnapshot] = useState<{
    detailId: number;
    memoNo: string;
    currencyCode: string;
    total: number;
  } | null>(null);
  const [returnDraft, setReturnDraft] = useState<Record<number, number>>({});
  const memoMainTab = view;
  const [ccModal, setCcModal] = useState<'customer' | 'currency' | null>(null);

  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemModalFromCartEdit, setItemModalFromCartEdit] = useState(false);
  const [itemModalTarget, setItemModalTarget] = useState<InventoryItem | null>(null);
  const [itemModalQty, setItemModalQty] = useState(1);
  const [itemModalUnitPrice, setItemModalUnitPrice] = useState(0);
  const [itemModalSoldCarats, setItemModalSoldCarats] = useState('');
  const itemModalUnitPriceManualRef = useRef(false);
  const itemModalUnitPriceInputRef = useRef<HTMLInputElement>(null);

  const [memoEditDeleting, setMemoEditDeleting] = useState(false);
  const [editingMemoId, setEditingMemoId] = useState<number | null>(null);
  const [editingMemoNo, setEditingMemoNo] = useState<string | null>(null);
  const [editingMemoConvertedInvoiceId, setEditingMemoConvertedInvoiceId] = useState<number | null>(null);
  const [editingMemoStatus, setEditingMemoStatus] = useState<MemoStatus | null>(null);
  const [memoUpdating, setMemoUpdating] = useState(false);

  const [memoKpiStats, setMemoKpiStats] = useState<MemoKpiStats | null>(null);

  const fetchMemos = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '300');
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const statsParams = new URLSearchParams();
      if (search.trim()) statsParams.set('search', search.trim());
      if (statusFilter !== 'all') statsParams.set('status', statusFilter);

      const [res, statsRes] = await Promise.all([
        fetch(apiUrl(`/api/memos?${params.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(apiUrl(`/api/memos/stats?${statsParams.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load memos'));
      if (!statsRes.ok) throw new Error(await parseErrorResponse(statsRes, 'Failed to load memo totals'));
      const data: MemoRow[] = await res.json();
      const st: MemoKpiStats = await statsRes.json();
      setMemoKpiStats({
        memos_in_scope: Number(st.memos_in_scope) || 0,
        open_memo_count: Number(st.open_memo_count) || 0,
        overdue_memo_count: Number(st.overdue_memo_count) || 0,
        items_on_open_memos: Number(st.items_on_open_memos) || 0,
        open_memos_value_thb: Number(st.open_memos_value_thb) || 0,
      });
      setMemos(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load memos';
      setError(msg);
      setMemos([]);
      setMemoKpiStats(null);
      showAlert({ title: 'Could not load memos', message: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const id = window.setTimeout(() => fetchMemos(), 250);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, token]);

  useEffect(() => {
    if (memoMainTab === 'open') {
      fetchMemos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoMainTab]);

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
    } catch {
      setCustomers([]);
    }
  }, [token, customerSearch]);

  useEffect(() => {
    const id = setTimeout(() => {
      void fetchCustomers();
    }, 300);
    return () => clearTimeout(id);
  }, [customerSearch, fetchCustomers]);

  useEffect(() => {
    if (!ccModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCcModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ccModal]);

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

  const fetchMemoInventoryActivitySummary = useCallback(async () => {
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

  /** Same inventory query as Selling POS (`fetchAvailable`): Available + sold-out-with-sale-history, limit 200, optional search. */
  const fetchMemoCatalog = useCallback(
    async (searchTerm?: string) => {
      if (memoMainTab !== 'create') return;
      setMemoCatalogLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('status', 'Available');
        params.set('for_selling_catalog', '1');
        params.set('limit', '200');
        const q = searchTerm !== undefined ? String(searchTerm).trim() : '';
        if (q) params.set('search', q);
        const res = await fetch(apiUrl(`/api/inventory?${params.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const rows: InventoryItem[] = await res.json();
        setAvailableItems(Array.isArray(rows) ? rows : []);
        await fetchMemoInventoryActivitySummary();
      } catch {
        setAvailableItems([]);
      } finally {
        setMemoCatalogLoading(false);
      }
    },
    [memoMainTab, token, fetchMemoInventoryActivitySummary]
  );

  useEffect(() => {
    if (memoMainTab !== 'create') return;
    void fetchMemoCatalog();
  }, [memoMainTab, fetchMemoCatalog]);

  useEffect(() => {
    if (memoMainTab !== 'create') return;
    const id = window.setTimeout(() => {
      void fetchMemoCatalog(itemSearch);
    }, 300);
    return () => window.clearTimeout(id);
  }, [itemSearch, memoMainTab, fetchMemoCatalog]);

  /** Same ordering rules as Selling POS catalog (All vs Top Sold / Recent preview). */
  const memoCatalogDisplayItems = useMemo(() => {
    const items = [...availableItems];

    if (memoCatalogFilter === 'all') {
      items.sort((a, b) => {
        const tb = inventoryTimestampMs(b.created_at ?? b.updated_at);
        const ta = inventoryTimestampMs(a.created_at ?? a.updated_at);
        return tb - ta;
      });
      return items;
    }

    if (memoCatalogFilter === 'top' || memoCatalogFilter === 'recent') {
      items.sort((a, b) => {
        const tb = lastSaleAtMsFromSummary(b, inventoryActivitySummary);
        const ta = lastSaleAtMsFromSummary(a, inventoryActivitySummary);
        if (tb !== ta) return tb - ta;
        return (
          inventoryTimestampMs(b.updated_at ?? b.created_at) -
          inventoryTimestampMs(a.updated_at ?? a.created_at)
        );
      });
      return items.slice(0, MEMO_CATALOG_TAB_PREVIEW_LIMIT);
    }

    return items;
  }, [availableItems, memoCatalogFilter, inventoryActivitySummary]);

  const memoListTruncated =
    memos.length >= 300 && (memoKpiStats?.memos_in_scope ?? 0) > 300;

  const totals = useMemo(() => {
    if (memoKpiStats) {
      return {
        openCount: memoKpiStats.open_memo_count,
        overdueCount: memoKpiStats.overdue_memo_count,
        itemsOnMemo: memoKpiStats.items_on_open_memos,
        totalValueThb: roundMoney2(memoKpiStats.open_memos_value_thb),
      };
    }
    return { openCount: 0, overdueCount: 0, itemsOnMemo: 0, totalValueThb: 0 };
  }, [memoKpiStats]);

  const memoLinesReadOnly =
    editingMemoId != null &&
    (editingMemoConvertedInvoiceId != null || editingMemoStatus === 'Closed');

  const rawPiecesAvailForItem = useCallback((item: InventoryItem) => {
    return Math.max(0, Math.floor(Number(item.pieces_remaining ?? item.pieces ?? 0)));
  }, []);

  const maxPcsForMemoModalItem = useCallback(
    (item: InventoryItem) => {
      const line = cart.find(c => c.inventory_item_id === item.id);
      if (line) return Math.max(1, Math.floor(Number(line.maxQty) || 1));
      return Math.max(1, rawPiecesAvailForItem(item));
    },
    [cart, rawPiecesAvailForItem]
  );

  const openItemModal = useCallback(
    (item: InventoryItem) => {
      if (memoLinesReadOnly) {
        showAlert({
          title: 'Lines cannot be changed',
          message:
            editingMemoConvertedInvoiceId != null
              ? 'This memo was converted to an invoice. You can still update dates.'
              : 'This memo is closed. You can still update dates.',
          variant: 'info',
        });
        return;
      }
      if (rawPiecesAvailForItem(item) <= 0) return;
      const existing = cart.find(c => c.inventory_item_id === item.id);
      setItemModalFromCartEdit(false);
      setItemModalTarget(item);
      setItemModalQty(existing ? memoLineQty(existing) : 1);
      const existingCt = existing ? memoCartSoldCaratsValue(existing) : null;
      const soldRaw =
        existingCt != null
          ? String(existingCt)
          : itemNeedsSoldCaratsInput(item) && item.weight_carats != null
            ? String(item.weight_carats)
            : '';
      const q = existing ? memoLineQty(existing) : 1;
      itemModalUnitPriceManualRef.current = Boolean(existing);
      setItemModalUnitPrice(
        existing
          ? memoLineSellUnit(existing)
          : memoUnitPrefillFromList(item, memoCurrency, q, soldRaw)
      );
      setItemModalSoldCarats(soldRaw);
      setItemModalOpen(true);
    },
    [
      memoLinesReadOnly,
      cart,
      memoCurrency,
      rawPiecesAvailForItem,
      showAlert,
      editingMemoConvertedInvoiceId,
    ]
  );

  const openItemModalEditFromCart = useCallback(
    (line: MemoCartItem) => {
      if (memoLinesReadOnly) return;
      const inv = resolveInventoryItemForMemoLine(line, availableItems);
      setItemModalFromCartEdit(true);
      itemModalUnitPriceManualRef.current = true;
      setItemModalTarget(inv);
      setItemModalQty(memoLineQty(line));
      setItemModalUnitPrice(memoLineSellUnit(line));
      const soldCt = memoCartSoldCaratsValue(line);
      setItemModalSoldCarats(soldCt != null ? String(soldCt) : '');
      setItemModalOpen(true);
    },
    [memoLinesReadOnly, availableItems]
  );

  const confirmItemModalAdd = useCallback(() => {
    if (!itemModalTarget || memoLinesReadOnly) return;
    const item = itemModalTarget;
    const maxPcs = maxPcsForMemoModalItem(item);
    const safeQty = Math.max(1, Math.min(maxPcs, Math.floor(Number(itemModalQty) || 1)));
    let safeUnit = Math.max(0, roundMoney2(Number(itemModalUnitPrice) || 0));
    let soldCaratsLine: number | null = null;
    if (itemNeedsSoldCaratsInput(item)) {
      soldCaratsLine = parseSoldCaratsInput(itemModalSoldCarats);
      const err = validateSoldCaratsForLot(item.weight_carats, soldCaratsLine);
      if (err) {
        showAlert({ title: 'Carat weight required', message: err, variant: 'warning' });
        return;
      }
      const listUnit = listPricePerCt(item);
      if (listUnit != null && safeUnit <= 0) safeUnit = listUnit;
    }

    const existing = cart.find(c => c.inventory_item_id === item.id);
    if (!existing) {
      const remainingRaw = item.pieces_remaining ?? item.pieces;
      const remaining = Math.floor(Number(remainingRaw) || 0);
      if (remaining <= 0) return;
      const code = item.item_code || item.item_sticker || '';
      const label = `${code ? `${code} • ` : ''}${item.category} • ${item.item_type}`;
      const srcCur = normalizeCurrencyCode(item.selling_currency);
      const srcPrice = Number(item.selling_total_price || 0);
      setCart(prev => [
        ...prev,
        {
          inventory_item_id: item.id,
          label,
          maxQty: remaining,
          quantity: safeQty,
          unit_price: safeUnit,
          source_unit_price: srcPrice,
          source_carat_price: item.selling_carat_price ?? null,
          source_currency: srcCur,
          item_code: code || null,
          description: item.description || null,
          image_path: item.image_path ?? null,
          category: item.category,
          item_type: item.item_type,
          weight_carats: soldCaratsLine,
        },
      ]);
    } else {
      setCart(prev =>
        prev.map(c =>
          c.inventory_item_id === item.id
            ? {
                ...c,
                quantity: safeQty,
                unit_price: safeUnit,
                weight_carats: soldCaratsLine,
              }
            : c
        )
      );
    }
    setItemSearch('');
    setItemModalOpen(false);
    setItemModalTarget(null);
    setItemModalFromCartEdit(false);
    setItemModalSoldCarats('');
  }, [
    itemModalTarget,
    memoLinesReadOnly,
    itemModalQty,
    itemModalUnitPrice,
    itemModalSoldCarats,
    cart,
    maxPcsForMemoModalItem,
    showAlert,
  ]);

  const setMemoQtyForLine = useCallback(
    (line: MemoCartItem, raw: number) => {
      if (memoLinesReadOnly) return;
      const maxPcs = Math.max(1, Math.floor(Number(line.maxQty) || 1));
      let q = Math.floor(Number(raw));
      if (!Number.isFinite(q) || q < 1) q = 1;
      if (q > maxPcs) q = maxPcs;
      setCart(prev =>
        prev.map(c =>
          c.inventory_item_id === line.inventory_item_id ? { ...c, quantity: q } : c
        )
      );
    },
    [memoLinesReadOnly]
  );

  const bumpMemoQtyForLine = useCallback(
    (line: MemoCartItem, delta: number) => {
      setMemoQtyForLine(line, memoLineQty(line) + delta);
    },
    [setMemoQtyForLine]
  );

  const setMemoCartLineUnitPrice = useCallback(
    (line: MemoCartItem, raw: string | number) => {
      if (memoLinesReadOnly) return;
      const v = Math.max(0, roundMoney2(parseMoneyInput(String(raw))));
      setCart(prev =>
        prev.map(c =>
          c.inventory_item_id === line.inventory_item_id ? { ...c, unit_price: v } : c
        )
      );
    },
    [memoLinesReadOnly]
  );

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
        openItemModal(item);
      } catch {
        // Silent fallback: page remains usable without quick-add prefill.
      }
    };
    void hydrateQuickAdd();
  }, [token, openItemModal]);

  useEffect(() => {
    const el = itemModalUnitPriceInputRef.current;
    if (!el || !itemModalOpen) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [itemModalOpen, itemModalTarget?.id]);

  useEffect(() => {
    if (!itemModalOpen || !itemModalTarget || !itemNeedsSoldCaratsInput(itemModalTarget)) return;
    if (itemModalUnitPriceManualRef.current) return;
    const listUnit = listPricePerCt(itemModalTarget);
    if (listUnit != null) setItemModalUnitPrice(listUnit);
  }, [itemModalOpen, itemModalTarget, itemModalSoldCarats, itemModalQty]);

  const removeCartItem = (inventory_item_id: number) => {
    if (memoLinesReadOnly) return;
    setCart(prev => prev.filter(p => p.inventory_item_id !== inventory_item_id));
    setCartImageLoadFailed(prev => {
      const next = new Set(prev);
      next.delete(inventory_item_id);
      return next;
    });
  };

  const memoCartSubtotalGross = useMemo(() => {
    return cart.reduce((sum, c) => sum + memoLineSubtotalGross(c, memoCurrency, availableItems), 0);
  }, [cart, memoCurrency, availableItems]);

  const memoCartItemsDiscountTotal = useMemo(() => {
    return cart.reduce((sum, c) => sum + memoLineDerivedDiscount(c, memoCurrency, availableItems), 0);
  }, [cart, memoCurrency, availableItems]);

  const memoCartOrderDiscount = useMemo(() => {
    const afterLineDiscount = Math.max(0, roundMoney2(memoCartSubtotalGross - memoCartItemsDiscountTotal));
    const parsedDiscount = Number.isFinite(memoOrderDiscount) ? memoOrderDiscount : 0;
    const value =
      memoDiscountType === 'pct'
        ? roundMoney2((afterLineDiscount * Math.max(0, parsedDiscount)) / 100)
        : Math.max(0, parsedDiscount);
    return Math.min(afterLineDiscount, value);
  }, [memoCartItemsDiscountTotal, memoCartSubtotalGross, memoOrderDiscount, memoDiscountType]);

  const memoCartNetTotal = useMemo(() => {
    return Math.max(
      0,
      roundMoney2(memoCartSubtotalGross - memoCartItemsDiscountTotal - memoCartOrderDiscount)
    );
  }, [memoCartSubtotalGross, memoCartItemsDiscountTotal, memoCartOrderDiscount]);

  const applyMemoCurrency = useCallback((code: string) => {
    const next = normalizeCurrencyCode(code);
    setMemoCurrency(next);
    setCart(prev =>
      prev.map(line => ({
        ...line,
        unit_price: memoUnitPrefillFromCartLine(line, next, availableItems),
      }))
    );
  }, [availableItems]);

  const handleNewCustomerChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNewCustomer(prev => ({ ...prev, [name]: value }));
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
      const created: CustomerRow = await res.json();
      setSelectedCustomer(created);
      setCustomerSearch('');
      setCustomers(prev => [created, ...prev]);
      showAlert({
        title: 'Customer saved',
        message: `${created.name} was added.`,
        variant: 'success',
      });
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
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save customer';
      showAlert({ title: 'Could not save customer', message: msg, variant: 'error' });
      return false;
    } finally {
      setCustomerSaving(false);
    }
  };

  const resetForm = () => {
    setMemoDate(todayIso());
    setDueDate('');
    setMemoCurrency(MEMO_DEFAULT_CURRENCY);
    setMemoOrderDiscount(0);
    setMemoDiscountType('pct');
    setCustomerSearch('');
    setSelectedCustomer(null);
    setCustomers([]);
    setCcModal(null);
    setNewCustomerModalOpen(false);
    setCartImageLoadFailed(() => new Set());
    setItemSearch('');
    setMemoCatalogFilter('all');
    setCart([]);
    setEditingMemoId(null);
    setEditingMemoNo(null);
    setEditingMemoConvertedInvoiceId(null);
    setEditingMemoStatus(null);
  };

  const saveMemoDraft = useCallback(() => {
    if (editingMemoId != null) {
      showAlert({
        title: 'Draft unavailable in edit mode',
        message: 'Finish or cancel editing this memo before saving a draft.',
        variant: 'warning',
      });
      return;
    }
    const payload: MemoDraftPayload = {
      savedAt: new Date().toISOString(),
      memoDate,
      dueDate,
      memoCurrency,
      memoOrderDiscount,
      memoDiscountType,
      itemSearch,
      selectedCustomer,
      cart,
    };
    try {
      window.localStorage.setItem(MEMO_DRAFT_STORAGE_KEY, JSON.stringify(payload));
      showAlert({
        title: 'Draft saved',
        message: 'Memo draft was saved locally on this device.',
        variant: 'success',
      });
    } catch {
      showAlert({
        title: 'Could not save draft',
        message: 'Local storage is unavailable in this browser session.',
        variant: 'error',
      });
    }
  }, [
    cart,
    dueDate,
    editingMemoId,
    itemSearch,
    memoCurrency,
    memoDiscountType,
    memoDate,
    memoOrderDiscount,
    selectedCustomer,
    showAlert,
  ]);

  const loadMemoDraft = useCallback(() => {
    if (editingMemoId != null) {
      showAlert({
        title: 'Draft unavailable in edit mode',
        message: 'Finish or cancel editing this memo before loading a draft.',
        variant: 'warning',
      });
      return;
    }
    try {
      const raw = window.localStorage.getItem(MEMO_DRAFT_STORAGE_KEY);
      if (!raw) {
        showAlert({
          title: 'No draft found',
          message: 'There is no saved memo draft yet.',
          variant: 'info',
        });
        return;
      }
      const parsed = JSON.parse(raw) as Partial<MemoDraftPayload>;
      const draftCart = Array.isArray(parsed.cart) ? parsed.cart : [];
      setMemoDate(typeof parsed.memoDate === 'string' && parsed.memoDate ? parsed.memoDate : todayIso());
      setDueDate(typeof parsed.dueDate === 'string' ? parsed.dueDate : '');
      setMemoCurrency(
        normalizeCurrencyCode(
          typeof parsed.memoCurrency === 'string' && parsed.memoCurrency
            ? parsed.memoCurrency
            : MEMO_DEFAULT_CURRENCY
        )
      );
      setMemoOrderDiscount(roundMoney2(Number(parsed.memoOrderDiscount) || 0));
      setMemoDiscountType(parsed.memoDiscountType === 'flat' ? 'flat' : 'pct');
      setItemSearch(typeof parsed.itemSearch === 'string' ? parsed.itemSearch : '');
      setSelectedCustomer(parsed.selectedCustomer ?? null);
      setCustomerSearch('');
      setCustomers([]);
      setCart(
        draftCart.map(line => ({
          ...line,
          quantity: Math.max(1, Math.floor(Number(line.quantity) || 1)),
          maxQty: Math.max(1, Math.floor(Number(line.maxQty) || 1)),
          unit_price: Math.max(0, roundMoney2(Number(line.unit_price) || 0)),
          source_unit_price: Math.max(0, roundMoney2(Number(line.source_unit_price) || 0)),
          source_currency: normalizeCurrencyCode(line.source_currency || DEFAULT_CURRENCY_CODE),
        }))
      );
      setCartImageLoadFailed(() => new Set());
      showAlert({
        title: 'Draft loaded',
        message: 'Memo draft restored.',
        variant: 'success',
      });
    } catch {
      showAlert({
        title: 'Could not load draft',
        message: 'The saved draft is invalid or unreadable.',
        variant: 'error',
      });
    }
  }, [editingMemoId, showAlert]);

  const createMemo = async () => {
    if (cart.length === 0) {
      showAlert({
        title: 'Cannot create memo',
        message: 'Add at least one item to the memo before creating it.',
        variant: 'error',
      });
      return;
    }
    if (memoDueBeforeMemoDate(memoDate, dueDate)) {
      showAlert({
        title: 'Cannot create memo',
        message: 'Due date cannot be before the memo date. Fix the dates or leave due date empty.',
        variant: 'error',
      });
      return;
    }
    for (const c of cart) {
      const inv = resolveInventoryItemForMemoLine(c, availableItems);
      if (itemNeedsSoldCaratsInput(inv)) {
        const soldCt = parseSoldCaratsInput(memoCartSoldCaratsValue(c));
        const err = validateSoldCaratsForLot(inv.weight_carats, soldCt);
        if (err) {
          showAlert({
            title: 'Carat weight required',
            message: `${c.item_code || c.label}: ${err}`,
            variant: 'warning',
          });
          return;
        }
      }
      const q = Math.floor(Number(c.quantity));
      const p = Number(c.unit_price);
      if (!Number.isFinite(q) || q < 1 || q > c.maxQty) {
        showAlert({
          title: 'Cannot create memo',
          message: 'Each line needs a valid quantity (at least 1, and not more than available stock).',
          variant: 'error',
        });
        return;
      }
      if (!Number.isFinite(p) || p < 0) {
        showAlert({
          title: 'Cannot create memo',
          message: 'Unit prices cannot be negative. Correct the line or refresh the item from inventory.',
          variant: 'error',
        });
        return;
      }
    }
    setCreating(true);
    try {
      const res = await fetch(apiUrl('/api/memos'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          customer_id: selectedCustomer?.id || null,
          memo_date: memoDate,
          due_date: dueDate || null,
          notes: null,
          currency_code: memoCurrency,
          order_discount: memoCartOrderDiscount,
          items: cart.map(c => {
            const inv = resolveInventoryItemForMemoLine(c, availableItems);
            const soldCt = itemNeedsSoldCaratsInput(inv)
              ? parseSoldCaratsInput(memoCartSoldCaratsValue(c))
              : null;
            return {
              inventory_item_id: c.inventory_item_id,
              quantity: c.quantity,
              unit_price: memoLineApiUnit(c, memoCurrency, availableItems),
              discount: memoLineDerivedDiscount(c, memoCurrency, availableItems),
              item_code: c.item_code || null,
              description: c.description || null,
              ...(soldCt != null ? { weight_carats: soldCt } : {}),
            };
          }),
        }),
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to create memo'));
      const data = (await res.json()) as { id?: number; memo_no?: string };
      const newId = Number(data.id);
      resetForm();
      fetchMemos();
      onChangeView?.('open');
      const memoLabel = data.memo_no || 'Memo';
      if (Number.isFinite(newId) && newId > 0) {
        try {
          await openDetail(newId);
        } catch {
          /* detail error already surfaced */
        }
      }
      showAlert({
        title: 'Memo created',
        message: `${memoLabel} was created successfully.`,
        variant: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create memo';
      showAlert({ title: 'Could not create memo', message: msg, variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const openDetail = async (id: number) => {
    setDetailOpen(true);
    setDetailId(id);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setReturnDraft({});
    try {
      const res = await fetch(apiUrl(`/api/memos/${id}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load memo'));
      const data: MemoDetail = await res.json();
      setDetail(data);
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load memo';
      setDetailError(msg);
      showAlert({ title: 'Could not load memo', message: msg, variant: 'error' });
      throw err;
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailId(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  const openMemoEditInComposer = () => {
    if (!detail || !detailId) return;
    setMemoDate(detail.memo_date || todayIso());
    setDueDate(detail.due_date || '');
    setMemoCurrency(normalizeCurrencyCode(detail.currency_code || DEFAULT_CURRENCY_CODE));
    setMemoOrderDiscount(roundMoney2(Number(detail.order_discount || 0)));
    if (detail.customer_id != null) {
      setSelectedCustomer({
        id: detail.customer_id,
        name: detail.customer_name || 'Customer',
        phone: detail.customer_phone,
        email: detail.customer_email ?? null,
      });
    } else {
      setSelectedCustomer(null);
    }
    setCustomerSearch('');
    setCustomers([]);
    setItemSearch('');
    const initialCart = detailToComposerCart(detail);
    setCart(initialCart);
    setCartImageLoadFailed(() => new Set());
    const canEditLines = !detail.converted_invoice_id && detail.status !== 'Closed';
    if (canEditLines && initialCart.length > 0) {
      void (async () => {
        const enriched = await Promise.all(
          initialCart.map(async c => {
            try {
              const res = await fetch(apiUrl(`/api/inventory/${c.inventory_item_id}`), {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!res.ok) return c;
              const row = (await res.json()) as InventoryItem;
              const rem = Math.floor(
                Number(typeof row.pieces_remaining === 'number' ? row.pieces_remaining : row.pieces ?? 0)
              );
              const rq = Math.floor(Number(c.memoReturnedQty || 0));
              const q = Math.floor(Number(c.quantity) || 0);
              const onMemo = Math.max(0, q - rq);
              const maxQty = Math.max(1, q, onMemo + rem);
              const list = roundMoney2(Number(row.selling_total_price ?? 0));
              const listCur = normalizeCurrencyCode(row.selling_currency ?? DEFAULT_CURRENCY_CODE);
              return {
                ...c,
                maxQty,
                source_unit_price: list,
                source_carat_price: row.selling_carat_price ?? c.source_carat_price ?? null,
                source_currency: listCur,
              };
            } catch {
              return c;
            }
          })
        );
        setCart(enriched);
      })();
    }
    setEditingMemoId(detailId);
    setEditingMemoNo(detail.memo_no);
    setEditingMemoConvertedInvoiceId(detail.converted_invoice_id);
    setEditingMemoStatus(detail.status);
    onChangeView?.('create');
    setReturnDraft({});
    setDetailOpen(false);
    setDetailId(null);
    setDetail(null);
    setDetailError(null);
    window.setTimeout(() => {
      document.getElementById('memo-panel-create')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const saveMemoUpdate = async () => {
    if (!editingMemoId) return;
    if (memoDueBeforeMemoDate(memoDate, dueDate)) {
      showAlert({
        title: 'Invalid dates',
        message: 'Due date cannot be before the memo date.',
        variant: 'error',
      });
      return;
    }
    const linesEditable = !memoLinesReadOnly;
    if (linesEditable) {
      if (cart.length === 0) {
        showAlert({
          title: 'Memo needs lines',
          message: 'Add at least one item before saving.',
          variant: 'warning',
        });
        return;
      }
      for (const c of cart) {
        const rq = Math.floor(Number(c.memoReturnedQty || 0));
        const q = Math.floor(Number(c.quantity) || 0);
        const p = Number(c.unit_price);
        if (!Number.isFinite(q) || q < 1 || q < rq) {
          showAlert({
            title: 'Invalid quantity',
            message:
              rq > 0
                ? `Quantity cannot be below ${rq} — that many pieces were already returned on this line.`
                : 'Each line needs a valid quantity.',
            variant: 'error',
          });
          return;
        }
        if (!Number.isFinite(p) || p < 0) {
          showAlert({
            title: 'Invalid price',
            message: 'Unit prices cannot be negative.',
            variant: 'error',
          });
          return;
        }
        if (q > c.maxQty) {
          showAlert({
            title: 'Not enough stock',
            message: 'Increase a line quantity only if enough pieces are available.',
            variant: 'error',
          });
          return;
        }
        const inv = resolveInventoryItemForMemoLine(c, availableItems);
        if (itemNeedsSoldCaratsInput(inv)) {
          const soldCt = parseSoldCaratsInput(memoCartSoldCaratsValue(c));
          const err = validateSoldCaratsForLot(inv.weight_carats, soldCt);
          if (err) {
            showAlert({
              title: 'Carat weight required',
              message: `${c.item_code || c.label}: ${err}`,
              variant: 'warning',
            });
            return;
          }
        }
      }
    }
    const savedId = editingMemoId;
    setMemoUpdating(true);
    try {
      const body: {
        memo_date: string;
        due_date: string | null;
        order_discount: number;
        customer_id?: number | null;
        items?: Array<{
          memo_item_id: number | null;
          inventory_item_id: number;
          quantity: number;
          unit_price: number;
          discount: number;
          item_code: string | null;
          description: string | null;
          weight_carats?: number;
        }>;
      } = {
        memo_date: memoDate,
        due_date: dueDate.trim() || null,
        order_discount: memoCartOrderDiscount,
      };
      if (!editingMemoConvertedInvoiceId) {
        body.customer_id = selectedCustomer?.id ?? null;
      }
      if (linesEditable) {
        body.items = cart.map(c => {
          const inv = resolveInventoryItemForMemoLine(c, availableItems);
          const soldCt = itemNeedsSoldCaratsInput(inv)
            ? parseSoldCaratsInput(memoCartSoldCaratsValue(c))
            : null;
          return {
            memo_item_id: c.memoItemId ?? null,
            inventory_item_id: c.inventory_item_id,
            quantity: Math.floor(Number(c.quantity) || 0),
            unit_price: memoLineApiUnit(c, memoCurrency, availableItems),
            discount: memoLineDerivedDiscount(c, memoCurrency, availableItems),
            item_code: c.item_code ?? null,
            description: c.description ?? null,
            ...(soldCt != null ? { weight_carats: soldCt } : {}),
          };
        });
      }
      const res = await fetch(apiUrl(`/api/memos/${savedId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to update memo'));
      resetForm();
      fetchMemos();
      showAlert({
        title: 'Memo updated',
        message: 'Your changes were saved.',
        variant: 'success',
      });
      try {
        await openDetail(savedId);
      } catch {
        /* openDetail surfaces errors */
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update memo';
      showAlert({ title: 'Could not save memo', message: msg, variant: 'error' });
    } finally {
      setMemoUpdating(false);
    }
  };

  const deleteMemo = async () => {
    if (!detailId || !detail) return;
    if (detail.converted_invoice_id) {
      showAlert({
        title: 'Cannot delete',
        message: 'This memo was converted to an invoice and cannot be deleted.',
        variant: 'warning',
      });
      return;
    }
    const ok = await showConfirm({
      title: 'Delete memo?',
      message:
        'Delete this memo permanently? Any pieces still on memo (not yet returned) will be added back to inventory.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    setMemoEditDeleting(true);
    try {
      const res = await fetch(apiUrl(`/api/memos/${detailId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to delete memo'));
      closeDetail();
      fetchMemos();
      showAlert({
        title: 'Memo deleted',
        message: 'The memo was removed and remaining pieces were returned to stock.',
        variant: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete memo';
      showAlert({ title: 'Could not delete memo', message: msg, variant: 'error' });
    } finally {
      setMemoEditDeleting(false);
    }
  };

  useEffect(() => {
    if (!detailOpen && !memoConvertPaymentOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (memoConvertPaymentOpen) {
        setMemoConvertPaymentOpen(false);
        setMemoConvertSnapshot(null);
        return;
      }
      if (detailOpen) closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailOpen, memoConvertPaymentOpen, closeDetail]);

  const returnAll = async () => {
    if (!detailId) return;
    setActionBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/memos/${detailId}/return`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to return items'));
      await openDetail(detailId);
      fetchMemos();
      showAlert({
        title: 'Return recorded',
        message: 'All returnable pieces on this memo were returned to stock.',
        variant: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to return items';
      setDetailError(msg);
      showAlert({ title: 'Return failed', message: msg, variant: 'error' });
    } finally {
      setActionBusy(false);
    }
  };

  const returnSelected = async () => {
    if (!detailId || !detail) return;
    const plan = detail.items
      .map(it => {
        const remaining = Math.max(0, (it.quantity || 0) - (it.returned_qty || 0));
        const draft = Math.floor(Number(returnDraft[it.id] || 0));
        const qty = Math.max(0, Math.min(remaining, draft));
        return qty > 0 ? { memo_item_id: it.id, quantity: qty } : null;
      })
      .filter(Boolean) as { memo_item_id: number; quantity: number }[];

    if (plan.length === 0) {
      const msg = 'Enter a return quantity for at least one item.';
      setDetailError(msg);
      showAlert({ title: 'Nothing to return', message: msg, variant: 'warning' });
      return;
    }

    setActionBusy(true);
    setDetailError(null);
    try {
      const res = await fetch(apiUrl(`/api/memos/${detailId}/return`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items: plan }),
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to return items'));
      await openDetail(detailId);
      fetchMemos();
      showAlert({
        title: 'Return recorded',
        message: 'The selected quantities were returned to stock.',
        variant: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to return items';
      setDetailError(msg);
      showAlert({ title: 'Return failed', message: msg, variant: 'error' });
    } finally {
      setActionBusy(false);
    }
  };

  const cancelMemoConvertPayment = () => {
    setMemoConvertPaymentOpen(false);
    setMemoConvertSnapshot(null);
  };

  const convertToInvoice = () => {
    if (!detailId || !detail) return;
    setMemoConvertSnapshot({
      detailId,
      memoNo: detail.memo_no,
      currencyCode: normalizeCurrencyCode(detail.currency_code || DEFAULT_CURRENCY_CODE),
      total: computeMemoConvertInvoiceTotal(detail),
    });
    setMemoConvertPaymentOpen(true);
  };

  const submitMemoConvertWithPayment = async (paymentIntent: InvoicePaymentIntentResult) => {
    const convertId = memoConvertSnapshot?.detailId ?? detailId;
    if (!convertId) return;
    setActionBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/memos/${convertId}/convert-to-invoice`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          payment_mode: paymentIntent.payment_mode,
          payments: paymentIntent.payments,
        }),
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to convert memo'));
      const data = (await res.json()) as {
        invoice_id?: unknown;
        invoice_no?: string;
        total?: number;
        paid?: number;
        status?: string;
        customer_name?: string | null;
        currency_code?: string | null;
        created_at?: string;
        payments?: Array<{ method: string; amount: number; created_at: string }>;
      };
      const invoiceId = Number(data.invoice_id);
      if (Number.isFinite(invoiceId) && invoiceId > 0) {
        try {
          window.sessionStorage.setItem(
            SELLING_FROM_MEMO_CONVERT_INVOICE_KEY,
            JSON.stringify({
              invoiceId,
              summary: {
                invoice_no: data.invoice_no,
                total: data.total,
                paid: data.paid,
                status: data.status,
                customer_name: data.customer_name,
                currency_code: data.currency_code,
                created_at: data.created_at,
              },
              payments: data.payments ?? [],
            })
          );
        } catch {
          // ignore storage failures
        }
      }
      setMemoConvertPaymentOpen(false);
      setMemoConvertSnapshot(null);
      fetchMemos();
      closeDetail();
      onNavigate?.('selling');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to convert memo';
      setDetailError(msg);
      showAlert({ title: 'Could not convert memo', message: msg, variant: 'error' });
    } finally {
      setActionBusy(false);
    }
  };

  const printMemo = (d: MemoDetail) => {
    openMemoReceiptWindow({
      memo_no: d.memo_no,
      memo_date: d.memo_date,
      due_date: d.due_date,
      customer_name: d.customer_name,
      customer_phone: d.customer_phone,
      customer_email: d.customer_email,
      customer_address_line1: d.customer_address_line1,
      customer_address_line2: d.customer_address_line2,
      customer_city: d.customer_city,
      customer_postal_code: d.customer_postal_code,
      customer_country: d.customer_country,
      notes: d.notes,
      status: d.status,
      currency_code: d.currency_code,
      order_discount: d.order_discount,
      items: d.items.map(it => ({
        item_code: it.item_code,
        description: memoLineDescription(it),
        quantity: it.quantity,
        returned_qty: it.returned_qty,
        unit_price: it.unit_price,
        line_total: it.line_total,
        weight_grams: it.weight_grams,
        weight_carats: it.weight_carats,
        category: it.category,
        item_type: it.item_type,
      })),
    });
  };

  const itemModalListUnit =
    itemModalTarget != null
      ? memoUnitPrefillFromList(itemModalTarget, memoCurrency, itemModalQty, itemModalSoldCarats)
      : 0;
  const itemModalSoldCt =
    itemModalTarget != null && itemNeedsSoldCaratsInput(itemModalTarget)
      ? parseSoldCaratsInput(itemModalSoldCarats)
      : null;
  const itemModalListLineGross =
    itemModalTarget != null && itemNeedsSoldCaratsInput(itemModalTarget)
      ? lotListLineGross(itemModalTarget, itemModalSoldCt)
      : null;
  const itemModalPiecesAvail =
    itemModalTarget != null ? rawPiecesAvailForItem(itemModalTarget) : 0;
  const itemModalSellLine =
    itemModalTarget != null && itemNeedsSoldCaratsInput(itemModalTarget)
      ? lineGrossFromPerCt(itemModalUnitPrice, itemModalSoldCt)
      : roundMoney2(Math.max(0, itemModalUnitPrice) * Math.max(1, itemModalQty));
  const itemModalListBasis =
    itemModalListLineGross ?? roundMoney2(itemModalListUnit * Math.max(1, itemModalQty));
  const itemModalDiscount = Math.max(0, roundMoney2(itemModalListBasis - itemModalSellLine));
  const itemModalDiscountPct =
    itemModalListBasis > 0 ? roundMoney2((itemModalDiscount / itemModalListBasis) * 100) : 0;
  const itemModalSubtotal = itemModalSellLine;
  const itemModalPremium = Math.max(0, roundMoney2(itemModalSellLine - itemModalListBasis));
  const itemModalPremiumPct =
    itemModalListBasis > 0 ? roundMoney2((itemModalPremium / itemModalListBasis) * 100) : 0;
  const modalPriceDiff = roundMoney2(itemModalListBasis - itemModalSellLine);
  const modalShowSavingBanner = modalPriceDiff > 0.005;
  const modalShowAboveBanner = modalPriceDiff < -0.005;

  return (
    <div className="page page-memo">
      <div className="memo-tab-shell">
        {memoMainTab === 'create' && (
          <section className="memo-create-shell" aria-label="Create memo" id="memo-panel-create" role="tabpanel">
            <div className="page-selling">
              <div className="selling2-grid selling-pos-grid selling-pos-composer">
                <section className="selling-pos-catalog">
                  <div className="selling-pos-topbar">
                    <div className="selling-pos-search-inline">
                      <div className="selling2-search selling2-search--gem">
                        <span className="selling2-search-icon" aria-hidden="true">
                          <IconSearch />
                        </span>
                        <input
                          type="search"
                          value={itemSearch}
                          onChange={e => setItemSearch(e.target.value)}
                          className="selling2-search-input"
                          placeholder="Search by code, stone type, description..."
                          disabled={memoLinesReadOnly}
                        />
                      </div>
                    </div>
                    <div className="selling-pos-tabs" role="tablist" aria-label="Catalog filters">
                      {([
                        ['all', 'All'],
                        ['top', 'Top Sold'],
                        ['recent', 'Recent'],
                      ] as const).map(([id, label]) => {
                        const active = memoCatalogFilter === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            className={`selling-pos-tab${active ? ' is-active' : ''}`}
                            onClick={() => setMemoCatalogFilter(id)}
                            role="tab"
                            aria-selected={active}
                            disabled={memoLinesReadOnly}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {memoCatalogDisplayItems.length === 0 && !memoCatalogLoading ? (
                    <div className="selling-pos-catalog-body selling-pos-catalog-body--empty">
                      <div className="selling2-empty selling2-empty--gem">
                        <div className="selling2-empty-title">No items to show</div>
                        <div className="selling2-empty-sub">
                          {memoCatalogFilter === 'all'
                            ? 'Try another search or check inventory.'
                            : 'No recent invoice sales match yet — open All or adjust search.'}
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div className="selling-pos-catalog-body">
                    {memoCatalogLoading ? (
                      <p className="selling-pos-catalog-loading-hint" aria-live="polite">
                        Loading inventory…
                      </p>
                    ) : null}
                    <div className="selling-pos-cards">
                      {memoCatalogDisplayItems.map(it => {
                        const code = it.item_code || it.item_sticker || `#${it.id}`;
                        const cartLine = cart.find(c => c.inventory_item_id === it.id);
                        const inCart = !!cartLine;
                        const addedQty = cartLine ? memoLineQty(cartLine) : 0;
                        const avail = typeof it.pieces_remaining === 'number' ? it.pieces_remaining : it.pieces;
                        const imgSrc = memoItemImageSrc(it.image_path);
                        const showPlaceholder = !imgSrc || cartImageLoadFailed.has(it.id);
                        return (
                          <article key={it.id} className={`selling-pos-card${inCart ? ' is-in-cart' : ''}`}>
                            <div className="selling-pos-card-media">
                              {imgSrc && !cartImageLoadFailed.has(it.id) ? (
                                <img
                                  className="selling-pos-card-image"
                                  src={imgSrc}
                                  alt={code}
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
                              <div className="selling-pos-card-code">{code}</div>
                              <strong className="selling-pos-card-title">{it.category || code}</strong>
                              <div className="selling-pos-card-sub">
                                {it.item_type}
                                {it.weight_carats != null ? ` · ${it.weight_carats} ct` : ''}
                              </div>
                              <div className="selling-pos-card-price-row">
                                <span className="selling-pos-card-price">
                                  {formatUsdOnlyFromAny(Number(it.selling_total_price || 0), it.selling_currency ?? DEFAULT_CURRENCY_CODE, thbPerUnit)}
                                </span>
                              </div>
                              <button
                                type="button"
                                className={`selling-pos-card-add${inCart ? ' is-in-cart' : ''}`}
                                onClick={() => openItemModal(it)}
                                disabled={memoLinesReadOnly || avail <= 0}
                              >
                                {!inCart ? 'Add to memo' : `Add More (${addedQty})`}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                  )}
                </section>

                <section className="selling-pos-summary" aria-label="Current memo">
                  <div className="selling-pos-summary-head">
                    <h3>Current Memo</h3>
                    <span
                      className="selling-pos-order-count-pill"
                      aria-label={`${cart.reduce((sum, item) => sum + memoLineQty(item), 0)} items`}
                    >
                      {cart.length === 0
                        ? '0 items'
                        : `${cart.reduce((sum, item) => sum + memoLineQty(item), 0)} ${
                            cart.reduce((s, i) => s + memoLineQty(i), 0) === 1 ? 'item' : 'items'
                          }`}
                    </span>
                  </div>
                  <div className="selling-pos-cc selling-pos-cc--bar">
                    <div className="selling-pos-cc-row">
                      <div className="selling-pos-cc-pair">
                        <button type="button" className="selling-pos-cc-btn" onClick={() => setCcModal('customer')}>
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
                              SUPPORTED_CURRENCIES.find(c => c.code === normalizeCurrencyCode(memoCurrency))?.label ??
                              memoCurrency
                            }
                          >
                            {SUPPORTED_CURRENCIES.find(c => c.code === normalizeCurrencyCode(memoCurrency))?.label ??
                              memoCurrency}
                          </span>
                        </button>
                      </div>
                    </div>
                    <div className="memo-pos-cc-date-strip">
                      <div className="memo-create-date-row">
                        <div className="memo-create-date-field">
                          <label htmlFor="memo-pos-date-memo" className="memo-create-date-label">
                            Memo date
                          </label>
                          <div className="memo-create-date-input-wrap">
                            <input
                              id="memo-pos-date-memo"
                              type="date"
                              className="memo-create-date-input"
                              value={memoDate}
                              onChange={e => setMemoDate(e.target.value)}
                              disabled={memoLinesReadOnly}
                              aria-label="Memo date"
                            />
                            <span className="memo-create-date-cal-icon" aria-hidden="true">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                <line x1="16" y1="2" x2="16" y2="6" />
                                <line x1="8" y1="2" x2="8" y2="6" />
                                <line x1="3" y1="10" x2="21" y2="10" />
                              </svg>
                            </span>
                          </div>
                        </div>
                        <div className="memo-create-date-field memo-create-date-field--optional">
                          <label htmlFor="memo-pos-date-due" className="memo-create-date-label">
                            Due date
                          </label>
                          <div className="memo-create-date-input-wrap">
                            <input
                              id="memo-pos-date-due"
                              type="date"
                              className={`memo-create-date-input memo-create-date-input--due${dueDate ? '' : ' memo-create-date-input--empty'}`}
                              value={dueDate}
                              onChange={e => setDueDate(e.target.value)}
                              disabled={memoLinesReadOnly}
                              aria-label="Due date"
                              min={memoDate || undefined}
                            />
                            <span className="memo-create-date-cal-icon" aria-hidden="true">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                <line x1="16" y1="2" x2="16" y2="6" />
                                <line x1="8" y1="2" x2="8" y2="6" />
                                <line x1="3" y1="10" x2="21" y2="10" />
                              </svg>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="selling-pos-cart-scroll">
                    <div className="selling-pos-cart-lines">
                      {cart.length === 0 ? (
                        <div className="selling-pos-cart-empty">No items in the bill yet.</div>
                      ) : (
                        cart.map(c => {
                          const qty = memoLineQty(c);
                          const maxPcs = Math.max(1, Math.floor(Number(c.maxQty) || 1));
                          const lineNet = memoLineSellTotal(c);
                          const lineDiscount = memoLineDerivedDiscount(c, memoCurrency, availableItems);
                          const imgSrc = memoItemImageSrc(c.image_path);
                          const showPlaceholder = !imgSrc || cartImageLoadFailed.has(c.inventory_item_id);
                          const codeLabel = c.item_code || `#${c.inventory_item_id}`;
                          const displayName = (c.category || codeLabel).replace(/_/g, ' ');
                          const typeCtLabel = `${(c.item_type || 'item').replace(/_/g, ' ').toLowerCase()}${soldCaratsCartSuffix(
                            c.weight_carats
                          )}`;
                          return (
                            <div key={c.inventory_item_id} className="selling-pos-line">
                              <div className="selling-pos-line-thumb">
                                {imgSrc && !cartImageLoadFailed.has(c.inventory_item_id) ? (
                                  <img
                                    className="selling2-item-thumb"
                                    src={imgSrc}
                                    alt=""
                                    loading="lazy"
                                    onError={() =>
                                      setCartImageLoadFailed(prev => new Set(prev).add(c.inventory_item_id))
                                    }
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
                                  <span className="selling-pos-line-unit">
                                    {formatMoneyAmount(memoLineSellUnit(c), memoCurrency)}
                                    {memoCartSoldCaratsValue(c) != null ? '/ct' : ''}
                                  </span>
                                  {lineDiscount > 0 ? (
                                    <span className="selling-pos-line-discount">
                                      -{formatMoneyAmount(lineDiscount, memoCurrency)} off
                                    </span>
                                  ) : null}
                                </div>
                                <div className="selling-pos-line-controls">
                                  <button
                                    type="button"
                                    onClick={() => bumpMemoQtyForLine(c, -1)}
                                    disabled={qty <= 1 || memoLinesReadOnly}
                                  >
                                    −
                                  </button>
                                  <input
                                    type="number"
                                    value={qty}
                                    min={1}
                                    max={maxPcs}
                                    step={1}
                                    disabled={memoLinesReadOnly}
                                    onChange={e => setMemoQtyForLine(c, Number(e.target.value))}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => bumpMemoQtyForLine(c, 1)}
                                    disabled={qty >= maxPcs || memoLinesReadOnly}
                                  >
                                    +
                                  </button>
                                  <span className="selling-pos-line-equals">
                                    = {formatMoneyAmount(lineNet, memoCurrency)}
                                  </span>
                                </div>
                              </div>
                              <div className="selling-pos-line-side">
                                <input
                                  id={`memo-line-unit-${c.inventory_item_id}`}
                                  type="number"
                                  className="selling2-unit-price-input"
                                  value={memoLineSellUnit(c)}
                                  min={0}
                                  step={0.01}
                                  title={`Unit price (${memoCurrency})`}
                                  disabled={memoLinesReadOnly}
                                  onChange={e => setMemoCartLineUnitPrice(c, e.target.value)}
                                />
                                <button
                                  type="button"
                                  className="selling-pos-line-action"
                                  onClick={() => openItemModalEditFromCart(c)}
                                  aria-label="Edit line details"
                                  title="Edit line details"
                                  disabled={memoLinesReadOnly}
                                >
                                  <IconEdit />
                                </button>
                                <button
                                  type="button"
                                  className="selling2-trash"
                                  onClick={() => removeCartItem(c.inventory_item_id)}
                                  disabled={memoLinesReadOnly}
                                  aria-label="Remove"
                                >
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
                      <div className="selling2-summary-row"><span>Subtotal</span><strong>{formatMoneyAmount(memoCartSubtotalGross, memoCurrency)}</strong></div>
                      <div className="selling2-summary-row"><span>Item discounts</span><span className="selling2-neg">−{formatMoneyAmount(memoCartItemsDiscountTotal, memoCurrency)}</span></div>
                      <div className="selling2-summary-row">
                        <span>Order discount</span>
                        <div className="selling-pos-order-discount-input">
                          <input
                            type="number"
                            value={memoOrderDiscount}
                            onChange={e => setMemoOrderDiscount(parseMoneyInput(e.target.value))}
                            min={0}
                            disabled={memoLinesReadOnly}
                          />
                          <div className="selling-pos-discount-type">
                            <button
                              type="button"
                              className={memoDiscountType === 'pct' ? 'is-active' : ''}
                              onClick={() => setMemoDiscountType('pct')}
                              disabled={memoLinesReadOnly}
                            >
                              %
                            </button>
                            <button
                              type="button"
                              className={memoDiscountType === 'flat' ? 'is-active' : ''}
                              onClick={() => setMemoDiscountType('flat')}
                              disabled={memoLinesReadOnly}
                            >
                              {memoCurrency}
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="selling2-summary-row"><span>Net total</span><strong>{formatMoneyAmount(memoCartNetTotal, memoCurrency)}</strong></div>
                    </div>
                    <button
                      type="button"
                      className="selling2-btn-primary"
                      onClick={() => (editingMemoId != null ? saveMemoUpdate() : createMemo())}
                      disabled={creating || memoUpdating || cart.length === 0}
                    >
                      {creating ? 'Creating…' : memoUpdating ? 'Saving…' : editingMemoId != null ? 'Save changes' : 'Create memo'}
                    </button>
                    <div className="selling2-draft-actions selling2-gem-btn-row">
                      <button type="button" className="selling2-draft-btn selling2-draft-btn--new" onClick={resetForm} disabled={creating || memoUpdating}>
                        New memo
                      </button>
                      <button type="button" className="selling2-draft-btn selling2-draft-btn--save" onClick={saveMemoDraft} disabled={creating || memoUpdating}>
                        Save draft
                      </button>
                      <button type="button" className="selling2-draft-btn selling2-draft-btn--load" onClick={loadMemoDraft} disabled={creating || memoUpdating}>
                        Load draft
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </section>
        )}

        {memoMainTab === 'open' && (
        <section role="tabpanel" id="memo-panel-open" aria-label="Open memos">
          <section className="payments-kpi-grid memos-kpi-grid" aria-label="Memo summary stats">
            <div className="dashT-kpi-sum dashT-kpi-sum--blue memos-kpi-sum">
              <div className="dashT-kpi-sum__top">
                <span className="dashT-kpi-sum__label">Open memos</span>
                <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--blue" aria-hidden="true">
                  <IconKpiMemoClipboard />
                </div>
              </div>
              <div className="dashT-kpi-sum__value">{totals.openCount}</div>
              <div className="payments-kpi-sub memos-kpi-sub">
                {memoKpiStats?.memos_in_scope ?? 0} in scope · open & partially returned · matches search &
                status filter
              </div>
            </div>
            <div className="dashT-kpi-sum dashT-kpi-sum--pink memos-kpi-sum">
              <div className="dashT-kpi-sum__top">
                <span className="dashT-kpi-sum__label">Overdue memos</span>
                <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--pink" aria-hidden="true">
                  <IconKpiAlertCircle />
                </div>
              </div>
              <div className="dashT-kpi-sum__value">{totals.overdueCount}</div>
              <div className="payments-kpi-sub memos-kpi-sub">Past due date · same scope as the other tiles</div>
            </div>
            <div className="dashT-kpi-sum dashT-kpi-sum--orange memos-kpi-sum">
              <div className="dashT-kpi-sum__top">
                <span className="dashT-kpi-sum__label">Items on memo</span>
                <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--orange" aria-hidden="true">
                  <IconKpiPackage />
                </div>
              </div>
              <div className="dashT-kpi-sum__value">{totals.itemsOnMemo}</div>
              <div className="payments-kpi-sub memos-kpi-sub">Total pieces on open memos in scope</div>
            </div>
            <div className="dashT-kpi-sum dashT-kpi-sum--green memos-kpi-sum">
              <div className="dashT-kpi-sum__top">
                <span className="dashT-kpi-sum__label">Total memo value</span>
                <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--green" aria-hidden="true">
                  <IconKpiBanknote />
                </div>
              </div>
              <div className="dashT-kpi-sum__value">{formatUsdOnlyFromThb(totals.totalValueThb, thbPerUnit)}</div>
              <div className="payments-kpi-sub memos-kpi-sub">
                Open memos · USD from Profile rates · full line totals for current search & status
                {memoListTruncated ? ' · table lists first 300' : ''}
              </div>
            </div>
          </section>
        <section className="memo-card">
          <div className="memo-card-head">
            <h3 className="selling-section-title">Open Memos</h3>
            <div className="memo-card-sub">Search and manage memos.</div>
          </div>

          <div className="selling-invoices-toolbar">
            <div className="selling-invoices-search-wrap">
              <span className="selling-invoices-search-icon" aria-hidden="true">
                <IconSearch />
              </span>
              <input
                type="search"
                className="selling-invoices-search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search memo # or customer"
                aria-label="Search memos"
              />
            </div>
            <div className="selling-invoices-filters" role="tablist" aria-label="Memo status filters">
              {(['all', 'Open', 'Partially Returned', 'Closed'] as const).map(key => {
                const label = key === 'all' ? 'All' : key === 'Partially Returned' ? 'Partial' : key;
                const active = statusFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`selling-invoices-filter${active ? ' is-active' : ''}`}
                    onClick={() => setStatusFilter(key)}
                    role="tab"
                    aria-selected={active}
                    title={key === 'Partially Returned' ? 'Partially Returned' : undefined}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="memo-table-wrap">
            <table className="memo-table memo-table--list" aria-label="Memos">
              <thead>
                <tr>
                  <th scope="col">Memo #</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Date</th>
                  <th scope="col">Due</th>
                  <th scope="col" className="right">
                    Items
                  </th>
                  <th scope="col" className="right">
                    Value
                  </th>
                  <th scope="col" className="memo-th-center">
                    Status
                  </th>
                  <th scope="col" className="memo-th-center">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="memo-empty-cell">
                      Loading…
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={8} className="memo-empty-cell">
                      {error}
                    </td>
                  </tr>
                ) : memos.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="memo-empty-cell">
                      No memos.
                    </td>
                  </tr>
                ) : (
                  memos.map(m => {
                    const overdue =
                      m.status !== 'Closed' && m.due_date
                        ? new Date(m.due_date).getTime() < new Date(todayIso()).getTime()
                        : false;
                    return (
                      <tr key={m.id}>
                        <td>
                          <button
                            type="button"
                            className="memo-no-btn"
                            onClick={() => openDetail(m.id)}
                          >
                            {m.memo_no}
                          </button>
                        </td>
                        <td>
                          <div className="memo-cust">{m.customer_name || 'Walk-in'}</div>
                          {m.customer_phone ? (
                            <div className="memo-cust-sub">{m.customer_phone}</div>
                          ) : null}
                        </td>
                        <td className="memo-cell-muted">{m.memo_date}</td>
                        <td className={overdue ? 'memo-due memo-due--over' : 'memo-cell-muted memo-due'}>
                          {m.due_date || '—'}
                        </td>
                        <td className="right memo-cell-numeric">{m.items_count}</td>
                        <td className="right memo-cell-numeric">
                          {formatMoneyAmount(Number(m.total_value) || 0, m.currency_code || DEFAULT_CURRENCY_CODE)}
                        </td>
                        <td className="memo-td-center">
                          <span
                            className={`memo-status memo-status--${String(m.status).toLowerCase().replace(/\s+/g, '-')}`}
                          >
                            {m.status}
                          </span>
                        </td>
                        <td className="memo-actions memo-td-center">
                          <button
                            type="button"
                            className="memo-action-btn memo-action-btn--view"
                            aria-label={`View ${m.memo_no}`}
                            onClick={() => openDetail(m.id)}
                          >
                            <IconEye />
                          </button>
                          <button
                            type="button"
                            className="memo-action-btn memo-action-btn--print"
                            aria-label={`Print ${m.memo_no}`}
                            onClick={async () => {
                              try {
                                const d = await openDetail(m.id);
                                printMemo(d);
                              } catch {
                                // error is shown in modal state
                              }
                            }}
                          >
                            <IconPrinter />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
        </section>
        )}
      </div>

      {itemModalOpen && itemModalTarget && (
        <div className="page-selling">
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
                    {memoItemImageSrc(itemModalTarget.image_path) ? (
                      <img src={memoItemImageSrc(itemModalTarget.image_path)} alt="" />
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
                        {itemModalTarget && itemNeedsSoldCaratsInput(itemModalTarget)
                          ? 'List price (this sale)'
                          : 'Selling Price'}
                      </div>
                      <div className="selling-pos-item-modal-price-cell-value selling-pos-item-modal-price-cell-value--sell">
                        {itemModalListLineGross != null
                          ? formatMoneyAmount(itemModalListLineGross, memoCurrency)
                          : formatMoneyAmount(itemModalListUnit, memoCurrency)}
                      </div>
                      {itemModalTarget &&
                      itemNeedsSoldCaratsInput(itemModalTarget) &&
                      itemModalTarget.selling_carat_price != null &&
                      Number(itemModalTarget.selling_carat_price) > 0 ? (
                        <div className="selling-pos-item-modal-carats-hint">
                          {formatMoneyAmount(Number(itemModalTarget.selling_carat_price), memoCurrency)}/ct
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="selling-pos-item-modal-unit-row">
                    <div className="selling-pos-item-modal-unit-label">
                      <IconEdit />
                      <span>
                        {itemModalTarget && itemNeedsSoldCaratsInput(itemModalTarget)
                          ? 'Price per ct'
                          : 'Unit Price'}
                      </span>
                    </div>
                    <div className="selling-pos-item-modal-unit-input-wrap">
                      <span className="selling-pos-item-modal-unit-currency">{currencySymbolFor(memoCurrency)}</span>
                      <input
                        ref={itemModalUnitPriceInputRef}
                        type="number"
                        className="selling-pos-item-modal-unit-input"
                        value={itemModalUnitPrice}
                        min={0}
                        step={0.01}
                        onChange={e => {
                          itemModalUnitPriceManualRef.current = true;
                          setItemModalUnitPrice(Math.max(0, parseMoneyInput(e.target.value)));
                        }}
                        aria-label={
                          itemModalTarget && itemNeedsSoldCaratsInput(itemModalTarget)
                            ? `Price per carat (${memoCurrency})`
                            : `Unit price (${memoCurrency})`
                        }
                      />
                      {itemModalTarget && itemNeedsSoldCaratsInput(itemModalTarget) ? (
                        <span className="selling-pos-item-modal-unit-currency">/ct</span>
                      ) : null}
                    </div>
                  </div>

                  {modalShowSavingBanner ? (
                    <div className="selling-pos-item-modal-savings selling-pos-item-modal-savings--save">
                      <div className="selling-pos-item-modal-savings-left">
                        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                          <line x1="7" y1="7" x2="7.01" y2="7" />
                        </svg>
                        <span>Saving {formatMoneyAmount(itemModalDiscount, memoCurrency)}</span>
                      </div>
                      <span className="selling-pos-item-modal-savings-pct">{itemModalDiscountPct}% off</span>
                    </div>
                  ) : null}
                  {modalShowAboveBanner ? (
                    <div className="selling-pos-item-modal-savings selling-pos-item-modal-savings--above">
                      <div className="selling-pos-item-modal-savings-left">
                        <span>{formatMoneyAmount(itemModalPremium, memoCurrency)} above list</span>
                      </div>
                      <span className="selling-pos-item-modal-savings-pct">+{itemModalPremiumPct}%</span>
                    </div>
                  ) : null}
                </section>

                {itemModalTarget && itemNeedsSoldCaratsInput(itemModalTarget) ? (
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
                          aria-label="Total carat weight for pieces on memo"
                        />
                        <span className="selling-pos-item-modal-unit-currency">ct</span>
                      </div>
                    </div>
                    <p className="selling-pos-item-modal-carats-hint">
                      Enter weight for this memo (item has {itemModalTarget.weight_carats} ct remaining).
                      Line total = price per ct × carats.
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
                            Math.min(maxPcsForMemoModalItem(itemModalTarget), prev + 1)
                          )
                        }
                        disabled={itemModalQty >= maxPcsForMemoModalItem(itemModalTarget)}
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="selling-pos-item-modal-subtotal-bar">
                    <span className="selling-pos-item-modal-subtotal-label">Subtotal</span>
                    <span className="selling-pos-item-modal-subtotal-value">
                      {formatMoneyAmount(itemModalSubtotal, memoCurrency)}
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
                    setItemModalSoldCarats('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="selling-pos-item-modal-btn selling-pos-item-modal-btn--add"
                  onClick={confirmItemModalAdd}
                  aria-label={itemModalFromCartEdit ? 'Save changes' : 'Add to memo'}
                >
                  {itemModalFromCartEdit ? <IconCheck /> : <IconCartModal />}
                  {itemModalFromCartEdit ? 'Save changes' : 'Add to memo'}
                </button>
              </footer>
            </div>
          </div>
        </div>
      )}

      {detailOpen && !memoConvertPaymentOpen && (
        <div
          className="memo-modal-overlay memo-modal-overlay--vault"
          role="dialog"
          aria-modal="true"
          aria-labelledby="memo-detail-title"
          onClick={e => {
            if (e.target === e.currentTarget) closeDetail();
          }}
        >
          <div className="memo-detail-v2" onClick={e => e.stopPropagation()}>
            <div className="memo-detail-v2-mhdr">
              <div className="memo-detail-v2-hl">
                <div className="memo-detail-v2-hicon" aria-hidden="true">
                  <IconMemoDetailDoc20 />
                </div>
                <div>
                  <div className="memo-detail-v2-memo-id" id="memo-detail-title">
                    {detailLoading ? 'Memo details' : detailError ? 'Memo' : detail?.memo_no ?? 'Memo'}
                  </div>
                  {!detailLoading && detail ? (
                    <div className="memo-detail-v2-mcust">
                      <span className="memo-detail-v2-cavatar">{memoDetailCustomerInitial(detail.customer_name)}</span>
                      {memoDetailDisplayCustomer(detail)}
                    </div>
                  ) : null}
                  {!detailLoading && !detail && !detailError ? (
                    <div className="memo-detail-v2-mcust" style={{ opacity: 0.85 }}>
                      Loading…
                    </div>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className="memo-detail-v2-xbtn"
                onClick={closeDetail}
                aria-label="Close memo details"
              >
                <IconMemoDetailClose13 />
              </button>
            </div>

            {!detailLoading && detail ? (
              <>
                {(() => {
                  const detailCur = detail.currency_code || DEFAULT_CURRENCY_CODE;
                  const dueRaw = (detail.due_date || '').trim();
                  const dueOverdue = memoDetailDueOverdue(detail);
                  const dueDisplay = dueRaw ? formatMemoDetailDisplayDate(dueRaw) : 'Not set';
                  return (
                    <div className="memo-detail-v2-srow">
                      <div className="memo-detail-v2-sc">
                        <span className="memo-detail-v2-sl">Memo date</span>
                        <span className="memo-detail-v2-sv">{formatMemoDetailDisplayDate(detail.memo_date)}</span>
                      </div>
                      <div className="memo-detail-v2-sc">
                        <span className="memo-detail-v2-sl">Due date</span>
                        <span
                          className={
                            dueRaw
                              ? dueOverdue
                                ? 'memo-detail-v2-sv memo-detail-v2-sv--due-bad'
                                : 'memo-detail-v2-sv'
                              : 'memo-detail-v2-sv memo-detail-v2-sv--muted'
                          }
                        >
                          {dueDisplay}
                        </span>
                      </div>
                      <div className="memo-detail-v2-sc">
                        <span className="memo-detail-v2-sl">Status</span>
                        {memoDetailStatusPill(detail.status)}
                      </div>
                      <div className="memo-detail-v2-sc">
                        <span className="memo-detail-v2-sl">Total ({detailCur})</span>
                        <span className="memo-detail-v2-sv memo-detail-v2-sv--big">
                          {formatUsdOnlyFromAny(
                            detail.items.reduce((s, it) => s + memoDetailRemainingLineValue(it), 0),
                            detailCur,
                            thbPerUnit
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })()}
                <div className="memo-detail-v2-dv" aria-hidden="true" />
              </>
            ) : null}

            <div className="memo-detail-v2-mbody">
              {detailLoading ? <div className="memo-detail-v2-state">Loading memo…</div> : null}
              {!detailLoading && detailError ? (
                <div className="memo-detail-v2-state memo-detail-v2-state--error">{detailError}</div>
              ) : null}
              {!detailLoading && detail ? (
                <>
                  {detail.notes ? <div className="memo-detail-v2-notes">{detail.notes}</div> : null}
                  {(() => {
                    const detailCur = detail.currency_code || DEFAULT_CURRENCY_CODE;
                    const nItems = detail.items.length;
                    return (
                      <div className="memo-detail-v2-isec">
                        <div className="memo-detail-v2-ihdr">
                          <span className="memo-detail-v2-ititle">Memo items</span>
                          <span className="memo-detail-v2-ibadge">
                            {nItems} {nItems === 1 ? 'item' : 'items'}
                          </span>
                        </div>
                        {detail.items.map(it => {
                          const remaining = Math.max(0, (it.quantity || 0) - (it.returned_qty || 0));
                          const draft = Math.floor(Number(returnDraft[it.id] || 0));
                          const draftClamped = Math.max(0, Math.min(remaining, draft));
                          const remAmt = memoReceiptLineRemainingAmounts({
                            item_code: it.item_code,
                            description: it.description,
                            quantity: it.quantity,
                            returned_qty: it.returned_qty,
                            unit_price: it.unit_price,
                            line_total: it.line_total,
                          });
                          const codeStr = (it.item_code || '').trim() || `#${it.inventory_item_id}`;
                          const ctLine = memoDetailModalItemCt(it);
                          const typeLine = memoDetailModalItemType(it);
                          const discShow = remAmt.lineDiscRem > 0.0001;
                          return (
                            <div key={it.id} className="memo-detail-v2-ic">
                              <div className="memo-detail-v2-ith" aria-hidden="true">
                                {it.image_path ? (
                                  <img src={memoItemImageSrc(it.image_path)} alt="" />
                                ) : (
                                  '💎'
                                )}
                              </div>
                              <div className="memo-detail-v2-ii">
                                <div className="memo-detail-v2-in">{codeStr}</div>
                                <div className="memo-detail-v2-im">
                                  {ctLine ? <span className="memo-detail-v2-chip">{ctLine}</span> : null}
                                  {typeLine ? <span className="memo-detail-v2-chip">{typeLine}</span> : null}
                                </div>
                                <div className="memo-detail-v2-is">
                                  <div className="memo-detail-v2-ist">
                                    <span className="memo-detail-v2-il">Qty</span>
                                    <span className="memo-detail-v2-iv memo-detail-v2-iv--b">{it.quantity}</span>
                                  </div>
                                  <div className="memo-detail-v2-ist">
                                    <span className="memo-detail-v2-il">Returned</span>
                                    <span className="memo-detail-v2-iv memo-detail-v2-iv--a">{it.returned_qty}</span>
                                  </div>
                                  <div className="memo-detail-v2-ist">
                                    <span className="memo-detail-v2-il">Remaining</span>
                                    <span className="memo-detail-v2-iv memo-detail-v2-iv--g">{remaining}</span>
                                  </div>
                                  <div className="memo-detail-v2-ist">
                                    <span className="memo-detail-v2-il">Discount</span>
                                    <span className="memo-detail-v2-iv memo-detail-v2-iv--m">
                                      {discShow ? `−${formatMoneyAmount(remAmt.lineDiscRem, detailCur)}` : '—'}
                                    </span>
                                  </div>
                                  <div className="memo-detail-v2-ist">
                                    <span className="memo-detail-v2-il">Return qty</span>
                                    <input
                                      className="memo-detail-v2-qi"
                                      type="number"
                                      min={0}
                                      max={remaining}
                                      disabled={actionBusy || detail.status === 'Closed' || remaining === 0}
                                      value={Number.isFinite(draftClamped) ? draftClamped : 0}
                                      onChange={e => {
                                        const v = Math.max(0, Math.min(remaining, Math.floor(Number(e.target.value) || 0)));
                                        setReturnDraft(prev => ({ ...prev, [it.id]: v }));
                                      }}
                                      aria-label={`Return quantity for ${codeStr}`}
                                    />
                                  </div>
                                </div>
                              </div>
                              <div className="memo-detail-v2-ipr">
                                <span className="memo-detail-v2-plab">Net / pc</span>
                                <span className="memo-detail-v2-pval">{formatMoneyAmount(memoDetailNetUnit(it), detailCur)}</span>
                                <span className="memo-detail-v2-plab" style={{ marginTop: 7 }}>
                                  Subtotal
                                </span>
                                <span className="memo-detail-v2-pval memo-detail-v2-pval--green">
                                  {formatMoneyAmount(remAmt.lineGrossRem, detailCur)}
                                </span>
                                <span className="memo-detail-v2-plab" style={{ marginTop: 7 }}>
                                  Rem. value
                                </span>
                                <span className="memo-detail-v2-pval memo-detail-v2-pval--muted">
                                  {formatMoneyAmount(remAmt.lineNetRem, detailCur)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              ) : null}
            </div>

            {!detailLoading && detail ? (
              <footer className="memo-detail-v2-foot">
                <button
                  type="button"
                  className="memo-detail-v2-btn memo-detail-v2-btn--secondary"
                  onClick={openMemoEditInComposer}
                  disabled={actionBusy || memoEditDeleting}
                >
                  <IconPencil12 />
                  Edit Memo
                </button>
                <button
                  type="button"
                  className="memo-detail-v2-btn memo-detail-v2-btn--danger"
                  onClick={deleteMemo}
                  disabled={actionBusy || memoEditDeleting || !!detail.converted_invoice_id}
                  title={
                    detail.converted_invoice_id ? 'Converted memos cannot be deleted' : 'Delete memo and restock remaining pieces'
                  }
                >
                  <IconTrash12 />
                  Delete
                </button>
                <button type="button" className="memo-detail-v2-btn memo-detail-v2-btn--secondary" onClick={() => printMemo(detail)}>
                  <IconPrint12 />
                  Print
                </button>
                <div className="memo-detail-v2-fsep" aria-hidden="true" />
                <button
                  type="button"
                  className="memo-detail-v2-btn memo-detail-v2-btn--return"
                  onClick={returnSelected}
                  disabled={actionBusy || detail.status === 'Closed'}
                  title="Return only the quantities you entered"
                >
                  <IconReturnSelected12 />
                  Return Selected
                </button>
                <button
                  type="button"
                  className="memo-detail-v2-btn memo-detail-v2-btn--return"
                  onClick={returnAll}
                  disabled={actionBusy || detail.status === 'Closed'}
                >
                  <IconReturnAll12 />
                  Return All
                </button>
                <button
                  type="button"
                  className="memo-detail-v2-btn memo-detail-v2-btn--convert"
                  onClick={convertToInvoice}
                  disabled={actionBusy || detail.status === 'Closed' || !!detail.converted_invoice_id}
                >
                  <IconConvertMemo12 />
                  Convert to Invoice
                </button>
              </footer>
            ) : null}

            {(detailLoading || detailError) && (
              <footer className="memo-detail-v2-foot memo-detail-v2-foot--minimal">
                <button type="button" className="memo-detail-v2-btn memo-detail-v2-btn--secondary" onClick={closeDetail}>
                  Close
                </button>
              </footer>
            )}
          </div>
        </div>
      )}

      {(ccModal === 'customer' || ccModal === 'currency') && (
        <div className="page-selling">
          {ccModal === 'customer' && (
            <div
              className="selling2-modal-overlay selling-pos-cc-modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="memo-cc-customer-title"
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
                      <h3 id="memo-cc-customer-title">Select customer</h3>
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
                  <label className="selling-pos-cc-modal-search-label" htmlFor="memo-cc-customer-search">
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
                      id="memo-cc-customer-search"
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
                              {c.phone ? <span className="selling-pos-cc-customer-option-phone">{c.phone}</span> : null}
                              {c.phone && c.email ? <span className="selling-pos-cc-customer-option-dot"> · </span> : null}
                              {c.email ? <span className="selling-pos-cc-customer-option-email">{c.email}</span> : null}
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
              aria-labelledby="memo-cc-currency-title"
              onClick={() => setCcModal(null)}
            >
              <div
                className="selling2-modal selling-pos-cc-modal selling-pos-cc-modal--pickers selling-pos-cc-modal--currency"
                onClick={e => e.stopPropagation()}
              >
                <div className="selling2-modal-header selling-pos-cc-modal-head">
                  <h3 id="memo-cc-currency-title">Select currency</h3>
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
                      const active = normalizeCurrencyCode(memoCurrency) === c.code;
                      return (
                        <button
                          key={c.code}
                          type="button"
                          className={`selling-pos-cc-cur-option${active ? ' is-selected' : ''}`}
                          onClick={() => {
                            applyMemoCurrency(c.code);
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
        </div>
      )}

      {newCustomerModalOpen && (
        <div
          className="selling-new-customer-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="memo-new-customer-title"
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
                <span id="memo-new-customer-title" className="selling-new-customer-title">
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
                  Billing address <span className="selling-new-customer-heading-note">· optional, shown on receipts</span>
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
        open={memoConvertPaymentOpen}
        title="How is this invoice being paid?"
        subtitle={
          memoConvertSnapshot
            ? `Converting memo ${memoConvertSnapshot.memoNo} to invoice`
            : undefined
        }
        total={memoConvertSnapshot?.total ?? 0}
        currencyCode={memoConvertSnapshot?.currencyCode ?? DEFAULT_CURRENCY_CODE}
        busy={actionBusy}
        onCancel={cancelMemoConvertPayment}
        onConfirm={payload => void submitMemoConvertWithPayment(payload)}
      />
    </div>
  );
};

