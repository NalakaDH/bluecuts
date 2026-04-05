import React, { useEffect, useMemo, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { DEFAULT_CURRENCY_CODE } from '../../lib/currencies';
import {
  formatUsdOnlyFromAny,
  formatUsdOnlyFromThb,
  thbEquivalentToUsdCsv,
  thbEquivalentToUsdNumber,
} from '../../lib/moneyUsdDisplay';
import type { ThbPerUnitMap } from '../../lib/exchangeConversion';

type GroupMode = 'daily' | 'monthly';

type ReportsTab = 'customers' | 'items' | 'inventory' | 'memos' | 'activity';

interface SalesSummary {
  invoices_count: number;
  sales_total: number;
  collected_total: number;
  outstanding_total: number;
  paid_invoices: number;
  partial_invoices: number;
  unpaid_invoices: number;
}

interface ProfitSummary {
  selling_total: number;
  cost_total: number;
  profit_total: number;
  profit_margin_pct: number;
}

interface InventoryByStatusRow {
  status: string;
  pcs_remaining: number;
  value: number;
}

interface MemoByStatusRow {
  status: string;
  memo_count: number;
  remaining_qty: number;
  value: number;
}

interface TrendRow {
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

interface TopCustomerRow {
  id: number;
  name: string;
  phone: string | null;
  invoices_count: number;
  total_invoiced: number;
  total_paid: number;
  total_owed: number;
  last_invoice_at: string | null;
}

interface TopItemRow {
  inventory_item_id: number;
  item_code: string | null;
  category: string;
  item_type: string;
  qty_sold: number;
  sales_value: number;
  cost_total: number;
  profit_value: number;
}

interface LatestStockMovementRow {
  id: number;
  inventory_item_id: number;
  item_code: string | null;
  type: string;
  qty_change: number;
  note: string | null;
  created_at: string;
  user_name: string | null;
}

interface ReportsSummaryResponse {
  range: { from: string; to: string };
  sales: SalesSummary;
  profit: ProfitSummary;
  inventory: { remaining_pcs: number; inventory_value: number };
  inventory_by_status: InventoryByStatusRow[];
  memos_by_status: MemoByStatusRow[];
  top_customers: TopCustomerRow[];
  top_items: TopItemRow[];
  latest_stock_movements: LatestStockMovementRow[];
}

interface ReportsPageProps {
  token: string;
}

const money = (n: number) => Number(n || 0).toFixed(2);

interface InvoiceListRow {
  id: number;
  invoice_no: string;
  customer_name: string | null;
  total: number;
  paid: number;
  status: string;
  created_at: string;
  currency_code?: string | null;
}

interface StockMovementRow {
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

function toCsv(rows: any[], headers: { key: string; label: string }[]) {
  const escape = (v: any) => {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const headerLine = headers.map(h => escape(h.label)).join(',');
  const lines = rows.map(r => headers.map(h => escape(r[h.key])).join(','));
  return [headerLine, ...lines].join('\n');
}

/* —— Icons (lucide-style) —— */
function IconTrendingUp() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function IconArrowUpRight() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

function IconArrowDownRight() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <line x1="7" y1="7" x2="17" y2="17" />
      <polyline points="17 7 17 17 7 17" />
    </svg>
  );
}

function IconRotateCcw() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function IconDownloadCloud() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M21 16v-2l-3-3V5.5a2.5 2.5 0 0 0-5 0V7" />
      <path d="M7 16v-2l3-3" />
      <path d="M3.55 18A2.93 2.93 0 0 1 1 15.07V14a6 6 0 0 1 6.72-5.96" />
      <path d="M11 20h10v-2H11z" />
      <path d="M8 12l4 4 4-4" />
    </svg>
  );
}

/** Plain numbers with grouping — matches reference charts (0 … 16,000) */
function formatChartYAxis(n: number): string {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** X-axis: prefer YYYY-MM-DD (no time) so labels aren’t clipped or mangled */
function formatChartPeriod(period: string): string {
  const trimmed = (period || '').trim();
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const mo = trimmed.match(/^(\d{4}-\d{2})$/);
  if (mo) return mo[1];
  return trimmed.length > 14 ? `${trimmed.slice(0, 14)}…` : trimmed;
}

function ReportsSalesLineChart({ rows, thbPerUnit }: { rows: TrendRow[]; thbPerUnit: ThbPerUnitMap }) {
  const w = 840;
  const h = 360;
  const pad = { t: 32, r: 52, b: 72, l: 76 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const n = rows.length;

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tipX, setTipX] = useState<number>(0); // px inside the SVG box

  const axisFs = 16;
  const xAxisFs = 15;
  const lineStroke = 4;
  const pointR = 8;
  const pointStroke = 3;

  const colors = { sales: '#3b82f6', collected: '#10b981', outstanding: '#ef4444' };

  if (n === 0) {
    return <div className="rep2-chart-empty">No trend data for this range.</div>;
  }

  const maxVal = Math.max(
    1e-6,
    ...rows.flatMap(r => [
      thbEquivalentToUsdNumber(r.sales_total, thbPerUnit),
      thbEquivalentToUsdNumber(r.collected_total, thbPerUnit),
      thbEquivalentToUsdNumber(r.outstanding_total, thbPerUnit),
    ])
  );

  const xAt = (i: number) => (n === 1 ? pad.l + plotW / 2 : pad.l + (i / (n - 1)) * plotW);
  const yAt = (v: number) => pad.t + (1 - v / maxVal) * plotH;

  const baseY = pad.t + plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = pad.t + (1 - f) * plotH;
    return (
      <line
        key={f}
        x1={pad.l}
        x2={w - pad.r}
        y1={y}
        y2={y}
        stroke="#e2e8f0"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
    );
  });

  const iFromViewX = (viewX: number) => {
    if (n === 1) return 0;
    const raw = ((viewX - pad.l) / plotW) * (n - 1);
    return Math.min(n - 1, Math.max(0, Math.round(raw)));
  };

  const hovered = hoverIdx != null ? rows[hoverIdx] : null;

  const line = (
    key: 'sales_total' | 'collected_total' | 'outstanding_total',
    stroke: string
  ) => {
    const pts = rows
      .map((r, i) => {
        const vUsd = thbEquivalentToUsdNumber(Number(r[key]) || 0, thbPerUnit);
        return `${xAt(i)},${yAt(vUsd)}`;
      })
      .join(' ');
    return (
      <g key={key}>
        <polyline
          points={pts}
          fill="none"
          stroke={stroke}
          strokeWidth={lineStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {rows.map((r, i) => {
          const isHover = hoverIdx === i;
          const vUsd = thbEquivalentToUsdNumber(Number(r[key]) || 0, thbPerUnit);
          return (
            <circle
              key={`${key}-${r.period}`}
              cx={xAt(i)}
              cy={yAt(vUsd)}
              r={isHover ? pointR + 2 : pointR}
              fill="#ffffff"
              stroke={stroke}
              strokeWidth={isHover ? pointStroke + 1 : pointStroke}
            />
          );
        })}
      </g>
    );
  };

  return (
    <div className="rep2-chart-svg-wrap" style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Sales trend chart"
        onMouseMove={(e) => {
          const svg = e.currentTarget;
          const rect = svg.getBoundingClientRect();
          const xPx = e.clientX - rect.left;
          const viewX = (xPx / Math.max(1, rect.width)) * w;
          const i = iFromViewX(viewX);
          setHoverIdx(i);
          setTipX(xPx);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {gridLines}

        {/* Solid axes (left + bottom) */}
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={baseY} stroke="#94a3b8" strokeWidth={2} />
        <line x1={pad.l} x2={w - pad.r} y1={baseY} y2={baseY} stroke="#94a3b8" strokeWidth={2} />

        {hoverIdx != null && (
          <line
            x1={xAt(hoverIdx)}
            x2={xAt(hoverIdx)}
            y1={pad.t}
            y2={baseY}
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        )}

        {line('sales_total', colors.sales)}
        {line('collected_total', colors.collected)}
        {line('outstanding_total', colors.outstanding)}

        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const val = f * maxVal;
          const y = pad.t + (1 - f) * plotH;
          return (
            <text
              key={`y-${f}`}
              x={pad.l - 14}
              y={y + 6}
              fontSize={axisFs}
              textAnchor="end"
              fill="#475569"
              fontWeight={500}
            >
              {formatChartYAxis(val)}
            </text>
          );
        })}

        {rows.map((r, i) => (
          <text
            key={`x-${r.period}`}
            x={xAt(i)}
            y={h - 24}
            fontSize={xAxisFs}
            textAnchor="middle"
            fill="#475569"
            fontWeight={500}
          >
            {formatChartPeriod(r.period)}
          </text>
        ))}
      </svg>

      {hovered && (
        <div className="rep2-chart-tooltip" style={{ left: tipX, top: 14 }}>
          <div className="rep2-chart-tooltip-title">{formatChartPeriod(hovered.period)}</div>
          {(
            [
              { key: 'sales', color: colors.sales, label: 'sales', v: Number(hovered.sales_total) || 0 },
              { key: 'collected', color: colors.collected, label: 'collected', v: Number(hovered.collected_total) || 0 },
              { key: 'outstanding', color: colors.outstanding, label: 'outstanding', v: Number(hovered.outstanding_total) || 0 },
            ] as const
          ).map(({ key, color, label, v }) => (
            <div key={key} className="rep2-chart-tooltip-row" style={{ color }}>
              {label}: {formatUsdOnlyFromThb(v, thbPerUnit)}
            </div>
          ))}
        </div>
      )}

      <div className="rep2-chart-legend rep2-chart-legend--large">
        <span className="rep2-legend-item" style={{ color: colors.sales }}>
          <span className="rep2-legend-dot rep2-legend-dot--solid" style={{ backgroundColor: colors.sales }} />
          sales
        </span>
        <span className="rep2-legend-item" style={{ color: colors.collected }}>
          <span className="rep2-legend-dot rep2-legend-dot--solid" style={{ backgroundColor: colors.collected }} />
          collected
        </span>
        <span className="rep2-legend-item" style={{ color: colors.outstanding }}>
          <span className="rep2-legend-dot rep2-legend-dot--solid" style={{ backgroundColor: colors.outstanding }} />
          outstanding
        </span>
      </div>
    </div>
  );
}

function ReportsProfitBarChart({ rows, thbPerUnit }: { rows: ProfitTrendRow[]; thbPerUnit: ThbPerUnitMap }) {
  const w = 840;
  const h = 360;
  const pad = { t: 32, r: 52, b: 76, l: 76 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const n = rows.length;

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tipX, setTipX] = useState<number>(0);

  const axisFs = 16;
  const xAxisFs = 15;

  const fills = { selling: '#3b82f6', cost: '#f59e0b', profit: '#10b981' };

  if (n === 0) {
    return <div className="rep2-chart-empty">No profit data for this range.</div>;
  }

  const maxV = Math.max(
    1e-6,
    ...rows.flatMap(r => [
      thbEquivalentToUsdNumber(r.selling_total, thbPerUnit),
      thbEquivalentToUsdNumber(r.cost_total, thbPerUnit),
      thbEquivalentToUsdNumber(r.profit_total, thbPerUnit),
    ])
  );

  const groupW = n === 1 ? plotW : plotW / n;
  const gap = n === 1 ? 5 : 4;

  const maxTrioWidth =
    n === 1 ? plotW * 0.82 : Math.min(groupW * 0.9, (plotW / n) * 0.92);

  const barW = Math.max(18, (maxTrioWidth - gap * 2) / 3);
  const trioW = barW * 3 + gap * 2;
  const y0 = pad.t + plotH;

  const baseY = pad.t + plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = pad.t + (1 - f) * plotH;
    return (
      <line
        key={f}
        x1={pad.l}
        x2={w - pad.r}
        y1={y}
        y2={y}
        stroke="#e2e8f0"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
    );
  });

  const gxAt = (i: number) => (n === 1 ? pad.l + plotW / 2 : pad.l + i * (plotW / n) + groupW / 2);

  const iFromViewX = (viewX: number) => {
    if (n === 1) return 0;
    const groupX = plotW / n;
    const raw = (viewX - pad.l - groupX / 2) / groupX;
    return Math.min(n - 1, Math.max(0, Math.round(raw)));
  };

  const hovered = hoverIdx != null ? rows[hoverIdx] : null;

  return (
    <div className="rep2-chart-svg-wrap" style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Profit trend chart"
        onMouseMove={(e) => {
          const svg = e.currentTarget;
          const rect = svg.getBoundingClientRect();
          const xPx = e.clientX - rect.left;
          const viewX = (xPx / Math.max(1, rect.width)) * w;
          const i = iFromViewX(viewX);
          setHoverIdx(i);
          setTipX(xPx);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {gridLines}

        {/* Solid axes (left + bottom) */}
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={baseY} stroke="#94a3b8" strokeWidth={2} />
        <line x1={pad.l} x2={w - pad.r} y1={baseY} y2={baseY} stroke="#94a3b8" strokeWidth={2} />

        {hoverIdx != null && (
          <line
            x1={gxAt(hoverIdx)}
            x2={gxAt(hoverIdx)}
            y1={pad.t}
            y2={baseY}
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        )}

        {rows.map((r, i) => {
          const gx = gxAt(i);
          const startX = gx - trioW / 2;
          const sellH = (thbEquivalentToUsdNumber(r.selling_total, thbPerUnit) / maxV) * plotH;
          const costH = (thbEquivalentToUsdNumber(r.cost_total, thbPerUnit) / maxV) * plotH;
          const profH = (thbEquivalentToUsdNumber(r.profit_total, thbPerUnit) / maxV) * plotH;
          return (
            <g key={r.period}>
              <rect
                x={startX}
                y={y0 - sellH}
                width={barW}
                height={sellH}
                rx={4}
                fill={fills.selling}
              />
              <rect
                x={startX + barW + gap}
                y={y0 - costH}
                width={barW}
                height={costH}
                rx={4}
                fill={fills.cost}
              />
              <rect
                x={startX + (barW + gap) * 2}
                y={y0 - profH}
                width={barW}
                height={profH}
                rx={4}
                fill={fills.profit}
              />
              <text
                x={gx}
                y={h - 26}
                fontSize={xAxisFs}
                textAnchor="middle"
                fill="#475569"
                fontWeight={500}
              >
                {formatChartPeriod(r.period)}
              </text>
            </g>
          );
        })}

        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const val = f * maxV;
          const y = pad.t + (1 - f) * plotH;
          return (
            <text
              key={`py-${f}`}
              x={pad.l - 14}
              y={y + 6}
              fontSize={axisFs}
              textAnchor="end"
              fill="#475569"
              fontWeight={500}
            >
              {formatChartYAxis(val)}
            </text>
          );
        })}
      </svg>

      {hovered && (
        <div className="rep2-chart-tooltip" style={{ left: tipX, top: 14 }}>
          <div className="rep2-chart-tooltip-title">{formatChartPeriod(hovered.period)}</div>
          {(
            [
              { key: 'selling', color: fills.selling, label: 'selling', v: Number(hovered.selling_total) || 0 },
              { key: 'cost', color: fills.cost, label: 'cost', v: Number(hovered.cost_total) || 0 },
              { key: 'profit', color: fills.profit, label: 'profit', v: Number(hovered.profit_total) || 0 },
            ] as const
          ).map(({ key, color, label, v }) => (
            <div key={key} className="rep2-chart-tooltip-row" style={{ color }}>
              {label}: {formatUsdOnlyFromThb(v, thbPerUnit)}
            </div>
          ))}
        </div>
      )}

      <div className="rep2-chart-legend rep2-chart-legend--large">
        <span className="rep2-legend-item" style={{ color: fills.selling }}>
          <span className="rep2-legend-sq rep2-legend-sq--large" style={{ background: fills.selling }} />
          selling
        </span>
        <span className="rep2-legend-item" style={{ color: fills.cost }}>
          <span className="rep2-legend-sq rep2-legend-sq--large" style={{ background: fills.cost }} />
          cost
        </span>
        <span className="rep2-legend-item" style={{ color: fills.profit }}>
          <span className="rep2-legend-sq rep2-legend-sq--large" style={{ background: fills.profit }} />
          profit
        </span>
      </div>
    </div>
  );
}

function typeBadgeClass(type: string) {
  const t = (type || '').toUpperCase();
  if (t.includes('RETURN')) return 'rep2-type-badge rep2-type-badge--return';
  if (t.includes('SALE') || t.includes('INVOICE')) return 'rep2-type-badge rep2-type-badge--sale';
  if (t.includes('MEMO')) return 'rep2-type-badge rep2-type-badge--memo';
  return 'rep2-type-badge';
}

function RepUsdCell({ thb, thbPerUnit }: { thb: number; thbPerUnit: ThbPerUnitMap }) {
  return <span className="rep2-money-usd">{formatUsdOnlyFromThb(thb, thbPerUnit)}</span>;
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  variant,
  alert,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon?: React.ReactNode;
  variant: 'blue' | 'emerald' | 'red' | 'amber' | 'slate';
  alert?: boolean;
}) {
  const vClass =
    variant === 'blue'
      ? 'rep2-m--blue'
      : variant === 'emerald'
        ? 'rep2-m--emerald'
        : variant === 'red'
          ? 'rep2-m--red'
          : variant === 'amber'
            ? 'rep2-m--amber'
            : 'rep2-m--slate';
  return (
    <div className={`rep2-metric ${vClass}${alert ? ' rep2-metric--alert' : ''}`}>
      <div className="rep2-metric-inner">
        <div>
          <p className="rep2-metric-title">{title}</p>
          <p className="rep2-metric-value">{value}</p>
          <p className="rep2-metric-sub">{subtitle}</p>
        </div>
        {icon ? <div className="rep2-metric-icon">{icon}</div> : null}
      </div>
    </div>
  );
}

export const ReportsPage: React.FC<ReportsPageProps> = ({ token }) => {
  const { showAlert } = useAlertDialog();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  }, []);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [group, setGroup] = useState<GroupMode>('daily');
  const [activeTab, setActiveTab] = useState<ReportsTab>('customers');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ReportsSummaryResponse | null>(null);
  const [salesTrend, setSalesTrend] = useState<TrendRow[]>([]);
  const [profitTrend, setProfitTrend] = useState<ProfitTrendRow[]>([]);
  const [thbPerUnit, setThbPerUnit] = useState<ThbPerUnitMap>({ THB: 1 });

  const [customerInvoicesOpen, setCustomerInvoicesOpen] = useState(false);
  const [customerInvoicesLoading, setCustomerInvoicesLoading] = useState(false);
  const [customerInvoicesError, setCustomerInvoicesError] = useState<string | null>(null);
  const [customerInvoices, setCustomerInvoices] = useState<InvoiceListRow[]>([]);
  const [customerInvoicesTitle, setCustomerInvoicesTitle] = useState<string>('');

  const [itemStockOpen, setItemStockOpen] = useState(false);
  const [itemStockLoading, setItemStockLoading] = useState(false);
  const [itemStockError, setItemStockError] = useState<string | null>(null);
  const [itemStockHistory, setItemStockHistory] = useState<StockMovementRow[]>([]);
  const [itemStockTitle, setItemStockTitle] = useState<string>('');

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);

      const paramsTrend = new URLSearchParams(params.toString());
      paramsTrend.set('group', group);

      const summaryRes = await fetch(apiUrl(`/api/reports/summary?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!summaryRes.ok) throw new Error(await parseErrorResponse(summaryRes, 'Failed to load reports'));
      const summaryData: ReportsSummaryResponse = await summaryRes.json();

      const salesRes = await fetch(apiUrl(`/api/reports/sales-trend?${paramsTrend.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!salesRes.ok) throw new Error(await parseErrorResponse(salesRes, 'Failed to load sales trend'));
      const salesData = await salesRes.json();

      const profitRes = await fetch(apiUrl(`/api/reports/profit-trend?${paramsTrend.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!profitRes.ok) throw new Error(await parseErrorResponse(profitRes, 'Failed to load profit trend'));
      const profitData = await profitRes.json();

      setSummary(summaryData);
      setSalesTrend(salesData.rows || []);
      setProfitTrend(profitData.rows || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load reports';
      setError(msg);
      setSummary(null);
      setSalesTrend([]);
      setProfitTrend([]);
      showAlert({ title: 'Could not load reports', message: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const openCustomerInvoices = async (customerId: number, customerName: string) => {
    setCustomerInvoicesOpen(true);
    setCustomerInvoicesLoading(true);
    setCustomerInvoicesError(null);
    setCustomerInvoices([]);
    setCustomerInvoicesTitle(customerName);
    try {
      const params = new URLSearchParams();
      params.set('customer_id', String(customerId));
      params.set('limit', '100');
      const res = await fetch(apiUrl(`/api/invoices?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load invoices'));
      const data: InvoiceListRow[] = await res.json();
      setCustomerInvoices(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load invoices';
      setCustomerInvoicesError(msg);
      showAlert({ title: 'Could not load invoices', message: msg, variant: 'error' });
    } finally {
      setCustomerInvoicesLoading(false);
    }
  };

  const openItemStockHistory = async (itemId: number, itemLabel: string) => {
    setItemStockOpen(true);
    setItemStockLoading(true);
    setItemStockError(null);
    setItemStockHistory([]);
    setItemStockTitle(itemLabel);
    try {
      const res = await fetch(apiUrl(`/api/inventory/${itemId}/stock-history?limit=20`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load stock history'));
      const data: StockMovementRow[] = await res.json();
      setItemStockHistory(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load stock history';
      setItemStockError(msg);
      showAlert({ title: 'Stock history', message: msg, variant: 'error' });
    } finally {
      setItemStockLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, group, token]);

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

  const resetRange = () => {
    setFrom(defaultFrom);
    setTo(today);
    setGroup('daily');
  };

  const memoOpenValue = useMemo(() => {
    if (!summary) return 0;
    return (summary.memos_by_status || []).reduce(
      (sum, r) => (r.status === 'Closed' ? sum : sum + (Number(r.value) || 0)),
      0
    );
  }, [summary]);

  const openMemoCount = useMemo(() => {
    if (!summary) return 0;
    return (summary.memos_by_status || [])
      .filter(r => r.status !== 'Closed')
      .reduce((s, r) => s + (Number(r.memo_count) || 0), 0);
  }, [summary]);

  const exportMasterReport = () => {
    if (!summary) {
      return;
    }
    const s = summary.sales;
    const p = summary.profit;
    const inv = summary.inventory;
    const lines: string[] = [];
    lines.push('Blue Cuts — Reports export');
    lines.push(`From,${from}`);
    lines.push(`To,${to}`);
    lines.push(`Grouping,${group}`);
    lines.push(
      'Note,"USD values converted from internal THB-equivalent totals using Profile exchange rates (THB bridge)"'
    );
    lines.push('');
    lines.push('Metric,Value (USD)');
    lines.push(`Total Sales,${thbEquivalentToUsdCsv(s?.sales_total ?? 0, thbPerUnit)}`);
    lines.push(`Total Collected,${thbEquivalentToUsdCsv(s?.collected_total ?? 0, thbPerUnit)}`);
    lines.push(`Outstanding Balance,${thbEquivalentToUsdCsv(s?.outstanding_total ?? 0, thbPerUnit)}`);
    lines.push(`Gross Profit,${thbEquivalentToUsdCsv(p?.profit_total ?? 0, thbPerUnit)}`);
    lines.push(`Inventory Value,${thbEquivalentToUsdCsv(inv?.inventory_value ?? 0, thbPerUnit)}`);
    lines.push(`Open Memo Value,${thbEquivalentToUsdCsv(memoOpenValue, thbPerUnit)}`);
    lines.push('');
    lines.push('SALES TREND');
    lines.push(
      toCsv(
        salesTrend.map(r => ({
          period: r.period,
          invoices_count: r.invoices_count,
          sales_total: thbEquivalentToUsdCsv(r.sales_total, thbPerUnit),
          collected_total: thbEquivalentToUsdCsv(r.collected_total, thbPerUnit),
          outstanding_total: thbEquivalentToUsdCsv(r.outstanding_total, thbPerUnit),
        })),
        [
          { key: 'period', label: 'Period' },
          { key: 'invoices_count', label: 'Invoices' },
          { key: 'sales_total', label: 'Sales Total (USD)' },
          { key: 'collected_total', label: 'Collected Total (USD)' },
          { key: 'outstanding_total', label: 'Outstanding Total (USD)' },
        ]
      )
    );
    lines.push('');
    lines.push('PROFIT TREND');
    lines.push(
      toCsv(
        profitTrend.map(r => ({
          period: r.period,
          selling_total: thbEquivalentToUsdCsv(r.selling_total, thbPerUnit),
          cost_total: thbEquivalentToUsdCsv(r.cost_total, thbPerUnit),
          profit_total: thbEquivalentToUsdCsv(r.profit_total, thbPerUnit),
        })),
        [
          { key: 'period', label: 'Period' },
          { key: 'selling_total', label: 'Selling Total (USD)' },
          { key: 'cost_total', label: 'Cost Total (USD)' },
          { key: 'profit_total', label: 'Profit Total (USD)' },
        ]
      )
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reports-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sales = summary?.sales;
  const profit = summary?.profit;
  const inventory = summary?.inventory;

  const groupLabel = group === 'daily' ? 'Daily' : 'Monthly';

  return (
    <div className="page page-reports">
      <div className="rep2-page">
        <div className="rep2-shell">
          <section className="rep2-controls" aria-label="Report filters">
            <div className="rep2-controls-grid">
              <div className="rep2-field">
                <label htmlFor="rep-from">From</label>
                <input id="rep-from" type="date" value={from} onChange={e => setFrom(e.target.value)} />
              </div>
              <div className="rep2-field">
                <label htmlFor="rep-to">To</label>
                <input id="rep-to" type="date" value={to} onChange={e => setTo(e.target.value)} />
              </div>
              <div className="rep2-field">
                <label htmlFor="rep-group">Grouping</label>
                <select
                  id="rep-group"
                  value={group}
                  onChange={e => setGroup(e.target.value as GroupMode)}
                >
                  <option value="daily">Daily</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <button type="button" className="rep2-btn-outline" onClick={resetRange} disabled={loading}>
                <IconRotateCcw />
                Reset
              </button>
              <button
                type="button"
                className="rep2-btn-outline"
                onClick={exportMasterReport}
                disabled={loading || !summary}
                title="Download summary, sales trend, and profit trend as CSV"
              >
                <IconDownloadCloud />
                Export
              </button>
            </div>
          </section>

          {loading && !summary && <div className="rep2-loading">Loading reports…</div>}
          {error && (
            <div className="rep2-error" role="alert">
              {error}
            </div>
          )}

          {!loading && summary && (
            <>
              <section className="rep2-kpi-grid" aria-label="Key metrics">
                <MetricCard
                  title="Total Sales"
                  value={formatUsdOnlyFromThb(sales?.sales_total || 0, thbPerUnit)}
                  subtitle={`${sales?.invoices_count || 0} invoices · USD (Profile rates)`}
                  icon={<IconTrendingUp />}
                  variant="blue"
                />
                <MetricCard
                  title="Total Collected"
                  value={formatUsdOnlyFromThb(sales?.collected_total || 0, thbPerUnit)}
                  subtitle={`${sales?.paid_invoices || 0} paid invoices · USD (Profile rates)`}
                  icon={<IconArrowUpRight />}
                  variant="emerald"
                />
                <MetricCard
                  title="Outstanding Balance"
                  value={formatUsdOnlyFromThb(sales?.outstanding_total || 0, thbPerUnit)}
                  subtitle={`${sales?.unpaid_invoices || 0} unpaid · USD (Profile rates)`}
                  icon={<IconArrowDownRight />}
                  variant="red"
                  alert={(sales?.outstanding_total || 0) > 0}
                />
                <MetricCard
                  title="Gross Profit"
                  value={formatUsdOnlyFromThb(profit?.profit_total || 0, thbPerUnit)}
                  subtitle={`${money(profit?.profit_margin_pct || 0)}% margin · USD (Profile rates)`}
                  variant="emerald"
                />
                <MetricCard
                  title="Inventory Value"
                  value={formatUsdOnlyFromThb(inventory?.inventory_value || 0, thbPerUnit)}
                  subtitle={`${inventory?.remaining_pcs || 0} pieces · USD (Profile rates)`}
                  variant="amber"
                />
                <MetricCard
                  title="Open Memo Value"
                  value={formatUsdOnlyFromThb(memoOpenValue, thbPerUnit)}
                  subtitle={`${openMemoCount} open memos · USD (Profile rates)`}
                  variant="slate"
                />
              </section>

              <div className="rep2-charts-row">
                <div className="rep2-card rep2-card--chart">
                  <div className="rep2-card-head">
                    <h2 className="rep2-card-title">Sales Trend</h2>
                    <p className="rep2-card-desc">{groupLabel} sales, collections, and outstanding (USD)</p>
                  </div>
                  <div className="rep2-card-body rep2-card-body--chart">
                    <ReportsSalesLineChart rows={salesTrend} thbPerUnit={thbPerUnit} />
                  </div>
                </div>
                <div className="rep2-card rep2-card--chart">
                  <div className="rep2-card-head">
                    <h2 className="rep2-card-title">Profit Trend</h2>
                    <p className="rep2-card-desc">Selling vs cost vs profit (USD)</p>
                  </div>
                  <div className="rep2-card-body rep2-card-body--chart">
                    <ReportsProfitBarChart rows={profitTrend} thbPerUnit={thbPerUnit} />
                  </div>
                </div>
              </div>

              <div className="rep2-tabs-wrap">
                <div className="rep2-tabs-list" role="tablist" aria-label="Report sections">
                  {(
                    [
                      ['customers', 'Top Customers'],
                      ['items', 'Top Items'],
                      ['inventory', 'Inventory Status'],
                      ['memos', 'Memos'],
                      ['activity', 'Stock Activity'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === id}
                      className={`rep2-tab${activeTab === id ? ' rep2-tab--active' : ''}`}
                      onClick={() => setActiveTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {activeTab === 'customers' && (
                  <div className="rep2-tab-panel" role="tabpanel">
                    <div className="rep2-card rep2-table-card">
                      <div className="rep2-card-head">
                        <h2 className="rep2-card-title">Top Customers</h2>
                        <p className="rep2-card-desc">
                          Largest outstanding balances in your selected range
                        </p>
                      </div>
                      <div className="rep2-card-body">
                        <div className="rep2-table-scroll">
                          <table className="rep2-table">
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th className="rep2-th-right">Invoices</th>
                                <th className="rep2-th-right">Invoiced (USD)</th>
                                <th className="rep2-th-right">Owed (USD)</th>
                                <th className="rep2-th-center">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {summary.top_customers.length === 0 ? (
                                <tr>
                                  <td colSpan={5} style={{ textAlign: 'center', color: '#64748b' }}>
                                    No data
                                  </td>
                                </tr>
                              ) : (
                                summary.top_customers.map(c => (
                                  <tr key={c.id}>
                                    <td>
                                      <div className="rep2-cell-name">{c.name}</div>
                                      <div className="rep2-cell-muted">{c.phone || '—'}</div>
                                    </td>
                                    <td className="rep2-td-right">{c.invoices_count}</td>
                                    <td className="rep2-td-right rep2-td-money">
                                      <RepUsdCell thb={c.total_invoiced} thbPerUnit={thbPerUnit} />
                                    </td>
                                    <td
                                      className={`rep2-td-right rep2-td-money rep2-owed${c.total_owed > 0 ? ' rep2-owed--alert' : ''}`}
                                    >
                                      <RepUsdCell thb={c.total_owed} thbPerUnit={thbPerUnit} />
                                    </td>
                                    <td className="rep2-td-center">
                                      <button
                                        type="button"
                                        className="rep2-table-btn"
                                        onClick={() => openCustomerInvoices(c.id, c.name)}
                                      >
                                        View Invoices
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'items' && (
                  <div className="rep2-tab-panel" role="tabpanel">
                    <div className="rep2-card rep2-table-card">
                      <div className="rep2-card-head">
                        <h2 className="rep2-card-title">Top Items</h2>
                        <p className="rep2-card-desc">Best sellers in the selected date range</p>
                      </div>
                      <div className="rep2-card-body">
                        <div className="rep2-table-scroll">
                          <table className="rep2-table">
                            <thead>
                              <tr>
                                <th>SKU</th>
                                <th>Description</th>
                                <th className="rep2-th-right">Qty Sold</th>
                                <th className="rep2-th-right">Sales (USD)</th>
                                <th className="rep2-th-right">Profit (USD)</th>
                                <th className="rep2-th-center">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {summary.top_items.length === 0 ? (
                                <tr>
                                  <td colSpan={6} style={{ textAlign: 'center', color: '#64748b' }}>
                                    No data
                                  </td>
                                </tr>
                              ) : (
                                summary.top_items.map(it => (
                                  <tr key={it.inventory_item_id}>
                                    <td className="rep2-cell-name">
                                      {it.item_code || `#${it.inventory_item_id}`}
                                    </td>
                                    <td>
                                      <div className="rep2-item-desc">
                                        {it.category} • {it.item_type}
                                      </div>
                                    </td>
                                    <td className="rep2-td-right">{it.qty_sold}</td>
                                    <td className="rep2-td-right rep2-td-money">
                                      <RepUsdCell thb={it.sales_value} thbPerUnit={thbPerUnit} />
                                    </td>
                                    <td className="rep2-td-right rep2-td-money rep2-profit-cell">
                                      <RepUsdCell thb={it.profit_value} thbPerUnit={thbPerUnit} />
                                    </td>
                                    <td className="rep2-td-center">
                                      <button
                                        type="button"
                                        className="rep2-table-btn"
                                        onClick={() =>
                                          openItemStockHistory(
                                            it.inventory_item_id,
                                            it.item_code || `#${it.inventory_item_id}`
                                          )
                                        }
                                      >
                                        View Stock
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'inventory' && (
                  <div className="rep2-tab-panel" role="tabpanel">
                    <div className="rep2-card rep2-table-card">
                      <div className="rep2-card-head">
                        <h2 className="rep2-card-title">Inventory by Status</h2>
                        <p className="rep2-card-desc">Current pieces and value remaining per status</p>
                      </div>
                      <div className="rep2-card-body">
                        <div className="rep2-table-scroll">
                          <table className="rep2-table">
                            <thead>
                              <tr>
                                <th>Status</th>
                                <th className="rep2-th-right">Pieces</th>
                                <th className="rep2-th-right">Value (USD)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {summary.inventory_by_status.length === 0 ? (
                                <tr>
                                  <td colSpan={3} style={{ textAlign: 'center', color: '#64748b' }}>
                                    No data
                                  </td>
                                </tr>
                              ) : (
                                summary.inventory_by_status.map(r => (
                                  <tr key={r.status}>
                                    <td className="rep2-cell-name">{r.status}</td>
                                    <td className="rep2-td-right">{r.pcs_remaining}</td>
                                    <td className="rep2-td-right rep2-td-money">
                                      <RepUsdCell thb={r.value} thbPerUnit={thbPerUnit} />
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'memos' && (
                  <div className="rep2-tab-panel" role="tabpanel">
                    <div className="rep2-card rep2-table-card">
                      <div className="rep2-card-head">
                        <h2 className="rep2-card-title">Memos by Status</h2>
                        <p className="rep2-card-desc">
                          Open memo value and remaining pieces within selected range
                        </p>
                      </div>
                      <div className="rep2-card-body">
                        <div className="rep2-table-scroll">
                          <table className="rep2-table">
                            <thead>
                              <tr>
                                <th>Status</th>
                                <th className="rep2-th-right">Memos</th>
                                <th className="rep2-th-right">Remaining</th>
                                <th className="rep2-th-right">Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {summary.memos_by_status.length === 0 ? (
                                <tr>
                                  <td colSpan={4} style={{ textAlign: 'center', color: '#64748b' }}>
                                    No data
                                  </td>
                                </tr>
                              ) : (
                                summary.memos_by_status.map(r => (
                                  <tr key={r.status}>
                                    <td className="rep2-cell-name">{r.status}</td>
                                    <td className="rep2-td-right">{r.memo_count}</td>
                                    <td className="rep2-td-right">{r.remaining_qty}</td>
                                    <td className="rep2-td-right rep2-td-money">
                                      <RepUsdCell thb={r.value} thbPerUnit={thbPerUnit} />
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'activity' && (
                  <div className="rep2-tab-panel" role="tabpanel">
                    <div className="rep2-card rep2-table-card">
                      <div className="rep2-card-head">
                        <h2 className="rep2-card-title">Latest Stock Activity</h2>
                        <p className="rep2-card-desc">Recent movements with user and notes</p>
                      </div>
                      <div className="rep2-card-body">
                        <div className="rep2-table-scroll">
                          <table className="rep2-table">
                            <thead>
                              <tr>
                                <th>Date &amp; Time</th>
                                <th>Item</th>
                                <th>Type</th>
                                <th className="rep2-th-right">Qty Change</th>
                                <th>User</th>
                                <th>Note</th>
                              </tr>
                            </thead>
                            <tbody>
                              {summary.latest_stock_movements.length === 0 ? (
                                <tr>
                                  <td colSpan={6} style={{ textAlign: 'center', color: '#64748b' }}>
                                    No movements recorded
                                  </td>
                                </tr>
                              ) : (
                                summary.latest_stock_movements.map(m => (
                                  <tr key={m.id}>
                                    <td>{new Date(m.created_at).toLocaleString()}</td>
                                    <td className="rep2-cell-name">
                                      {m.item_code || `#${m.inventory_item_id}`}
                                    </td>
                                    <td>
                                      <span className={typeBadgeClass(m.type)}>{m.type}</span>
                                    </td>
                                    <td
                                      className={`rep2-td-right ${m.qty_change >= 0 ? 'rep2-qty-pos' : 'rep2-qty-neg'}`}
                                    >
                                      {m.qty_change >= 0 ? `+${m.qty_change}` : m.qty_change}
                                    </td>
                                    <td>{m.user_name || '—'}</td>
                                    <td>{m.note || ''}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {customerInvoicesOpen && (
        <div className="reports-modal-overlay" role="dialog" aria-modal="true" onClick={() => setCustomerInvoicesOpen(false)}>
          <div className="reports-modal" onClick={e => e.stopPropagation()}>
            <div className="reports-modal-header">
              <div>
                <h3>Invoices for {customerInvoicesTitle}</h3>
                <div className="reports-modal-sub">Sales and payment status.</div>
              </div>
              <button type="button" className="reports-modal-close" onClick={() => setCustomerInvoicesOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="reports-modal-body">
              {customerInvoicesLoading ? (
                <div className="reports-empty">Loading…</div>
              ) : customerInvoicesError ? (
                <div className="reports-error reports-empty">{customerInvoicesError}</div>
              ) : customerInvoices.length === 0 ? (
                <div className="reports-empty">No invoices found.</div>
              ) : (
                <div className="reports-table-wrap">
                  <table className="reports-table" aria-label="Customer invoice list">
                    <thead>
                      <tr>
                        <th>Invoice #</th>
                        <th>Date</th>
                        <th className="right">Total (USD)</th>
                        <th className="right">Paid (USD)</th>
                        <th className="right">Balance (USD)</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerInvoices.map(inv => {
                        const bal = Math.max(0, (inv.total || 0) - (inv.paid || 0));
                        return (
                          <tr key={inv.id}>
                            <td className="reports-strong">{inv.invoice_no}</td>
                            <td>{new Date(inv.created_at).toLocaleDateString()}</td>
                            <td className="right">
                              {formatUsdOnlyFromAny(inv.total, inv.currency_code || DEFAULT_CURRENCY_CODE, thbPerUnit)}
                            </td>
                            <td className="right reports-profit-positive">
                              {formatUsdOnlyFromAny(inv.paid, inv.currency_code || DEFAULT_CURRENCY_CODE, thbPerUnit)}
                            </td>
                            <td className={`right ${bal > 0 ? 'reports-balance-red' : ''}`}>
                              {formatUsdOnlyFromAny(bal, inv.currency_code || DEFAULT_CURRENCY_CODE, thbPerUnit)}
                            </td>
                            <td>{inv.status}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {itemStockOpen && (
        <div className="reports-modal-overlay" role="dialog" aria-modal="true" onClick={() => setItemStockOpen(false)}>
          <div className="reports-modal" onClick={e => e.stopPropagation()}>
            <div className="reports-modal-header">
              <div>
                <h3>Stock history for {itemStockTitle}</h3>
                <div className="reports-modal-sub">Audit log of quantity changes with user and timestamp.</div>
              </div>
              <button type="button" className="reports-modal-close" onClick={() => setItemStockOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="reports-modal-body">
              {itemStockLoading ? (
                <div className="reports-empty">Loading…</div>
              ) : itemStockError ? (
                <div className="reports-empty">{itemStockError}</div>
              ) : itemStockHistory.length === 0 ? (
                <div className="reports-empty">No movements recorded.</div>
              ) : (
                <div className="reports-table-wrap">
                  <table className="reports-table" aria-label="Stock movement list">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th className="right">Qty change</th>
                        <th>User</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemStockHistory.map(m => (
                        <tr key={m.id}>
                          <td>{new Date(m.created_at).toLocaleString()}</td>
                          <td>{m.type}</td>
                          <td className={`right ${m.qty_change >= 0 ? 'reports-stock-pos' : 'reports-stock-neg'}`}>
                            {m.qty_change >= 0 ? `+${m.qty_change}` : m.qty_change}
                          </td>
                          <td>{m.user_name || '—'}</td>
                          <td>{m.note || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
