import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { openMemoReceiptWindow } from '../../lib/receiptDocument';
import {
  DEFAULT_CURRENCY_CODE,
  SUPPORTED_CURRENCIES,
  formatMoneyAmount,
  formatMoneyWhole,
  normalizeCurrencyCode,
  roundMoney2,
} from '../../lib/currencies';
import { convertAmountViaThb, hasRateFor, type ThbPerUnitMap } from '../../lib/exchangeConversion';

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
  inventory_item_id: number;
  label: string;
  maxQty: number;
  quantity: number;
  unit_price: number;
  /** Original list price & currency (for recalc when memo currency changes) */
  source_unit_price: number;
  source_currency: string;
  item_code?: string | null;
  description?: string | null;
  image_path?: string | null;
  category?: string;
  item_type?: string;
  weight_carats?: number | null;
}

interface MemoPageProps {
  token: string;
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

const IconUserRounded: React.FC = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const IconPlus: React.FC = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

const IconStickyNote: React.FC = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M10 13h4M10 17h2" />
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

const IconFilePlus: React.FC = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M12 11v6M9 14h6" />
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

const IconMemoModalClose = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
  </svg>
);

const IconPrint = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" />
  </svg>
);

const IconUndo = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 7v6h6M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconReceipt = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" />
    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" />
  </svg>
);

const IconClipboard = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" strokeLinecap="round" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
  </svg>
);

export const MemoPage: React.FC<MemoPageProps> = ({ token }) => {
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
  const [memoCurrency, setMemoCurrency] = useState<string>(DEFAULT_CURRENCY_CODE);
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

  const [memoEditOpen, setMemoEditOpen] = useState(false);
  const [memoEditSaving, setMemoEditSaving] = useState(false);
  const [memoEditDeleting, setMemoEditDeleting] = useState(false);
  const [editMemoDate, setEditMemoDate] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editCustomerSearch, setEditCustomerSearch] = useState('');
  const [editCustomerSuggestions, setEditCustomerSuggestions] = useState<CustomerRow[]>([]);
  const [editSelectedCustomer, setEditSelectedCustomer] = useState<CustomerRow | null>(null);

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
    if (!memoEditOpen || editSelectedCustomer) {
      setEditCustomerSuggestions([]);
      return;
    }
    if (!editCustomerSearch.trim()) {
      setEditCustomerSuggestions([]);
      return;
    }
    const id = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        params.set('search', editCustomerSearch.trim());
        params.set('limit', '12');
        const res = await fetch(apiUrl(`/api/customers?${params.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const rows = await res.json();
        setEditCustomerSuggestions(rows);
      } catch {
        setEditCustomerSuggestions([]);
      }
    }, 250);
    return () => window.clearTimeout(id);
  }, [memoEditOpen, editCustomerSearch, editSelectedCustomer, token]);

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

  const addItemToCart = (it: InventoryItem) => {
    const remaining = typeof it.pieces_remaining === 'number' ? it.pieces_remaining : it.pieces;
    if (remaining <= 0) return;
    const code = it.item_code || it.item_sticker || '';
    const label = `${code ? `${code} • ` : ''}${it.category} • ${it.item_type}`;
    const srcCur = normalizeCurrencyCode(it.selling_currency);
    const srcPrice = Number(it.selling_total_price || 0);
    const unit = convertAmountViaThb(srcPrice, srcCur, memoCurrency, thbPerUnit);
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

  useEffect(() => {
    setCart(prev =>
      prev.map(c => ({
        ...c,
        unit_price: convertAmountViaThb(c.source_unit_price, c.source_currency, memoCurrency, thbPerUnit),
      }))
    );
  }, [memoCurrency, thbPerUnit]);

  const removeCartItem = (inventory_item_id: number) => {
    setCart(prev => prev.filter(p => p.inventory_item_id !== inventory_item_id));
    setCartImageLoadFailed(prev => {
      const next = new Set(prev);
      next.delete(inventory_item_id);
      return next;
    });
  };

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, c) => sum + (Number(c.unit_price) || 0) * (Number(c.quantity) || 0), 0);
  }, [cart]);

  const fxWarning = useMemo(() => {
    for (const c of cart) {
      const from = normalizeCurrencyCode(c.source_currency);
      const to = normalizeCurrencyCode(memoCurrency);
      if (from === to) continue;
      if (!hasRateFor(from, thbPerUnit) || !hasRateFor(to, thbPerUnit)) {
        return 'Missing exchange rate for this currency pair. Set THB rates in Profile → Exchange rates (owner), or amounts may be wrong.';
      }
    }
    return null;
  }, [cart, memoCurrency, thbPerUnit]);

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
    setMemoCurrency(DEFAULT_CURRENCY_CODE);
    setCustomerSearch('');
    setSelectedCustomer(null);
    setCustomerSuggestions([]);
    setNewCustomerModalOpen(false);
    setCartImageLoadFailed(() => new Set());
    setItemSearch('');
    setItemSuggestions([]);
    setCart([]);
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
            unit_price: c.unit_price,
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
    setMemoEditOpen(false);
  }, []);

  const openMemoEditModal = () => {
    if (!detail) return;
    setEditMemoDate(detail.memo_date || todayIso());
    setEditDueDate(detail.due_date || '');
    setEditNotes(detail.notes || '');
    if (detail.customer_id != null) {
      setEditSelectedCustomer({
        id: detail.customer_id,
        name: detail.customer_name || 'Customer',
        phone: detail.customer_phone,
        email: detail.customer_email ?? null,
      });
    } else {
      setEditSelectedCustomer(null);
    }
    setEditCustomerSearch('');
    setEditCustomerSuggestions([]);
    setMemoEditOpen(true);
  };

  const saveMemoEdit = async () => {
    if (!detailId || !detail) return;
    if (memoDueBeforeMemoDate(editMemoDate, editDueDate)) {
      showAlert({
        title: 'Invalid dates',
        message: 'Due date cannot be before the memo date.',
        variant: 'error',
      });
      return;
    }
    setMemoEditSaving(true);
    try {
      const body: {
        memo_date: string;
        due_date: string | null;
        notes: string | null;
        customer_id?: number | null;
      } = {
        memo_date: editMemoDate,
        due_date: editDueDate.trim() || null,
        notes: editNotes.trim() || null,
      };
      if (!detail.converted_invoice_id) {
        body.customer_id = editSelectedCustomer?.id ?? null;
      }
      const res = await fetch(apiUrl(`/api/memos/${detailId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to update memo'));
      setMemoEditOpen(false);
      await openDetail(detailId);
      fetchMemos();
      showAlert({
        title: 'Memo updated',
        message: 'Your changes were saved.',
        variant: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update memo';
      showAlert({ title: 'Could not save memo', message: msg, variant: 'error' });
    } finally {
      setMemoEditSaving(false);
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
      await openDetail(detailId);
      fetchMemos();
      showAlert({
        title: 'Memo converted',
        message: 'An invoice was created from this memo. You can find it under Selling or Payments.',
        variant: 'success',
      });
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
      <section className="payments-kpi-grid" aria-label="Memo summary stats">
        <div className="payments-kpi-card payments-kpi-card--blue">
          <div className="payments-kpi-label">Open memos</div>
          <div className="payments-kpi-value">{totals.openCount}</div>
        </div>
        <div className="payments-kpi-card payments-kpi-card--red">
          <div className="payments-kpi-label">Overdue memos</div>
          <div className="payments-kpi-value">{totals.overdueCount}</div>
        </div>
        <div className="payments-kpi-card payments-kpi-card--amber">
          <div className="payments-kpi-label">Items on memo</div>
          <div className="payments-kpi-value">{totals.itemsOnMemo}</div>
        </div>
        <div className="payments-kpi-card payments-kpi-card--green">
          <div className="payments-kpi-label">Total memo value</div>
          <div className="payments-kpi-value">
            {formatMoneyAmount(totals.totalValueThb, DEFAULT_CURRENCY_CODE)}
          </div>
          <div className="payments-kpi-sub">
            Open / active memos · THB equivalent (full totals for current search & status
            {memoListTruncated ? '; table shows first 300' : ''})
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
        <section
          className="memo-card memo-card--create"
          aria-labelledby="memo-create-hero-title"
          id="memo-panel-create"
          role="tabpanel"
        >
          <header className="memo-create-hero">
            <div className="memo-create-hero-icon" aria-hidden="true">
              <IconClipboardCreate />
            </div>
            <div className="memo-create-hero-text">
              <h3 id="memo-create-hero-title" className="memo-create-hero-title">
                Create memo
              </h3>
            </div>
          </header>

          <div className="memo-create-columns selling2-grid">
            <div className="memo-create-col memo-create-col--left selling2-left">
              <section className="selling2-card">
                <h3 className="selling2-card-title">
                  <span className="selling2-card-title-icon" aria-hidden="true">
                    <IconPlus />
                  </span>
                  Search &amp; Add Items
                </h3>
                <div className="selling2-search">
                  <span className="selling2-search-icon" aria-hidden="true">
                    <IconSearch />
                  </span>
                  <input
                    type="search"
                    className="selling2-search-input"
                    value={itemSearch}
                    onChange={e => setItemSearch(e.target.value)}
                    placeholder="Search by Gem ID, stone type…"
                    aria-label="Search inventory to add to memo"
                  />
                </div>
                {itemSearch.trim() && itemSuggestions.length > 0 ? (
                  <div className="selling2-suggest">
                    {itemSuggestions.map(it => {
                      const remaining = typeof it.pieces_remaining === 'number' ? it.pieces_remaining : it.pieces;
                      const code = it.item_code || it.item_sticker || '';
                      const srcCur = normalizeCurrencyCode(it.selling_currency);
                      const list = Number(it.selling_total_price || 0);
                      const inMemo = convertAmountViaThb(list, srcCur, memoCurrency, thbPerUnit);
                      return (
                        <button key={it.id} type="button" className="selling2-suggest-row" onClick={() => addItemToCart(it)}>
                          <span className="selling2-suggest-code">{code || `#${it.id}`}</span>
                          <span className="selling2-suggest-name">{it.category}</span>
                          <span className="selling2-suggest-meta">
                            {it.item_type} · {remaining} pcs · {formatMoneyWhole(inMemo, memoCurrency)}
                            {srcCur !== normalizeCurrencyCode(memoCurrency) ? ` (${formatMoneyWhole(list, srcCur)} list)` : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </section>

              <section className="selling2-card selling2-card--added">
                <h3 className="selling2-card-title">Added Items</h3>
                {cart.length === 0 ? (
                  <div className="selling2-empty">
                    <div className="selling2-empty-title">No items added yet</div>
                    <div className="selling2-empty-sub">Search and add items from the left to get started</div>
                  </div>
                ) : (
                  <>
                    <div className="selling2-table-wrap">
                      <table className="selling2-table" aria-label="Added items">
                        <thead>
                          <tr>
                            <th className="selling2-item-thumb-cell" scope="col">
                              Image
                            </th>
                            <th scope="col">Code</th>
                            <th scope="col">Description</th>
                            <th scope="col">Pcs</th>
                            <th scope="col">Net</th>
                            <th scope="col">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cart.map(c => {
                            const qty = Number(c.quantity) || 0;
                            const unit = Number(c.unit_price) || 0;
                            const lineGross = roundMoney2(unit * qty);
                            const imgSrc = c.image_path ? memoItemImageSrc(c.image_path) : '';
                            const showPlaceholder = !imgSrc || cartImageLoadFailed.has(c.inventory_item_id);
                            const avail = c.maxQty;
                            return (
                              <tr key={c.inventory_item_id}>
                                <td className="selling2-item-thumb-cell">
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
                                </td>
                                <td>
                                  <span className="selling2-code-badge">{c.item_code || `#${c.inventory_item_id}`}</span>
                                </td>
                                <td>
                                  <div className="selling2-desc-title">{c.category || c.label}</div>
                                  <div className="selling2-desc-sub">
                                    {c.item_type}
                                    {c.weight_carats != null ? ` · ${c.weight_carats} ct` : ''}
                                    {avail != null ? ` · ${avail} in stock` : ''}
                                  </div>
                                </td>
                                <td>
                                  <label className="visually-hidden" htmlFor={`memo-qty-${c.inventory_item_id}`}>
                                    Pieces for {c.item_code || c.inventory_item_id}
                                  </label>
                                  <input
                                    id={`memo-qty-${c.inventory_item_id}`}
                                    type="number"
                                    className="selling2-qty-input"
                                    min={1}
                                    max={c.maxQty}
                                    value={c.quantity}
                                    title={`Pieces on memo (1–${c.maxQty})`}
                                    onChange={e => {
                                      const v = Math.max(1, Math.min(c.maxQty, Math.floor(Number(e.target.value) || 1)));
                                      setCart(prev =>
                                        prev.map(x => (x.inventory_item_id === c.inventory_item_id ? { ...x, quantity: v } : x))
                                      );
                                    }}
                                  />
                                </td>
                                <td className="selling2-net">{formatMoneyAmount(lineGross, memoCurrency)}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="selling2-trash"
                                    onClick={() => removeCartItem(c.inventory_item_id)}
                                    aria-label="Remove line"
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
                    <div className="memo-create-items-total" aria-live="polite">
                      <span>Memo total</span>
                      <strong>{formatMoneyAmount(cartTotal, memoCurrency)}</strong>
                    </div>
                  </>
                )}
              </section>
            </div>

            <div className="memo-create-col memo-create-col--right selling2-right">
              <div className="memo-form memo-form--create">
                <section className="selling2-card" aria-labelledby="memo-sec-customer-title">
                  <h3 id="memo-sec-customer-title" className="selling2-card-title">
                    <span className="selling2-card-title-icon" aria-hidden="true">
                      <IconUserRounded />
                    </span>
                    Customer
                  </h3>
                  {selectedCustomer ? (
                    <div className="selling2-customer-selected">
                      <span className="selling2-customer-selected-icon" aria-hidden="true">
                        <IconUserRounded />
                      </span>
                      <div className="selling2-customer-selected-main">
                        <div className="selling2-customer-selected-name">{selectedCustomer.name}</div>
                        <div className="selling2-customer-selected-phone">{selectedCustomer.phone || ''}</div>
                      </div>
                      <button
                        type="button"
                        className="selling2-customer-selected-close"
                        onClick={() => setSelectedCustomer(null)}
                        aria-label="Remove customer"
                      >
                        <IconX size={16} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="selling2-customer-search">
                        <span className="selling2-search-icon" aria-hidden="true">
                          <IconSearch />
                        </span>
                        <input
                          type="search"
                          className="selling2-search-input"
                          value={customerSearch}
                          onChange={e => setCustomerSearch(e.target.value)}
                          placeholder="Search by name, phone…"
                          aria-label="Search customers"
                        />
                      </div>
                      {customerSuggestions.length > 0 ? (
                        <div className="selling2-customer-list">
                          {customerSuggestions.map(cust => (
                            <button
                              type="button"
                              key={cust.id}
                              className="selling2-customer-row"
                              onClick={() => {
                                setSelectedCustomer(cust);
                                setCustomerSearch('');
                                setCustomerSuggestions([]);
                              }}
                            >
                              <div className="selling2-customer-row-name">{cust.name}</div>
                              <div className="selling2-customer-row-phone">{cust.phone || ''}</div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  )}
                  <button
                    type="button"
                    className="ghost-button selling2-new-customer"
                    onClick={() => setNewCustomerModalOpen(true)}
                  >
                    <span className="btn-icon" aria-hidden="true">
                      <IconPlus />
                    </span>
                    New customer
                  </button>
                </section>

                <section className="selling2-card" aria-labelledby="memo-sec-schedule-title">
                  <h3 id="memo-sec-schedule-title" className="selling2-card-title">
                    <span className="selling2-card-title-icon" aria-hidden="true">
                      <IconCalendarMemo />
                    </span>
                    Dates &amp; currency
                  </h3>
                  <div className="memo-form-row memo-form-row--dates">
                    <label className="memo-field-label">
                      <span className="memo-field-label-row">
                        <span className="memo-field-label-icon" aria-hidden="true">
                          <IconCalendarMemo />
                        </span>
                        Memo date
                      </span>
                      <input type="date" className="memo-date-input" value={memoDate} onChange={e => setMemoDate(e.target.value)} />
                    </label>
                    <label className="memo-field-label">
                      <span className="memo-field-label-row">
                        <span className="memo-field-label-icon" aria-hidden="true">
                          <IconCalendarMemo />
                        </span>
                        Due date
                      </span>
                      <input type="date" className="memo-date-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                    </label>
                    <label className="memo-field-label memo-field-label--currency">
                      <span className="memo-field-label-row">
                        <span className="memo-field-label-icon memo-field-label-icon--coin" aria-hidden="true">
                          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <circle cx="12" cy="12" r="8" />
                            <path d="M12 6v2M12 16v2M6 12h2M16 12h2" />
                          </svg>
                        </span>
                        Currency
                      </span>
                      <select
                        className="memo-date-input"
                        value={memoCurrency}
                        onChange={e => setMemoCurrency(e.target.value)}
                        aria-label="Memo currency"
                      >
                        {SUPPORTED_CURRENCIES.map(cur => (
                          <option key={cur.code} value={cur.code}>
                            {cur.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {fxWarning ? <div className="memo-fx-warning" role="alert">{fxWarning}</div> : null}
                </section>

                <section className="selling2-card" aria-labelledby="memo-sec-notes-title">
                  <h3 id="memo-sec-notes-title" className="selling2-card-title">
                    <span className="selling2-card-title-icon" aria-hidden="true">
                      <IconStickyNote />
                    </span>
                    Notes
                  </h3>
                  <label className="memo-notes-field">
                    <span className="visually-hidden">Notes (optional)</span>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Optional notes…" />
                  </label>
                </section>

                <div className="memo-form-actions memo-form-actions--create">
                  <button type="button" className="primary-button memo-create-submit" onClick={createMemo} disabled={creating}>
                    {creating ? (
                      'Creating…'
                    ) : (
                      <>
                        <span className="memo-create-submit-icon" aria-hidden="true">
                          <IconFilePlus />
                        </span>
                        Create memo
                      </>
                    )}
                  </button>
                  <button type="button" className="ghost-button memo-create-reset" onClick={resetForm} disabled={creating}>
                    Reset
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
                  <IconClipboard />
                </div>
                <div className="memo-detail-topbar-text">
                  <h3 id="memo-detail-title">
                    {detailLoading ? 'Memo details' : detailError ? 'Memo' : detail?.memo_no ?? 'Memo'}
                  </h3>
                  {!detailLoading && detail && (
                    <div className="memo-detail-sub">
                      {detail.customer_name || 'Walk-in'}
                      {detail.customer_phone ? ` · ${detail.customer_phone}` : ''}
                    </div>
                  )}
                  {!detailLoading && !detail && !detailError && <div className="memo-detail-sub">Loading…</div>}
                </div>
              </div>
              <button type="button" className="memo-close memo-close--fab" onClick={closeDetail} aria-label="Close memo details">
                <IconMemoModalClose />
              </button>
            </header>

            <div className="memo-detail-scroll">
              {detailLoading && <div className="memo-detail-state">Loading memo…</div>}
              {!detailLoading && detailError && <div className="memo-detail-state memo-detail-state--error">{detailError}</div>}
              {!detailLoading && detail && (() => {
                const detailCur = detail.currency_code || DEFAULT_CURRENCY_CODE;
                const statusTone =
                  detail.status === 'Open'
                    ? 'memo-detail-meta-tile--open'
                    : detail.status === 'Closed'
                      ? 'memo-detail-meta-tile--closed'
                      : 'memo-detail-meta-tile--partial';
                return (
                  <>
                    {detail.items.length > 4 ? (
                      <p className="memo-detail-scroll-hint">
                        <span className="memo-detail-hint-icon" aria-hidden="true">
                          ↕
                        </span>
                        Scroll to see all {detail.items.length} lines — actions stay at the bottom.
                      </p>
                    ) : null}

                    <div className="memo-detail-meta">
                      <div className="memo-detail-meta-tile memo-detail-meta-tile--date">
                        <span>Memo date</span>
                        <strong>{detail.memo_date}</strong>
                      </div>
                      <div className="memo-detail-meta-tile memo-detail-meta-tile--due">
                        <span>Due date</span>
                        <strong>{detail.due_date || '—'}</strong>
                      </div>
                      <div className={`memo-detail-meta-tile ${statusTone}`}>
                        <span>Status</span>
                        <strong>{detail.status}</strong>
                      </div>
                      <div className="memo-detail-meta-tile memo-detail-meta-tile--total">
                        <span>Total ({detailCur})</span>
                        <strong>
                          {formatMoneyAmount(
                            detail.items.reduce(
                              (s, it) => s + Math.max(0, (it.quantity - it.returned_qty) * it.unit_price),
                              0
                            ),
                            detailCur
                          )}
                        </strong>
                      </div>
                    </div>

                    {detail.notes ? <div className="memo-detail-notes">{detail.notes}</div> : null}

                    <div className="memo-detail-table-wrap">
                      <table className="memo-table memo-table--detail" aria-label="Memo items">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th className="right">Qty</th>
                            <th className="right">Returned</th>
                            <th className="right">Remaining</th>
                            <th className="right">Return qty</th>
                            <th className="right">Price</th>
                            <th className="right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.items.map(it => {
                            const remaining = Math.max(0, (it.quantity || 0) - (it.returned_qty || 0));
                            const draft = Math.floor(Number(returnDraft[it.id] || 0));
                            const draftClamped = Math.max(0, Math.min(remaining, draft));
                            return (
                              <tr key={it.id}>
                                <td>
                                  <div className="memo-item">
                                    <div className="memo-thumb">
                                      {it.image_path ? (
                                        <img src={memoItemImageSrc(it.image_path)} alt="" />
                                      ) : (
                                        <div className="memo-thumb-ph" />
                                      )}
                                    </div>
                                    <div>
                                      <div className="memo-item-title">{it.item_code || `#${it.inventory_item_id}`}</div>
                                      <div className="memo-item-sub">{(it.category || '')} {(it.item_type || '')}</div>
                                    </div>
                                  </div>
                                </td>
                                <td className="right">{it.quantity}</td>
                                <td className="right">{it.returned_qty}</td>
                                <td className="right">{remaining}</td>
                                <td className="right">
                                  <input
                                    className="memo-qty memo-qty--small"
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
                                <td className="right">{formatMoneyAmount(it.unit_price, detailCur)}</td>
                                <td className="right">{formatMoneyAmount(remaining * it.unit_price, detailCur)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
            </div>

            {!detailLoading && detail && (
              <footer className="memo-detail-footer">
                <div className="memo-detail-footer-actions">
                  <button
                    type="button"
                    className="memo-footer-btn ghost-button"
                    onClick={openMemoEditModal}
                    disabled={actionBusy || memoEditDeleting}
                  >
                    <span>Edit memo</span>
                  </button>
                  <button
                    type="button"
                    className="memo-footer-btn memo-footer-btn--danger"
                    onClick={deleteMemo}
                    disabled={actionBusy || memoEditDeleting || !!detail.converted_invoice_id}
                    title={detail.converted_invoice_id ? 'Converted memos cannot be deleted' : 'Delete memo and restock remaining pieces'}
                  >
                    <span>Delete memo</span>
                  </button>
                  <button type="button" className="memo-footer-btn memo-footer-btn--primary" onClick={() => printMemo(detail)}>
                    <IconPrint />
                    <span>Print</span>
                  </button>
                  <button
                    type="button"
                    className="memo-footer-btn memo-footer-btn--amber"
                    onClick={returnSelected}
                    disabled={actionBusy || detail.status === 'Closed'}
                    title="Return only the quantities you entered in the table"
                  >
                    <IconUndo />
                    <span>Return selected</span>
                  </button>
                  <button
                    type="button"
                    className="memo-footer-btn memo-footer-btn--amber"
                    onClick={returnAll}
                    disabled={actionBusy || detail.status === 'Closed'}
                  >
                    <IconUndo />
                    <span>Return all</span>
                  </button>
                  <button
                    type="button"
                    className="memo-footer-btn memo-footer-btn--violet"
                    onClick={convertToInvoice}
                    disabled={actionBusy || detail.status === 'Closed' || !!detail.converted_invoice_id}
                  >
                    <IconReceipt />
                    <span>Convert to invoice</span>
                  </button>
                </div>
                <button type="button" className="memo-detail-close-footer ghost-button" onClick={closeDetail}>
                  Close window
                </button>
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

      {memoEditOpen && detail && (
        <div className="selling2-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="memo-edit-title">
          <div className="selling2-modal memo-edit-modal">
            <div className="selling2-modal-header">
              <h3 id="memo-edit-title">Edit memo {detail.memo_no}</h3>
              <button
                type="button"
                className="selling2-modal-close"
                onClick={() => setMemoEditOpen(false)}
                aria-label="Close"
              >
                <IconX />
              </button>
            </div>
            <div className="selling2-modal-body">
              <label>
                <span>Memo date</span>
                <input type="date" value={editMemoDate} onChange={e => setEditMemoDate(e.target.value)} />
              </label>
              <label>
                <span>Due date (optional)</span>
                <input type="date" value={editDueDate} onChange={e => setEditDueDate(e.target.value)} />
              </label>
              <label>
                <span>Notes (optional)</span>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3} placeholder="Notes…" />
              </label>
              <p className="selling2-modal-section-label">Customer</p>
              {detail.converted_invoice_id ? (
                <p className="memo-edit-hint">
                  Customer cannot be changed because this memo was converted to an invoice.
                </p>
              ) : editSelectedCustomer ? (
                <div className="selling2-customer-selected">
                  <span className="selling2-customer-selected-icon" aria-hidden="true">
                    <IconUserRounded />
                  </span>
                  <div className="selling2-customer-selected-main">
                    <div className="selling2-customer-selected-name">{editSelectedCustomer.name}</div>
                    <div className="selling2-customer-selected-phone">{editSelectedCustomer.phone || ''}</div>
                  </div>
                  <button
                    type="button"
                    className="selling2-customer-selected-close"
                    onClick={() => setEditSelectedCustomer(null)}
                    aria-label="Remove customer"
                  >
                    <IconX size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="selling2-customer-search">
                    <span className="selling2-search-icon" aria-hidden="true">
                      <IconSearch />
                    </span>
                    <input
                      type="search"
                      className="selling2-search-input"
                      value={editCustomerSearch}
                      onChange={e => setEditCustomerSearch(e.target.value)}
                      placeholder="Search by name, phone…"
                      aria-label="Search customers"
                    />
                  </div>
                  {editCustomerSuggestions.length > 0 ? (
                    <div className="selling2-customer-list">
                      {editCustomerSuggestions.map(cust => (
                        <button
                          type="button"
                          key={cust.id}
                          className="selling2-customer-row"
                          onClick={() => {
                            setEditSelectedCustomer(cust);
                            setEditCustomerSearch('');
                            setEditCustomerSuggestions([]);
                          }}
                        >
                          <div className="selling2-customer-row-name">{cust.name}</div>
                          <div className="selling2-customer-row-phone">{cust.phone || ''}</div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <div className="selling2-modal-footer">
              <button type="button" className="ghost-button" onClick={() => setMemoEditOpen(false)} disabled={memoEditSaving}>
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={saveMemoEdit} disabled={memoEditSaving}>
                {memoEditSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
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

