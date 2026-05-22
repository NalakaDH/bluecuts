import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { readDoc } from '../firebase';

/* ── Interfaces ──────────────────────────────────────── */

interface Customer {
  id?: number;
  name: string;
  phone?: string | null;
  total_invoiced: number;
  total_paid: number;
  total_owed: number;
  invoices_count: number;
  last_invoice_at?: string;
}

interface TopItem {
  item_code: string;
  category: string;
  item_type?: string;
  qty_sold: number;
  sales_value: number;
  cost_total?: number;
  profit_value: number;
}

interface StatusRow {
  status: string;
  pcs_remaining: number;
  value: number;
}

interface MemoRow {
  status: string;
  memo_count: number;
  remaining_qty: number;
  value: number;
}

interface StockMovement {
  id: number;
  inventory_item_id: number;
  type: string;
  ref_type?: string;
  ref_id?: number;
  qty_change: number;
  note?: string;
  created_at: string;
  user_name?: string;
}

interface Summary {
  range: { from: string; to: string };
  sales: {
    invoices_count: number;
    sales_total: number;
    collected_total: number;
    outstanding_total: number;
    paid_invoices?: number;
    partial_invoices?: number;
    unpaid_invoices?: number;
  };
  profit: {
    selling_total: number;
    cost_total: number;
    profit_total: number;
    profit_margin_pct: number;
  };
  inventory: { remaining_pcs: number; inventory_value: number };
  top_customers: Customer[];
  top_items: TopItem[];
  inventory_by_status: StatusRow[];
  memos_by_status: MemoRow[];
  latest_stock_movements: StockMovement[];
  syncedAt: string;
}

interface SalesTrendRow {
  period: string;
  invoices_count: number;
  sales_total: number;
  collected_total: number;
  outstanding_total: number;
}

interface ProfitTrendRow {
  period: string;
  selling_total: number;
  cost_total: number;
  profit_total: number;
}

interface Trends {
  range: { from: string; to: string };
  group: string;
  sales: SalesTrendRow[];
  profit: ProfitTrendRow[];
}

interface Rates { thb_per_unit: Record<string, number> }

/* ── Helpers ─────────────────────────────────────────── */

function fmt(n: number) { return n.toLocaleString('en-US', { maximumFractionDigits: 0 }); }

/** Compare YYYY-MM-DD (or ISO prefix) to range */
function ymdInRange(ymd: string | undefined, from: string, to: string): boolean {
  if (!ymd) return false;
  const d = ymd.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function shortDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function periodLabel(period: string) {
  if (!period) return '';
  const parts = period.split('-');
  if (parts.length >= 2) {
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2] || '0', 10);
    return d ? `${m}/${d}` : `${m}`;
  }
  return period;
}

function relTime(ts: string) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return shortDate(ts);
}

function movementTypeLabel(type: string, note?: string) {
  const t = (type || '').toLowerCase();
  const n = (note || '').toLowerCase();
  if (t.includes('sale') || t === 'sold' || n.startsWith('sold')) return 'SALE';
  if (t.includes('restock') || t === 'purchase' || t === 'add' || n.includes('restock')) return 'RESTOCK';
  if (t.includes('shrink') || t.includes('loss') || t === 'adjustment' || n.includes('shrink') || n.includes('adjust')) return 'SHRINKAGE';
  if (t.includes('memo') || n.includes('memo')) return 'MEMO OUT';
  return 'EDIT';
}

function movementDotColor(type: string, note?: string) {
  const l = movementTypeLabel(type, note);
  if (l === 'SALE') return 'var(--c-blue)';
  if (l === 'RESTOCK') return 'var(--c-green)';
  if (l === 'SHRINKAGE') return 'var(--c-red)';
  if (l === 'MEMO OUT') return 'var(--c-orange)';
  return 'var(--c-slate)';
}

function parseMovementNote(note: string | undefined, mv: StockMovement): string {
  if (!note) return `Item #${mv.inventory_item_id}`;
  const invMatch = note.match(/via\s+(INV-\d+)/i);
  if (invMatch) {
    const qty = Math.abs(mv.qty_change);
    return `Invoice ${invMatch[1]} — ${qty} pc${qty !== 1 ? 's' : ''}`;
  }
  const memoMatch = note.match(/(?:from|to)\s+(MEM-\d+)/i);
  if (memoMatch) return note.replace(/^[^a-z]*(?:returned|moved|sent)\s*/i, '').trim() || `Memo ${memoMatch[1]}`;
  return note;
}

function statusDotColor(status: string) {
  const s = (status || '').toLowerCase();
  if (s === 'available') return 'var(--c-green)';
  if (s === 'on memo' || s === 'memo') return 'var(--c-orange)';
  if (s === 'out of stock' || s === 'out') return 'var(--c-red)';
  if (s === 'sold') return 'var(--text-xs)';
  return 'var(--c-slate)';
}

function memoDotColor(status: string) {
  const s = (status || '').toLowerCase();
  if (s.includes('open') || s.includes('active')) return 'var(--c-blue)';
  if (s.includes('due') || s.includes('partial')) return 'var(--c-orange)';
  if (s.includes('overdue') || s.includes('expired')) return 'var(--c-red)';
  if (s.includes('closed') || s.includes('returned')) return 'var(--c-green)';
  return 'var(--c-slate)';
}

/* ── SVG Icons ───────────────────────────────────────── */

const IconTrendUp = () => (
  <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
);
const IconArrowUp = () => (
  <svg viewBox="0 0 24 24"><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></svg>
);
const IconArrowDown = () => (
  <svg viewBox="0 0 24 24"><line x1="7" y1="7" x2="17" y2="17" /><polyline points="17 7 17 17 7 17" /></svg>
);
const IconCoins = () => (
  <svg viewBox="0 0 24 24">
    <ellipse cx="9" cy="8" rx="6" ry="3.5" /><path d="M3 8v4c0 2 2.7 3.5 6 3.5s6-1.5 6-3.5V8" />
    <ellipse cx="15" cy="14" rx="6" ry="3.5" /><path d="M9 14v4c0 2 2.7 3.5 6 3.5s6-1.5 6-3.5v-4" />
  </svg>
);
const IconDoc = () => (
  <svg viewBox="0 0 24 24">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" /><line x1="12" y1="13" x2="12" y2="17" /><line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

/* ── Charts ──────────────────────────────────────────── */

function drawSalesChart(
  svg: SVGSVGElement,
  data: SalesTrendRow[],
  usdRate: number,
  isDark: boolean,
) {
  if (!data.length) { svg.innerHTML = ''; return; }
  const W = 340, H = 150, pL = 8, pR = 8, pT = 16, pB = 26;
  const plotW = W - pL - pR, plotH = H - pT - pB;
  const n = data.length;
  const step = n > 1 ? plotW / (n - 1) : plotW;
  const u = (v: number) => usdRate > 0 ? v / usdRate : v;
  const allV = data.flatMap(d => [u(d.sales_total), u(d.collected_total), u(d.outstanding_total)]);
  const maxV = Math.max(...allV, 1);
  const xAt = (i: number) => pL + i * step;
  const yAt = (v: number) => pT + (1 - v / maxV) * plotH;
  const baseY = pT + plotH;
  const gridC = isDark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)';
  const tickC = isDark ? '#5A5046' : '#B0A397';
  const labelC = isDark ? '#7A6D5F' : '#8A7B6E';

  const lines: { key: 'sales_total' | 'collected_total' | 'outstanding_total'; color: string }[] = [
    { key: 'sales_total', color: '#3B7DD8' },
    { key: 'collected_total', color: '#2E9E6B' },
    { key: 'outstanding_total', color: '#DC2626' },
  ];

  const areas = lines.map(l => {
    const pts = data.map((d, i) => `${xAt(i)},${yAt(u(d[l.key]))}`).join(' ');
    const area = `M${xAt(0)},${baseY} ` + data.map((d, i) => `L${xAt(i)},${yAt(u(d[l.key]))}`).join(' ') + ` L${xAt(n - 1)},${baseY} Z`;
    const id = `ag_${l.key}`;
    return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${l.color}" stop-opacity=".18"/>
      <stop offset="100%" stop-color="${l.color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/>
    <polyline points="${pts}" fill="none" stroke="${l.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${data.map((d, i) => `<circle cx="${xAt(i)}" cy="${yAt(u(d[l.key]))}" r="3.5" fill="${isDark ? '#1C1813' : '#fff'}" stroke="${l.color}" stroke-width="1.8"/>`).join('')}`;
  });

  const gridLines = [.25, .5, .75, 1].map(f => {
    const y = yAt(f * maxV);
    return `<line x1="${pL}" x2="${W - pR}" y1="${y}" y2="${y}" stroke="${gridC}" stroke-width="1" stroke-dasharray="3 3"/>
            <text x="${pL}" y="${y - 3}" font-size="8" fill="${tickC}" font-family="DM Sans,sans-serif">$${(f * maxV / 1000).toFixed(1)}k</text>`;
  }).join('');

  const xLabels = data.map((d, i) =>
    `<text x="${xAt(i)}" y="${H - 6}" font-size="9" text-anchor="middle" fill="${labelC}" font-family="DM Sans,sans-serif" font-weight="500">${periodLabel(d.period)}</text>`
  ).join('');

  svg.innerHTML = gridLines + areas.join('') + xLabels;
}

function drawProfitChart(
  svg: SVGSVGElement,
  data: ProfitTrendRow[],
  usdRate: number,
  isDark: boolean,
) {
  if (!data.length) { svg.innerHTML = ''; return; }
  const W = 340, H = 150, pL = 8, pR = 8, pT = 16, pB = 26;
  const plotW = W - pL - pR, plotH = H - pT - pB;
  const n = data.length;
  const u = (v: number) => usdRate > 0 ? v / usdRate : v;
  const maxV = Math.max(...data.flatMap(d => [u(d.selling_total), u(d.cost_total), u(d.profit_total)]), 1);
  const baseY = pT + plotH;
  const groupW = plotW / n;
  const barW = Math.max(6, (groupW - 8) / 3);
  const gap = Math.max(2, (groupW - barW * 3 - 8) / 2);
  const gridC = isDark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)';
  const tickC = isDark ? '#5A5046' : '#B0A397';
  const labelC = isDark ? '#7A6D5F' : '#8A7B6E';
  const fills = ['#3B7DD8', '#D97706', '#2E9E6B'];

  const gridLines = [.25, .5, .75, 1].map(f => {
    const y = pT + (1 - f) * plotH;
    return `<line x1="${pL}" x2="${W - pR}" y1="${y}" y2="${y}" stroke="${gridC}" stroke-width="1" stroke-dasharray="3 3"/>
            <text x="${pL}" y="${y - 3}" font-size="8" fill="${tickC}" font-family="DM Sans,sans-serif">$${(f * maxV / 1000).toFixed(1)}k</text>`;
  }).join('');

  const bars = data.map((d, i) => {
    const gx = pL + i * groupW;
    const cx = gx + groupW / 2;
    const vals = [u(d.selling_total), u(d.cost_total), u(d.profit_total)];
    const bs = vals.map((v, j) => {
      const bh = (v / maxV) * plotH;
      const bx = cx - barW * 1.5 - gap + (barW + gap) * j;
      return `<rect x="${bx}" y="${baseY - bh}" width="${barW}" height="${bh}" rx="3" fill="${fills[j]}"/>`;
    }).join('');
    return bs + `<text x="${cx}" y="${H - 6}" font-size="9" text-anchor="middle" fill="${labelC}" font-family="DM Sans,sans-serif" font-weight="500">${periodLabel(d.period)}</text>`;
  }).join('');

  svg.innerHTML = gridLines + bars;
}

/* ── Customer Detail Sheet ───────────────────────────── */

function CustomerSheet({
  customer,
  usdRate,
  onClose,
}: {
  customer: Customer;
  usdRate: number;
  onClose: () => void;
}) {
  const u = (v: number) => usdRate > 0 ? v / usdRate : v;
  const c = customer;
  const owedCls = c.total_owed > 0 ? 'red' : 'green';

  return (
    <div className="sheet-scroll">
      <div className="sheet-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
        <div className="sheet-title-block" style={{ flex: 1, minWidth: 0 }}>
          <div className="sheet-title">{c.name}</div>
          <div className="sheet-sub-line">
            {c.phone || 'No phone'} &middot; {c.invoices_count} invoices
          </div>
        </div>
        <button className="sheet-close" onClick={onClose}>&times;</button>
      </div>

      <div className="sheet-summary-row">
        <div className="sheet-sum-cell">
          <div className="sheet-sum-val">${fmt(u(c.total_invoiced))}</div>
          <div className="sheet-sum-label">Invoiced</div>
        </div>
        <div className="sheet-sum-cell">
          <div className="sheet-sum-val green">${fmt(u(c.total_paid))}</div>
          <div className="sheet-sum-label">Collected</div>
        </div>
        <div className="sheet-sum-cell">
          <div className={`sheet-sum-val ${owedCls}`}>
            ${fmt(u(c.total_owed))}
          </div>
          <div className="sheet-sum-label">Owed</div>
        </div>
      </div>

      {c.last_invoice_at && (
        <div style={{ fontSize: 12, color: 'var(--text-xs)', marginBottom: 10 }}>
          Last invoice: {shortDate(c.last_invoice_at)}
        </div>
      )}

      <div className="empty-state" style={{ paddingTop: 12, paddingBottom: 20 }}>
        Invoice history is available in the desktop app
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────── */

type TabId = 'customers' | 'items' | 'inventory' | 'memos' | 'activity';

export function ReportsPage() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [usdRate, setUsdRate] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  const [chartMode, setChartMode] = useState<'sales' | 'profit'>('sales');
  const [tab, setTab] = useState<TabId>('customers');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupMode, setGroupMode] = useState<'daily' | 'monthly'>('daily');

  const salesSvgRef = useRef<SVGSVGElement>(null);
  const profitSvgRef = useRef<SVGSVGElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);

  useEffect(() => {
    Promise.all([
      readDoc<Summary>('reportsSummary'),
      readDoc<Trends>('reportsTrends'),
      readDoc<Rates>('exchangeRates'),
    ])
      .then(([s, t, r]) => {
        setSum(s);
        setTrends(t);
        setUsdRate(r.thb_per_unit?.USD || 1);
        if (s.range) {
          setDateFrom(s.range.from);
          setDateTo(s.range.to);
        }
        if (t.group) setGroupMode(t.group as 'daily' | 'monthly');
      })
      .catch(e => setErr(e.message));
  }, []);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  const filteredSales = useMemo(() => {
    if (!trends) return [];
    return trends.sales.filter(d => {
      if (dateFrom && d.period < dateFrom) return false;
      if (dateTo && d.period > dateTo) return false;
      return true;
    });
  }, [trends, dateFrom, dateTo]);

  const filteredProfit = useMemo(() => {
    if (!trends) return [];
    return trends.profit.filter(d => {
      if (dateFrom && d.period < dateFrom) return false;
      if (dateTo && d.period > dateTo) return false;
      return true;
    });
  }, [trends, dateFrom, dateTo]);

  /** KPIs derived from daily trend rows = respects From/To (same window as charts) */
  const trendRangeKpis = useMemo(() => {
    const fs = [...filteredSales].sort((a, b) => a.period.localeCompare(b.period));
    const fp = [...filteredProfit].sort((a, b) => a.period.localeCompare(b.period));
    const sales_total = fs.reduce((a, d) => a + d.sales_total, 0);
    const collected_total = fs.reduce((a, d) => a + d.collected_total, 0);
    const invoices_count = fs.reduce((a, d) => a + d.invoices_count, 0);
    const outstanding_total = fs.length ? fs[fs.length - 1].outstanding_total : 0;
    const selling_total = fp.reduce((a, d) => a + d.selling_total, 0);
    const cost_total = fp.reduce((a, d) => a + d.cost_total, 0);
    const profit_total = fp.reduce((a, d) => a + d.profit_total, 0);
    const profit_margin_pct = selling_total > 0
      ? Math.round((profit_total / selling_total) * 10000) / 100
      : 0;
    return {
      sales_total,
      collected_total,
      outstanding_total,
      invoices_count,
      selling_total,
      cost_total,
      profit_total,
      profit_margin_pct,
    };
  }, [filteredSales, filteredProfit]);

  const kSales = trendRangeKpis.sales_total;
  const kCollected = trendRangeKpis.collected_total;
  const kOutstanding = trendRangeKpis.outstanding_total;
  const kInvoices = trendRangeKpis.invoices_count;
  const kCost = trendRangeKpis.cost_total;
  const kProfit = trendRangeKpis.profit_total;
  const kMargin = trendRangeKpis.profit_margin_pct;

  const isFullSyncedRange = useMemo(() => {
    if (!sum?.range) return true;
    return sum.range.from === dateFrom && sum.range.to === dateTo;
  }, [sum, dateFrom, dateTo]);

  const filteredCustomers = useMemo(() => {
    if (!sum?.top_customers) return [];
    if (isFullSyncedRange) return sum.top_customers;
    return sum.top_customers.filter(c => ymdInRange(c.last_invoice_at, dateFrom, dateTo));
  }, [sum, isFullSyncedRange, dateFrom, dateTo]);

  const filteredActivity = useMemo(() => {
    if (!sum?.latest_stock_movements) return [];
    const moves = sum.latest_stock_movements;
    if (isFullSyncedRange) return moves;
    return moves.filter(m => ymdInRange(m.created_at, dateFrom, dateTo));
  }, [sum, isFullSyncedRange, dateFrom, dateTo]);

  useEffect(() => {
    if (!salesSvgRef.current) return;
    drawSalesChart(salesSvgRef.current, filteredSales, usdRate, isDark);
  }, [filteredSales, usdRate, isDark, chartMode]);

  useEffect(() => {
    if (!profitSvgRef.current) return;
    drawProfitChart(profitSvgRef.current, filteredProfit, usdRate, isDark);
  }, [filteredProfit, usdRate, isDark, chartMode]);

  const toUsd = useCallback((thb: number) => usdRate > 0 ? thb / usdRate : thb, [usdRate]);

  const dayCount = useMemo(() => {
    if (!dateFrom || !dateTo) return 30;
    const f = new Date(dateFrom);
    const t = new Date(dateTo);
    return Math.max(1, Math.round((t.getTime() - f.getTime()) / (86400000)) + 1);
  }, [dateFrom, dateTo]);

  const openSheet = useCallback((c: Customer) => setSelectedCustomer(c), []);
  const closeSheet = useCallback(() => setSelectedCustomer(null), []);

  if (err) return <div className="page-msg page-msg--err">{err}</div>;
  if (!sum) return <div className="page-msg"><div className="spinner" /></div>;

  const s = sum.sales;

  const memoOpenValue = sum.memos_by_status
    .filter(m => {
      const sl = (m.status || '').toLowerCase();
      return sl.includes('open') || sl.includes('active') || sl.includes('due');
    })
    .reduce((a, m) => a + m.value, 0);
  const memoOpenCount = sum.memos_by_status
    .filter(m => {
      const sl = (m.status || '').toLowerCase();
      return sl.includes('open') || sl.includes('active') || sl.includes('due');
    })
    .reduce((a, m) => a + m.memo_count, 0);

  return (
    <div className="page">
      {/* Page header */}
      <div className="page-header">
        <div className="page-title">Reports</div>
        <div className="range-pill">{dayCount} days</div>
      </div>

      {/* Date range strip */}
      <div className="range-strip">
        <div className="range-field">
          <label>From</label>
          <input
            type="date"
            value={dateFrom}
            min={sum.range.from}
            max={dateTo || sum.range.to}
            onChange={e => setDateFrom(e.target.value)}
          />
        </div>
        <div className="range-field">
          <label>To</label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || sum.range.from}
            max={sum.range.to}
            onChange={e => setDateTo(e.target.value)}
          />
        </div>
        <button
          className={`range-group-btn${groupMode === 'monthly' ? ' active' : ''}`}
          onClick={() => setGroupMode(g => g === 'daily' ? 'monthly' : 'daily')}
        >
          {groupMode === 'monthly' ? 'Monthly' : 'Daily'}
        </button>
      </div>

      {!isFullSyncedRange && (
        <p className="range-hint">
          KPIs and charts match your dates. Top Items, inventory, memos, and open memo totals are from the full sync snapshot.
        </p>
      )}

      {/* KPI Grid */}
      <div className="kpi-grid">
        <div className="kpi-card kpi-blue">
          <div className="kpi-icon"><IconTrendUp /></div>
          <div className="kpi-label">Total Sales</div>
          <div className="kpi-value">${fmt(toUsd(kSales))}</div>
          <div className="kpi-sub">
            {fmt(kInvoices)} invoices · {isFullSyncedRange ? 'sync window' : 'selected dates'}
          </div>
        </div>

        <div className="kpi-card kpi-green">
          <div className="kpi-icon"><IconArrowUp /></div>
          <div className="kpi-label">Collected</div>
          <div className="kpi-value">${fmt(toUsd(kCollected))}</div>
          <div className="kpi-sub">
            {isFullSyncedRange
              ? `${s.paid_invoices ?? '—'} paid invoices`
              : 'Collected in selected dates'}
          </div>
        </div>

        <div className="kpi-card kpi-red">
          <div className="kpi-icon"><IconArrowDown /></div>
          <div className="kpi-label">Outstanding</div>
          <div className="kpi-value">${fmt(toUsd(kOutstanding))}</div>
          <div className="kpi-sub">
            {isFullSyncedRange
              ? `${(s.unpaid_invoices ?? 0) + (s.partial_invoices ?? 0)} unpaid invoices`
              : 'Balance at end of selected range'}
          </div>
        </div>

        <div className="kpi-card kpi-slate">
          <div className="kpi-icon"><IconCoins /></div>
          <div className="kpi-label">Purchase Cost</div>
          <div className="kpi-value">${fmt(toUsd(kCost))}</div>
          <div className="kpi-sub">Cost of sold items</div>
        </div>

        <div className="kpi-card kpi-green">
          <div className="kpi-icon"><IconTrendUp /></div>
          <div className="kpi-label">Gross Profit</div>
          <div className="kpi-value">${fmt(toUsd(kProfit))}</div>
          <div className="kpi-sub">{kMargin.toFixed(1)}% margin</div>
        </div>

        <div className="kpi-card kpi-slate">
          <div className="kpi-icon"><IconDoc /></div>
          <div className="kpi-label">Open Memos</div>
          <div className="kpi-value">${fmt(toUsd(memoOpenValue))}</div>
          <div className="kpi-sub">
            {memoOpenCount} open memos
            {!isFullSyncedRange ? ' · shop snapshot' : ''}
          </div>
        </div>
      </div>

      {/* Chart Section */}
      <div className="sec-card">
        <div className="sec-head">
          <div>
            <div className="sec-title">Trend</div>
            <div className="sec-sub">
              {chartMode === 'sales' ? 'Daily sales · USD' : 'Selling vs cost vs profit · USD'}
            </div>
          </div>
        </div>
        <div className="sec-body">
          <div className="chart-toggle">
            <button
              className={`chart-toggle-btn${chartMode === 'sales' ? ' active' : ''}`}
              onClick={() => setChartMode('sales')}
            >Sales</button>
            <button
              className={`chart-toggle-btn${chartMode === 'profit' ? ' active' : ''}`}
              onClick={() => setChartMode('profit')}
            >Profit</button>
          </div>

          {/* Sales chart */}
          <div className="chart-wrap" style={{ display: chartMode === 'sales' ? '' : 'none' }}>
            <svg ref={salesSvgRef} viewBox="0 0 340 150" preserveAspectRatio="xMidYMid meet" />
            <div className="chart-legend">
              <span className="legend-item"><span className="legend-dot" style={{ background: '#3B7DD8' }} />Sales</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: '#2E9E6B' }} />Collected</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: '#DC2626' }} />Outstanding</span>
            </div>
          </div>

          {/* Profit chart */}
          <div className="chart-wrap" style={{ display: chartMode === 'profit' ? '' : 'none' }}>
            <svg ref={profitSvgRef} viewBox="0 0 340 150" preserveAspectRatio="xMidYMid meet" />
            <div className="chart-legend">
              <span className="legend-item"><span className="legend-sq" style={{ background: '#3B7DD8' }} />Selling</span>
              <span className="legend-item"><span className="legend-sq" style={{ background: '#D97706' }} />Cost</span>
              <span className="legend-item"><span className="legend-sq" style={{ background: '#2E9E6B' }} />Profit</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs + Content */}
      <div className="sec-card">
        <div className="tab-strip" role="tablist">
          {(['customers', 'items', 'inventory', 'memos', 'activity'] as TabId[]).map(t => (
            <button
              key={t}
              className={`r-tab-btn${tab === t ? ' active' : ''}`}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
            >
              {t === 'customers' ? 'Customers' : t === 'items' ? 'Top Items' : t === 'inventory' ? 'Inventory' : t === 'memos' ? 'Memos' : 'Activity'}
            </button>
          ))}
        </div>

        {/* Tab: Customers */}
        {tab === 'customers' && (
          <div>
            {filteredCustomers.length === 0 && (
              <div className="empty-state">
                {sum.top_customers.length === 0 ? 'No customer data' : 'No customers with invoices in this date range'}
              </div>
            )}
            {filteredCustomers.map((c, i) => {
              const owed = toUsd(c.total_owed);
              return (
                <div key={i} className="rpt-data-row" onClick={() => openSheet(c)}>
                  <div className={`row-rank${i === 0 ? ' gold' : ''}`}>{i + 1}</div>
                  <div className="row-info">
                    <div className="row-name">{c.name}</div>
                    <div className="row-meta">
                      {c.invoices_count} invoices{c.last_invoice_at ? ` · Last: ${shortDate(c.last_invoice_at)}` : ''}
                    </div>
                  </div>
                  <div className="row-right">
                    <div className="row-val">${fmt(toUsd(c.total_invoiced))}</div>
                    <div className={`row-sub ${owed > 0 ? 'row-sub--red' : 'row-sub--green'}`}>
                      {owed > 0 ? `$${fmt(owed)} owed` : 'Fully paid'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tab: Top Items */}
        {tab === 'items' && (
          <div>
            {sum.top_items.length === 0 && <div className="empty-state">No item data</div>}
            {sum.top_items.map((it, i) => (
              <div key={i} className="rpt-data-row" style={{ cursor: 'default' }}>
                <div className={`row-rank${i === 0 ? ' gold' : ''}`}>{i + 1}</div>
                <div className="row-info">
                  <div className="row-name">{it.item_code}</div>
                  <div className="row-meta">
                    {it.category}{it.item_type ? ` · ${it.item_type}` : ''} &middot; {it.qty_sold} sold
                  </div>
                </div>
                <div className="row-right">
                  <div className="row-val">${fmt(toUsd(it.sales_value))}</div>
                  <div className="row-sub row-sub--green">${fmt(toUsd(it.profit_value))} profit</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab: Inventory Status */}
        {tab === 'inventory' && (
          <div>
            {sum.inventory_by_status.length === 0 && <div className="empty-state">No inventory data</div>}
            {sum.inventory_by_status.map((r, i) => (
              <div key={i} className="status-row">
                <div className="status-dot" style={{ background: statusDotColor(r.status) }} />
                <div className="status-label">{r.status}</div>
                <div className="status-pcs">{r.pcs_remaining} pcs</div>
                <div className="status-val">{r.pcs_remaining > 0 ? `$${fmt(r.value)}` : '—'}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tab: Memos */}
        {tab === 'memos' && (
          <div>
            {sum.memos_by_status.length === 0 && <div className="empty-state">No memo data</div>}
            {sum.memos_by_status.map((m, i) => (
              <div key={i} className="status-row">
                <div className="status-dot" style={{ background: memoDotColor(m.status) }} />
                <div className="status-label">{m.status}</div>
                <div className="status-pcs">{m.memo_count} memos &middot; {m.remaining_qty} pcs</div>
                <div className="status-val">${fmt(toUsd(m.value))}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tab: Activity */}
        {tab === 'activity' && (
          <div className="rpt-feed">
            {filteredActivity.length === 0 && (
              <div className="empty-state">
                {!sum.latest_stock_movements?.length
                  ? 'No recent activity'
                  : 'No activity in selected date range'}
              </div>
            )}
            {filteredActivity.map((mv, i, arr) => {
              const label = movementTypeLabel(mv.type, mv.note);
              const dot = movementDotColor(mv.type, mv.note);
              const isLast = i === arr.length - 1;
              const qty = mv.qty_change;
              const desc = parseMovementNote(mv.note, mv);
              return (
                <div key={mv.id ?? i} className="feed-item">
                  <div className="feed-track">
                    <div className="feed-dot" style={{ background: dot }} />
                    {!isLast && <div className="feed-vline" />}
                  </div>
                  <div className="feed-content">
                    <div className="feed-msg">
                      <strong>{label}</strong>{' '}
                      {desc}
                      {mv.user_name ? ` · ${mv.user_name}` : ''}
                    </div>
                    <div className="feed-time">{relTime(mv.created_at)}</div>
                  </div>
                  {qty !== 0 && (
                    <div className={`feed-qty ${qty > 0 ? 'pos' : 'neg'}`}>
                      {qty > 0 ? `+${qty}` : `−${Math.abs(qty)}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Customer Detail Sheet — rendered via portal */}
      {createPortal(
        <>
          <div
            ref={backdropRef}
            className={`sheet-backdrop${selectedCustomer ? ' open' : ''}`}
            onClick={closeSheet}
          />
          <div
            ref={sheetRef}
            className={`detail-sheet${selectedCustomer ? ' open' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label="Customer detail"
            onTouchStart={e => { touchStartY.current = e.touches[0].clientY; }}
            onTouchEnd={e => { if (e.changedTouches[0].clientY - touchStartY.current > 80) closeSheet(); }}
          >
            <div className="sheet-handle" />
            {selectedCustomer && (
              <CustomerSheet
                customer={selectedCustomer}
                usdRate={usdRate}
                onClose={closeSheet}
              />
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
