import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { isCloudFirestoreMode } from '../../cloud/cloudMode';
import { readPublicDoc } from '../../cloud/firestoreDocs';
import type { PageId } from '../../components/layout/Layout';
import { formatMoneyWhole } from '../../lib/currencies';
import {
  categoryLooksLikeShortCode,
  formatItemTypeDisplay,
  inventoryCategoryDisplay,
} from '../../lib/inventoryDisplay';
import { dateFromServerUtc } from '../../lib/serverTime';

type UserRole = 'owner' | 'staff';

interface CheckInventoryPageProps {
  token: string;
  role?: UserRole;
  onNavigate?: (page: PageId) => void;
}

interface InventoryItem {
  id: number;
  category: string;
  item_type: string;
  pieces: number;
  pieces_remaining?: number | null;
  weight_grams: number | null;
  weight_carats: number | null;
  purchasing_total_price: number | null;
  purchasing_carat_price: number | null;
  selling_total_price: number | null;
  selling_carat_price: number | null;
  selling_currency?: string | null;
  image_path: string | null;
  item_code: string | null;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface StockMovement {
  id: number;
  inventory_item_id: number;
  type: string;
  ref_type: string | null;
  ref_id: number | null;
  qty_change: number;
  note: string | null;
  created_at: string;
  user_name: string | null;
}

interface ActivityRow {
  shrink_units: number;
  memo_units?: number;
  sold_units?: number;
  last_activity: string | null;
  has_manual_edit: boolean;
}

type ActivitySummaryMap = Record<string, ActivityRow>;

type StockHealth = 'critical' | 'low' | 'healthy';

type EnrichedItem = InventoryItem & {
  rem: number;
  shrinkUnits: number;
  memoUnits: number;
  soldUnits: number;
  effectiveStatus: string;
  lastActivityIso: string | null;
  hasManualEdit: boolean;
};

const PAGE_SIZE = 60;
const QUICK_ADD_STORAGE_KEY = 'bluecuts-quick-add-item';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'Available', label: 'Available' },
  { value: 'On Memo', label: 'On Memo' },
  { value: 'Out of stock', label: 'Out of stock' },
  { value: 'Sold', label: 'Sold' },
];

function remainingOf(item: InventoryItem): number {
  return typeof item.pieces_remaining === 'number' ? item.pieces_remaining : item.pieces;
}

function healthOf(rem: number, pieces: number): StockHealth {
  if (rem === 0) return 'critical';
  const denom = Math.max(pieces, 1);
  const pct = rem / denom;
  if (pct <= 0.2) return 'critical';
  if (pct <= 0.5) return 'low';
  return 'healthy';
}

function healthPct(rem: number, pieces: number): number {
  if (rem === 0) return 0;
  const denom = Math.max(pieces, 1);
  return Math.round((rem / denom) * 100);
}

function healthLabel(h: StockHealth): string {
  if (h === 'critical') return 'Critical';
  if (h === 'low') return 'Low';
  return 'Healthy';
}

/** Primary line: description, or code · product form · carats — stone type is shown on its own row below. */
function displayTitle(item: InventoryItem): string {
  const d = item.description?.trim();
  if (d) {
    return d.length > 72 ? `${d.slice(0, 69)}…` : d;
  }
  const carat = item.weight_carats != null ? ` ${item.weight_carats}ct` : '';
  const typeDisp = formatItemTypeDisplay(item.item_type);
  const code = item.item_code?.trim();
  if (code) return `${code} · ${typeDisp}${carat}`.trim();
  return `${typeDisp}${carat}`.trim() || `Item #${item.id}`;
}

function formatRelativeLast(iso: string | null): string {
  if (!iso) return '—';
  const t = dateFromServerUtc(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const now = Date.now();
  const diffMs = Math.max(0, now - t);
  const s = Math.floor(diffMs / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1) return 'Just now';
  if (h < 1) return `${m} min ago`;
  if (d < 1) return `${h} hr ago`;
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return dateFromServerUtc(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMovementDateShort(iso: string): string {
  try {
    return dateFromServerUtc(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function movementTypeLabel(type: string): string {
  if (type === 'INVENTORY_EDIT') return 'Manual edit';
  return type.replace(/_/g, ' ');
}

/** Panel history: uppercase type like the reference UI (SALE, SHRINKAGE). */
function movementTypeDisplay(type: string): string {
  return movementTypeLabel(type).toUpperCase();
}

function movementDotClass(type: string): string {
  const u = type.toUpperCase();
  if (u === 'SALE' || u === 'INVOICE') return 'ci2-mov--sale';
  if (u === 'SHRINKAGE') return 'ci2-mov--shrink';
  if (u === 'RESTOCK' || u === 'RETURN') return 'ci2-mov--restock';
  if (u === 'INVENTORY_EDIT') return 'ci2-mov--edit';
  if (u.includes('MEMO')) return 'ci2-mov--memo';
  return 'ci2-mov--default';
}

function statusBadgeClass(status: string): string {
  return status.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

const iconSize = 22;
const IconRefresh = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 4v6h-6M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
const IconGem = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
  </svg>
);
const IconMemo = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
  </svg>
);
const IconSell = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);

export const CheckInventoryPage: React.FC<CheckInventoryPageProps> = ({ token, role = 'staff', onNavigate }) => {
  const { showAlert } = useAlertDialog();
  const isOwner = role === 'owner';
  const cloud = isCloudFirestoreMode();

  const [rawItems, setRawItems] = useState<InventoryItem[]>([]);
  const [activitySummary, setActivitySummary] = useState<ActivitySummaryMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterHealth, setFilterHealth] = useState<'all' | StockHealth>('all');
  const [filterCat, setFilterCat] = useState('');
  const [shrinkOnly, setShrinkOnly] = useState(false);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const [stockHistory, setStockHistory] = useState<StockMovement[]>([]);
  const [stockHistoryLoading, setStockHistoryLoading] = useState(false);
  const [stockHistoryError, setStockHistoryError] = useState<string | null>(null);

  const getImageSrc = useCallback((imagePath: string | null): string => {
    if (!imagePath) return '';
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
    const path = imagePath.startsWith('/') ? imagePath : `/uploads/${imagePath}`;
    return apiUrl(path);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (cloud) {
        const doc = await readPublicDoc<any>('checkInventory');
        const items = Array.isArray(doc?.items) ? (doc.items as InventoryItem[]) : [];
        const summary = doc?.activity_summary && typeof doc.activity_summary === 'object' ? (doc.activity_summary as ActivitySummaryMap) : {};
        setRawItems(items);
        setActivitySummary(summary);
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      const [invRes, sumRes] = await Promise.all([
        fetch(apiUrl('/api/inventory'), { headers }),
        fetch(apiUrl('/api/inventory/activity-summary'), { headers }),
      ]);
      if (!invRes.ok) throw new Error(await parseErrorResponse(invRes, 'Failed to load inventory'));
      if (!sumRes.ok) throw new Error(await parseErrorResponse(sumRes, 'Failed to load activity summary'));
      const data: InventoryItem[] = await invRes.json();
      const summary: ActivitySummaryMap = await sumRes.json();
      setRawItems(data);
      setActivitySummary(summary && typeof summary === 'object' ? summary : {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load inventory';
      setError(msg);
      setRawItems([]);
      setActivitySummary({});
      showAlert({ title: 'Could not load inventory', message: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [token, showAlert, cloud]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const enriched: EnrichedItem[] = useMemo(() => {
    return rawItems.map((item) => {
      const s = activitySummary[String(item.id)] || {
        shrink_units: 0,
        memo_units: 0,
        sold_units: 0,
        last_activity: null,
        has_manual_edit: false,
      };
      const rem = remainingOf(item);
      const memoUnits = Math.max(0, Math.round(Number((s as any).memo_units) || 0));
      const soldUnits = Math.max(0, Math.round(Number((s as any).sold_units) || 0));
      const effectiveStatus =
        memoUnits > 0
          ? 'On Memo'
          : rem === 0 && soldUnits > 0
            ? 'Sold'
            : item.status;
      return {
        ...item,
        rem,
        shrinkUnits: Number(s.shrink_units) || 0,
        memoUnits,
        soldUnits,
        effectiveStatus,
        lastActivityIso: s.last_activity || item.updated_at || null,
        hasManualEdit: Boolean(s.has_manual_edit),
      };
    });
  }, [rawItems, activitySummary]);

  const categories = useMemo(() => {
    const list: string[] = [];
    const seen: Record<string, true> = {};
    for (const i of rawItems) {
      const c = i.category;
      if (c && !seen[c] && !categoryLooksLikeShortCode(c)) {
        seen[c] = true;
        list.push(c);
      }
    }
    return list.sort();
  }, [rawItems]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter((i) => {
      if (q) {
        const hay = [
          i.category,
          i.item_type,
          i.item_code || '',
          i.description || '',
          displayTitle(i),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterStatus && i.effectiveStatus !== filterStatus) return false;
      if (filterCat && i.category !== filterCat) return false;
      const h = healthOf(i.rem, i.pieces);
      if (isOwner && filterHealth !== 'all' && h !== filterHealth) return false;
      if (isOwner && shrinkOnly && i.shrinkUnits <= 0) return false;
      return true;
    });
  }, [enriched, search, filterStatus, filterCat, filterHealth, shrinkOnly, isOwner]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterStatus, filterCat, filterHealth, shrinkOnly, view]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSlice = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  const selectedItem = useMemo(
    () => (selectedId == null ? null : enriched.find((x) => x.id === selectedId) ?? null),
    [enriched, selectedId]
  );

  const fetchStockHistory = useCallback(
    async (itemId: number) => {
      setStockHistoryLoading(true);
      setStockHistoryError(null);
      try {
        if (cloud) {
          setStockHistory([]);
          setStockHistoryError('Stock history is not synced to cloud dashboard.');
          return;
        }
        const res = await fetch(apiUrl(`/api/inventory/${itemId}/stock-history?limit=200`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load stock history'));
        const data: StockMovement[] = await res.json();
        setStockHistory(data);
      } catch (err: unknown) {
        setStockHistoryError(err instanceof Error ? err.message : 'Failed to load stock history');
        setStockHistory([]);
      } finally {
        setStockHistoryLoading(false);
      }
    },
    [token, cloud]
  );

  useEffect(() => {
    if (selectedId == null) {
      setStockHistory([]);
      setStockHistoryError(null);
      return;
    }
    fetchStockHistory(selectedId);
  }, [selectedId, fetchStockHistory]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleSelect = (id: number) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const lowCriticalCount = filtered.filter((i) => ['low', 'critical'].includes(healthOf(i.rem, i.pieces))).length;

  return (
    <div className="page page-check-inventory ci2-root">
      {onNavigate && (
        <p className="check-inventory-to-stockcount">
          <button type="button" className="check-inventory-to-stockcount-btn" onClick={() => onNavigate('stockCount')}>
            Stock count — quick physical check &amp; record missing stock
          </button>
        </p>
      )}

      <div className="ci2-summary ci2-summary--top" aria-label="Filtered summary">
        <div className="ci2-summary-cell">
          <span className="ci2-summary-label">Showing</span>
          <span className="ci2-summary-val">{filtered.length} items</span>
        </div>
        <div className="ci2-summary-cell">
          <span className="ci2-summary-label">Available</span>
          <span className="ci2-summary-val ci2-summary-val--ok">{filtered.filter((i) => i.effectiveStatus === 'Available').length}</span>
        </div>
        <div className="ci2-summary-cell">
          <span className="ci2-summary-label">Out of stock</span>
          <span className="ci2-summary-val ci2-summary-val--bad">{filtered.filter((i) => i.rem === 0).length}</span>
        </div>
        <div className="ci2-summary-cell">
          <span className="ci2-summary-label">Low / Critical</span>
          <span className="ci2-summary-val ci2-summary-val--warn">{lowCriticalCount}</span>
        </div>
        <div className="ci2-summary-cell">
          <span className="ci2-summary-label">Has shrinkage</span>
          <span className="ci2-summary-val ci2-summary-val--bad">{filtered.filter((i) => i.shrinkUnits > 0).length}</span>
        </div>
      </div>

      <header className="ci2-topbar">
        <div className="ci2-toolbar-main ci2-toolbar-main--search">
          <input
            className="ci2-input ci2-input--search"
            type="search"
            placeholder="Search name, category, code, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search inventory"
          />
        </div>
        <div className="ci2-toolbar-sub">
          <div className="ci2-filters" aria-label="Filters">
            <select className="ci2-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label="Status filter">
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {isOwner && (
              <select
                className="ci2-select"
                value={filterHealth}
                onChange={(e) => setFilterHealth(e.target.value as 'all' | StockHealth)}
                aria-label="Stock health filter"
              >
                <option value="all">All stock health</option>
                <option value="critical">Critical (0–20%)</option>
                <option value="low">Low (21–50%)</option>
                <option value="healthy">Healthy (51%+)</option>
              </select>
            )}
            <select className="ci2-select" value={filterCat} onChange={(e) => setFilterCat(e.target.value)} aria-label="Category filter">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {isOwner && (
              <button
                type="button"
                className={`ci2-btn-shrink ${shrinkOnly ? 'is-on' : ''}`}
                onClick={() => setShrinkOnly((v) => !v)}
              >
                Shrinkage only
              </button>
            )}
          </div>
          <div className="ci2-toolbar-actions">
            <button type="button" className="ci2-btn-icon" onClick={() => loadAll()} title="Refresh" aria-label="Refresh inventory">
              <IconRefresh />
            </button>
            <div className="ci2-view-toggle" role="group" aria-label="View mode">
              {(['list', 'grid'] as const).map((v) => (
                <button key={v} type="button" className={view === v ? 'is-active' : ''} onClick={() => setView(v)}>
                  {v === 'list' ? 'List' : 'Grid'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className={`ci2-body ${selectedItem ? 'has-panel' : ''}`}>
        <div className="ci2-list-panel">
          {loading && (
            <div className="ci2-state ci2-state--loading">
              <div className="ci2-spinner" aria-hidden="true" />
              <p>Loading inventory…</p>
            </div>
          )}
          {!loading && error && (
            <div className="ci2-state ci2-state--error">
              <p>{error}</p>
            </div>
          )}
          {!loading && !error && view === 'list' && (
            <div className="ci2-table-wrap">
              <table className="ci2-table">
                <thead>
                  <tr>
                    <th className="ci2-th ci2-th--thumb" scope="col" />
                    <th className="ci2-th ci2-th--stone" scope="col">
                      Stone type
                    </th>
                    <th className="ci2-th ci2-th--code" scope="col">
                      Code
                    </th>
                    <th className="ci2-th ci2-th--health" scope="col">
                      Stock health
                    </th>
                    <th className="ci2-th ci2-th--num" scope="col">
                      Remaining
                    </th>
                    <th className="ci2-th ci2-th--num" scope="col">
                      Price
                    </th>
                    <th className="ci2-th" scope="col">
                      Status
                    </th>
                    <th className="ci2-th" scope="col">
                      Last activity
                    </th>
                    <th className="ci2-th ci2-th--flags" scope="col">
                      Flags
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlice.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="ci2-empty">
                        {rawItems.length === 0 ? 'No inventory yet.' : 'No matching items.'}
                      </td>
                    </tr>
                  ) : (
                    pageSlice.map((item) => {
                      const h = healthOf(item.rem, item.pieces);
                      const pct = healthPct(item.rem, item.pieces);
                      const active = selectedId === item.id;
                      return (
                        <tr
                          key={item.id}
                          className={active ? 'is-active' : ''}
                          onClick={() => toggleSelect(item.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleSelect(item.id);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-pressed={active}
                          aria-label={`${inventoryCategoryDisplay(item.category) ?? 'Category not set'}, ${item.item_code || `item ${item.id}`}, open details`}
                        >
                          <td className="ci2-td ci2-td--thumb">
                            <div className="ci2-thumb">
                              {item.image_path ? (
                                <img src={getImageSrc(item.image_path)} alt="" className="ci2-thumb-img" />
                              ) : (
                                <span className="ci2-thumb-ph" aria-hidden="true">
                                  <IconGem />
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="ci2-td ci2-td--stone">
                            <div className="ci2-item-title">{inventoryCategoryDisplay(item.category) ?? '—'}</div>
                          </td>
                          <td className="ci2-td ci2-td--code ci2-mono">{item.item_code || `#${item.id}`}</td>
                          <td className="ci2-td ci2-td--health">
                            <div className="ci2-health-row">
                              <div className="ci2-health-track" aria-hidden="true">
                                <div className={`ci2-health-fill ci2-health-fill--${h}`} style={{ width: `${pct}%` }} />
                              </div>
                              <span className={`ci2-health-pct ci2-health-pct--${h}`}>{item.rem === 0 ? '0%' : `${pct}%`}</span>
                            </div>
                          </td>
                          <td className="ci2-td ci2-td--num">
                            <span className={`ci2-rem ci2-rem--${h}`}>{item.rem}</span>
                            <span className="ci2-rem-denom"> / {item.pieces}</span>
                          </td>
                          <td className="ci2-td ci2-td--num ci2-price">
                            {item.selling_total_price != null
                              ? formatMoneyWhole(item.selling_total_price, item.selling_currency)
                              : '—'}
                          </td>
                          <td className="ci2-td">
                            <span className={`ci2-status ci2-status--${statusBadgeClass(item.effectiveStatus)}`}>{item.effectiveStatus}</span>
                          </td>
                          <td className="ci2-td ci2-muted">{formatRelativeLast(item.lastActivityIso)}</td>
                          <td className="ci2-td ci2-flags">
                            {item.shrinkUnits > 0 && (
                              <span className="ci2-badge-shrink" title="Shrinkage units recorded">
                                -{item.shrinkUnits}
                              </span>
                            )}
                            {isOwner && item.hasManualEdit && (
                              <span className="ci2-badge-suspicious" title="Quantity manually edited on record">
                                Edit
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && view === 'grid' && (
            <div className="ci2-grid">
              {pageSlice.length === 0 ? (
                <p className="ci2-empty ci2-empty--grid">{rawItems.length === 0 ? 'No inventory yet.' : 'No matching items.'}</p>
              ) : (
                pageSlice.map((item) => {
                  const h = healthOf(item.rem, item.pieces);
                  const pct = healthPct(item.rem, item.pieces);
                  const active = selectedId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`ci2-card ${active ? 'is-active' : ''}`}
                      onClick={() => toggleSelect(item.id)}
                    >
                      <div className="ci2-card-head">
                        <div>
                          <div className="ci2-card-title">{inventoryCategoryDisplay(item.category) ?? '—'}</div>
                          <div className="ci2-card-code">{item.item_code || `#${item.id}`}</div>
                        </div>
                        {item.shrinkUnits > 0 && <span className="ci2-badge-shrink">-{item.shrinkUnits}</span>}
                      </div>
                      <div className="ci2-card-stock">
                        <div className="ci2-card-stock-row">
                          <span className="ci2-muted">Stock</span>
                          <span className={`ci2-rem ci2-rem--${h}`}>
                            {item.rem} / {item.pieces}
                          </span>
                        </div>
                        <div className="ci2-health-track" aria-hidden="true">
                          <div className={`ci2-health-fill ci2-health-fill--${h}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="ci2-card-foot">
                        <span className={`ci2-status ci2-status--${statusBadgeClass(item.effectiveStatus)}`}>{item.effectiveStatus}</span>
                        <span className="ci2-price">
                          {item.selling_total_price != null
                            ? formatMoneyWhole(item.selling_total_price, item.selling_currency)
                            : '—'}
                        </span>
                      </div>
                      {isOwner && item.hasManualEdit && <div className="ci2-card-edit-flag">Manual edit on file</div>}
                      <div className="ci2-card-activity">{formatRelativeLast(item.lastActivityIso)}</div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {!loading && !error && filtered.length > PAGE_SIZE && (
            <nav className="ci2-pagination" aria-label="Pagination">
              <button type="button" className="ci2-page-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>
                Prev
              </button>
              <span className="ci2-page-info">
                Page {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                className="ci2-page-btn"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </nav>
          )}
        </div>

        {selectedItem && (
          <>
            <button type="button" className="ci2-panel-backdrop" aria-label="Close detail panel" onClick={() => setSelectedId(null)} />
            <aside className="ci2-detail-panel" aria-label="Item detail">
              <div className="ci2-panel-head">
                <div>
                  {(() => {
                    const catDisp = inventoryCategoryDisplay(selectedItem.category);
                    const typeDisp = formatItemTypeDisplay(selectedItem.item_type);
                    const caratSuffix =
                      selectedItem.weight_carats != null ? ` · ${selectedItem.weight_carats}ct` : '';
                    if (catDisp) {
                      return (
                        <>
                          <div className="ci2-panel-title">{catDisp}</div>
                          <div className="ci2-panel-sub">
                            {typeDisp}
                            {caratSuffix}
                          </div>
                        </>
                      );
                    }
                    return (
                      <>
                        <div className="ci2-panel-title">{typeDisp}</div>
                        {selectedItem.weight_carats != null && (
                          <div className="ci2-panel-sub">{selectedItem.weight_carats}ct</div>
                        )}
                      </>
                    );
                  })()}
                </div>
                <button type="button" className="ci2-panel-close" onClick={() => setSelectedId(null)} aria-label="Close">
                  ×
                </button>
              </div>

              <div className="ci2-panel-fields">
                <div className="ci2-field">
                  <div className="ci2-field-label">Code</div>
                  <div className="ci2-field-val ci2-mono">{selectedItem.item_code || `#${selectedItem.id}`}</div>
                </div>
                <div className="ci2-field">
                  <div className="ci2-field-label">Price</div>
                  <div className="ci2-field-val">
                    {selectedItem.selling_total_price != null
                      ? formatMoneyWhole(selectedItem.selling_total_price, selectedItem.selling_currency)
                      : '—'}
                  </div>
                </div>
                <div className="ci2-field">
                  <div className="ci2-field-label">Purchase price</div>
                  <div className="ci2-field-val">
                    {selectedItem.purchasing_total_price != null
                      ? formatMoneyWhole(selectedItem.purchasing_total_price, selectedItem.selling_currency)
                      : '—'}
                  </div>
                </div>
                <div className="ci2-field">
                  <div className="ci2-field-label">Total pieces</div>
                  <div className="ci2-field-val">{selectedItem.pieces}</div>
                </div>
                <div className="ci2-field">
                  <div className="ci2-field-label">Remaining</div>
                  <div
                    className={`ci2-field-val ci2-field-val--${healthOf(selectedItem.rem, selectedItem.pieces)}`}
                  >
                    {selectedItem.rem}
                  </div>
                </div>
                <div className="ci2-field">
                  <div className="ci2-field-label">Status</div>
                  <span className={`ci2-status ci2-status--${statusBadgeClass(selectedItem.effectiveStatus)}`}>
                    {selectedItem.effectiveStatus}
                  </span>
                </div>
                <div className="ci2-field">
                  <div className="ci2-field-label">Last activity</div>
                  <div className="ci2-field-val">{formatRelativeLast(selectedItem.lastActivityIso)}</div>
                </div>
              </div>

              {(() => {
                const h = healthOf(selectedItem.rem, selectedItem.pieces);
                const pct = healthPct(selectedItem.rem, selectedItem.pieces);
                return (
                  <div className="ci2-panel-stock-health">
                    <div className="ci2-panel-stock-health-title">Stock health</div>
                    <div className="ci2-panel-stock-health-row">
                      <div className="ci2-health-track ci2-health-track--panel" aria-hidden="true">
                        <div className={`ci2-health-fill ci2-health-fill--${h}`} style={{ width: `${selectedItem.rem === 0 ? 0 : pct}%` }} />
                      </div>
                      <span className={`ci2-panel-stock-health-pct ci2-health-pct--${h}`}>
                        {selectedItem.rem === 0 ? '0%' : `${pct}%`}
                      </span>
                    </div>
                    <div className={`ci2-panel-stock-health-desc ci2-health-pct--${h}`}>
                      {healthLabel(h)} — {selectedItem.rem} of {selectedItem.pieces} remaining
                    </div>
                  </div>
                );
              })()}

              {selectedItem.shrinkUnits > 0 && (
                <div className="ci2-shrink-banner">
                  <div className="ci2-shrink-main">
                    Shrinkage recorded: {selectedItem.shrinkUnits} unit{selectedItem.shrinkUnits > 1 ? 's' : ''}
                  </div>
                  <div className="ci2-shrink-hint">Check stock history below for details</div>
                </div>
              )}
              {isOwner && selectedItem.hasManualEdit && (
                <div className="ci2-suspicious-banner">This line has a manual quantity edit on record.</div>
              )}

              <div className="ci2-panel-quick-actions" role="group" aria-label="Quick actions">
                <button
                  type="button"
                  className="ci2-panel-action"
                  onClick={() => {
                    try {
                      sessionStorage.setItem(
                        QUICK_ADD_STORAGE_KEY,
                        JSON.stringify({ inventory_item_id: selectedItem.id })
                      );
                    } catch {
                      // Ignore storage errors; navigation still works.
                    }
                    onNavigate?.('memo');
                  }}
                >
                  <IconMemo />
                  <span>Memo</span>
                </button>
                <button
                  type="button"
                  className="ci2-panel-action"
                  onClick={() => {
                    try {
                      sessionStorage.setItem(
                        QUICK_ADD_STORAGE_KEY,
                        JSON.stringify({ inventory_item_id: selectedItem.id })
                      );
                    } catch {
                      // Ignore storage errors; navigation still works.
                    }
                    onNavigate?.('selling');
                  }}
                >
                  <IconSell />
                  <span>Sell</span>
                </button>
              </div>

              <div className="ci2-history">
                <div className="ci2-history-title">Stock history</div>
                {stockHistoryLoading && <p className="ci2-muted">Loading…</p>}
                {stockHistoryError && <p className="ci2-history-err">{stockHistoryError}</p>}
                {!stockHistoryLoading && !stockHistoryError && stockHistory.length === 0 && <p className="ci2-muted">No movements yet.</p>}
                <ul className="ci2-history-list">
                  {stockHistory.map((m) => (
                    <li key={m.id} className="ci2-history-row">
                      <span className={`ci2-mov-dot ${movementDotClass(m.type)}`} aria-hidden="true" />
                      <div className="ci2-history-main">
                        <div className="ci2-history-top">
                          <span className={`ci2-mov-type ci2-mov-type--upper ${movementDotClass(m.type)}`}>
                            {movementTypeDisplay(m.type)}
                          </span>
                          <span className="ci2-history-date">{formatMovementDateShort(m.created_at)}</span>
                        </div>
                        <div className="ci2-history-note-row">
                          <span className="ci2-history-note">
                            {m.note || m.ref_type || '—'}
                            {m.user_name ? ` · ${m.user_name}` : ''}
                          </span>
                          <span className={m.qty_change > 0 ? 'ci2-qty-pos' : 'ci2-qty-neg'}>
                            {m.qty_change > 0 ? '+' : ''}
                            {m.qty_change}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
};
