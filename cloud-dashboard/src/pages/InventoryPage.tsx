import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { readDoc } from '../firebase';

interface Item {
  id: number;
  category: string;
  item_type: string;
  item_code: string;
  description: string;
  pieces: number;
  pieces_remaining: number;
  weight_carats: number;
  purchasing_total_price: number;
  selling_total_price: number;
  selling_currency: string;
  status: string;
  updated_at: string;
}

interface ActivityEntry {
  shrink_units: number;
  memo_units: number;
  sold_units: number;
  last_activity: string | null;
  has_manual_edit: boolean;
}

const gemEmoji: Record<string, string> = {
  Diamond: '💎', Ruby: '🔴', Sapphire: '🔵', Emerald: '🟢',
  Amethyst: '🟣', Citrine: '🟡', Topaz: '🟠', Garnet: '🔴',
};

const catColor: Record<string, string> = {
  Diamond: '#3B7DD8', Ruby: '#DC2626', Sapphire: '#3B7DD8',
  Emerald: '#2E9E6B', Amethyst: '#7c3aed', Citrine: '#D97706',
  Topaz: '#D97706', Garnet: '#DC2626',
};

function healthOf(rem: number, total: number): 'healthy' | 'low' | 'critical' {
  if (rem === 0) return 'critical';
  const pct = rem / Math.max(total, 1);
  if (pct <= 0.2) return 'critical';
  if (pct <= 0.5) return 'low';
  return 'healthy';
}

function healthPct(rem: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((rem / total) * 100);
}

function statusInfo(item: Item, act?: ActivityEntry): { label: string; cls: string } {
  if (act && act.memo_units > 0) return { label: 'On Memo', cls: 'on-memo' };
  if (item.pieces_remaining === 0) return { label: 'Out of stock', cls: 'out-of-stock' };
  const h = healthOf(item.pieces_remaining, item.pieces);
  if (h === 'critical') return { label: 'Critical', cls: 'critical' };
  if (h === 'low') return { label: 'Low stock', cls: 'low' };
  return { label: 'Available', cls: 'available' };
}

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtPrice(n: number | undefined, currency: string): string {
  if (n == null || n === 0) return '—';
  if (currency === 'USD') return `$${n.toLocaleString()}`;
  return `${currency} ${n.toLocaleString()}`;
}

type StatusFilter = 'all' | 'available' | 'low' | 'critical' | 'out' | 'memo';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'available', label: 'Available' },
  { value: 'low', label: 'Low stock' },
  { value: 'critical', label: 'Critical' },
  { value: 'out', label: 'Out of stock' },
  { value: 'memo', label: 'On Memo' },
];

export function InventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [activity, setActivity] = useState<Record<string, ActivityEntry>>({});
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const statusPickerTouchY = useRef(0);

  useEffect(() => {
    readDoc('checkInventory')
      .then((d: any) => {
        setItems(d.items || []);
        setActivity(d.activity_summary || {});
      })
      .catch(e => setErr(e.message));
  }, []);

  const categories = useMemo(() => {
    const set = new Set(items.map(i => i.category).filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (catFilter !== 'all') list = list.filter(i => i.category === catFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        (i.item_code || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q) ||
        (i.item_type || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') {
      list = list.filter(i => {
        const act = activity[String(i.id)];
        const h = healthOf(i.pieces_remaining, i.pieces);
        switch (statusFilter) {
          case 'available': return i.pieces_remaining > 0 && h === 'healthy' && !(act && act.memo_units > 0);
          case 'low': return h === 'low';
          case 'critical': return h === 'critical' && i.pieces_remaining > 0;
          case 'out': return i.pieces_remaining === 0;
          case 'memo': return act ? act.memo_units > 0 : false;
          default: return true;
        }
      });
    }
    return list;
  }, [items, search, catFilter, statusFilter, activity]);

  const summary = useMemo(() => {
    let avail = 0, low = 0, out = 0;
    items.forEach(i => {
      if (i.pieces_remaining === 0) out++;
      else {
        const h = healthOf(i.pieces_remaining, i.pieces);
        if (h === 'healthy') avail++;
        else low++;
      }
    });
    return { total: items.length, avail, low, out };
  }, [items]);

  const openSheet = useCallback((id: number) => {
    setStatusPickerOpen(false);
    setSelectedId(id);
  }, []);
  const closeSheet = useCallback(() => { setSelectedId(null); }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (statusPickerOpen) {
        setStatusPickerOpen(false);
        return;
      }
      closeSheet();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [closeSheet, statusPickerOpen]);

  const selectedItem = selectedId != null ? items.find(i => i.id === selectedId) : null;
  const selectedAct = selectedItem ? activity[String(selectedItem.id)] : undefined;
  const statusTriggerLabel = STATUS_OPTIONS.find(o => o.value === statusFilter)?.label ?? 'All statuses';

  if (err) return <div className="page-msg page-msg--err">{err}</div>;
  if (!items.length) return <div className="page-msg"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Inventory</div>
        <div className="page-count-pill">{items.length} items</div>
      </div>

      <div className="summary-strip">
        <div className="summary-cell">
          <div className="summary-val">{summary.total}</div>
          <div className="summary-label">Total</div>
        </div>
        <div className="summary-cell">
          <div className="summary-val ok">{summary.avail}</div>
          <div className="summary-label">Available</div>
        </div>
        <div className="summary-cell">
          <div className="summary-val warn">{summary.low}</div>
          <div className="summary-label">Low / Crit</div>
        </div>
        <div className="summary-cell">
          <div className="summary-val bad">{summary.out}</div>
          <div className="summary-label">Out</div>
        </div>
      </div>

      <div className="search-wrap">
        <div className="search-ico">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>
        <input
          type="search"
          className="search-input"
          placeholder="Search by code, type, or description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="filter-row">
        {categories.map(c => (
          <button
            key={c}
            className={`filter-chip${catFilter === c ? ' active' : ''}`}
            onClick={() => setCatFilter(c)}
          >
            {c !== 'all' && (
              <span className="chip-dot" style={{ background: catColor[c] || 'var(--gold)' }} />
            )}
            {c === 'all' ? 'All' : c}
          </button>
        ))}
      </div>

      <div className="sort-bar">
        <span className="sort-label">Showing {filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
        <button
          type="button"
          className="pill-select-btn pill-select-btn--inline"
          aria-expanded={statusPickerOpen}
          aria-haspopup="dialog"
          aria-label={`Status filter: ${statusTriggerLabel}. Tap to change.`}
          onClick={() => setStatusPickerOpen(p => !p)}
        >
          {statusTriggerLabel}
        </button>
      </div>

      <div className="sec-card">
        {filtered.length === 0 && (
          <div className="empty-list">
            <svg viewBox="0 0 24 24"><polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5"/><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="8.5" x2="22" y2="8.5"/></svg>
            No items match your filters
          </div>
        )}
        {filtered.map(item => {
          const act = activity[String(item.id)];
          const emoji = gemEmoji[item.category] || '💎';
          const catCls = (item.category || '').toLowerCase().replace(/\s+/g, '') || 'other';
          const h = healthOf(item.pieces_remaining, item.pieces);
          const pct = healthPct(item.pieces_remaining, item.pieces);
          const st = statusInfo(item, act);
          const isSelected = selectedId === item.id;

          return (
            <div
              key={item.id}
              className={`inv-item${isSelected ? ' selected' : ''}`}
              onClick={() => openSheet(item.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSheet(item.id); } }}
            >
              <div className={`gem-ico ${catCls}`}>{emoji}</div>
              <div className="inv-info">
                <div className="inv-code">{item.item_code || '—'}</div>
                <div className="inv-name">
                  {[item.category, item.item_type].filter(Boolean).join(' · ')}
                </div>
                <div className="inv-meta">
                  {item.weight_carats ? `${item.weight_carats}ct · ` : ''}
                  Last: {act ? relTime(act.last_activity) : relTime(item.updated_at)}
                </div>
              </div>
              <div className="inv-right">
                <div className="inv-pcs">{item.pieces_remaining}</div>
                <div className="inv-pcs-label">/ {item.pieces} pcs</div>
                <div className="health-bar">
                  <div className={`health-fill ${h}`} style={{ width: `${pct}%` }} />
                </div>
                <span className={`status-badge status-${st.cls}`}>{st.label}</span>
              </div>
              {act && act.shrink_units > 0 && (
                <div className="shrink-flag">−{act.shrink_units} shrink</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Detail Sheet — rendered via portal to escape scroll container */}
      {createPortal(
        <>
          <div
            ref={backdropRef}
            className={`sheet-backdrop${selectedItem ? ' open' : ''}`}
            onClick={closeSheet}
          />
          <div
            ref={sheetRef}
            className={`detail-sheet${selectedItem ? ' open' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label="Item detail"
            onTouchStart={e => { touchStartY.current = e.touches[0].clientY; }}
            onTouchEnd={e => { if (e.changedTouches[0].clientY - touchStartY.current > 80) closeSheet(); }}
          >
            <div className="sheet-handle" />
            {selectedItem && (
              <div className="sheet-scroll">
                <SheetContent item={selectedItem} act={selectedAct} onClose={closeSheet} />
              </div>
            )}
          </div>
        </>,
        document.body
      )}

      {createPortal(
        <>
          <div
            className={`sheet-backdrop${statusPickerOpen ? ' open' : ''}`}
            onClick={() => setStatusPickerOpen(false)}
            aria-hidden={!statusPickerOpen}
          />
          <div
            className={`detail-sheet${statusPickerOpen ? ' open' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label="Choose status filter"
            onTouchStart={e => { statusPickerTouchY.current = e.touches[0].clientY; }}
            onTouchEnd={e => {
              if (e.changedTouches[0].clientY - statusPickerTouchY.current > 80) setStatusPickerOpen(false);
            }}
          >
            <div className="sheet-handle" />
            <div className="picker-sheet-head">
              <h2 className="picker-sheet-title">Status</h2>
              <button type="button" className="sheet-close" onClick={() => setStatusPickerOpen(false)} aria-label="Close">&times;</button>
            </div>
            <div className="picker-sheet-scroll">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`picker-option${statusFilter === opt.value ? ' selected' : ''}`}
                  onClick={() => {
                    setStatusFilter(opt.value);
                    setStatusPickerOpen(false);
                  }}
                >
                  <span>{opt.label}</span>
                  {statusFilter === opt.value && <span className="picker-check" aria-hidden>✓</span>}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function SheetContent({ item, act, onClose }: { item: Item; act?: ActivityEntry; onClose: () => void }) {
  const emoji = gemEmoji[item.category] || '💎';
  const catCls = (item.category || '').toLowerCase().replace(/\s+/g, '') || 'other';
  const h = healthOf(item.pieces_remaining, item.pieces);
  const pct = healthPct(item.pieces_remaining, item.pieces);
  const st = statusInfo(item, act);
  const hLabel = h.charAt(0).toUpperCase() + h.slice(1);

  return (
    <>
      <div className="sheet-head">
        <div className={`sheet-gem-icon gem-ico ${catCls}`}>{emoji}</div>
        <div className="sheet-title-block">
          <div className="sheet-code">{item.item_code || '—'}</div>
          <div className="sheet-name">{item.category || 'Item'}</div>
          <div className="sheet-sub">
            {[item.item_type, item.weight_carats ? `${item.weight_carats}ct` : '', item.description].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="field-grid">
        <div className="field-cell">
          <div className="field-label">Selling Price</div>
          <div className="field-val price">{fmtPrice(item.selling_total_price, item.selling_currency || 'THB')}</div>
        </div>
        <div className="field-cell">
          <div className="field-label">Purchase Price</div>
          <div className="field-val price">{fmtPrice(item.purchasing_total_price, item.selling_currency || 'THB')}</div>
        </div>
        <div className="field-cell">
          <div className="field-label">Total Pieces</div>
          <div className="field-val">{item.pieces}</div>
        </div>
        <div className="field-cell">
          <div className="field-label">Remaining</div>
          <div className={`field-val ${h === 'critical' ? 'bad' : h === 'low' ? 'warn' : 'good'}`}>
            {item.pieces_remaining}
          </div>
        </div>
        <div className="field-cell">
          <div className="field-label">Status</div>
          <div className="field-val">
            <span className={`status-badge status-${st.cls}`}>{st.label}</span>
          </div>
        </div>
        <div className="field-cell">
          <div className="field-label">Last Activity</div>
          <div className="field-val" style={{ fontSize: 13, fontWeight: 500 }}>
            {act ? relTime(act.last_activity) : relTime(item.updated_at)}
          </div>
        </div>
      </div>

      <div className="health-section">
        <div className="health-section-title">Stock Health</div>
        <div className="health-big-track">
          <div className={`health-big-fill ${h}`} style={{ width: `${item.pieces_remaining === 0 ? 0 : pct}%` }} />
        </div>
        <div className="health-desc">
          <strong>{hLabel}</strong> — {item.pieces_remaining} of {item.pieces} units remaining ({pct}%)
        </div>
      </div>

      {act && act.shrink_units > 0 && (
        <div className="shrink-banner">
          <div className="shrink-banner-title">
            Shrinkage: {act.shrink_units} unit{act.shrink_units > 1 ? 's' : ''} recorded
          </div>
          <div className="shrink-banner-hint">Check stock history in the desktop app for details</div>
        </div>
      )}

      {act && (
        <div className="sec-card" style={{ margin: '0 -4px' }}>
          <div style={{ padding: '14px 16px 0' }}>
            <div className="history-title">Activity Summary</div>
          </div>
          <div style={{ padding: '0 16px 14px' }}>
            <div className="field-grid" style={{ marginBottom: 0 }}>
              <div className="field-cell">
                <div className="field-label">Sold</div>
                <div className="field-val">{act.sold_units}</div>
              </div>
              <div className="field-cell">
                <div className="field-label">On Memo</div>
                <div className={`field-val ${act.memo_units > 0 ? 'warn' : ''}`}>{act.memo_units}</div>
              </div>
              <div className="field-cell">
                <div className="field-label">Shrinkage</div>
                <div className={`field-val ${act.shrink_units > 0 ? 'bad' : ''}`}>{act.shrink_units}</div>
              </div>
              <div className="field-cell">
                <div className="field-label">Manual Edit</div>
                <div className="field-val">{act.has_manual_edit ? 'Yes' : 'No'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="history-section">
        <div className="history-title">Stock History</div>
        <div className="history-note-msg">
          Detailed stock movement history is available in the desktop app.
        </div>
      </div>
    </>
  );
}
