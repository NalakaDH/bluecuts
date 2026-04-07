import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { formatItemTypeDisplay, inventoryCategoryDisplay } from '../../lib/inventoryDisplay';

interface InventoryItem {
  id: number;
  category: string;
  item_type: string;
  pieces: number;
  pieces_remaining?: number | null;
  item_code: string | null;
  description: string | null;
  status: string;
  image_path: string | null;
}

function remOf(item: InventoryItem): number {
  return Math.max(0, Math.floor(Number(item.pieces_remaining ?? 0)));
}

function calcDiff(item: InventoryItem, counts: Record<number, string>): number | null {
  const raw = counts[item.id];
  if (raw === undefined || raw === '') return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return null;
  return n - remOf(item);
}

interface StockCountPageProps {
  token: string;
}

function imageSrc(path: string | null): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const p = path.startsWith('/') ? path : `/uploads/${path}`;
  return apiUrl(p);
}

const IconGem = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
  </svg>
);

export const StockCountPage: React.FC<StockCountPageProps> = ({ token }) => {
  const { showAlert } = useAlertDialog();
  const [sessionStarted] = useState(() => new Date());
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [filterCat, setFilterCat] = useState('');
  const [filterShow, setFilterShow] = useState<'all' | 'uncounted' | 'discrepancy'>('all');
  const [showApply, setShowApply] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/inventory'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load inventory'));
      const data: InventoryItem[] = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load inventory';
      setError(msg);
      setItems([]);
      showAlert({ title: 'Could not load inventory', message: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [token, showAlert]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const countable = useMemo(
    () => items.filter((i) => i.status === 'Available' || i.status === 'Out of stock'),
    [items]
  );

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const i of countable) {
      if (i.category) seen.add(i.category);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [countable]);

  const filtered = useMemo(() => {
    return countable.filter((item) => {
      if (filterCat && item.category !== filterCat) return false;
      const d = calcDiff(item, counts);
      if (filterShow === 'uncounted' && d !== null) return false;
      if (filterShow === 'discrepancy' && (d === null || d === 0)) return false;
      return true;
    });
  }, [countable, counts, filterCat, filterShow]);

  const summary = useMemo(() => {
    const counted = countable.filter((i) => counts[i.id] !== undefined && counts[i.id] !== '').length;
    const matches = countable.filter((i) => calcDiff(i, counts) === 0).length;
    const shrinkage = countable.filter((i) => {
      const d = calcDiff(i, counts);
      return d !== null && d < 0;
    }).length;
    const restock = countable.filter((i) => {
      const d = calcDiff(i, counts);
      return d !== null && d > 0;
    }).length;
    const uncounted = countable.filter((i) => counts[i.id] === undefined || counts[i.id] === '').length;
    return { counted, matches, shrinkage, restock, uncounted };
  }, [countable, counts]);

  const discrepancies = useMemo(
    () => countable.filter((i) => {
      const d = calcDiff(i, counts);
      return d !== null && d !== 0;
    }),
    [countable, counts]
  );

  const progressPct =
    countable.length === 0 ? 0 : Math.round((summary.counted / countable.length) * 100);
  const hasChanges = discrepancies.length > 0;

  const handleCount = (id: number, val: string) => {
    if (applied) return;
    setCounts((prev) => {
      const next = { ...prev };
      if (val === '') delete next[id];
      else next[id] = String(Math.max(0, Math.floor(Number(val)) || 0));
      return next;
    });
  };

  const handleNote = (id: number, val: string) => {
    if (applied) return;
    setNotes((prev) => ({ ...prev, [id]: val }));
  };

  const handleReset = () => {
    setCounts({});
    setNotes({});
    setApplied(false);
    setShowApply(false);
  };

  const handleConfirmApply = async () => {
    if (discrepancies.length === 0) return;
    setApplyBusy(true);
    try {
      for (const item of discrepancies) {
        const d = calcDiff(item, counts);
        if (d === null || d === 0) continue;
        const rowNote = (notes[item.id] || '').trim();
        const baseNote = rowNote || 'Stock count';
        if (d < 0) {
          const qty = -d;
          const rem = remOf(item);
          if (qty > rem) {
            throw new Error(
              `Cannot record ${qty} missing for ${item.item_code || `#${item.id}`}: only ${rem} on hand.`
            );
          }
          const res = await fetch(apiUrl(`/api/inventory/${item.id}/shrinkage`), {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ quantity: qty, note: baseNote }),
          });
          if (!res.ok) throw new Error(await parseErrorResponse(res, 'Shrinkage failed'));
        } else {
          const res = await fetch(apiUrl('/api/restock'), {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              inventory_item_id: item.id,
              quantity: d,
              note: rowNote || null,
            }),
          });
          if (!res.ok) throw new Error(await parseErrorResponse(res, 'Restock failed'));
        }
      }
      setShowApply(false);
      setApplied(true);
      setCounts({});
      setNotes({});
      await loadItems();
      showAlert({
        title: 'Stock count applied',
        message: 'Shrinkage and restock movements have been recorded.',
        variant: 'success',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Apply failed';
      showAlert({ title: 'Could not apply', message: msg, variant: 'error' });
    } finally {
      setApplyBusy(false);
    }
  };

  const sessionDateStr = sessionStarted.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const locked = applied;

  return (
    <div className="page page-stock-count sc-root">
      <div className="sc-summary sc-summary--top" aria-label="Count summary">
        <div className="sc-summary-cell">
          <span className="sc-summary-label">Counted</span>
          <span className="sc-summary-val sc-summary-val--neutral">{summary.counted}</span>
        </div>
        <div className="sc-summary-cell sc-summary-cell--match">
          <span className="sc-summary-label">Match</span>
          <span className="sc-summary-val sc-summary-val--match">{summary.matches}</span>
        </div>
        <div className="sc-summary-cell sc-summary-cell--shrink">
          <span className="sc-summary-label">Shrinkage</span>
          <span className="sc-summary-val sc-summary-val--shrink">{summary.shrinkage}</span>
        </div>
        <div className="sc-summary-cell sc-summary-cell--restock">
          <span className="sc-summary-label">Restock</span>
          <span className="sc-summary-val sc-summary-val--restock">{summary.restock}</span>
        </div>
        <div className="sc-summary-cell">
          <span className="sc-summary-label">Uncounted</span>
          <span className="sc-summary-val sc-summary-val--muted">{summary.uncounted}</span>
        </div>
      </div>

      <div className="sc-progress">
        <div className="sc-progress-track" aria-hidden="true">
          <div className="sc-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="sc-progress-label">
          {summary.counted} of {countable.length} counted
        </span>
      </div>

      <header className="sc-topbar sc-topbar--filters" aria-label="Filters and actions">
        <select
          className="sc-select"
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          aria-label="Category"
          disabled={locked || loading}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="sc-select"
          value={filterShow}
          onChange={(e) => setFilterShow(e.target.value as 'all' | 'uncounted' | 'discrepancy')}
          aria-label="Show items"
          disabled={locked || loading}
        >
          <option value="all">Show all items</option>
          <option value="uncounted">Uncounted only</option>
          <option value="discrepancy">Discrepancies only</option>
        </select>
        <span className="sc-session-hint">Session: {sessionDateStr}</span>
        <div className="sc-topbar-actions">
          <button type="button" className="sc-btn sc-btn--ghost" onClick={handleReset} disabled={loading}>
            Clear all counts
          </button>
          <button
            type="button"
            className="sc-btn sc-btn--apply"
            onClick={() => setShowApply(true)}
            disabled={!hasChanges || applied || loading || applyBusy}
          >
            Apply changes
          </button>
        </div>
      </header>

      {error && !loading && <div className="sc-error">{error}</div>}
      {loading && <div className="sc-loading">Loading inventory…</div>}

      {!loading && !error && (
        <div className="sc-table-scroll">
          <table className="sc-table">
            <thead>
              <tr>
                <th className="sc-th sc-th--thumb" />
                <th className="sc-th">Item</th>
                <th className="sc-th">Code</th>
                <th className="sc-th sc-th--center">System stock</th>
                <th className="sc-th sc-th--center">Physical count</th>
                <th className="sc-th sc-th--center">Difference</th>
                <th className="sc-th">Result</th>
                <th className="sc-th sc-th--note">Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="sc-td sc-td--empty">
                    {countable.length === 0 ? 'No countable inventory items.' : 'No items match your filter.'}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const d = calcDiff(item, counts);
                  const rem = remOf(item);
                  const diffStr = d === null ? '—' : d === 0 ? '0' : d > 0 ? `+${d}` : `${d}`;
                  let rowClass = 'sc-tr sc-tr--none';
                  if (d === 0) rowClass = 'sc-tr sc-tr--match';
                  else if (d !== null && d < 0) rowClass = 'sc-tr sc-tr--shrink';
                  else if (d !== null && d > 0) rowClass = 'sc-tr sc-tr--restock';
                  const catLine = inventoryCategoryDisplay(item.category) ?? '—';
                  return (
                    <tr key={item.id} className={rowClass}>
                      <td className="sc-td sc-td--thumb">
                        <div className="sc-thumb">
                          {item.image_path ? (
                            <img src={imageSrc(item.image_path)} alt="" className="sc-thumb-img" />
                          ) : (
                            <span className="sc-thumb-ph" aria-hidden="true">
                              <IconGem />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="sc-td">
                        <div className="sc-item-name">{catLine}</div>
                        <div className="sc-item-sub">{formatItemTypeDisplay(item.item_type)}</div>
                      </td>
                      <td className="sc-td sc-td--code">{item.item_code || `#${item.id}`}</td>
                      <td className="sc-td sc-td--center sc-td--num">
                        <span className="sc-sys-qty">{rem}</span>
                      </td>
                      <td className="sc-td sc-td--center">
                        <input
                          type="number"
                          min={0}
                          className="sc-count-input"
                          value={counts[item.id] ?? ''}
                          placeholder="—"
                          disabled={locked}
                          onChange={(e) => handleCount(item.id, e.target.value)}
                          aria-label={`Physical count for ${item.item_code || item.id}`}
                        />
                      </td>
                      <td className="sc-td sc-td--center sc-td--diff">
                        <span
                          className={
                            d === null
                              ? 'sc-diff sc-diff--muted'
                              : d === 0
                                ? 'sc-diff sc-diff--match'
                                : d < 0
                                  ? 'sc-diff sc-diff--shrink'
                                  : 'sc-diff sc-diff--restock'
                          }
                        >
                          {diffStr}
                        </span>
                      </td>
                      <td className="sc-td">
                        <span
                          className={
                            d === null
                              ? 'sc-result sc-result--empty'
                              : d === 0
                                ? 'sc-result sc-result--match'
                                : d < 0
                                  ? 'sc-result sc-result--shrink'
                                  : 'sc-result sc-result--restock'
                          }
                        >
                          {d === null
                            ? '—'
                            : d === 0
                              ? 'Match'
                              : d < 0
                                ? `Shrinkage ${d}`
                                : `Restock +${d}`}
                        </span>
                      </td>
                      <td className="sc-td sc-td--note">
                        {d !== null && d !== 0 && (
                          <textarea
                            className="sc-note-input"
                            value={notes[item.id] || ''}
                            placeholder="Add a note (optional)"
                            maxLength={500}
                            disabled={locked}
                            rows={2}
                            onChange={(e) => handleNote(item.id, e.target.value)}
                          />
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

      {showApply && !applied && hasChanges && (
        <div className="sc-review">
          <div className="sc-review-inner">
            <div className="sc-review-title">Review &amp; apply changes</div>
            <p className="sc-review-desc">
              The following adjustments will be written to stock movements. This cannot be undone.
            </p>
            <ul className="sc-review-list">
              {discrepancies.map((item) => {
                const d = calcDiff(item, counts)!;
                const isShrink = d < 0;
                const newRem = remOf(item) + d;
                return (
                  <li key={item.id} className={`sc-review-item ${isShrink ? 'is-shrink' : 'is-restock'}`}>
                    <span className={`sc-review-dot ${isShrink ? 'is-shrink' : 'is-restock'}`} aria-hidden="true" />
                    <div className="sc-review-text">
                      <div className="sc-review-line">
                        {inventoryCategoryDisplay(item.category) ?? item.category}{' '}
                        <span className="sc-review-code">{item.item_code || `#${item.id}`}</span>
                      </div>
                      <div className="sc-review-note-preview">{notes[item.id]?.trim() || 'Stock count'}</div>
                    </div>
                    <div className="sc-review-meta">
                      <div className={isShrink ? 'sc-review-kind shrink' : 'sc-review-kind restock'}>
                        {isShrink ? 'Shrinkage' : 'Restock'} {isShrink ? d : `+${d}`}
                      </div>
                      <div className="sc-review-arrow">
                        {remOf(item)} → {newRem}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="sc-review-actions">
              <button type="button" className="sc-btn sc-btn--cancel" onClick={() => setShowApply(false)} disabled={applyBusy}>
                Cancel
              </button>
              <button type="button" className="sc-btn sc-btn--confirm" onClick={() => void handleConfirmApply()} disabled={applyBusy}>
                {applyBusy ? 'Applying…' : 'Confirm & apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {applied && (
        <div className="sc-done" role="status">
          <div className="sc-done-title">Stock count applied successfully</div>
          <div className="sc-done-sub">All shrinkage and restock movements have been recorded.</div>
        </div>
      )}
    </div>
  );
};
