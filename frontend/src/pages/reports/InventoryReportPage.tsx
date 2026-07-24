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
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
  memo_out_qty?: number;
  unit_price: number | null;
  selling_currency: string;
  revenue_thb: number;
  revenue_usd: number | null;
  cost_thb?: number;
  cost_usd?: number | null;
  profit_thb?: number;
  profit_usd?: number | null;
  stock_value?: number;
  stock_value_usd: number | null;
  stock_value_thb?: number;
  status: string;
}

interface Summary {
  totalSold: number;
  /** Units returned on invoices this calendar month (same window as Returned column). */
  totalReturned?: number;
  totalRevenueThb: number;
  totalRevenueUsd: number | null;
  totalCostThb?: number;
  totalProfitThb?: number;
  totalProfitUsd: number | null;
  stockValue?: number;
  stockValueUsd: number | null;
  stockValueThb?: number;
  noMovement: number;
  totalShrinkage: number;
  outOfStock: number;
}

interface FxInfo {
  thb_per_usd: number | null;
  usd_available: boolean;
}

type ActiveTab = 'all' | 'top' | 'none' | 'low';

type SortKey =
  | 'name'
  | 'category'
  | 'opening'
  | 'sold'
  | 'returned'
  | 'restocked'
  | 'remaining'
  | 'memo_out'
  | 'price'
  | 'revenue'
  | 'profit'
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
  if (item.sold === 0 && (item.returned ?? 0) > 0) {
    return { label: 'Returns', className: 'inv-rpt-badge inv-rpt-badge--low' };
  }
  if (item.sold === 0) return { label: 'No sales', className: 'inv-rpt-badge inv-rpt-badge--idle' };
  if (item.remaining <= 3) return { label: 'Low stock', className: 'inv-rpt-badge inv-rpt-badge--low' };
  return { label: 'Active', className: 'inv-rpt-badge inv-rpt-badge--active' };
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

const IconTrend = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <polyline points="17 6 23 6 23 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconUpRight = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <line x1="7" y1="17" x2="17" y2="7" />
    <polyline points="7 7 17 7 17 17" />
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
  const [itemCodeFilter, setItemCodeFilter] = useState<'all' | 'contains_m'>('all');

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
      none: items.filter((i) => i.sold === 0 && i.returned === 0).length,
      low: items.filter((i) => i.remaining <= 3 && i.remaining > 0).length,
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
    if (itemCodeFilter === 'contains_m') {
      data = data.filter((i) => (i.item_code ?? '').toUpperCase().includes('M'));
    }

    if (activeTab === 'top') {
      data = data
        .filter((i) => i.sold > 0)
        .sort((a, b) => b.sold - a.sold)
        .slice(0, 10);
    } else if (activeTab === 'none') data = data.filter((i) => i.sold === 0 && i.returned === 0);
    else if (activeTab === 'low') data = data.filter((i) => i.remaining <= 3 && i.remaining > 0);

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
        case 'restocked':
          return row.restocked;
        case 'remaining':
          return row.remaining;
        case 'memo_out':
          return row.memo_out_qty ?? 0;
        case 'price':
          return row.unit_price ?? 0;
        case 'revenue':
          return row.revenue_usd ?? -1;
        case 'profit':
          return row.profit_usd ?? -1;
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
  }, [items, search, category, itemCodeFilter, activeTab, sortKey, sortDir]);

  /** KPIs from the API are month-wide for all inventory. The table can be narrowed (tabs, search, category, item-code filter). */
  const isNarrowedView = useMemo(() => {
    if (items.length === 0) return false;
    if (activeTab !== 'all') return true;
    return filtered.length !== items.length;
  }, [items.length, activeTab, filtered.length]);

  const filteredKpis = useMemo(() => {
    const totalSold = filtered.reduce((s, i) => s + i.sold, 0);
    const thbPerUsd = fx?.thb_per_usd;
    const revenueUsd =
      fx?.usd_available && thbPerUsd != null && thbPerUsd > 0
        ? Math.round(filtered.reduce((s, i) => s + (Number(i.revenue_usd) || 0), 0) * 100) / 100
        : null;
    const stockUsd =
      Math.round(
        filtered.reduce((s, i) => s + (Number(i.stock_value_usd ?? i.stock_value ?? i.stock_value_thb) || 0), 0) * 100
      ) / 100;
    const profitUsd =
      fx?.usd_available && thbPerUsd != null && thbPerUsd > 0
        ? Math.round(filtered.reduce((s, i) => s + (Number(i.profit_usd) || 0), 0) * 100) / 100
        : null;
    return { totalSold, revenueUsd, profitUsd, stockUsd };
  }, [filtered, fx]);

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

  const exportPdf = () => {
    const rows = filtered;
    if (!rows.length) return;

    const title = `Monthly Inventory Report — ${MONTHS[month - 1]} ${year}`;
    const subtitleBits = [
      ym ? `Period: ${ym}` : null,
      category && category !== 'All' ? `Category: ${category}` : null,
      itemCodeFilter === 'contains_m' ? 'Item code: contains "M"' : null,
      search.trim() ? `Search: "${search.trim()}"` : null,
      `Segment: ${tabs.find(t => t.key === activeTab)?.label ?? activeTab}`,
      fx?.usd_available && fx.thb_per_usd ? `USD @ ${fx.thb_per_usd} THB/USD` : null,
      `Rows: ${rows.length}`,
      `Generated: ${new Date().toLocaleString()}`,
    ].filter(Boolean);

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const marginX = 40;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(title, marginX, 44);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text(subtitleBits.join('   •   '), marginX, 62, { maxWidth: pageW - marginX * 2 });

    const head = [[
      'Item code',
      'Category',
      'Opening',
      'Net sold',
      'Returned',
      'Restocked',
      'Remaining',
      'On memo',
      'Unit price',
      'Revenue (USD)',
      'Profit (USD)',
      'Stock (USD)',
      'Status',
    ]];

    const body = rows.map(item => {
      const badge = statusBadge(item);
      const unit = item.unit_price != null ? formatMoneyAmount(item.unit_price, item.selling_currency) : '—';
      const revUsd =
        item.revenue_usd != null && Number.isFinite(item.revenue_usd) ? String(item.revenue_usd) : '—';
      const profitUsd =
        item.profit_usd != null && Number.isFinite(item.profit_usd) ? String(item.profit_usd) : '—';
      const stockUsd = item.stock_value_usd != null ? String(item.stock_value_usd) : '—';
      return [
        item.item_code?.trim() || '—',
        inventoryCategoryDisplay(item.category) ?? item.category ?? '—',
        String(item.opening),
        String(item.sold),
        String(item.returned),
        item.restocked > 0 ? `+${item.restocked}` : '—',
        String(item.remaining),
        String(item.memo_out_qty ?? 0),
        unit,
        revUsd,
        profitUsd,
        stockUsd,
        badge.label,
      ];
    });

    autoTable(doc, {
      startY: 78,
      head,
      body,
      styles: {
        font: 'helvetica',
        fontSize: 9,
        cellPadding: { top: 5, right: 6, bottom: 5, left: 6 },
        lineColor: [226, 232, 240],
        lineWidth: 0.75,
      },
      headStyles: {
        fillColor: [13, 43, 94],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      alternateRowStyles: { fillColor: [247, 251, 255] },
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right' },
        8: { halign: 'right' },
        9: { halign: 'right' },
        10: { halign: 'right' },
        11: { halign: 'right' },
      },
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        const raw = data.row.raw as unknown;
        const status = Array.isArray(raw) ? String(raw[12] ?? '') : '';
        if (data.column.index === 12) {
          if (status === 'Shrinkage') data.cell.styles.textColor = [183, 28, 28];
          else if (status === 'Out of stock') data.cell.styles.textColor = [220, 38, 38];
          else if (status === 'Low stock') data.cell.styles.textColor = [217, 119, 6];
          else if (status === 'Active') data.cell.styles.textColor = [5, 150, 105];
        }
      },
      margin: { left: marginX, right: marginX },
    });

    doc.save(`inventory-report-${ym || `${year}-${String(month).padStart(2, '0')}`}.pdf`);
  };

  const cols: { key: SortKey; label: string; w: string }[] = [
    { key: 'name', label: 'Item code', w: '20%' },
    { key: 'category', label: 'Category', w: '9%' },
    { key: 'opening', label: 'Opening', w: '7%' },
    { key: 'sold', label: 'Net sold', w: '7%' },
    { key: 'returned', label: 'Returned', w: '7%' },
    { key: 'restocked', label: 'Restocked', w: '8%' },
    { key: 'remaining', label: 'Remaining', w: '8%' },
    { key: 'memo_out', label: 'On memo', w: '7%' },
    { key: 'price', label: 'List price', w: '8%' },
    { key: 'revenue', label: 'Revenue (USD)', w: '8%' },
    { key: 'profit', label: 'Profit (USD)', w: '8%' },
    { key: 'stock_value', label: 'Stock (USD)', w: '8%' },
  ];

  const tabs: { key: ActiveTab; label: string; count: number }[] = [
    { key: 'all', label: 'All items', count: tabCounts.all },
    { key: 'top', label: 'Top sellers', count: tabCounts.top },
    { key: 'none', label: 'No invoice activity', count: tabCounts.none },
    { key: 'low', label: 'Low stock', count: tabCounts.low },
  ];

  const SortIcon: React.FC<{ k: SortKey }> = ({ k }) => {
    if (sortKey !== k) return <span className="inv-rpt-sort inv-rpt-sort--idle">↕</span>;
    return (
      <span className="inv-rpt-sort inv-rpt-sort--active">{sortDir === 'asc' ? '↑' : '↓'}</span>
    );
  };

  const sum = summary;

  const kpiCards = useMemo(() => {
    if (!sum) return [];
    const narrowed = isNarrowedView;
    const soldVal = narrowed ? String(filteredKpis.totalSold) : String(sum.totalSold);
    const retAll = sum.totalReturned ?? 0;
    const soldSub = narrowed
      ? `Shown in table · Month (all items): ${sum.totalSold} net · returns ${retAll} pcs`
      : `Net units this month (sales minus returns in the same month) · returns ${retAll} pcs`;

    const revVal = narrowed ? formatUsd(filteredKpis.revenueUsd) : formatUsd(sum.totalRevenueUsd);
    const revSub = narrowed
      ? `Shown in table · Month (all items): ${formatUsd(sum.totalRevenueUsd)} · matches column sum`
      : 'Sum of row revenue (same rounding as column) · this calendar month only, THB→USD per line';

    const stockVal = narrowed ? formatUsd(filteredKpis.stockUsd) : formatUsd(sum.stockValueUsd);
    const stockSub = narrowed
      ? `Shown in table · Month (all items): ${formatUsd(sum.stockValueUsd)}`
      : 'Remaining stock at list (carat × $/ct or lot prorated)';

    const profitVal = narrowed ? formatUsd(filteredKpis.profitUsd) : formatUsd(sum.totalProfitUsd);
    const profitSub = narrowed
      ? `Shown in table · Month (all items): ${formatUsd(sum.totalProfitUsd)}`
      : 'Revenue minus purchase cost (snapshotted at sale) · this calendar month';

    return [
      { label: 'Net sold', value: soldVal, sub: soldSub, variant: 'blue' as const, icon: <IconTrend /> },
      {
        label: 'Revenue',
        value: revVal,
        sub: revSub,
        variant: 'emerald' as const,
        icon: <IconUpRight />,
      },
      {
        label: 'Profit',
        value: profitVal,
        sub: profitSub,
        variant: 'emerald' as const,
        icon: <IconUpRight />,
      },
      {
        label: 'No invoice activity',
        value: String(sum.noMovement),
        sub: 'no gross sales and no returns this month',
        tone: 'warn' as const,
        variant: 'amber' as const,
      },
      {
        label: 'Stock value',
        value: stockVal,
        sub: stockSub,
        variant: 'amber' as const,
      },
      { label: 'Out of stock', value: String(sum.outOfStock), sub: 'items depleted', variant: 'slate' as const },
    ] as {
      label: string;
      value: string;
      sub: string;
      tone?: 'warn' | 'danger';
      variant: 'blue' | 'emerald' | 'red' | 'amber' | 'slate';
      icon?: React.ReactNode;
    }[];
  }, [sum, isNarrowedView, filteredKpis]);

  return (
    <div className="page page-inventory-report inv-rpt-root">
      {sum && (
        <section
          className="rep2-kpi-grid"
          aria-label={isNarrowedView ? 'Month summary (totals match visible table where noted)' : 'Month summary'}
        >
          {kpiCards.map((c, i) => (
            <div
              key={i}
              className={`rep2-metric rep2-m--${c.variant}${c.tone === 'danger' ? ' rep2-metric--alert' : ''}`}
            >
              <div className="rep2-metric-inner">
                <div>
                  <p className="rep2-metric-title">{c.label}</p>
                  <p className={`rep2-metric-value${c.tone === 'danger' ? ' inv-rpt-summary-value--danger' : ''}${c.tone === 'warn' ? ' inv-rpt-summary-value--warn' : ''}`}>
                    {c.value}
                  </p>
                  <p className="rep2-metric-sub">{c.sub}</p>
                </div>
                {c.icon ? <div className="rep2-metric-icon">{c.icon}</div> : null}
              </div>
            </div>
          ))}
        </section>
      )}

      <header className="inv-rpt-topbar">
        <div className="inv-rpt-toolbar-row">
          <input
            className="inv-rpt-input inv-rpt-input--search"
            type="search"
            placeholder="Search by item code, name, or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search report"
          />
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
            <select
              className="inv-rpt-select"
              value={itemCodeFilter}
              onChange={(e) => setItemCodeFilter(e.target.value as 'all' | 'contains_m')}
              aria-label="Item code filter"
            >
              <option value="all">All item codes</option>
              <option value="contains_m">Item code contains "M"</option>
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
            <button
              type="button"
              className="inv-rpt-export"
              onClick={exportPdf}
              disabled={loading || filtered.length === 0}
            >
              Export PDF
            </button>
          </div>
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
                  <td colSpan={13} className="inv-rpt-empty">
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
                      <td className="inv-rpt-td inv-rpt-td--num">
                        <span className={item.memo_out_qty && item.memo_out_qty > 0 ? 'inv-rpt-num-warn' : 'inv-rpt-num-dim'}>
                          {item.memo_out_qty && item.memo_out_qty > 0 ? item.memo_out_qty : '—'}
                        </span>
                      </td>
                      <td className="inv-rpt-td inv-rpt-td--num inv-rpt-price">
                        {item.unit_price != null
                          ? formatMoneyAmount(item.unit_price, item.selling_currency)
                          : '—'}
                      </td>
                      <td className="inv-rpt-td inv-rpt-td--num">
                        <span
                          className={
                            revUsd != null && Number.isFinite(revUsd) && revUsd !== 0
                              ? 'inv-rpt-revenue'
                              : 'inv-rpt-num-muted'
                          }
                        >
                          {revUsd == null || !Number.isFinite(revUsd) ? '—' : formatUsd(revUsd)}
                        </span>
                      </td>
                      <td className="inv-rpt-td inv-rpt-td--num">
                        <span
                          className={
                            item.profit_usd != null && Number.isFinite(item.profit_usd) && item.profit_usd !== 0
                              ? 'inv-rpt-revenue'
                              : 'inv-rpt-num-muted'
                          }
                        >
                          {item.profit_usd == null || !Number.isFinite(item.profit_usd) ? '—' : formatUsd(item.profit_usd)}
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
