import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

/** Default memo currency for new memos (matches Selling). */
const MEMO_DEFAULT_CURRENCY = 'USD';

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
  image_path?: string | null;
  item_code?: string | null;
  item_sticker?: string | null;
  description?: string | null;
  weight_carats?: number | null;
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

function memoUnitPrefillFromList(item: InventoryItem, memoCur: string): number {
  const listCur = normalizeCurrencyCode(item.selling_currency ?? DEFAULT_CURRENCY_CODE);
  const inv = normalizeCurrencyCode(memoCur);
  if (listCur === inv) return roundMoney2(Number(item.selling_total_price ?? 0));
  return 0;
}

function memoUnitPrefillFromCartLine(c: MemoCartItem, memoCur: string): number {
  const listCur = normalizeCurrencyCode(c.source_currency ?? DEFAULT_CURRENCY_CODE);
  const inv = normalizeCurrencyCode(memoCur);
  if (listCur === inv) return roundMoney2(Number(c.source_unit_price ?? 0));
  return 0;
}

function listUnitForMemoCartLine(c: MemoCartItem, memoCur: string): number | null {
  const listCur = normalizeCurrencyCode(c.source_currency ?? DEFAULT_CURRENCY_CODE);
  if (listCur !== normalizeCurrencyCode(memoCur)) return null;
  const v = Number(c.source_unit_price ?? 0);
  if (!Number.isFinite(v) || v < 0) return null;
  return roundMoney2(v);
}

function memoLineSellUnit(c: MemoCartItem): number {
  return roundMoney2(Number(c.unit_price) || 0);
}

function memoLineApiUnit(c: MemoCartItem, memoCur: string): number {
  const sell = memoLineSellUnit(c);
  const list = listUnitForMemoCartLine(c, memoCur);
  if (list == null) return sell;
  if (sell > list) return sell;
  return list;
}

function memoLineQty(c: MemoCartItem): number {
  return Math.max(1, Math.floor(Number(c.quantity) || 1));
}

function memoLineSubtotalGross(c: MemoCartItem, memoCur: string): number {
  return roundMoney2(memoLineApiUnit(c, memoCur) * memoLineQty(c));
}

function memoLineDerivedDiscount(c: MemoCartItem, memoCur: string): number {
  const qty = memoLineQty(c);
  const sell = memoLineSellUnit(c);
  const list = listUnitForMemoCartLine(c, memoCur);
  if (list == null || sell >= list) return 0;
  const gross = memoLineSubtotalGross(c, memoCur);
  return Math.min(gross, Math.max(0, roundMoney2(roundMoney2(list - sell) * qty)));
}

function memoLineSellTotal(c: MemoCartItem): number {
  return roundMoney2(memoLineSellUnit(c) * memoLineQty(c));
}

/** Net unit (charged) from stored memo line — works for list+discount and legacy rows. */
function memoDetailNetUnit(it: MemoItemRow): number {
  const q = Math.max(1, Math.floor(Number(it.quantity) || 1));
  const lt = Number(it.line_total) || 0;
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

/** Ensure category/type from inventory appears on memo receipts when the stored line is short. */
function memoLineDescription(it: MemoItemRow): string {
  const base = (it.description || '').trim();
  const typeBit = [it.category, it.item_type].filter(Boolean).join(' ').trim();
  if (!typeBit) return base || (it.item_code || '').trim() || '—';
  if (!base) return typeBit;
  if (base.toLowerCase().includes(typeBit.toLowerCase())) return base;
  return `${base} · ${typeBit}`;
}

/** Subline under item title in detail modal (mock: "40 ct · 8 g · Code B"). */
function memoItemMetaLine(it: MemoItemRow): string {
  const parts: string[] = [];
  if (it.weight_carats != null && Number(it.weight_carats) > 0) parts.push(`${it.weight_carats} ct`);
  if (it.weight_grams != null && Number(it.weight_grams) > 0) parts.push(`${it.weight_grams} g`);
  const code = (it.item_code || '').trim();
  if (code) parts.push(`Code ${code}`);
  if (parts.length > 0) return parts.join(' · ');
  return [it.category, it.item_type].filter(Boolean).join(' · ') || '—';
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

function memoItemCodeBadgeLetter(it: MemoItemRow): string {
  const c = (it.item_code || '').trim();
  if (c) return c.charAt(0).toUpperCase();
  const desc = (it.description || '').trim();
  if (desc) return desc.charAt(0).toUpperCase();
  return '?';
}

function memoItemDetailTitle(it: MemoItemRow): string {
  const desc = (it.description || '').trim();
  if (desc) return desc;
  const code = (it.item_code || '').trim();
  if (code) return code;
  return `Item #${it.inventory_item_id}`;
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

const IconMemoDocHeader = () => (
  <svg
    width={20}
    height={20}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

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

const IconReturn12 = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 .49-3.48" />
  </svg>
);

const IconConvert12 = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

const IconCheck10 = () => (
  <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconMemoModalClose = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
  </svg>
);

export const MemoPage: React.FC<MemoPageProps> = ({ token, onNavigate }) => {
  const { showAlert, showConfirm } = useAlertDialog();

  // create memo form
  const [memoDate, setMemoDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerRow[]>([]);
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
  const [itemSuggestions, setItemSuggestions] = useState<InventoryItem[]>([]);
  const [cart, setCart] = useState<MemoCartItem[]>([]);
  const [memoCurrency, setMemoCurrency] = useState<string>(MEMO_DEFAULT_CURRENCY);
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
  const [returnDraft, setReturnDraft] = useState<Record<number, number>>({});
  const [memoMainTab, setMemoMainTab] = useState<'create' | 'open'>('create');

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

  useEffect(() => {
    if (!customerSearch.trim() || selectedCustomer) {
      setCustomerSuggestions([]);
      return;
    }
    const id = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        params.set('search', customerSearch.trim());
        params.set('limit', '12');
        const res = await fetch(apiUrl(`/api/customers?${params.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const rows = await res.json();
        setCustomerSuggestions(rows);
      } catch {
        setCustomerSuggestions([]);
      }
    }, 250);
    return () => window.clearTimeout(id);
  }, [customerSearch, selectedCustomer, token]);

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
    if (!itemSearch.trim()) {
      setItemSuggestions([]);
      return;
    }
    const id = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        params.set('search', itemSearch.trim());
        params.set('limit', '12');
        params.set('status', 'Available');
        const res = await fetch(apiUrl(`/api/inventory?${params.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const rows: InventoryItem[] = await res.json();
        setItemSuggestions(rows);
      } catch {
        setItemSuggestions([]);
      }
    }, 250);
    return () => window.clearTimeout(id);
  }, [itemSearch, token]);

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

  const addItemToCart = (it: InventoryItem) => {
    if (memoLinesReadOnly) {
      showAlert({
        title: 'Lines cannot be changed',
        message:
          editingMemoConvertedInvoiceId != null
            ? 'This memo was converted to an invoice. You can still update dates and notes.'
            : 'This memo is closed. You can still update dates and notes.',
        variant: 'info',
      });
      return;
    }
    const remaining = typeof it.pieces_remaining === 'number' ? it.pieces_remaining : it.pieces;
    if (remaining <= 0) return;
    const code = it.item_code || it.item_sticker || '';
    const label = `${code ? `${code} • ` : ''}${it.category} • ${it.item_type}`;
    const srcCur = normalizeCurrencyCode(it.selling_currency);
    const srcPrice = Number(it.selling_total_price || 0);
    const unit = memoUnitPrefillFromList(it, memoCurrency);
    setCart(prev => {
      const exists = prev.find(p => p.inventory_item_id === it.id);
      if (exists) return prev;
      return [
        ...prev,
        {
          inventory_item_id: it.id,
          label,
          maxQty: remaining,
          quantity: 1,
          unit_price: unit,
          source_unit_price: srcPrice,
          source_currency: srcCur,
          item_code: code || null,
          description: it.description || null,
          image_path: it.image_path ?? null,
          category: it.category,
          item_type: it.item_type,
          weight_carats: it.weight_carats ?? null,
        },
      ];
    });
    setItemSearch('');
    setItemSuggestions([]);
  };

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
    return cart.reduce((sum, c) => sum + memoLineSubtotalGross(c, memoCurrency), 0);
  }, [cart, memoCurrency]);

  const memoCartItemsDiscountTotal = useMemo(() => {
    return cart.reduce((sum, c) => sum + memoLineDerivedDiscount(c, memoCurrency), 0);
  }, [cart, memoCurrency]);

  const memoCartNetTotal = useMemo(() => {
    return Math.max(0, roundMoney2(memoCartSubtotalGross - memoCartItemsDiscountTotal));
  }, [memoCartSubtotalGross, memoCartItemsDiscountTotal]);

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
      setCustomerSuggestions([]);
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
    setNotes('');
    setMemoCurrency(MEMO_DEFAULT_CURRENCY);
    setCustomerSearch('');
    setSelectedCustomer(null);
    setCustomerSuggestions([]);
    setNewCustomerModalOpen(false);
    setCartImageLoadFailed(() => new Set());
    setItemSearch('');
    setItemSuggestions([]);
    setCart([]);
    setEditingMemoId(null);
    setEditingMemoNo(null);
    setEditingMemoConvertedInvoiceId(null);
    setEditingMemoStatus(null);
  };

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
          notes: notes.trim() || null,
          currency_code: memoCurrency,
          items: cart.map(c => ({
            inventory_item_id: c.inventory_item_id,
            quantity: c.quantity,
            unit_price: memoLineApiUnit(c, memoCurrency),
            discount: memoLineDerivedDiscount(c, memoCurrency),
            item_code: c.item_code || null,
            description: c.description || null,
          })),
        }),
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to create memo'));
      const data = (await res.json()) as { id?: number; memo_no?: string };
      const newId = Number(data.id);
      resetForm();
      fetchMemos();
      setMemoMainTab('open');
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
    setNotes(detail.notes || '');
    setMemoCurrency(normalizeCurrencyCode(detail.currency_code || DEFAULT_CURRENCY_CODE));
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
    setCustomerSuggestions([]);
    setItemSearch('');
    setItemSuggestions([]);
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
              return { ...c, maxQty, source_unit_price: list, source_currency: listCur };
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
    setMemoMainTab('create');
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
      }
    }
    const savedId = editingMemoId;
    setMemoUpdating(true);
    try {
      const body: {
        memo_date: string;
        due_date: string | null;
        notes: string | null;
        customer_id?: number | null;
        items?: Array<{
          memo_item_id: number | null;
          inventory_item_id: number;
          quantity: number;
          unit_price: number;
          discount: number;
          item_code: string | null;
          description: string | null;
        }>;
      } = {
        memo_date: memoDate,
        due_date: dueDate.trim() || null,
        notes: notes.trim() || null,
      };
      if (!editingMemoConvertedInvoiceId) {
        body.customer_id = selectedCustomer?.id ?? null;
      }
      if (linesEditable) {
        body.items = cart.map(c => ({
          memo_item_id: c.memoItemId ?? null,
          inventory_item_id: c.inventory_item_id,
          quantity: Math.floor(Number(c.quantity) || 0),
          unit_price: memoLineApiUnit(c, memoCurrency),
          discount: memoLineDerivedDiscount(c, memoCurrency),
          item_code: c.item_code ?? null,
          description: c.description ?? null,
        }));
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
    if (!detailOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailOpen, closeDetail]);

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

  const convertToInvoice = async () => {
    if (!detailId) return;
    setActionBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/memos/${detailId}/convert-to-invoice`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to convert memo'));
      const data = (await res.json()) as { invoice_id?: unknown };
      const invoiceId = Number(data.invoice_id);
      if (Number.isFinite(invoiceId) && invoiceId > 0) {
        try {
          window.sessionStorage.setItem(
            SELLING_FROM_MEMO_CONVERT_INVOICE_KEY,
            JSON.stringify({ invoiceId })
          );
        } catch {
          // ignore storage failures
        }
      }
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

  return (
    <div className="page page-memo">
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

      <div className="memo-tab-shell">
        <div className="memo-main-tabs" role="tablist" aria-label="Memos">
          <button
            type="button"
            role="tab"
            id="memo-tab-create"
            aria-controls="memo-panel-create"
            aria-selected={memoMainTab === 'create'}
            className={`memo-main-tab${memoMainTab === 'create' ? ' is-active' : ''}`}
            onClick={() => {
              setMemoMainTab('create');
            }}
          >
            <span className="memo-main-tab-icon" aria-hidden="true">
              <IconClipboardCreate />
            </span>
            Create memo
          </button>
          <button
            type="button"
            role="tab"
            id="memo-tab-open"
            aria-controls="memo-panel-open"
            aria-selected={memoMainTab === 'open'}
            className={`memo-main-tab${memoMainTab === 'open' ? ' is-active' : ''}`}
            onClick={() => setMemoMainTab('open')}
          >
            <span className="memo-main-tab-icon" aria-hidden="true">
              <IconMemoListTab />
            </span>
            Open memos
          </button>
        </div>

        {memoMainTab === 'create' && (
        <section className="memo-create-shell" aria-labelledby="memo-tab-create" id="memo-panel-create" role="tabpanel">
          {editingMemoId != null && editingMemoNo ? (
            <div className="memo-create-edit-banner" role="status">
              Editing <strong>{editingMemoNo}</strong> — update dates, notes, and customer below. Line items are read-only; use{' '}
              <strong>Open memos</strong> to process returns.
            </div>
          ) : null}
          <div className="memo-create-ui-grid">
            <div className="memo-create-col memo-create-col--left">
              <section className="memo-create-card">
                <div className="memo-create-card-header">
                  <div className="memo-create-card-title">
                    <div className="memo-create-card-title-icon" aria-hidden="true">
                      <IconPlusSm />
                    </div>
                    Search &amp; Add Items
                  </div>
                </div>
                <div className="memo-create-search-bar">
                  <div className="memo-create-search-wrap">
                    <span className="memo-create-search-icon" aria-hidden="true">
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" />
                      </svg>
                    </span>
                    <input
                      type="search"
                      className="memo-create-search-input"
                      value={itemSearch}
                      onChange={e => setItemSearch(e.target.value)}
                      placeholder="Search by Gem ID, stone type, description…"
                      aria-label="Search inventory to add to memo"
                      disabled={memoLinesReadOnly}
                    />
                  </div>
                </div>
                {itemSearch.trim() && itemSuggestions.length > 0 ? (
                  <div className="memo-create-suggest">
                    {itemSuggestions.map(it => {
                      const remaining = typeof it.pieces_remaining === 'number' ? it.pieces_remaining : it.pieces;
                      const code = it.item_code || it.item_sticker || '';
                      const list = Number(it.selling_total_price || 0);
                      return (
                        <button key={it.id} type="button" className="memo-create-suggest-row" onClick={() => addItemToCart(it)}>
                          <span className="memo-create-suggest-code">{code || `#${it.id}`}</span>
                          <span className="memo-create-suggest-name">{it.category}</span>
                          <span className="memo-create-suggest-meta">
                            {it.item_type} · {remaining} pcs · list{' '}
                            {formatUsdOnlyFromAny(list, it.selling_currency ?? DEFAULT_CURRENCY_CODE, thbPerUnit)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </section>

              <section className="memo-create-card memo-create-card--items">
                <div className="memo-create-items-head">
                  <span className="memo-create-items-label">Added Items</span>
                  <span className="memo-create-count-chip">{cart.length === 1 ? '1' : String(cart.length)}</span>
                </div>
                {cart.length === 0 ? (
                  <div className="memo-create-empty">
                    <div className="memo-create-empty-title">No items added yet</div>
                    <div className="memo-create-empty-sub">
                      Search and add items. List prices in results are shown in USD (Profile rates). Enter unit prices in the memo currency.
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="memo-create-table-wrap">
                      <table className="memo-create-items-table" aria-label="Added items">
                        <thead>
                          <tr>
                            <th className="memo-create-thumb-cell" scope="col">
                              Image
                            </th>
                            <th scope="col">Code</th>
                            <th scope="col">Description</th>
                            <th scope="col">Pcs</th>
                            <th scope="col">Unit price ({normalizeCurrencyCode(memoCurrency)})</th>
                            <th scope="col">Subtotal</th>
                            <th scope="col">Discount</th>
                            <th scope="col">Net</th>
                            <th scope="col">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cart.map(c => {
                            const rqLine = Math.floor(Number(c.memoReturnedQty || 0));
                            const qtyMin = Math.max(1, rqLine);
                            const unit = memoLineSellUnit(c);
                            const lineGross = memoLineSubtotalGross(c, memoCurrency);
                            const rowDiscount = memoLineDerivedDiscount(c, memoCurrency);
                            const lineNet = memoLineSellTotal(c);
                            const imgSrc = c.image_path ? memoItemImageSrc(c.image_path) : '';
                            const showPlaceholder = !imgSrc || cartImageLoadFailed.has(c.inventory_item_id);
                            const avail = c.maxQty;
                            return (
                              <tr key={c.inventory_item_id}>
                                <td className="memo-create-thumb-cell">
                                  {imgSrc && !cartImageLoadFailed.has(c.inventory_item_id) ? (
                                    <img
                                      className="memo-create-item-thumb"
                                      src={imgSrc}
                                      alt=""
                                      loading="lazy"
                                      onError={() =>
                                        setCartImageLoadFailed(prev => new Set(prev).add(c.inventory_item_id))
                                      }
                                    />
                                  ) : null}
                                  {showPlaceholder ? <span className="memo-create-thumb-ph">No img</span> : null}
                                </td>
                                <td>
                                  <span className="memo-create-code-badge">{c.item_code || `#${c.inventory_item_id}`}</span>
                                </td>
                                <td>
                                  <div className="memo-create-item-name">{c.category || c.label}</div>
                                  <div className="memo-create-item-meta">
                                    {c.item_type}
                                    {c.weight_carats != null ? ` · ${c.weight_carats} ct` : ''}
                                    {c.memoReturnedQty != null && c.memoReturnedQty > 0
                                      ? ` · ${c.memoReturnedQty} returned`
                                      : ''}
                                    {!memoLinesReadOnly && avail != null ? ` · ${avail} max (stock + on memo)` : ''}
                                  </div>
                                </td>
                                <td>
                                  <label className="visually-hidden" htmlFor={`memo-qty-${c.inventory_item_id}`}>
                                    Pieces for {c.item_code || c.inventory_item_id}
                                  </label>
                                  <input
                                    id={`memo-qty-${c.inventory_item_id}`}
                                    type="number"
                                    className="memo-create-qty-input"
                                    min={qtyMin}
                                    max={c.maxQty}
                                    value={c.quantity}
                                    title={`Pieces on memo (${qtyMin}–${c.maxQty}${rqLine > 0 ? `; ${rqLine} already returned` : ''})`}
                                    disabled={memoLinesReadOnly}
                                    onChange={e => {
                                      const v = Math.max(
                                        qtyMin,
                                        Math.min(c.maxQty, Math.floor(Number(e.target.value) || qtyMin))
                                      );
                                      setCart(prev =>
                                        prev.map(x => (x.inventory_item_id === c.inventory_item_id ? { ...x, quantity: v } : x))
                                      );
                                    }}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    className="memo-create-price-input"
                                    min={0}
                                    step={0.01}
                                    value={unit}
                                    title={`Unit price (${memoCurrency})`}
                                    aria-label={`Unit price for ${c.item_code || c.inventory_item_id}`}
                                    disabled={memoLinesReadOnly}
                                    onChange={e => {
                                      const v = Math.max(0, roundMoney2(parseMoneyInput(e.target.value)));
                                      setCart(prev =>
                                        prev.map(x =>
                                          x.inventory_item_id === c.inventory_item_id ? { ...x, unit_price: v } : x
                                        )
                                      );
                                    }}
                                  />
                                </td>
                                <td className="memo-create-line-total">{formatMoneyAmount(lineGross, memoCurrency)}</td>
                                <td className="memo-create-line-total memo-create-discount-cell">
                                  {rowDiscount > 0 ? formatMoneyAmount(rowDiscount, memoCurrency) : '—'}
                                </td>
                                <td className="memo-create-line-total">{formatMoneyAmount(lineNet, memoCurrency)}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="memo-create-trash"
                                    onClick={() => removeCartItem(c.inventory_item_id)}
                                    aria-label="Remove line"
                                    disabled={memoLinesReadOnly}
                                  >
                                    <IconTrash />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            </div>

            <div className="memo-create-col memo-create-col--right">
              <div className="memo-create-panel">
                <div className="memo-create-panel-inner">
                  <div className="memo-create-panel-section">
                    <div className="memo-create-panel-label">Customer</div>
                    {editingMemoConvertedInvoiceId ? (
                      <p className="memo-create-hint" style={{ marginBottom: '0.75rem' }}>
                        Customer cannot be changed because this memo was converted to an invoice.
                      </p>
                    ) : null}
                    {selectedCustomer ? (
                      <div className="memo-create-customer-selected">
                        <span className="memo-create-customer-selected-icon" aria-hidden="true">
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                        </span>
                        <div className="memo-create-customer-selected-main">
                          <div className="memo-create-customer-selected-name">{selectedCustomer.name}</div>
                          <div className="memo-create-customer-selected-phone">{selectedCustomer.phone || ''}</div>
                        </div>
                        <button
                          type="button"
                          className="memo-create-customer-selected-close"
                          onClick={() => setSelectedCustomer(null)}
                          aria-label="Remove customer"
                          disabled={editingMemoConvertedInvoiceId != null}
                        >
                          <IconX size={16} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="memo-create-customer-search">
                          <span className="memo-create-customer-search-icon" aria-hidden="true">
                            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                          </span>
                          <input
                            type="search"
                            className="memo-create-customer-input"
                            value={customerSearch}
                            onChange={e => setCustomerSearch(e.target.value)}
                            placeholder="Search by name, phone…"
                            aria-label="Search customers"
                            disabled={editingMemoConvertedInvoiceId != null}
                          />
                        </div>
                        {customerSuggestions.length > 0 ? (
                          <div className="memo-create-customer-list">
                            {customerSuggestions.map(cust => (
                              <button
                                type="button"
                                key={cust.id}
                                className="memo-create-customer-row"
                                onClick={() => {
                                  setSelectedCustomer(cust);
                                  setCustomerSearch('');
                                  setCustomerSuggestions([]);
                                }}
                              >
                                <div className="memo-create-customer-row-name">{cust.name}</div>
                                <div className="memo-create-customer-row-phone">{cust.phone || ''}</div>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                    <button
                      type="button"
                      className="memo-create-new-customer"
                      onClick={() => setNewCustomerModalOpen(true)}
                      disabled={editingMemoConvertedInvoiceId != null}
                    >
                      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      New customer
                    </button>
                  </div>

                  <div className="memo-create-panel-divider" />

                  <div className="memo-create-panel-section">
                    <div className="memo-create-panel-label">Dates &amp; Currency</div>
                    <div className="memo-create-date-row">
                      <div className="memo-create-date-field">
                        <span className="memo-create-date-label">Memo date</span>
                        <div className="memo-create-date-input-wrap">
                          <input
                            type="date"
                            className="memo-create-date-input"
                            value={memoDate}
                            onChange={e => setMemoDate(e.target.value)}
                            aria-label="Memo date"
                          />
                          <span className="memo-create-date-cal-icon" aria-hidden="true">
                            <IconCalendarMemo />
                          </span>
                        </div>
                      </div>
                      <div className="memo-create-date-field">
                        <span className="memo-create-date-label">Due date</span>
                        <div className="memo-create-date-input-wrap">
                          <input
                            type="date"
                            className="memo-create-date-input"
                            value={dueDate}
                            onChange={e => setDueDate(e.target.value)}
                            aria-label="Due date"
                          />
                          <span className="memo-create-date-cal-icon" aria-hidden="true">
                            <IconCalendarMemo />
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="memo-create-currency-wrap">
                      <select
                        className="memo-create-currency-select"
                        value={memoCurrency}
                        onChange={e => {
                          const next = normalizeCurrencyCode(e.target.value);
                          setMemoCurrency(next);
                          setCart(prev =>
                            prev.map(c => ({
                              ...c,
                              unit_price: memoUnitPrefillFromCartLine(c, next),
                            }))
                          );
                        }}
                        aria-label="Memo currency"
                        disabled={editingMemoId != null}
                      >
                        {SUPPORTED_CURRENCIES.map(cur => (
                          <option key={cur.code} value={cur.code}>
                            {cur.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="memo-create-currency-hint">
                      Unit prices are in the memo currency. Changing currency refills from inventory when the list currency matches; otherwise enter prices manually.
                    </p>
                  </div>

                  {cart.length > 0 ? (
                    <>
                      <div className="memo-create-panel-divider" />
                      <div className="memo-create-panel-section selling2-gem-summary-lines">
                        <div className="selling2-summary-row selling2-summary-row--gem">
                          <span className="selling2-summary-key">Subtotal</span>
                          <strong className="selling2-summary-val">
                            {formatMoneyAmount(memoCartSubtotalGross, memoCurrency)}
                          </strong>
                        </div>
                        <div className="selling2-summary-row selling2-summary-row--gem">
                          <span className="selling2-summary-key">Item discounts</span>
                          <span className="selling2-summary-val selling2-neg">
                            −{formatMoneyAmount(memoCartItemsDiscountTotal, memoCurrency)}
                          </span>
                        </div>
                      </div>
                      <div className="selling2-final-total-row">
                        <span className="selling2-ft-label">Memo total</span>
                        <span className="selling2-ft-value">{formatMoneyAmount(memoCartNetTotal, memoCurrency)}</span>
                      </div>
                    </>
                  ) : null}

                  <div className="memo-create-panel-divider" />

                  <div className="memo-create-panel-section">
                    <div className="memo-create-panel-label">Notes</div>
                    <label className="memo-create-notes-label">
                      <span className="visually-hidden">Notes (optional)</span>
                      <textarea
                        className="memo-create-notes-textarea"
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        rows={4}
                        placeholder="Optional notes…"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    className="memo-create-btn-create"
                    onClick={() => (editingMemoId != null ? saveMemoUpdate() : createMemo())}
                    disabled={creating || memoUpdating}
                  >
                    {creating ? (
                      'Creating…'
                    ) : memoUpdating ? (
                      'Saving…'
                    ) : editingMemoId != null ? (
                      <>
                        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                          <polyline points="17 21 17 13 7 13 7 21" />
                          <polyline points="7 3 7 8 15 8" />
                        </svg>
                        Save changes
                      </>
                    ) : (
                      <>
                        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="12" y1="18" x2="12" y2="12" />
                          <line x1="9" y1="15" x2="15" y2="15" />
                        </svg>
                        Create Memo
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="memo-create-btn-reset"
                    onClick={resetForm}
                    disabled={creating || memoUpdating}
                  >
                    {editingMemoId != null ? 'Cancel edit' : 'Reset'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
        )}

        {memoMainTab === 'open' && (
        <section className="memo-card" role="tabpanel" id="memo-panel-open" aria-labelledby="memo-tab-open">
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
        )}
      </div>

      {detailOpen && (
        <div
          className="memo-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="memo-detail-title"
          onClick={e => {
            if (e.target === e.currentTarget) closeDetail();
          }}
        >
          <div className="memo-detail" onClick={e => e.stopPropagation()}>
            <header className="memo-detail-topbar">
              <div className="memo-detail-topbar-left">
                <div className="memo-detail-topbar-icon" aria-hidden="true">
                  <IconMemoDocHeader />
                </div>
                <div className="memo-detail-topbar-text">
                  <h3 id="memo-detail-title">
                    {detailLoading ? 'Memo details' : detailError ? 'Memo' : detail?.memo_no ?? 'Memo'}
                  </h3>
                  {!detailLoading && detail && (
                    <div className="memo-detail-customer-row">
                      <span className="memo-detail-customer-avatar" aria-hidden="true">
                        {memoDetailCustomerInitial(detail.customer_name)}
                      </span>
                      <span className="memo-detail-sub">{memoDetailDisplayCustomer(detail)}</span>
                    </div>
                  )}
                  {!detailLoading && !detail && !detailError && <div className="memo-detail-sub">Loading…</div>}
                </div>
              </div>
              <button type="button" className="memo-close memo-close--fab" onClick={closeDetail} aria-label="Close memo details">
                <IconMemoModalClose />
              </button>
            </header>

            {!detailLoading && detail && (() => {
              const detailCur = detail.currency_code || DEFAULT_CURRENCY_CODE;
              const statusPillClass =
                detail.status === 'Open'
                  ? 'memo-status-pill memo-status-pill--open'
                  : detail.status === 'Closed'
                    ? 'memo-status-pill memo-status-pill--closed'
                    : 'memo-status-pill memo-status-pill--partial';
              return (
                <div className="memo-detail-meta-strip">
                  <div className="memo-detail-meta-cell memo-detail-meta-cell--blue">
                    <span className="memo-detail-meta-label">Memo date</span>
                    <strong className="memo-detail-meta-strong memo-detail-meta-strong--blue">{detail.memo_date}</strong>
                  </div>
                  <div className="memo-detail-meta-cell memo-detail-meta-cell--amber">
                    <span className="memo-detail-meta-label">Due date</span>
                    <strong className="memo-detail-meta-strong memo-detail-meta-strong--amber">{detail.due_date || '—'}</strong>
                  </div>
                  <div className="memo-detail-meta-cell memo-detail-meta-cell--green">
                    <span className="memo-detail-meta-label">Status</span>
                    <div className="memo-detail-meta-value-wrap">
                      <span className={statusPillClass}>
                        {detail.status === 'Closed' ? <IconCheck10 /> : null}
                        {detail.status}
                      </span>
                    </div>
                  </div>
                  <div className="memo-detail-meta-cell memo-detail-meta-cell--purple">
                    <span className="memo-detail-meta-label">Total (USD)</span>
                    <strong className="memo-detail-meta-strong memo-detail-meta-strong--total-usd">
                      {formatUsdOnlyFromAny(
                        detail.items.reduce((s, it) => s + memoDetailRemainingLineValue(it), 0),
                        detailCur,
                        thbPerUnit
                      )}
                    </strong>
                  </div>
                </div>
              );
            })()}

            <div className="memo-detail-scroll">
              {detailLoading && <div className="memo-detail-state">Loading memo…</div>}
              {!detailLoading && detailError && <div className="memo-detail-state memo-detail-state--error">{detailError}</div>}
              {!detailLoading && detail && (() => {
                const detailCur = detail.currency_code || DEFAULT_CURRENCY_CODE;
                const nItems = detail.items.length;
                return (
                  <>
                    {nItems > 4 ? (
                      <p className="memo-detail-scroll-hint">
                        <span className="memo-detail-hint-icon" aria-hidden="true">
                          ↕
                        </span>
                        Scroll to see all {nItems} lines — actions stay at the bottom.
                      </p>
                    ) : null}

                    {detail.notes ? <div className="memo-detail-notes">{detail.notes}</div> : null}

                    <div className="memo-detail-items-section">
                      <div className="memo-detail-table-header-bar">
                        <span className="memo-detail-table-section-label">Memo items</span>
                        <span className="memo-detail-item-count">
                          {nItems} {nItems === 1 ? 'item' : 'items'}
                        </span>
                      </div>
                      <div className="memo-detail-table-wrap">
                        <table className="memo-table memo-table--detail" aria-label="Memo items">
                          <thead>
                            <tr>
                              <th>Item</th>
                              <th className="memo-detail-th-center">Qty</th>
                              <th className="memo-detail-th-center">Returned</th>
                              <th className="memo-detail-th-center">Remaining</th>
                              <th className="memo-detail-th-center">Return qty</th>
                              <th className="memo-detail-th-center">Net / pc</th>
                              <th className="memo-detail-th-end">Subtotal</th>
                              <th className="memo-detail-th-end">Discount</th>
                              <th className="memo-detail-th-end">Remaining value</th>
                            </tr>
                          </thead>
                          <tbody>
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
                              return (
                                <tr key={it.id}>
                                  <td>
                                    <div className="memo-item memo-item--detail">
                                      <div className="memo-thumb memo-thumb--detail">
                                        {it.image_path ? (
                                          <img src={memoItemImageSrc(it.image_path)} alt="" />
                                        ) : (
                                          <span className="memo-thumb-placeholder-label">No img</span>
                                        )}
                                      </div>
                                      <div className="memo-item-text">
                                        <span className="memo-item-code-badge">{memoItemCodeBadgeLetter(it)}</span>
                                        <div className="memo-item-title">{memoItemDetailTitle(it)}</div>
                                        <div className="memo-item-sub">{memoItemMetaLine(it)}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="memo-detail-td-center">
                                    <span className="memo-qty-chip memo-qty-chip--qty">{it.quantity}</span>
                                  </td>
                                  <td className="memo-detail-td-center">
                                    <span className="memo-qty-chip memo-qty-chip--returned">{it.returned_qty}</span>
                                  </td>
                                  <td className="memo-detail-td-center">
                                    <span className="memo-qty-chip memo-qty-chip--remaining">{remaining}</span>
                                  </td>
                                  <td className="memo-detail-td-center">
                                    <input
                                      className="memo-return-qty-input"
                                      type="number"
                                      min={0}
                                      max={remaining}
                                      disabled={actionBusy || detail.status === 'Closed' || remaining === 0}
                                      value={Number.isFinite(draftClamped) ? draftClamped : 0}
                                      onChange={e => {
                                        const v = Math.max(0, Math.min(remaining, Math.floor(Number(e.target.value) || 0)));
                                        setReturnDraft(prev => ({ ...prev, [it.id]: v }));
                                      }}
                                    />
                                  </td>
                                  <td className="memo-detail-td-center">
                                    <span className="memo-detail-price-cell">{formatMoneyAmount(memoDetailNetUnit(it), detailCur)}</span>
                                  </td>
                                  <td className="memo-detail-td-end">
                                    <span className="memo-detail-line-total">
                                      {formatMoneyAmount(remAmt.lineGrossRem, detailCur)}
                                    </span>
                                  </td>
                                  <td className="memo-detail-td-end">
                                    <span
                                      className={
                                        remAmt.lineDiscRem > 0.0001
                                          ? 'memo-detail-line-discount'
                                          : 'memo-detail-line-total memo-detail-line-total--muted'
                                      }
                                    >
                                      {remAmt.lineDiscRem > 0.0001
                                        ? `−${formatMoneyAmount(remAmt.lineDiscRem, detailCur)}`
                                        : '—'}
                                    </span>
                                  </td>
                                  <td className="memo-detail-td-end">
                                    <span className="memo-detail-line-total">
                                      {formatMoneyAmount(remAmt.lineNetRem, detailCur)}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {!detailLoading && detail && (
              <footer className="memo-detail-footer">
                <div className="memo-detail-footer-row">
                  <div className="memo-detail-footer-group">
                    <button
                    type="button"
                      className="memo-footer-btn memo-footer-btn--edit"
                      onClick={openMemoEditInComposer}
                      disabled={actionBusy || memoEditDeleting}
                    >
                      <IconPencil12 />
                      <span>Edit memo</span>
                    </button>
                    <button
                      type="button"
                      className="memo-footer-btn memo-footer-btn--delete"
                      onClick={deleteMemo}
                      disabled={actionBusy || memoEditDeleting || !!detail.converted_invoice_id}
                      title={detail.converted_invoice_id ? 'Converted memos cannot be deleted' : 'Delete memo and restock remaining pieces'}
                    >
                      <IconTrash12 />
                      <span>Delete</span>
                    </button>
                    <button type="button" className="memo-footer-btn memo-footer-btn--print-solid" onClick={() => printMemo(detail)}>
                      <IconPrint12 />
                      <span>Print</span>
                    </button>
                  </div>
                  <span className="memo-detail-footer-dot" aria-hidden="true" />
                  <div className="memo-detail-footer-group memo-detail-footer-group--mid">
                    <button
                      type="button"
                      className="memo-footer-btn memo-footer-btn--return"
                      onClick={returnSelected}
                      disabled={actionBusy || detail.status === 'Closed'}
                      title="Return only the quantities you entered in the table"
                    >
                      <IconReturn12 />
                      <span>Return selected</span>
                    </button>
                    <button
                      type="button"
                      className="memo-footer-btn memo-footer-btn--return-all"
                      onClick={returnAll}
                      disabled={actionBusy || detail.status === 'Closed'}
                    >
                      <IconReturn12 />
                      <span>Return all</span>
                    </button>
                    <button
                      type="button"
                      className="memo-footer-btn memo-footer-btn--convert"
                      onClick={convertToInvoice}
                      disabled={actionBusy || detail.status === 'Closed' || !!detail.converted_invoice_id}
                    >
                      <IconConvert12 />
                      <span>Convert to invoice</span>
                    </button>
                  </div>
                  <button type="button" className="memo-footer-btn memo-footer-btn--close-window" onClick={closeDetail}>
                    Close window
                  </button>
                </div>
              </footer>
            )}

            {(detailLoading || detailError) && (
              <footer className="memo-detail-footer memo-detail-footer--minimal">
                <button type="button" className="memo-detail-close-footer ghost-button" onClick={closeDetail}>
                  Close
                </button>
              </footer>
            )}
          </div>
        </div>
      )}

      {newCustomerModalOpen && (
        <div className="selling2-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="memo-new-customer-title">
          <div className="selling2-modal">
            <div className="selling2-modal-header">
              <h3 id="memo-new-customer-title">
                <span className="btn-icon" aria-hidden="true">
                  <IconPlus />
                </span>{' '}
                Add New Customer
              </h3>
              <button
                type="button"
                className="selling2-modal-close"
                onClick={() => setNewCustomerModalOpen(false)}
                aria-label="Close"
              >
                <IconX />
              </button>
            </div>
            <div className="selling2-modal-body">
              <label>
                <span>Name *</span>
                <input name="name" value={newCustomer.name} onChange={handleNewCustomerChange} placeholder="Customer name" />
              </label>
              <label>
                <span>Phone (optional)</span>
                <input name="phone" value={newCustomer.phone} onChange={handleNewCustomerChange} placeholder="0771234567" />
              </label>
              <label>
                <span>Email (optional)</span>
                <input name="email" value={newCustomer.email} onChange={handleNewCustomerChange} placeholder="customer@example.com" />
              </label>
              <p className="selling2-modal-section-label">Billing address (optional, shown on receipts)</p>
              <label>
                <span>Address line 1</span>
                <input
                  name="address_line1"
                  value={newCustomer.address_line1}
                  onChange={handleNewCustomerChange}
                  placeholder="Street, building"
                />
              </label>
              <label>
                <span>Address line 2</span>
                <input
                  name="address_line2"
                  value={newCustomer.address_line2}
                  onChange={handleNewCustomerChange}
                  placeholder="Unit, district…"
                />
              </label>
              <div className="selling2-modal-row2">
                <label>
                  <span>City</span>
                  <input name="city" value={newCustomer.city} onChange={handleNewCustomerChange} placeholder="City" />
                </label>
                <label>
                  <span>Postal code</span>
                  <input
                    name="postal_code"
                    value={newCustomer.postal_code}
                    onChange={handleNewCustomerChange}
                    placeholder="Postal code"
                  />
                </label>
              </div>
              <label>
                <span>Country</span>
                <input name="country" value={newCustomer.country} onChange={handleNewCustomerChange} placeholder="Country" />
              </label>
              <label>
                <span>Notes (optional)</span>
                <textarea
                  name="notes"
                  value={newCustomer.notes}
                  onChange={handleNewCustomerChange}
                  rows={3}
                  placeholder="Any special instructions..."
                />
              </label>
            </div>
            <div className="selling2-modal-footer">
              <button type="button" className="ghost-button" onClick={() => setNewCustomerModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={async () => {
                  const ok = await saveCustomer();
                  if (ok) setNewCustomerModalOpen(false);
                }}
                disabled={customerSaving}
              >
                {customerSaving ? 'Saving…' : 'Save Customer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

