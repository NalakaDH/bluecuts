import React, { useEffect, useMemo, useState } from 'react';
import { useAlertDialog } from '../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../api';
import type { PageId } from '../components/layout/Layout';
import { DEFAULT_CURRENCY_CODE, formatMoneyAmount } from '../lib/currencies';

type InvoiceStatus = 'Unpaid' | 'Partial' | 'Paid';

type InvoiceRow = {
  id: number;
  invoice_no: string;
  customer_name: string | null;
  total: number;
  paid: number;
  status: InvoiceStatus;
  created_at: string;
  currency_code?: string | null;
};

type InvoiceDetail = {
  id: number;
  items: { quantity: number }[];
};

type InventoryItem = {
  id: number;
  category: string;
  item_type: string;
  pieces_remaining?: number | null;
  item_code?: string | null;
  item_sticker?: string | null;
};

type MemoStatus = 'Open' | 'Partially Returned' | 'Closed';

type MemoRow = {
  id: number;
  memo_no: string;
  customer_name: string | null;
  status: MemoStatus;
  due_date: string | null;
  items_count: number;
  created_at: string;
};

type StockMovement = {
  id: number;
  type: string;
  qty_change: number;
  note: string | null;
  created_at: string;
  user_name: string | null;
  item_code: string | null;
};

type DashboardOverviewResponse = {
  business_today?: string;
  business_tz?: string;
  today_sales_bounds?: { start: string; end: string };
  todaySales: {
    invoices_count: number;
    sales_total: number;
    collected_total: number;
    outstanding_total: number;
    paid_invoices: number;
    partial_invoices: number;
    unpaid_invoices: number;
  };
  items_sold_today?: number;
  outstanding_all?: { outstanding_total: number; invoice_count: number };
  memos_summary?: { open_count: number; due_within_3_days: number };
  trends: { sales: { period: string; invoices_count: number; sales_total: number; collected_total: number; outstanding_total: number }[] };
  latest_stock_movements: StockMovement[];
};

interface DashboardTemplateUIProps {
  token: string;
  username?: string;
  onNavigate?: (page: PageId) => void;
}

/** Local time-of-day greeting (5–12 morning, 12–17 afternoon, 17–22 evening, else night). */
function greetingForLocalHour(date: Date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  if (h >= 17 && h < 22) return 'Good evening';
  return 'Good night';
}

const formatRelative = (iso: string) => {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - t;
  const s = Math.floor(diffMs / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (m < 1) return `${s}s ago`;
  if (h < 1) return `${m} min ago`;
  return `${h} hr ago`;
};

const weekdayShort = (isoDate: string) => {
  try {
    return new Date(isoDate).toLocaleDateString(undefined, { weekday: 'short' });
  } catch {
    return isoDate;
  }
};

function RevenueWeekChart({ rows }: { rows: { period: string; sales_total: number }[] }) {
  const w = 560;
  const h = 220;
  const padTop = 22;
  const padBottom = 48;
  const padLeft = 44;
  const padRight = 16;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tip, setTip] = useState<{ left: number; top: number }>({ left: 0, top: 10 });

  const n = Math.max(1, rows.length);
  const stepX = plotW / n;
  const maxVal = Math.max(1, ...rows.map(r => Number(r.sales_total) || 0));

  const xAt = (i: number) => (n === 1 ? padLeft + plotW / 2 : padLeft + i * stepX + stepX / 2);
  const yAt = (v: number) => padTop + (1 - v / maxVal) * plotH;

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const points = rows
    .map((r, i) => `${xAt(i)},${yAt(Number(r.sales_total) || 0)}`)
    .join(' ');

  const baseY = padTop + plotH;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const xView = (xPx / Math.max(1, rect.width)) * w;
    const raw = (xView - padLeft) / Math.max(1, plotW);
    const i = n === 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round(raw * (n - 1))));
    setHoverIdx(i);
    setTip({ left: xPx, top: 14 });
  };

  const hovered = hoverIdx != null ? rows[hoverIdx] : null;

  return (
    <div className="dashT-chart-wrap dashT-chart-wrap--revenue">
      <svg
        className="dashT-chart-svg"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Revenue This Week"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Axes */}
        <line x1={padLeft} x2={padLeft} y1={padTop} y2={baseY} stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
        <line x1={padLeft} x2={w - padRight} y1={baseY} y2={baseY} stroke="rgba(0,0,0,0.18)" strokeWidth="2" />

        {/* Grid + Y labels */}
        {ticks.map(f => {
          const v = f * maxVal;
          const y = yAt(v);
          return (
            <g key={`y-${f}`}>
              <line x1={padLeft} x2={w - padRight} y1={y} y2={y} stroke="rgba(0,0,0,0.06)" strokeWidth="1" strokeDasharray="3 3" />
              <text x={padLeft - 10} y={y + 4} fontSize="12" textAnchor="end" fill="rgba(148,163,184,1)" fontWeight={600}>
                {Math.round(v).toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* Hover guideline */}
        {hoverIdx != null && (
          <line
            x1={xAt(hoverIdx)}
            x2={xAt(hoverIdx)}
            y1={padTop}
            y2={baseY}
            stroke="rgba(37,99,235,0.45)"
            strokeWidth="2"
            strokeDasharray="3 3"
          />
        )}

        {/* Lines + points */}
        <polyline points={points} fill="none" stroke="rgba(37,99,235,0.95)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        {rows.map((r, i) => {
          const v = Number(r.sales_total) || 0;
          const isHover = hoverIdx === i;
          return (
            <circle
              key={r.period}
              cx={xAt(i)}
              cy={yAt(v)}
              r={isHover ? 7 : 4}
              fill="#ffffff"
              stroke="rgba(37,99,235,0.95)"
              strokeWidth={isHover ? 3 : 2}
            />
          );
        })}

        {/* X labels */}
        {rows.map((r, i) => {
          return (
            <text
              key={`t-${r.period}`}
              x={xAt(i)}
              y={h - 18}
              fontSize="12"
              textAnchor="middle"
              fill="rgba(0,0,0,0.65)"
              fontWeight={600}
            >
              {weekdayShort(r.period)}
            </text>
          );
        })}
      </svg>

      {hovered && (
        <div className="dashT-chart-tooltip" style={{ left: tip.left, top: tip.top }}>
          <div className="dashT-chart-tooltip-title">{weekdayShort(hovered.period)}</div>
          <div className="dashT-chart-tooltip-row" style={{ color: 'var(--accent)' }}>
            sales: {formatMoneyAmount(Number(hovered.sales_total) || 0, DEFAULT_CURRENCY_CODE)}
          </div>
        </div>
      )}
    </div>
  );
}

export function DashboardTemplateUI({ token, username, onNavigate }: DashboardTemplateUIProps) {
  const { showAlert } = useAlertDialog();
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null);
  const [recentInvoices, setRecentInvoices] = useState<InvoiceRow[]>([]);
  const [invoiceItemsCount, setInvoiceItemsCount] = useState<Record<number, number>>({});

  const [stockAlerts, setStockAlerts] = useState<InventoryItem[]>([]);
  const [memos, setMemos] = useState<MemoRow[]>([]);

  const [greetingTick, setGreetingTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setGreetingTick(t => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const timeGreeting = useMemo(() => greetingForLocalHour(), [greetingTick]);

  const fetchOverview = async (days: number) => {
    const res = await fetch(apiUrl(`/api/dashboard/overview?days=${days}`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load dashboard overview'));
    return (await res.json()) as DashboardOverviewResponse;
  };

  const normalizeCreatedAtForCompare = (raw: string) =>
    String(raw || '')
      .replace('T', ' ')
      .slice(0, 19);

  const fetchRecentInvoices = async (bounds?: { start: string; end: string } | null) => {
    setInvoiceItemsCount({});
    const res = await fetch(apiUrl('/api/invoices'), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load invoices'));
    const all: InvoiceRow[] = (await res.json()) as InvoiceRow[];
    const sorted = all
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const todays =
      bounds && bounds.start && bounds.end
        ? sorted.filter(i => {
            const ca = normalizeCreatedAtForCompare(i.created_at);
            return ca >= bounds.start && ca < bounds.end;
          })
        : [];

    // Prefer "today" invoices (business timezone from overview), but fall back to latest so the panel isn't empty.
    const pick = (todays.length ? todays : sorted).slice(0, 5);
    setRecentInvoices(pick);

    // Fetch item counts for the table (small number of rows).
    await Promise.all(
      pick.map(async inv => {
        try {
          const detailRes = await fetch(apiUrl(`/api/invoices/${inv.id}`), { headers: { Authorization: `Bearer ${token}` } });
          if (!detailRes.ok) return;
          const detail = (await detailRes.json()) as InvoiceDetail;
          const count = (detail.items || []).reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
          setInvoiceItemsCount(prev => ({ ...prev, [inv.id]: count }));
        } catch {
          // ignore
        }
      })
    );
  };

  const fetchLowStock = async () => {
    const params = new URLSearchParams();
    params.set('status', 'Available');
    params.set('limit', '200');
    const res = await fetch(apiUrl(`/api/inventory?${params.toString()}`), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load inventory'));
    const rows: InventoryItem[] = (await res.json()) as InventoryItem[];

    const low = rows.filter(r => (typeof r.pieces_remaining === 'number' ? r.pieces_remaining : 0) <= 2);
    const orderedByRemaining = rows
      .slice()
      .sort((a, b) => (Number(a.pieces_remaining) || 0) - (Number(b.pieces_remaining) || 0));

    // Prefer true low-stock alerts; if none, show the 4 lowest remaining items.
    const pick = (low.length ? low : orderedByRemaining).slice(0, 4);
    setStockAlerts(pick);
  };

  const fetchMemos = async () => {
    const params = new URLSearchParams();
    params.set('limit', '150');
    const res = await fetch(apiUrl(`/api/memos?${params.toString()}`), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load memos'));
    const rows: MemoRow[] = (await res.json()) as MemoRow[];
    const sorted = rows
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const open = sorted.filter(r => r.status !== 'Closed');
    // If there are no open memos, show the latest memos (including Closed) so the dashboard doesn't look empty.
    setMemos((open.length ? open : sorted).slice(0, 4));
  };

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const ov = await fetchOverview(rangeDays);
      setOverview(ov);
      await Promise.all([
        fetchRecentInvoices(ov.today_sales_bounds ?? null),
        fetchLowStock(),
        fetchMemos(),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load dashboard';
      setError(msg);
      setOverview(null);
      showAlert({ title: 'Could not load dashboard', message: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, rangeDays]);

  const lowStockCount = stockAlerts.length;

  const openMemosCount = overview?.memos_summary?.open_count ?? memos.filter(m => m.status !== 'Closed').length;
  const memosDueSoon = overview?.memos_summary?.due_within_3_days ?? 0;
  const latestFeed = overview?.latest_stock_movements || [];

  const kpiToday = overview?.todaySales;
  const kpiOutstanding = overview?.outstanding_all?.outstanding_total ?? 0;
  const kpiOutstandingInvoiceCount = overview?.outstanding_all?.invoice_count ?? 0;
  const itemsSoldToday = Math.floor(Number(overview?.items_sold_today ?? 0));

  const weekRows = useMemo(() => {
    const rows = overview?.trends?.sales || [];
    if (!rows.length) return [];
    // endpoint returns ASC; take last 7 for a "week" chart
    return rows.slice(-7).map(r => ({ period: r.period, sales_total: r.sales_total }));
  }, [overview]);

  const navBtns = [
    { label: 'New Sale', page: 'selling' as PageId },
    { label: 'Add Customer', page: 'customers' as PageId },
    { label: 'Create Memo', page: 'memo' as PageId },
    { label: 'Check Inventory', page: 'checkInventory' as PageId },
    { label: 'Restock Item', page: 'returns' as PageId },
    { label: 'View Reports', page: 'reports' as PageId },
  ];

  const QuickIcon = ({ page }: { page: PageId }) => {
    const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
    switch (page) {
      case 'selling':
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" {...common} />
            <line x1="3" y1="6" x2="21" y2="6" {...common} />
            <path d="M16 10a4 4 0 01-8 0" {...common} />
          </svg>
        );
      case 'customers':
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" {...common} />
            <circle cx="12" cy="7" r="4" {...common} />
            <line x1="12" y1="11" x2="12" y2="17" {...common} />
            <line x1="9" y1="14" x2="15" y2="14" {...common} />
          </svg>
        );
      case 'memo':
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" {...common} />
            <polyline points="14 2 14 8 20 8" {...common} />
            <line x1="12" y1="11" x2="12" y2="17" {...common} />
            <line x1="9" y1="14" x2="15" y2="14" {...common} />
          </svg>
        );
      case 'checkInventory':
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="8" {...common} />
            <line x1="21" y1="21" x2="16.65" y2="16.65" {...common} />
          </svg>
        );
      case 'returns':
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="1 4 1 10 7 10" {...common} />
            <path d="M3.51 15a9 9 0 102.13-9.36L1 10" {...common} />
          </svg>
        );
      case 'profile':
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" {...common} />
            <circle cx="12" cy="7" r="4" {...common} />
          </svg>
        );
      case 'reports':
      case 'dashboard':
      case 'updateInventory':
      case 'payments':
      case 'invoiceCheckout':
      default:
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="18" y1="20" x2="18" y2="10" {...common} />
            <line x1="12" y1="20" x2="12" y2="4" {...common} />
            <line x1="6" y1="20" x2="6" y2="14" {...common} />
          </svg>
        );
    }
  };

  return (
    <div className="page dashT-page">
      <div className="dashT-subtop">
        <div className="dashT-subtop-left">
          <div className="dashT-greeting">
            {timeGreeting}, <span className="dashT-greeting-name">{username || 'Owner'}</span>
          </div>
          <div className="dashT-greeting-sub">Here's what&apos;s happening with your gem shop today</div>

          <div className="dashT-period-tabs" role="tablist" aria-label="Dashboard period tabs">
            {[
              { d: 7, label: '7D' },
              { d: 30, label: '30D' },
              { d: 90, label: '90D' },
              { d: 365, label: '1Y' },
            ].map(opt => (
              <button
                key={opt.d}
                type="button"
                className={`dashT-period-tab ${rangeDays === opt.d ? 'active' : ''}`}
                onClick={() => setRangeDays(opt.d)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="dashT-subtop-right">
          <button type="button" className="dashT-alert-badge" disabled>
            <span className="dashT-alert-dot">!</span>
            {lowStockCount} Low Stock Alert{lowStockCount === 1 ? '' : 's'}
          </button>
        </div>
      </div>

      <div className="dashT-kpi-grid">
        <div className="dashT-kpi-card dashT-kpi-card--blue">
          <div className="dashT-kpi-header">
            <div className="dashT-kpi-header-left">
              <div className="dashT-kpi-icon ic-blue">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="12" y1="1" x2="12" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </div>
              <div className="dashT-kpi-label dashT-kpi-label--top">Today&apos;s Revenue</div>
            </div>
          </div>
          <div className="dashT-kpi-value dashT-kpi-value--top">
            {formatMoneyAmount(kpiToday?.sales_total ?? 0, DEFAULT_CURRENCY_CODE)}
          </div>
          <div className="dashT-kpi-sub">
            {(kpiToday?.invoices_count ?? 0)} invoices · THB equivalent (by exchange rates)
            {overview?.business_today ? ` · ${overview.business_today}` : ''}
          </div>
        </div>

        <div className="dashT-kpi-card dashT-kpi-card--green">
          <div className="dashT-kpi-header">
            <div className="dashT-kpi-header-left">
              <div className="dashT-kpi-icon ic-green">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="2" />
                  <path d="M16 10a4 4 0 01-8 0" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </div>
              <div className="dashT-kpi-label dashT-kpi-label--top">Items sold (today)</div>
            </div>
          </div>
          <div className="dashT-kpi-value dashT-kpi-value--top">{itemsSoldToday}</div>
          <div className="dashT-kpi-sub">Sum of line quantities on today&apos;s invoices</div>
        </div>

        <div className="dashT-kpi-card dashT-kpi-card--red">
          <div className="dashT-kpi-header">
            <div className="dashT-kpi-header-left">
              <div className="dashT-kpi-icon ic-amber">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="1" y="4" width="22" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                  <line x1="1" y1="10" x2="23" y2="10" stroke="currentColor" strokeWidth="2" />
                </svg>
              </div>
              <div className="dashT-kpi-label dashT-kpi-label--top">Outstanding Balance</div>
            </div>

            <div className="dashT-kpi-warning-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 9v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 17h.01" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                <path d="M10.29 3.86 1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          <div className="dashT-kpi-value dashT-kpi-value--top">
            {formatMoneyAmount(kpiOutstanding, DEFAULT_CURRENCY_CODE)}
          </div>
          <div className="dashT-kpi-sub">
            Across {kpiOutstandingInvoiceCount} invoice{kpiOutstandingInvoiceCount === 1 ? '' : 's'} with a balance (all time)
          </div>
        </div>

        <div className="dashT-kpi-card dashT-kpi-card--purple">
          <div className="dashT-kpi-header">
            <div className="dashT-kpi-header-left">
              <div className="dashT-kpi-icon ic-purple">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" fill="none" stroke="currentColor" strokeWidth="2" />
                  <polyline points="14 2 14 8 20 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="dashT-kpi-label dashT-kpi-label--top">Open Memos</div>
            </div>
          </div>
          <div className="dashT-kpi-value dashT-kpi-value--top">{openMemosCount}</div>
          <div className="dashT-kpi-sub">{memosDueSoon} with due date in the next 3 days</div>
        </div>
      </div>

      <div className="dashT-quick">
        <div className="dashT-qa-title">Quick Actions</div>
        <div className="dashT-qa-grid">
          {navBtns.map(btn => (
            <div key={btn.page} className="dashT-qa-btn" role="button" tabIndex={0} onClick={() => onNavigate?.(btn.page)} title={btn.label}>
              <div className="dashT-qa-icon" aria-hidden="true">
                <QuickIcon page={btn.page} />
              </div>
              <div className="dashT-qa-text">{btn.label}</div>
            </div>
          ))}
        </div>
      </div>

      {loading && <div className="reports-empty">Loading dashboard…</div>}
      {error && <div className="reports-error">{error}</div>}

      {!loading && !error && (
        <>
          <div className="dashT-row-main">
            <div className="dashT-card">
              <div className="dashT-card-head">
                <div>
                  <div className="dashT-card-title">Recent Invoices</div>
                  <div className="dashT-card-subtitle">Latest transactions today</div>
                </div>
                <span className="dashT-card-link">View all →</span>
              </div>
              <div className="dashT-card-body">
                <div className="dashT-table-wrap">
                  <table className="dashT-inv-table">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Customer</th>
                        <th>Items</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th style={{ textAlign: 'right' }}>Balance</th>
                        <th style={{ textAlign: 'center' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentInvoices.length ? (
                        recentInvoices.map(inv => {
                          const remaining = Math.max(0, Number(inv.total) - Number(inv.paid));
                          const items = invoiceItemsCount[inv.id];
                          const statusClass = inv.status === 'Paid' ? 'st-paid' : inv.status === 'Partial' ? 'st-partial' : 'st-unpaid';
                          const statusColor =
                            inv.status === 'Paid' ? 'var(--fg-muted)' : inv.status === 'Partial' ? 'var(--warning)' : 'var(--danger)';
                          return (
                            <tr key={inv.id}>
                              <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{`#${inv.invoice_no}`}</td>
                              <td style={{ color: '#0b0b0b', fontWeight: 600 }}>
                                {inv.customer_name || 'Walk-in customer'}
                              </td>
                              <td style={{ color: '#0b0b0b', fontWeight: 600 }}>
                                {typeof items === 'number' ? `${items} pcs` : '—'}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 600, color: '#0b0b0b' }}>
                                {formatMoneyAmount(inv.total, inv.currency_code || DEFAULT_CURRENCY_CODE)}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 600, color: inv.status === 'Paid' ? 'var(--fg-muted)' : statusColor }}>
                                {inv.status === 'Paid'
                                  ? '—'
                                  : formatMoneyAmount(remaining, inv.currency_code || DEFAULT_CURRENCY_CODE)}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span className={`dashT-status-tag ${statusClass}`}>{inv.status}</span>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={6} className="reports-empty">
                            No invoices today.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="dashT-card">
              <div className="dashT-card-head">
                <div>
                  <div className="dashT-card-title">Recent Activity</div>
                  <div className="dashT-card-subtitle">Live system events</div>
                </div>
              </div>
              <div className="dashT-card-body">
                <div className="dashT-feed">
                  {latestFeed.length ? (
                    latestFeed.slice(0, 6).map(item => {
                      const t = item.type || '';
                      const isRestock = t === 'RESTOCK';
                      const isMemoOut = t === 'MEMO_OUT';
                      const isMemoReturn = t === 'MEMO_RETURN';
                      const isSaleReturn = t === 'SALE_RETURN';
                      const dotColor = isRestock ? 'var(--success)' : isMemoOut ? 'var(--accent)' : isMemoReturn ? 'var(--section-list)' : isSaleReturn ? 'var(--danger)' : 'var(--warning)';
                      const msg = isRestock
                        ? `Restocked ${item.item_code || 'item'} — +${Math.abs(item.qty_change)} pcs added`
                        : isMemoOut
                          ? `Memo created — ${item.item_code || 'item'} moved to memo`
                          : isMemoReturn
                            ? `Memo return — ${item.item_code || 'item'} returned`
                            : isSaleReturn
                              ? `Return processed — ${item.item_code || 'item'} restocked`
                              : `${item.type || 'UPDATE'}: ${item.note || ''}`;
                      return (
                        <div key={item.id} className="dashT-feed-item">
                          <div className="dashT-feed-dot-wrap">
                            <div className="dashT-feed-dot" style={{ background: dotColor }} />
                            <div className="dashT-feed-line" />
                          </div>
                          <div className="dashT-feed-content">
                            <div className="dashT-feed-msg">
                              <strong>{item.type || 'Event'}</strong> {msg.replace(`${item.type || 'Event'}`, '').trim()}
                            </div>
                            <div className="dashT-feed-time">
                              {formatRelative(item.created_at)} · {item.user_name || '—'}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="reports-empty">No activity yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="dashT-row-lower">
            <div className="dashT-card">
              <div className="dashT-card-head">
                <div>
                  <div className="dashT-card-title">Revenue This Week</div>
                  <div className="dashT-card-subtitle">Daily sales · THB (converted)</div>
                </div>
              </div>
              <div className="dashT-card-body">
                <RevenueWeekChart rows={weekRows} />
              </div>
            </div>

            <div className="dashT-card">
              <div className="dashT-card-head">
                <div>
                  <div className="dashT-card-title">Low Stock Alerts</div>
                  <div className="dashT-card-subtitle">Items with ≤ 2 pcs remaining</div>
                </div>
              </div>
              <div className="dashT-card-body">
                <div className="dashT-stock-list">
                  {stockAlerts.length ? (
                    stockAlerts.map(item => {
                      const code = item.item_code || item.item_sticker || `${item.category} ${item.item_type}`;
                      const pcs = typeof item.pieces_remaining === 'number' ? item.pieces_remaining : 0;
                      return (
                        <div key={item.id} className="dashT-stock-row">
                          <div className="dashT-stock-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                              <polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5" fill="none" stroke="currentColor" strokeWidth="2" />
                            </svg>
                          </div>
                          <div className="dashT-stock-info">
                            <div className="dashT-stock-name">{code}</div>
                            <div className="dashT-stock-cat">{item.category}</div>
                          </div>
                          <div className="dashT-stock-pcs">
                            {pcs} <span>pc left</span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="reports-empty">No low-stock items.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="dashT-card">
              <div className="dashT-card-head">
                <div>
                  <div className="dashT-card-title">Open Memos</div>
                  <div className="dashT-card-subtitle">Items out on approval</div>
                </div>
              </div>
              <div className="dashT-card-body">
                <div className="dashT-memo-list">
                  {memos.length ? (
                    memos.map(m => {
                      const now = Date.now();
                      const due = m.due_date ? new Date(m.due_date).getTime() : null;
                      const daysLeft = due ? Math.ceil((due - now) / (24 * 60 * 60 * 1000)) : null;
                      const cls =
                        m.status === 'Closed'
                          ? ''
                          : daysLeft == null
                            ? ''
                            : daysLeft < 0
                              ? 'due-overdue'
                              : daysLeft <= 3
                                ? 'due-soon'
                                : 'due-open';
                      return (
                        <div key={m.id} className={`dashT-memo-row ${cls}`} role="button" tabIndex={0} title={m.memo_no}>
                          <div className="dashT-memo-info">
                            <div className="dashT-memo-id">{m.memo_no}</div>
                            <div className="dashT-memo-cust">{m.customer_name || '—'}</div>
                            <div className="dashT-memo-due">
                              {m.due_date ? `Due: ${m.due_date} · ${m.items_count} pcs` : `Due: — · ${m.items_count} pcs`}
                            </div>
                          </div>
                          <div
                            className={`dashT-memo-tag ${
                              m.status === 'Closed'
                                ? 'mt-open'
                                : cls.includes('overdue')
                                  ? 'mt-overdue'
                                  : cls.includes('soon')
                                    ? 'mt-soon'
                                    : 'mt-open'
                            }`}
                          >
                            {m.status === 'Closed'
                              ? 'Converted'
                              : cls.includes('overdue')
                                ? 'Overdue'
                                : cls.includes('soon')
                                  ? 'Due Soon'
                                  : 'Open'}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="reports-empty">No open memos.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

