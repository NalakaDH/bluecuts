import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { isCloudFirestoreMode } from '../../cloud/cloudMode';
import { inventoryMonthlyDocId, readPublicDoc } from '../../cloud/firestoreDocs';
import { formatMoneyAmount } from '../../lib/currencies';
import {
  categoryLooksLikeShortCode,
  formatItemTypeDisplay,
  inventoryItemPrimaryLabel,
  inventoryCategoryDisplay,
} from '../../lib/inventoryDisplay';

const USD = 'USD';

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return formatMoneyAmount(n, USD);
}

interface InventoryReportPageProps {
  token: string;
}

interface ReportItem {
  id: number;
  category: string;
  item_type: string;
  item_code: string | null;
  description: string | null;
  opening: number;
  sold: number;
  returned: number;
  shrinkage: number;
  restocked: number;
  remaining: number;
  unit_price: number | null;
  selling_currency: string;
  revenue_thb: number;
  revenue_usd: number | null;
  stock_value_thb: number;
  stock_value_usd: number | null;
  status: string;
}

interface Summary {
  totalSold: number;
  totalRevenueThb: number;
  totalRevenueUsd: number | null;
  stockValueThb: number;
  stockValueUsd: number | null;
  noMovement: number;
  totalShrinkage: number;
  outOfStock: number;
}

interface FxInfo {
  thb_per_usd: number | null;
  usd_available: boolean;
}

type ActiveTab = 'all' | 'top' | 'none' | 'low' | 'shrinkage';

type SortKey =
  | 'name'
  | 'category'
  | 'opening'
  | 'sold'
  | 'returned'
  | 'shrinkage'
  | 'restocked'
  | 'remaining'
  | 'price'
  | 'revenue'
  | 'stock_value';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function displayTitle(row: ReportItem): string {
  const d = row.description?.trim();
  if (d) return d.length > 64 ? `${d.slice(0, 61)}…` : d;
  const cat = row.category?.trim() ?? '';
  const typeDisp = formatItemTypeDisplay(row.item_type);
  if (!categoryLooksLikeShortCode(cat)) {
    const code = row.item_code?.trim();
    const parts = [cat, typeDisp];
    if (code) parts.push(code);
    return parts.join(' · ');
  }
  return (
    inventoryItemPrimaryLabel({
      id: row.id,
      category: row.category,
      description: row.description,
      item_code: row.item_code,
    }) +
    ' · ' +
    typeDisp
  );
}

function statusBadge(item: ReportItem): { label: string; className: string } {
  if (item.shrinkage > 0) return { label: 'Shrinkage', className: 'inv-rpt-badge inv-rpt-badge--shrink' };
  if (item.remaining === 0) return { label: 'Out of stock', className: 'inv-rpt-badge inv-rpt-badge--out' };
  if (item.sold === 0) return { label: 'No sales', className: 'inv-rpt-badge inv-rpt-badge--idle' };
  if (item.remaining <= 3) return { label: 'Low stock', className: 'inv-rpt-badge inv-rpt-badge--low' };
  return { label: 'Active', className: 'inv-rpt-badge inv-rpt-badge--active' };
}

function escapeCsvCell(v: string | number): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isNumericSortKey(k: SortKey): boolean {
  return k !== 'name' && k !== 'category';
}

const IconRefresh = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 4v6h-6M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export const InventoryReportPage: React.FC<InventoryReportPageProps> = ({ token }) => {
  const { showAlert } = useAlertDialog();
  const cloud = isCloudFirestoreMode();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [items, setItems] = useState<ReportItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [fx, setFx] = useState<FxInfo | null>(null);
  const [ym, setYm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('sold');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [category, setCategory] = useState('All');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (cloud) {
        const id = inventoryMonthlyDocId(year, month);
        const data = await readPublicDoc<any>(id);
        setItems(Array.isArray(data.items) ? data.items : []);
        setSummary(data.summary ?? null);
        setFx(data.fx && typeof data.fx === 'object' ? (data.fx as FxInfo) : null);
        setYm(String(data.ym ?? ''));
        return;
      }
      const res = await fetch(apiUrl(`/api/reports/inventory-monthly?year=${year}&month=${month}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) {
        throw new Error('This report is only available to the owner.');
      }
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load report'));
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setSummary(data.summary ?? null);
      setFx(data.fx && typeof data.fx === 'object' ? (data.fx as FxInfo) : null);
      setYm(String(data.ym ?? ''));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load report';
      setError(msg);
      setItems([]);
      setSummary(null);
      setFx(null);
      showAlert({ title: 'Report unavailable', message: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [token, year, month, showAlert, cloud]);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    const list: string[] = [];
    const seen: Record<string, true> = {};
    for (const i of items) {
      const c = i.category;
      if (c && !seen[c] && !categoryLooksLikeShortCode(c)) {
        seen[c] = true;
        list.push(c);
      }
    }
    return list.sort();
  }, [items]);

  const tabCounts = useMemo(
    () => ({
      all: items.length,
      top: items.filter((i) => i.sold > 0).length,
      none: items.filter((i) => i.sold === 0).length,
      low: items.filter((i) => i.remaining <= 3 && i.remaining > 0).length,
      shrinkage: items.filter((i) => i.shrinkage > 0).length,
    }),
    [items]
  );

  const filtered = useMemo(() => {
    let data = [...items];
    const q = search.trim().toLowerCase();
    if (q) {
      data = data.filter((i) => {
        const code = (i.item_code ?? '').toLowerCase();
        const name = displayTitle(i).toLowerCase();
        const cat = i.category.toLowerCase();
        return code.includes(q) || name.includes(q) || cat.includes(q);
      });
    }
    if (category !== 'All') data = data.filter((i) => i.category === category);

    if (activeTab === 'top') {
      data = data
        .filter((i) => i.sold > 0)
        .sort((a, b) => b.sold - a.sold)
        .slice(0, 10);
    } else if (activeTab === 'none') data = data.filter((i) => i.sold === 0);
    else if (activeTab === 'low') data = data.filter((i) => i.remaining <= 3 && i.remaining > 0);
    else if (activeTab === 'shrinkage') data = data.filter((i) => i.shrinkage > 0);

    const getVal = (row: ReportItem, key: SortKey): string | number => {
      switch (key) {
        case 'name':
          return (row.item_code ?? '').trim() || `#${row.id}`;
        case 'category':
          return row.category;
        case 'opening':
          return row.opening;
        case 'sold':
          return row.sold;
        case 'returned':
          return row.returned;
        case 'shrinkage':
          return row.shrinkage;
        case 'restocked':
          return row.restocked;
        case 'remaining':
          return row.remaining;
        case 'price':
          return row.unit_price ?? 0;
        case 'revenue':
          return row.revenue_usd ?? -1;
        case 'stock_value':
          return row.stock_value_usd ?? -1;
        default:
          return 0;
      }
    };

    data.sort((a, b) => {
      const av = getVal(a, sortKey);
      const bv = getVal(b, sortKey);
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      return sortDir === 'asc' ? an - bn : bn - an;
    });

    return data;
  }, [items, search, category, activeTab, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    const out: number[] = [];
    for (let yy = 2024; yy <= y + 1; yy++) out.push(yy);
    return out;
  }, []);

  const exportCsv = () => {
    const rows = filtered;
    const headers = [
      'Item code',
      'Category',
      'Opening',
      'Sold',
      'Returned',
      'Shrinkage',
      'Restocked',
      'Remaining',
      'Unit price',
      'Revenue USD',
      'Stock value USD',
      'Status',
    ];
    const lines = [headers.join(',')];
    for (const item of rows) {
      const badge = statusBadge(item);
      lines.push(
        [
          escapeCsvCell(item.item_code?.trim() || ''),
          escapeCsvCell(item.category),
          item.opening,
          item.sold,
          item.returned,
          item.shrinkage,
          item.restocked,
          item.remaining,
          escapeCsvCell(
            item.unit_price != null ? formatMoneyAmount(item.unit_price, item.selling_currency) : '—'
          ),
          escapeCsvCell(item.revenue_usd != null && item.revenue_usd > 0 ? String(item.revenue_usd) : ''),
          escapeCsvCell(item.stock_value_usd != null ? String(item.stock_value_usd) : ''),
          escapeCsvCell(badge.label),
        ].join(',')
      );
    }
    const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inventory-report-${ym || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const cols: { key: SortKey; label: string; w: string }[] = [
    { key: 'name', label: 'Item code', w: '22%' },
    { key: 'category', label: 'Category', w: '10%' },
    { key: 'opening', label: 'Opening', w: '8%' },
    { key: 'sold', label: 'Sold', w: '7%' },
    { key: 'returned', label: 'Returned', w: '8%' },
    { key: 'shrinkage', label: 'Shrinkage', w: '9%' },
    { key: 'restocked', label: 'Restocked', w: '9%' },
    { key: 'remaining', label: 'Remaining', w: '9%' },
    { key: 'price', label: 'Unit price', w: '8%' },
    { key: 'revenue', label: 'Revenue (USD)', w: '9%' },
    { key: 'stock_value', label: 'Stock (USD)', w: '9%' },
  ];

  const tabs: { key: ActiveTab; label: string; count: number }[] = [
    { key: 'all', label: 'All items', count: tabCounts.all },
    { key: 'top', label: 'Top sellers', count: tabCounts.top },
    { key: 'none', label: 'No movement', count: tabCounts.none },
    { key: 'low', label: 'Low stock', count: tabCounts.low },
    { key: 'shrinkage', label: 'Shrinkage', count: tabCounts.shrinkage },
  ];

  const SortIcon: React.FC<{ k: SortKey }> = ({ k }) => {
    if (sortKey !== k) return <span className="inv-rpt-sort inv-rpt-sort--idle">↕</span>;
    return (
      <span className="inv-rpt-sort inv-rpt-sort--active">{sortDir === 'asc' ? '↑' : '↓'}</span>
    );
  };

  const sum = summary;

  return (
    <div className="page page-inventory-report inv-rpt-root">
      {sum && (
        <div className="inv-rpt-summary inv-rpt-summary--top" aria-label="Month summary">
          {(
            [
              { label: 'Total sold', value: String(sum.totalSold), sub: 'units this month' },
              {
                label: 'Revenue',
                value: formatUsd(sum.totalRevenueUsd),
                sub: 'Month invoice sales → THB (line share × FX) → USD',
              },
              { label: 'No movement', value: String(sum.noMovement), sub: 'items unsold', tone: 'warn' as const },
              {
                label: 'Stock value',
                value: formatUsd(sum.stockValueUsd),
                sub: 'Remaining × list price × FX → THB → USD',
              },
              {
                label: 'Shrinkage',
                value: String(sum.totalShrinkage),
                sub: 'units lost/missing',
                tone: 'danger' as const,
              },
              { label: 'Out of stock', value: String(sum.outOfStock), sub: 'items depleted' },
            ] as {
              label: string;
              value: string;
              sub: string;
              tone?: 'warn' | 'danger';
            }[]
          ).map((c, i) => (
            <div key={i} className="inv-rpt-summary-cell">
              <div className="inv-rpt-summary-label">{c.label}</div>
              <div
                className={`inv-rpt-summary-value${c.tone === 'danger' ? ' inv-rpt-summary-value--danger' : ''}${c.tone === 'warn' ? ' inv-rpt-summary-value--warn' : ''}`}
              >
                {c.value}
              </div>
              <div className="inv-rpt-summary-sub">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      <header className="inv-rpt-topbar">
        <div className="inv-rpt-toolbar-main inv-rpt-toolbar-main--search-only">
          <input
            className="inv-rpt-input inv-rpt-input--search"
            type="search"
            placeholder="Search by item code, name, or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search report"
          />
        </div>
        <div className="inv-rpt-toolbar-sub">
          <div className="inv-rpt-filters" aria-label="Period and category">
            <select
              className="inv-rpt-select"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              aria-label="Month"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select className="inv-rpt-select" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select className="inv-rpt-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="All">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="inv-rpt-toolbar-actions">
            <button
              type="button"
              className="inv-rpt-btn-icon"
              onClick={() => void load()}
              disabled={loading}
              title="Reload report"
              aria-label="Reload report"
            >
              <IconRefresh />
            </button>
            <button type="button" className="inv-rpt-export" onClick={exportCsv} disabled={loading || filtered.length === 0}>
              Export CSV
            </button>
          </div>
        </div>
        <div className="inv-rpt-context">
          <p className="inv-rpt-subtitle inv-rpt-subtitle--toolbar">
            Owner view — {MONTHS[month - 1]} {year}
            {ym ? ` (${ym})` : ''}
            {fx?.usd_available && fx.thb_per_usd
              ? ` · Revenue & stock converted via THB bridge (USD @ ${fx.thb_per_usd} THB/USD from Profile).`
              : ''}
          </p>
          {fx && !fx.usd_available && (
            <p className="inv-rpt-fx-warn">
              Set a USD exchange rate under Profile to show revenue and stock values in US dollars.
            </p>
          )}
        </div>
      </header>

      <div className="inv-rpt-tabs-bar">
        <div className="inv-rpt-tabs" role="tablist" aria-label="Report segments">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              className={activeTab === t.key ? 'inv-rpt-tab is-active' : 'inv-rpt-tab'}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
              <span className={activeTab === t.key ? 'inv-rpt-tab-count is-active' : 'inv-rpt-tab-count'}>{t.count}</span>
            </button>
          ))}
        </div>
        <span className="inv-rpt-result-info">{filtered.length} items shown</span>
      </div>

      <div className="inv-rpt-table-wrap">
        {loading && <div className="inv-rpt-state">Loading report…</div>}
        {!loading && error && <div className="inv-rpt-state inv-rpt-state--error">{error}</div>}
        {!loading && !error && (
          <table className="inv-rpt-table">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className={`inv-rpt-th${isNumericSortKey(c.key) ? ' inv-rpt-th--num' : ''}`}
                    style={{ width: c.w }}
                    onClick={() => handleSort(c.key)}
                  >
                    {c.label}
                    <SortIcon k={c.key} />
                  </th>
                ))}
                <th className="inv-rpt-th inv-rpt-th--center" style={{ width: '10%' }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="inv-rpt-empty">
                    No items match this filter.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const badge = statusBadge(item);
                  const revUsd = item.revenue_usd;
                  const stockUsd = item.stock_value_usd;
                  return (
                    <tr key={item.id} className="inv-rpt-tr">
                      <td className="inv-rpt-td inv-rpt-td--code">
                        <div className="inv-rpt-item-code inv-rpt-item-code--primary">
                          {item.item_code?.trim() || '—'}
                        </div>
                      </td>
                      <td className="inv-rpt-td inv-rpt-td--cat">
                        <span className="inv-rpt-cat">
                          {inventoryCategoryDisplay(item.category) ?? '—'}
                        </span>
                      </td>
                      <td className="inv-rpt-td inv-rpt-td--num inv-rpt-num-neutral">{item.opening}</td>
                      <td className="inv-rpt-td inv-rpt-td--num">
                        <span
                          className={
                            item.sold > 5
                              ? 'inv-rpt-num-good'
                              : item.sold === 0
                                ? 'inv-rpt-num-neutral'
                                : 'inv-rpt-num-mid'
                          }
                        >
                          {item.sold}
                        </span>
                      </td>
                      <td
                        className={
                          item.returned > 0 ? 'inv-rpt-td inv-rpt-td--num inv-rpt-num-warn' : 'inv-rpt-td inv-rpt-td--num inv-rpt-num-dim'
                        }
                      >
                        {item.returned}
                      </td>
                      <td className="inv-rpt-td inv-rpt-td--num">
                        <span className={item.shrinkage > 0 ? 'inv-rpt-num-bad' : 'inv-rpt-num-dim'}>
                          {item.shrinkage > 0 ? `−${item.shrinkage}` : '—'}
                        </span>
                      </td>
                      <td
                        className={
                          item.restocked > 0 ? 'inv-rpt-td inv-rpt-td--num inv-rpt-num-good' : 'inv-rpt-td inv-rpt-td--num inv-rpt-num-dim'
                        }
                      >
                        {item.restocked > 0 ? `+${item.restocked}` : '—'}
                      </td>
                      <td className="inv-rpt-td inv-rpt-td--num">
                        <span
                          className={
                            item.remaining === 0
                              ? 'inv-rpt-num-bad'
                              : item.remaining <= 3
                                ? 'inv-rpt-num-warn'
                                : 'inv-rpt-num-neutral'
                          }
                        >
                          {item.remaining}
                        </span>
                      </td>
                      <td className="inv-rpt-td inv-rpt-td--num inv-rpt-price">
                        {item.unit_price != null
                          ? formatMoneyAmount(item.unit_price, item.selling_currency)
                          : '—'}
                      </td>
                      <td className="inv-rpt-td inv-rpt-td--num">
                        <span className={revUsd != null && revUsd > 0 ? 'inv-rpt-revenue' : 'inv-rpt-num-muted'}>
                          {revUsd == null || revUsd <= 0 ? '—' : formatUsd(revUsd)}
                        </span>
                      </td>
                      <td className="inv-rpt-td inv-rpt-td--num">
                        <span
                          className={
                            stockUsd == null
                              ? 'inv-rpt-num-muted'
                              : stockUsd > 0
                                ? 'inv-rpt-stock-val'
                                : 'inv-rpt-num-muted'
                          }
                        >
                          {stockUsd == null ? '—' : formatUsd(stockUsd)}
                        </span>
                      </td>
                      <td className="inv-rpt-td inv-rpt-td--status">
                        <span className={badge.className}>{badge.label}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
