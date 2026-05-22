import { useEffect, useMemo, useRef, useState } from 'react';
import { readDoc } from '../firebase';

/** YYYY-MM-DD plus delta calendar days (stable UTC date arithmetic). */
function addCalendarDaysYmd(ymd: string, deltaDays: number): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

interface DashOverview {
  /** Sync setting used for dashboard trend SQL window (may be narrower than the UI range). */
  days?: number;
  trend_range_ymd?: { from: string; to: string };
  todaySales: {
    invoices_count: number;
    sales_total: number;
    collected_total: number;
    outstanding_total: number;
    paid_invoices: number;
    partial_invoices: number;
    unpaid_invoices: number;
  };
  items_sold_today: number;
  outstanding_all: { outstanding_total: number; invoice_count: number };
  memos_summary: { open_count: number; due_within_3_days: number };
  trends: { sales: { period: string; sales_total: number }[] };
  latest_stock_movements: {
    id: number; type: string; qty_change: number; note: string;
    created_at: string; user_name: string; item_code: string; item_sticker: string;
  }[];
  syncedAt: string;
}

interface Rates { thb_per_unit: Record<string, number> }

function fmtUsd(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function relTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  if (h >= 17 && h < 22) return 'Good evening';
  return 'Good night';
}

const moveColor: Record<string, string> = {
  SALE: 'var(--c-blue)', INVOICE_RETURN: 'var(--c-green)',
  MEMO_OUT: 'var(--c-orange)', MEMO_RETURN: 'var(--c-green)',
  MEMO_VOID: 'var(--c-red)', SHRINKAGE: 'var(--c-red)',
  INVENTORY_EDIT: 'var(--c-orange)', RESTOCK: 'var(--c-green)',
};

const moveLabel: Record<string, string> = {
  SALE: 'SALE', INVOICE_RETURN: 'RETURN', MEMO_OUT: 'MEMO_OUT',
  MEMO_RETURN: 'MEMO_RETURN', MEMO_VOID: 'MEMO_VOID',
  SHRINKAGE: 'SHRINKAGE', INVENTORY_EDIT: 'EDIT', RESTOCK: 'RESTOCK',
};

const PERIODS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '1Y', days: 365 },
];

interface Props { onSyncedAt: (s: string) => void }

export function DashboardPage({ onSyncedAt }: Props) {
  const [data, setData] = useState<DashOverview | null>(null);
  const [usdRate, setUsdRate] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [period, setPeriod] = useState(30);
  const chartRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    Promise.all([
      readDoc<DashOverview>('dashboardOverview'),
      readDoc<Rates>('exchangeRates'),
    ])
      .then(([d, r]) => {
        setData(d);
        onSyncedAt(d.syncedAt);
        setUsdRate(r.thb_per_unit?.USD || 1);
      })
      .catch(e => setErr(e.message));
  }, [onSyncedAt]);

  const chartData = useMemo(() => {
    if (!data?.trends?.sales?.length) return [];
    const sales = data.trends.sales;
    const sorted = [...sales].sort((a, b) => String(a.period).localeCompare(String(b.period)));

    const endYmd =
      (data.trend_range_ymd?.to || '').slice(0, 10) ||
      String(sorted[sorted.length - 1]?.period || '').slice(0, 10) ||
      new Date().toISOString().slice(0, 10);

    const startYmd = addCalendarDaysYmd(endYmd, -(period - 1));

    return sorted.filter(r => {
      const p = String(r.period).slice(0, 10);
      return p >= startYmd && p <= endYmd;
    });
  }, [data, period]);

  useEffect(() => {
    const svg = chartRef.current;
    if (!svg || chartData.length === 0) return;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const W = 340, H = 130, pL = 8, pR = 8, pT = 14, pB = 28;
    const plotW = W - pL - pR, plotH = H - pT - pB;
    const vals = chartData.map(d => d.sales_total / usdRate);
    const max = Math.max(...vals, 1);
    const n = vals.length;
    const step = plotW / Math.max(n - 1, 1);
    const xAt = (i: number) => pL + i * step;
    const yAt = (v: number) => pT + (1 - v / max) * plotH;
    const baseY = pT + plotH;

    const gridCol = isDark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)';
    const tickCol = isDark ? '#5A5046' : '#B0A397';
    const areaTop = isDark ? 'rgba(201,169,110,.18)' : 'rgba(201,169,110,.22)';

    const pts = vals.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');
    const areaPath = `M${xAt(0)},${baseY} ` +
      vals.map((v, i) => `L${xAt(i)},${yAt(v)}`).join(' ') +
      ` L${xAt(n - 1)},${baseY} Z`;

    const showDots = n <= 14;
    const tickSteps = [.25, .5, .75, 1];

    svg.innerHTML = `
      <defs>
        <linearGradient id="aG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${areaTop}"/>
          <stop offset="100%" stop-color="rgba(201,169,110,0)"/>
        </linearGradient>
      </defs>
      <line x1="${pL}" y1="${baseY}" x2="${W - pR}" y2="${baseY}" stroke="${gridCol}" stroke-width="1"/>
      ${tickSteps.map(f => {
        const y = yAt(f * max);
        return `<line x1="${pL}" x2="${W - pR}" y1="${y}" y2="${y}" stroke="${gridCol}" stroke-width="1" stroke-dasharray="3 3"/>
                <text x="${pL}" y="${y - 3}" font-size="9" fill="${tickCol}" font-family="DM Sans,sans-serif">$${(f * max / 1000).toFixed(1)}k</text>`;
      }).join('')}
      <path d="${areaPath}" fill="url(#aG)"/>
      <polyline points="${pts}" fill="none" stroke="#C9A96E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${showDots ? vals.map((v, i) =>
        `<circle cx="${xAt(i)}" cy="${yAt(v)}" r="3.5" fill="var(--bg-card)" stroke="#C9A96E" stroke-width="2"/>`
      ).join('') : ''}
    `;
  }, [chartData, usdRate]);

  if (err) return <div className="page-msg page-msg--err">{err}</div>;
  if (!data) return <div className="page-msg"><div className="spinner" /></div>;

  const toUsd = (thb: number) => usdRate > 0 ? thb / usdRate : thb;

  const syncDate = data.syncedAt ? new Date(data.syncedAt).toDateString() : '';
  const isToday = syncDate === new Date().toDateString();

  const ts = isToday
    ? data.todaySales
    : { invoices_count: 0, sales_total: 0, collected_total: 0, outstanding_total: 0, paid_invoices: 0, partial_invoices: 0, unpaid_invoices: 0 };
  const itemsSold = isToday ? data.items_sold_today : 0;
  const oa = data.outstanding_all;
  const mm = data.memos_summary;

  return (
    <div className="page">
      <div className="greeting-block">
        <div className="greeting-line">{greeting()}, <span className="greeting-em">Owner</span></div>
        <div className="greeting-sub">Here's what's happening with your gem shop today</div>
      </div>

      <div className="period-tabs" role="tablist">
        {PERIODS.map(p => (
          <button
            type="button"
            key={p.days}
            className={`period-tab${period === p.days ? ' active' : ''}`}
            aria-selected={period === p.days}
            onClick={() => setPeriod(p.days)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="kpi-grid">
        <div className="kpi-card kpi-blue">
          <div className="kpi-icon">
            <svg viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
          </div>
          <div className="kpi-label">{isToday ? 'Sales Today' : 'Sales (last sync)'}</div>
          <div className="kpi-value">{fmtUsd(toUsd(ts.sales_total))}</div>
          <div className="kpi-trend kpi-trend--flat">
            {isToday
              ? `${ts.invoices_count} invoice${ts.invoices_count !== 1 ? 's' : ''}`
              : 'Sync to update'}
          </div>
        </div>

        <div className="kpi-card kpi-green">
          <div className="kpi-icon">
            <svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <div className="kpi-label">{isToday ? 'Items Sold' : 'Items Sold (last sync)'}</div>
          <div className="kpi-value">{itemsSold}</div>
          <div className="kpi-trend kpi-trend--flat">
            {isToday
              ? `${ts.paid_invoices} paid today`
              : 'Sync to update'}
          </div>
        </div>

        <div className="kpi-card kpi-orange">
          <div className="kpi-icon">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div className="kpi-label">Outstanding</div>
          <div className="kpi-value">{fmtUsd(toUsd(oa.outstanding_total))}</div>
          <div className="kpi-trend kpi-trend--red">
            <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
            {oa.invoice_count} invoices owed
          </div>
        </div>

        <div className="kpi-card kpi-rose">
          <div className="kpi-icon">
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="13" x2="12" y2="17"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
          </div>
          <div className="kpi-label">Open Memos</div>
          <div className="kpi-value">{mm.open_count}</div>
          <div className={`kpi-trend ${mm.due_within_3_days > 0 ? 'kpi-trend--red' : 'kpi-trend--flat'}`}>
            {mm.due_within_3_days > 0 && (
              <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
            )}
            {mm.due_within_3_days > 0 ? `${mm.due_within_3_days} due in 3 days` : 'No urgent memos'}
          </div>
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="sec-card">
          <div className="sec-head">
            <div>
              <div className="sec-title">Revenue Trend</div>
              <div className="sec-sub">
                Last {period} days · daily sales (USD)
                {typeof data.days === 'number' && period > data.days && (
                  <span className="sec-sub-note"> · sync holds {data.days}d</span>
                )}
              </div>
            </div>
          </div>
          <div className="sec-body">
            <div className="chart-wrap">
              <svg ref={chartRef} viewBox="0 0 340 130" preserveAspectRatio="none" />
            </div>
          </div>
        </div>
      )}

      {data.latest_stock_movements.length > 0 && (
        <div className="sec-card">
          <div className="sec-head">
            <div>
              <div className="sec-title">Recent Activity</div>
              <div className="sec-sub">Live system events</div>
            </div>
          </div>
          <div className="sec-body">
            <div className="feed-list">
              {data.latest_stock_movements.slice(0, 8).map((m, i, arr) => (
                <div key={m.id} className="feed-item">
                  <div className="feed-track">
                    <div className="feed-dot" style={{ background: moveColor[m.type] || 'var(--text-xs)' }} />
                    {i < arr.length - 1 && <div className="feed-vline" />}
                  </div>
                  <div className="feed-content">
                    <div className="feed-msg">
                      <strong>{moveLabel[m.type] || m.type}</strong>{' '}
                      {m.item_code || m.item_sticker}{m.note ? ` — ${m.note}` : ''}{' '}
                      ({m.qty_change > 0 ? '+' : ''}{m.qty_change} pcs)
                    </div>
                    <div className="feed-time">{relTime(m.created_at)} · {m.user_name || 'System'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
