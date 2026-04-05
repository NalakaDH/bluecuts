import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';

interface InventoryItem {
  id: number;
  category: string;
  item_type: string;
  pieces: number;
  pieces_remaining?: number | null;
  item_code: string | null;
  description: string | null;
  status: string;
}

type RowMark = '' | 'match';

interface StockCountPageProps {
  token: string;
}

const PAGE_SIZE = 75;

export const StockCountPage: React.FC<StockCountPageProps> = ({ token }) => {
  const { showAlert } = useAlertDialog();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Available' | 'Out of stock' | ''>('Available');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [rowMarks, setRowMarks] = useState<Record<number, RowMark>>({});
  const [countInputs, setCountInputs] = useState<Record<number, string>>({});
  const [sessionNote, setSessionNote] = useState('');
  const [page, setPage] = useState(1);
  const [applyBusy, setApplyBusy] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchApplied.trim()) params.set('search', searchApplied.trim());
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(apiUrl(`/api/inventory?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load inventory'));
      const data: InventoryItem[] = await res.json();
      setItems(data);
      setRowMarks({});
      setCountInputs({});
      setPage(1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load inventory';
      setError(msg);
      setItems([]);
      showAlert({ title: 'Could not load inventory', message: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [token, searchApplied, statusFilter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const i of items) {
      const c = i.category;
      if (c && !seen.has(c)) {
        seen.add(c);
        list.push(c);
      }
    }
    return list.sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (categoryFilter && i.category !== categoryFilter) return false;
      if (!statusFilter && i.status !== 'Available' && i.status !== 'Out of stock') return false;
      return true;
    });
  }, [items, categoryFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageSlice = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const expectedFor = (it: InventoryItem) => Math.max(0, Math.floor(Number(it.pieces_remaining ?? 0)));

  const parsedCount = (id: number, it: InventoryItem): number | null => {
    if (rowMarks[id] === 'match') return expectedFor(it);
    const raw = countInputs[id];
    if (raw == null || String(raw).trim() === '') return null;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };

  const rowsWithVariance = useMemo(() => {
    const out: { item: InventoryItem; expected: number; counted: number; delta: number }[] = [];
    for (const it of filtered) {
      const exp = expectedFor(it);
      const c = parsedCount(it.id, it);
      if (c === null) continue;
      if (c !== exp) out.push({ item: it, expected: exp, counted: c, delta: c - exp });
    }
    return out;
  }, [filtered, rowMarks, countInputs]);

  const countedInScope = useMemo(() => {
    let n = 0;
    for (const it of filtered) {
      if (parsedCount(it.id, it) !== null) n += 1;
    }
    return n;
  }, [filtered, rowMarks, countInputs]);

  const setMatch = (id: number) => {
    setRowMarks(prev => ({ ...prev, [id]: 'match' }));
    setCountInputs(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const setCount = (id: number, value: string) => {
    setRowMarks(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setCountInputs(prev => ({ ...prev, [id]: value }));
  };

  const markVisibleMatches = () => {
    const nextM = { ...rowMarks };
    const nextI = { ...countInputs };
    for (const it of pageSlice) {
      nextM[it.id] = 'match';
      delete nextI[it.id];
    }
    setRowMarks(nextM);
    setCountInputs(nextI);
  };

  const clearMarks = () => {
    setRowMarks({});
    setCountInputs({});
  };

  const applyVariances = async () => {
    if (rowsWithVariance.length === 0) {
      showAlert({ title: 'Nothing to apply', message: 'Enter counts that differ from the system, or use Match.', variant: 'info' });
      return;
    }
    const needsNote = rowsWithVariance.some(r => r.delta < 0);
    const note = sessionNote.trim();
    if (needsNote && !note) {
      showAlert({
        title: 'Reason required',
        message: 'Enter a session note (e.g. physical count Feb 2026) before recording missing stock.',
        variant: 'error',
      });
      return;
    }

    setApplyBusy(true);
    try {
      for (const { item, delta } of rowsWithVariance) {
        if (delta < 0) {
          const qty = -delta;
          const res = await fetch(apiUrl(`/api/inventory/${item.id}/shrinkage`), {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ quantity: qty, note }),
          });
          if (!res.ok) throw new Error(await parseErrorResponse(res, 'Shrinkage failed'));
        } else if (delta > 0) {
          const res = await fetch(apiUrl('/api/restock'), {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              inventory_item_id: item.id,
              quantity: delta,
              note: note ? `${note} (${item.item_code || `#${item.id}`})` : `Stock count correction (${item.item_code || `#${item.id}`})`,
            }),
          });
          if (!res.ok) throw new Error(await parseErrorResponse(res, 'Restock failed'));
        }
      }
      showAlert({
        title: 'Stock updated',
        message: `Applied ${rowsWithVariance.length} adjustment(s).`,
        variant: 'success',
      });
      await fetchItems();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Apply failed';
      showAlert({ title: 'Could not apply', message: msg, variant: 'error' });
    } finally {
      setApplyBusy(false);
    }
  };

  return (
    <div className="page page-stock-count">
      <header className="stock-count-header">
        <div>
          <h2 className="stock-count-title">Stock count</h2>
          <p className="stock-count-desc">
            Work by category or search. Use <strong>Match</strong> when the shelf matches the system, or type the
            <strong> counted </strong>
            quantity. Apply saves only rows with a difference (missing → shrinkage, extra → restock). Shrinkage is logged
            in stock history.
          </p>
        </div>
      </header>

      <section className="section-card stock-count-filters">
        <div className="stock-count-filter-row">
          <label className="stock-count-label">
            Search
            <input
              type="search"
              className="stock-count-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  setSearchApplied(search);
                }
              }}
              placeholder="Code, category, type…"
            />
          </label>
          <button type="button" className="stock-count-btn secondary" onClick={() => setSearchApplied(search)}>
            Search
          </button>
          <label className="stock-count-label">
            Status
            <select
              className="stock-count-select"
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value as typeof statusFilter);
                setPage(1);
              }}
            >
              <option value="Available">Available (default)</option>
              <option value="Out of stock">Out of stock</option>
              <option value="">All countable (Available + Out of stock)</option>
            </select>
          </label>
          <label className="stock-count-label">
            Category
            <select
              className="stock-count-select"
              value={categoryFilter}
              onChange={e => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {categories.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="stock-count-btn secondary" onClick={() => fetchItems()} disabled={loading}>
            Refresh
          </button>
        </div>
        <div className="stock-count-help">
          <span>
            Showing <strong>{filtered.length}</strong> lines
            {statusFilter ? ` · status: ${statusFilter || 'all'}` : ''}
            {categoryFilter ? ` · ${categoryFilter}` : ''}.
          </span>
          <span>
            Confirmed this list: <strong>{countedInScope}</strong> / {filtered.length}
          </span>
        </div>
      </section>

      {error && !loading && <div className="stock-count-error">{error}</div>}

      {loading && <div className="stock-count-loading">Loading inventory…</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="section-card stock-count-empty">No items match these filters.</div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <div className="stock-count-toolbar">
            <button type="button" className="stock-count-btn secondary" onClick={markVisibleMatches}>
              Mark visible ({pageSlice.length}) as match
            </button>
            <button type="button" className="stock-count-btn ghost" onClick={clearMarks}>
              Clear marks
            </button>
            <label className="stock-count-note-label">
              Session note (required if recording missing stock)
              <input
                type="text"
                className="stock-count-input stock-count-note-input"
                value={sessionNote}
                onChange={e => setSessionNote(e.target.value)}
                placeholder="e.g. Weekly count 2026-02-01"
              />
            </label>
            <button
              type="button"
              className="stock-count-btn primary"
              onClick={() => void applyVariances()}
              disabled={applyBusy || rowsWithVariance.length === 0}
            >
              {applyBusy ? 'Applying…' : `Apply ${rowsWithVariance.length} adjustment(s)`}
            </button>
          </div>

          <div className="section-card stock-count-table-card">
            <div className="stock-count-table-wrap">
              <table className="stock-count-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Category</th>
                    <th>Type</th>
                    <th className="right">System qty</th>
                    <th>Match</th>
                    <th>Counted</th>
                    <th className="right">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlice.map(it => {
                    const exp = expectedFor(it);
                    const c = parsedCount(it.id, it);
                    const delta = c !== null ? c - exp : null;
                    return (
                      <tr key={it.id}>
                        <td>{it.item_code || `#${it.id}`}</td>
                        <td>{it.category}</td>
                        <td>{it.item_type}</td>
                        <td className="right tabular">{exp}</td>
                        <td>
                          <button
                            type="button"
                            className={`stock-count-match ${rowMarks[it.id] === 'match' ? 'is-on' : ''}`}
                            onClick={() => setMatch(it.id)}
                          >
                            Match
                          </button>
                        </td>
                        <td>
                          <input
                            type="text"
                            inputMode="numeric"
                            className="stock-count-count-input"
                            value={countInputs[it.id] ?? ''}
                            onChange={e => setCount(it.id, e.target.value)}
                            placeholder="—"
                            aria-label={`Counted quantity for ${it.item_code || it.id}`}
                          />
                        </td>
                        <td className="right tabular">
                          {delta == null ? '—' : delta === 0 ? '0' : delta > 0 ? `+${delta}` : `${delta}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <nav className="stock-count-pagination" aria-label="Pages">
              <button
                type="button"
                className="stock-count-btn secondary"
                disabled={safePage <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className="stock-count-page-label">
                Page {safePage} / {totalPages}
              </span>
              <button
                type="button"
                className="stock-count-btn secondary"
                disabled={safePage >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
};
