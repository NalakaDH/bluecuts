import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { readDoc, monthlyDocId } from '../firebase';

/* ── Interfaces ──────────────────────────────────────── */

interface MonthlyItem {
  id?: number;
  item_code: string;
  category: string;
  item_type: string;
  description?: string;
  opening: number;
  sold: number;
  returned: number;
  shrinkage: number;
  restocked: number;
  remaining: number;
  memo_out_qty: number;
  memo_item_notes?: string;
  unit_price?: number | null;
  selling_currency?: string;
  revenue_usd: number;
  stock_value_usd: number;
  status: string;
}

interface MonthlySummary {
  totalSold: number;
  totalReturned: number;
  totalRevenueUsd: number;
  stockValueUsd: number;
  stockValue?: number;
  noMovement: number;
  totalShrinkage: number;
  outOfStock: number;
}

interface MonthlyDoc {
  year: number;
  month: number;
  items: MonthlyItem[];
  summary: MonthlySummary | null;
  syncedAt: string;
}

/* ── Helpers ─────────────────────────────────────────── */

function fmt(n: number) { return n.toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function fmtPrice(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${fmt(n)}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Seg = 'all' | 'top' | 'none' | 'low' | 'shrinkage';
type SortKey = 'sold-desc' | 'sold-asc' | 'remaining-asc' | 'remaining-desc' | 'revenue-desc' | 'shrinkage-desc' | 'name-asc';

type SheetPicker = null | 'category' | 'sort';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'sold-desc', label: 'Most sold' },
  { value: 'sold-asc', label: 'Least sold' },
  { value: 'remaining-asc', label: 'Lowest stock' },
  { value: 'remaining-desc', label: 'Highest stock' },
  { value: 'revenue-desc', label: 'Highest revenue' },
  { value: 'shrinkage-desc', label: 'Shrinkage first' },
  { value: 'name-asc', label: 'Code A→Z' },
];

function badgeFor(item: MonthlyItem): { label: string; cls: string } {
  if (item.shrinkage > 0) return { label: 'Shrinkage', cls: 'badge-shrink' };
  if (item.remaining === 0) return { label: 'Out of stock', cls: 'badge-out' };
  if (item.sold === 0) return { label: 'No sales', cls: 'badge-idle' };
  if (item.remaining <= 3) return { label: 'Low stock', cls: 'badge-low' };
  return { label: 'Active', cls: 'badge-active' };
}

/* ── SVG Icons ───────────────────────────────────────── */

const IconTrendUp = () => (
  <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
);
const IconArrowUp = () => (
  <svg viewBox="0 0 24 24"><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></svg>
);
const IconAlert = () => (
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" strokeWidth="2" strokeLinecap="round" />
    <line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="3" strokeLinecap="round" />
  </svg>
);
const IconBox = () => (
  <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
);
const IconRefresh = () => (
  <svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
);
const IconBan = () => (
  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
);

/* ── Stat Pill Component ─────────────────────────────── */

function StatPill({ val, label, cls = '' }: { val: string | number; label: string; cls?: string }) {
  return (
    <div className="stat-pill">
      <div className={`stat-val ${cls}`}>{val}</div>
      <div className="stat-lbl">{label}</div>
    </div>
  );
}

/* ── Item Card Component ─────────────────────────────── */

function ItemCard({ item, expanded, onToggle }: { item: MonthlyItem; expanded: boolean; onToggle: () => void }) {
  const b = badgeFor(item);
  const soldCls = item.sold > 5 ? 'pos' : item.sold === 0 ? 'muted' : '';
  const remCls = item.remaining === 0 ? 'neg' : item.remaining <= 3 ? 'warn' : '';

  return (
    <div
      className={`item-card${expanded ? ' expanded' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      <div className="item-card-r1">
        <div className="item-code">{item.item_code}</div>
        <span className={`item-badge ${b.cls}`}>{b.label}</span>
      </div>
      <div className="item-name">
        {item.category}{item.item_type ? ` · ${item.item_type}` : ''}
      </div>
      <div className="stat-row">
        <StatPill val={item.sold} label="Sold" cls={soldCls} />
        <StatPill val={item.remaining} label="Left" cls={remCls} />
        {item.restocked > 0 && <StatPill val={`+${item.restocked}`} label="Restock" cls="pos" />}
        {item.shrinkage > 0 && <StatPill val={`−${item.shrinkage}`} label="Shrink" cls="neg" />}
        {item.memo_out_qty > 0 && <StatPill val={item.memo_out_qty} label="Memo" cls="warn" />}
        {item.returned > 0 && <StatPill val={item.returned} label="Return" cls="warn" />}
      </div>

      <div className="item-detail">
        <div className="detail-grid">
          <div className="detail-cell">
            <div className="detail-label">Unit Price</div>
            <div className="detail-val price">{fmtPrice(item.unit_price)}</div>
          </div>
          <div className="detail-cell">
            <div className="detail-label">Revenue (USD)</div>
            <div className={`detail-val price${item.revenue_usd === 0 ? ' muted' : ''}`}>
              {item.revenue_usd > 0 ? `$${fmt(item.revenue_usd)}` : '—'}
            </div>
          </div>
          <div className="detail-cell">
            <div className="detail-label">Stock Value</div>
            <div className={`detail-val price${item.stock_value_usd === 0 ? ' muted' : ''}`}>
              {item.stock_value_usd > 0 ? `$${fmt(item.stock_value_usd)}` : '—'}
            </div>
          </div>
          <div className="detail-cell">
            <div className="detail-label">Opening Stock</div>
            <div className="detail-val">{item.opening} pcs</div>
          </div>
          <div className="detail-cell">
            <div className="detail-label">Type / Cut</div>
            <div className="detail-val">{item.item_type || '—'}</div>
          </div>
          <div className="detail-cell">
            <div className="detail-label">Category</div>
            <div className="detail-val">{item.category || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────── */

export function MonthlyReportPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<MonthlyDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [mCodeOnly, setMCodeOnly] = useState(false);
  const [seg, setSeg] = useState<Seg>('all');
  const [sortKey, setSortKey] = useState<SortKey>('sold-desc');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [picker, setPicker] = useState<SheetPicker>(null);
  const [catSearch, setCatSearch] = useState('');
  const pickerTouchY = useRef(0);

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true);
    setErr(null);
    try {
      const d = await readDoc<MonthlyDoc>(monthlyDocId(y, m));
      setData(d);
    } catch (e: any) {
      setErr(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(year, month); }, [year, month, load]);

  const prev = () => {
    setExpandedId(null); setSearch(''); setSeg('all'); setCatFilter('all'); setMCodeOnly(false);
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };

  const next = () => {
    setExpandedId(null); setSearch(''); setSeg('all'); setCatFilter('all'); setMCodeOnly(false);
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();

  const categories = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.items.map(i => i.category).filter(Boolean))).sort();
  }, [data]);

  const allItems = data?.items ?? [];

  const mCodeCount = useMemo(() => {
    return allItems.filter(i => (i.item_code || '').toUpperCase().includes('M')).length;
  }, [allItems]);

  const filteredCategoriesForPicker = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(c => c.toLowerCase().includes(q));
  }, [categories, catSearch]);

  const categoryTriggerLabel = catFilter === 'all' ? 'All categories' : catFilter;
  const sortTriggerLabel = SORT_OPTIONS.find(o => o.value === sortKey)?.label ?? 'Sort';

  useEffect(() => {
    if (!picker) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicker(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker]);

  const segCounts = useMemo(() => ({
    all: allItems.length,
    top: allItems.filter(i => i.sold > 0).length,
    none: allItems.filter(i => i.sold === 0 && i.returned === 0).length,
    low: allItems.filter(i => i.remaining > 0 && i.remaining <= 3).length,
    shrinkage: allItems.filter(i => i.shrinkage > 0).length,
  }), [allItems]);

  const filtered = useMemo(() => {
    let list = [...allItems];

    if (catFilter !== 'all') list = list.filter(i => i.category === catFilter);
    if (mCodeOnly) list = list.filter(i => (i.item_code || '').toUpperCase().includes('M'));

    const q = search.trim().toLowerCase();
    if (q) list = list.filter(i =>
      [i.item_code, i.category, i.item_type].join(' ').toLowerCase().includes(q)
    );

    if (seg === 'top') list = list.filter(i => i.sold > 0);
    else if (seg === 'none') list = list.filter(i => i.sold === 0 && i.returned === 0);
    else if (seg === 'low') list = list.filter(i => i.remaining > 0 && i.remaining <= 3);
    else if (seg === 'shrinkage') list = list.filter(i => i.shrinkage > 0);

    const [sk, dir] = sortKey.split('-') as [string, string];
    list.sort((a, b) => {
      let av: number, bv: number;
      switch (sk) {
        case 'sold': av = a.sold; bv = b.sold; break;
        case 'remaining': av = a.remaining; bv = b.remaining; break;
        case 'revenue': av = a.revenue_usd; bv = b.revenue_usd; break;
        case 'shrinkage': av = a.shrinkage; bv = b.shrinkage; break;
        case 'name': return dir === 'asc' ? a.item_code.localeCompare(b.item_code) : b.item_code.localeCompare(a.item_code);
        default: av = a.sold; bv = b.sold;
      }
      return dir === 'asc' ? av - bv : bv - av;
    });

    if (seg === 'top') list = list.slice(0, 10);

    return list;
  }, [allItems, catFilter, mCodeOnly, search, seg, sortKey]);

  const s = data?.summary;

  return (
    <div className="page">
      {/* Page header */}
      <div className="page-header">
        <div className="page-title">Monthly</div>
      </div>

      {/* Month navigator */}
      <div className="month-nav-row">
        <button className="month-nav-btn" onClick={prev} aria-label="Previous month">
          <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div className="month-display">
          <div className="month-label">{MONTHS[month - 1]} {year}</div>
          <div className="month-sub">{year}-{pad(month)}-01 &rarr; {year}-{pad(month)}-{pad(lastDay)}</div>
        </div>
        <button className="month-nav-btn" onClick={next} aria-label="Next month">
          <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>

      {loading && <div className="page-msg"><div className="spinner" /></div>}
      {err && !loading && <div className="page-msg page-msg--err">{err}</div>}

      {s && !loading && (
        <>
          {/* KPI Grid */}
          <div className="kpi-grid">
            <div className="kpi-card kpi-blue">
              <div className="kpi-icon"><IconTrendUp /></div>
              <div className="kpi-label">Net Sold</div>
              <div className="kpi-value">{fmt(s.totalSold)}</div>
              <div className="kpi-sub">units this month</div>
            </div>

            <div className="kpi-card kpi-green">
              <div className="kpi-icon"><IconArrowUp /></div>
              <div className="kpi-label">Revenue</div>
              <div className="kpi-value">${fmt(s.totalRevenueUsd)}</div>
              <div className="kpi-sub">USD &middot; all items</div>
            </div>

            <div className="kpi-card kpi-orange">
              <div className="kpi-icon"><IconAlert /></div>
              <div className="kpi-label">No Activity</div>
              <div className="kpi-value warn">{s.noMovement}</div>
              <div className="kpi-sub">no sales or returns</div>
            </div>

            <div className="kpi-card kpi-orange">
              <div className="kpi-icon"><IconBox /></div>
              <div className="kpi-label">Stock Value</div>
              <div className="kpi-value">${fmt(s.stockValueUsd ?? s.stockValue ?? 0)}</div>
              <div className="kpi-sub">remaining &times; price</div>
            </div>

            <div className="kpi-card kpi-red">
              <div className="kpi-icon"><IconRefresh /></div>
              <div className="kpi-label">Shrinkage</div>
              <div className="kpi-value danger">{s.totalShrinkage}</div>
              <div className="kpi-sub">units lost / missing</div>
            </div>

            <div className="kpi-card kpi-slate">
              <div className="kpi-icon"><IconBan /></div>
              <div className="kpi-label">Out of Stock</div>
              <div className="kpi-value">{s.outOfStock}</div>
              <div className="kpi-sub">items depleted</div>
            </div>
          </div>

          {/* Search */}
          <div className="m-search-wrap">
            <div className="m-search-ico">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </div>
            <input
              type="search"
              className="m-search-input"
              placeholder="Search by code, type, or category…"
              value={search}
              onChange={e => { setSearch(e.target.value); setExpandedId(null); }}
              autoComplete="off"
            />
          </div>

          {/* Category picker (bottom sheet — avoids native full-screen select on mobile) */}
          <div className="m-filter-controls">
            <div className="m-category-wrap">
              <button
                type="button"
                className="pill-select-btn"
                aria-expanded={picker === 'category'}
                aria-haspopup="dialog"
                aria-label={`Category: ${categoryTriggerLabel}. Tap to change.`}
                onClick={() => {
                  setCatSearch('');
                  setExpandedId(null);
                  setPicker(p => p === 'category' ? null : 'category');
                }}
              >
                {categoryTriggerLabel}
              </button>
            </div>
            <button
              type="button"
              className={`m-code-filter-btn${mCodeOnly ? ' active' : ''}`}
              aria-pressed={mCodeOnly}
              aria-label={mCodeOnly ? 'Show all item codes' : 'Show only items with letter M in code'}
              onClick={() => { setMCodeOnly(p => !p); setExpandedId(null); }}
            >
              <span>M in code</span>
              <span className="m-code-badge">{mCodeCount}</span>
            </button>
          </div>

          {/* Segment tabs */}
          <div className="seg-tabs">
            {([
              { id: 'all' as Seg, label: 'All items', count: segCounts.all },
              { id: 'top' as Seg, label: 'Top sellers', count: segCounts.top },
              { id: 'none' as Seg, label: 'No activity', count: segCounts.none },
              { id: 'low' as Seg, label: 'Low stock', count: segCounts.low },
              { id: 'shrinkage' as Seg, label: 'Shrinkage', count: segCounts.shrinkage },
            ]).map(t => (
              <button
                key={t.id}
                className={`seg-tab${seg === t.id ? ' active' : ''}`}
                onClick={() => { setSeg(t.id); setExpandedId(null); }}
              >
                {t.label} <span className="seg-count">{t.count}</span>
              </button>
            ))}
          </div>

          {/* Result meta + sort */}
          <div className="list-meta">
            <span className="result-count">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
            <button
              type="button"
              className="pill-select-btn pill-select-btn--inline"
              aria-expanded={picker === 'sort'}
              aria-haspopup="dialog"
              aria-label={`Sort: ${sortTriggerLabel}. Tap to change.`}
              onClick={() => setPicker(p => p === 'sort' ? null : 'sort')}
            >
              {sortTriggerLabel}
            </button>
          </div>

          {/* Item list */}
          <div className="sec-card">
            {filtered.length === 0 && (
              <div className="empty-state">
                <svg viewBox="0 0 24 24"><polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5" /><line x1="12" y1="2" x2="12" y2="22" /><line x1="2" y1="8.5" x2="22" y2="8.5" /></svg>
                No items match your filters
              </div>
            )}
            {filtered.map(item => (
              <ItemCard
                key={item.id ?? item.item_code}
                item={item}
                expanded={expandedId === (item.id ?? null)}
                onToggle={() => setExpandedId(prev => prev === (item.id ?? null) ? null : (item.id ?? null))}
              />
            ))}
          </div>
        </>
      )}

      {createPortal(
        <>
          <div
            className={`sheet-backdrop${picker ? ' open' : ''}`}
            onClick={() => setPicker(null)}
            aria-hidden={!picker}
          />
          <div
            className={`detail-sheet${picker ? ' open' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={picker === 'category' ? 'Choose category' : picker === 'sort' ? 'Choose sort order' : undefined}
            onTouchStart={e => { pickerTouchY.current = e.touches[0].clientY; }}
            onTouchEnd={e => {
              if (e.changedTouches[0].clientY - pickerTouchY.current > 80) setPicker(null);
            }}
          >
            <div className="sheet-handle" />
            {picker === 'category' && (
              <>
                <div className="picker-sheet-head">
                  <h2 className="picker-sheet-title">Category</h2>
                  <button type="button" className="sheet-close" onClick={() => setPicker(null)} aria-label="Close">&times;</button>
                </div>
                <div className="picker-search-wrap">
                  <input
                    type="search"
                    className="picker-search-input"
                    placeholder="Search categories…"
                    value={catSearch}
                    onChange={e => setCatSearch(e.target.value)}
                    autoComplete="off"
                    enterKeyHint="search"
                  />
                </div>
                <div className="picker-sheet-scroll">
                  <button
                    type="button"
                    className={`picker-option${catFilter === 'all' ? ' selected' : ''}`}
                    onClick={() => { setCatFilter('all'); setExpandedId(null); setPicker(null); }}
                  >
                    <span>All categories</span>
                    {catFilter === 'all' && <span className="picker-check" aria-hidden>✓</span>}
                  </button>
                  {filteredCategoriesForPicker.length === 0 && (
                    <div className="empty-state" style={{ padding: '20px 16px', fontSize: 13 }}>No categories match</div>
                  )}
                  {filteredCategoriesForPicker.map(c => (
                    <button
                      key={c}
                      type="button"
                      className={`picker-option${catFilter === c ? ' selected' : ''}`}
                      onClick={() => { setCatFilter(c); setExpandedId(null); setPicker(null); }}
                    >
                      <span>{c}</span>
                      {catFilter === c && <span className="picker-check" aria-hidden>✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
            {picker === 'sort' && (
              <>
                <div className="picker-sheet-head">
                  <h2 className="picker-sheet-title">Sort by</h2>
                  <button type="button" className="sheet-close" onClick={() => setPicker(null)} aria-label="Close">&times;</button>
                </div>
                <div className="picker-sheet-scroll">
                  {SORT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`picker-option${sortKey === opt.value ? ' selected' : ''}`}
                      onClick={() => { setSortKey(opt.value); setPicker(null); }}
                    >
                      <span>{opt.label}</span>
                      {sortKey === opt.value && <span className="picker-check" aria-hidden>✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
