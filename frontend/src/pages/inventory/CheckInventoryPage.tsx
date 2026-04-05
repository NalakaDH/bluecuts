import React, { useState, useEffect, useRef } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import type { PageId } from '../../components/layout/Layout';

interface CheckInventoryPageProps {
  token: string;
  onNavigate?: (page: PageId) => void;
}

interface InventoryItem {
  id: number;
  category: string;
  item_type: string;
  pieces: number;
  pieces_remaining?: number | null;
  weight_grams: number | null;
  weight_carats: number | null;
  purchasing_total_price: number | null;
  purchasing_carat_price: number | null;
  selling_total_price: number | null;
  selling_carat_price: number | null;
  image_path: string | null;
  item_code: string | null;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface StockMovement {
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

const PAGE_SIZE = 10;

function formatPrice(n: number | null): string {
  if (n == null) return '—';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const iconSize = 20;
const IconSearch = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);
const IconChevronDown = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);
const IconGem = () => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" />
  </svg>
);
const IconRefresh = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
const IconView = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const IconMemo = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
  </svg>
);
const IconSell = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);
const IconBox = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
  </svg>
);
const IconFilter = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);
const IconCategory = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><path d="M8 7h8M8 11h8" />
  </svg>
);
const IconStatus = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
  </svg>
);
const IconCheck = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'Available', label: 'Available' },
  { value: 'On Memo', label: 'On Memo' },
  { value: 'Sold', label: 'Sold' },
];

export const CheckInventoryPage: React.FC<CheckInventoryPageProps> = ({ token, onNavigate }) => {
  const { showAlert } = useAlertDialog();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewItem, setViewItem] = useState<InventoryItem | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const [stockHistory, setStockHistory] = useState<StockMovement[]>([]);
  const [stockHistoryLoading, setStockHistoryLoading] = useState(false);
  const [stockHistoryError, setStockHistoryError] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) setCategoryOpen(false);
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) setStatusOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getImageSrc = (imagePath: string | null): string => {
    if (!imagePath) return '';
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
    const path = imagePath.startsWith('/') ? imagePath : `/uploads/${imagePath}`;
    return apiUrl(path);
  };

  const fetchStockHistory = async (itemId: number) => {
    setStockHistoryLoading(true);
    setStockHistoryError(null);
    try {
      const res = await fetch(apiUrl(`/api/inventory/${itemId}/stock-history?limit=20`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load stock history'));
      const data: StockMovement[] = await res.json();
      setStockHistory(data);
    } catch (err: unknown) {
      setStockHistoryError(err instanceof Error ? err.message : 'Failed to load stock history');
      setStockHistory([]);
    } finally {
      setStockHistoryLoading(false);
    }
  };

  const fetchItems = async (opts: { search?: string; status?: string } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (opts.search?.trim()) params.set('search', opts.search.trim());
      if (opts.status?.trim()) params.set('status', opts.status.trim());
      const res = await fetch(apiUrl(`/api/inventory?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const message = await parseErrorResponse(res, 'Failed to load inventory');
        throw new Error(message);
      }
      const data = await res.json();
      setItems(data);
    } catch (err: any) {
      const msg = err.message || 'Failed to load inventory';
      setError(msg);
      setItems([]);
      showAlert({ title: 'Could not load inventory', message: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems({ search: '', status: '' });
  }, [token]);

  const applySearch = () => {
    setCurrentPage(1);
    fetchItems({ search });
  };

  const filteredByStatus = statusFilter
    ? items.filter((i) => i.status === statusFilter)
    : items;
  const filteredByCategory = categoryFilter
    ? filteredByStatus.filter((i) => i.category === categoryFilter)
    : filteredByStatus;

  const statTotal = items.length;
  const statAvailable = items.filter((i) => i.status === 'Available').length;
  const statOnMemo = items.filter((i) => i.status === 'On Memo').length;
  const statSold = items.filter((i) => i.status === 'Sold').length;
  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('');
    setStatusFilter('');
    setCurrentPage(1);
  };

  const totalFiltered = filteredByCategory.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredByCategory.slice(startIndex, startIndex + PAGE_SIZE);

  const uniqueCategories = Array.from(new Set(items.map((i) => i.category))).sort();

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, categoryFilter]);

  return (
    <div className="page page-check-inventory">
      {onNavigate && (
        <p className="check-inventory-to-stockcount">
          <button type="button" className="check-inventory-to-stockcount-btn" onClick={() => onNavigate('stockCount')}>
            Stock count — quick physical check &amp; record missing stock
          </button>
        </p>
      )}
      <section className="check-inventory-stats" aria-label="Inventory summary">
        <div className="check-inventory-stat-card">
          <span className="check-inventory-stat-icon check-inventory-stat-icon--total" aria-hidden="true"><IconBox /></span>
          <div className="check-inventory-stat-content">
            <span className="check-inventory-stat-value">{statTotal}</span>
            <span className="check-inventory-stat-label">Total items</span>
          </div>
        </div>
        <div className="check-inventory-stat-card">
          <span className="check-inventory-stat-icon check-inventory-stat-icon--available" aria-hidden="true"><IconGem /></span>
          <div className="check-inventory-stat-content">
            <span className="check-inventory-stat-value">{statAvailable}</span>
            <span className="check-inventory-stat-label">Available</span>
          </div>
        </div>
        <div className="check-inventory-stat-card">
          <span className="check-inventory-stat-icon check-inventory-stat-icon--memo" aria-hidden="true"><IconMemo /></span>
          <div className="check-inventory-stat-content">
            <span className="check-inventory-stat-value">{statOnMemo}</span>
            <span className="check-inventory-stat-label">On Memo</span>
          </div>
        </div>
        <div className="check-inventory-stat-card">
          <span className="check-inventory-stat-icon check-inventory-stat-icon--sold" aria-hidden="true"><IconSell /></span>
          <div className="check-inventory-stat-content">
            <span className="check-inventory-stat-value">{statSold}</span>
            <span className="check-inventory-stat-label">Out of stock</span>
          </div>
        </div>
      </section>

      <section
        className={`section-card section-card--find check-inventory-filters-card ${categoryOpen || statusOpen ? 'dropdown-open' : ''}`}
      >
        <h3 className="check-inventory-filters-title">Search & filters</h3>
        <div className="check-inventory-filters-row">
          <div className="check-inventory-search-wrap">
            <span className="check-inventory-search-icon" aria-hidden="true"><IconSearch /></span>
            <input
              type="search"
              className="check-inventory-search-input"
              placeholder="Search by SKU, Gem ID, Stone Type, or Scan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch()}
              aria-label="Search inventory"
            />
          </div>
          <button type="button" className="primary-button check-inventory-search-btn" onClick={applySearch} aria-label="Search">
            Search
          </button>
          <div className="check-inventory-dropdown" ref={categoryDropdownRef}>
            <button
              type="button"
              className="check-inventory-dropdown-trigger"
              onClick={() => { setCategoryOpen((o) => !o); setStatusOpen(false); }}
              aria-haspopup="listbox"
              aria-expanded={categoryOpen}
              aria-label="Category filter"
            >
              <span className="check-inventory-dropdown-trigger-icon check-inventory-dropdown-trigger-icon--category"><IconCategory /></span>
              <span className="check-inventory-dropdown-trigger-label">{categoryFilter || 'All categories'}</span>
              <span className={`check-inventory-dropdown-chevron ${categoryOpen ? 'is-open' : ''}`}><IconChevronDown /></span>
            </button>
            {categoryOpen && (
              <ul className="check-inventory-dropdown-list" role="listbox" aria-label="Category">
                <li
                  role="option"
                  aria-selected={!categoryFilter}
                  className={`check-inventory-dropdown-option ${!categoryFilter ? 'is-selected' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setCategoryFilter(''); setCategoryOpen(false); }}
                >
                  <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--category"><IconGem /></span>
                  All categories
                </li>
                {uniqueCategories.map((c) => (
                  <li
                    key={c}
                    role="option"
                    aria-selected={categoryFilter === c}
                    className={`check-inventory-dropdown-option ${categoryFilter === c ? 'is-selected' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setCategoryFilter(c); setCategoryOpen(false); }}
                  >
                    <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--category"><IconGem /></span>
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="check-inventory-dropdown" ref={statusDropdownRef}>
            <button
              type="button"
              className="check-inventory-dropdown-trigger"
              onClick={() => { setStatusOpen((o) => !o); setCategoryOpen(false); }}
              aria-haspopup="listbox"
              aria-expanded={statusOpen}
              aria-label="Status filter"
            >
              <span className="check-inventory-dropdown-trigger-icon check-inventory-dropdown-trigger-icon--status"><IconStatus /></span>
              <span className="check-inventory-dropdown-trigger-label">
                {STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label || 'All statuses'}
              </span>
              <span className={`check-inventory-dropdown-chevron ${statusOpen ? 'is-open' : ''}`}><IconChevronDown /></span>
            </button>
            {statusOpen && (
              <ul className="check-inventory-dropdown-list" role="listbox" aria-label="Status">
                  {STATUS_OPTIONS.map((opt) => (
                    <li
                      key={opt.value || 'all'}
                      role="option"
                      aria-selected={statusFilter === opt.value}
                      className={`check-inventory-dropdown-option check-inventory-dropdown-option--${opt.value || 'all'} ${statusFilter === opt.value ? 'is-selected' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setStatusFilter(opt.value); setStatusOpen(false); }}
                    >
                    {opt.value === '' && <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--all"><IconFilter /></span>}
                    {opt.value === 'Available' && <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--available"><IconCheck /></span>}
                    {opt.value === 'On Memo' && <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--memo"><IconMemo /></span>}
                    {opt.value === 'Sold' && <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--sold"><IconSell /></span>}
                    {opt.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="ghost-button check-inventory-clear-btn" onClick={clearFilters} aria-label="Clear filters">
            <IconFilter />
            <span>Clear filters</span>
          </button>
          <button
            type="button"
            className="ghost-button check-inventory-refresh-btn"
            onClick={() => fetchItems({ search })}
            title="Refresh list"
            aria-label="Refresh inventory"
          >
            <IconRefresh />
            <span>Refresh</span>
          </button>
        </div>
      </section>

      <section className="section-card section-card--list check-inventory-results-card">
        <div className="check-inventory-results-header">
          <h3 className="check-inventory-results-title">Inventory results</h3>
          <span className="check-inventory-count-badge" aria-live="polite">
            {totalFiltered} item{totalFiltered !== 1 ? 's' : ''} found
          </span>
        </div>

        {loading && (
          <div className="check-inventory-state check-inventory-state--loading">
            <div className="check-inventory-spinner" aria-hidden="true" />
            <p className="check-inventory-state-message">Loading your inventory…</p>
          </div>
        )}

        {!loading && error && (
          <div className="check-inventory-state check-inventory-state--error">
            <span className="check-inventory-state-error-icon" aria-hidden="true">!</span>
            <p className="check-inventory-state-message">{error}</p>
          </div>
        )}

        {!loading && !error && (
        <div className="check-inventory-table-wrap">
          <table className="check-inventory-table" aria-label="Inventory items">
            <thead>
              <tr>
                <th scope="col">Thumbnail</th>
                <th scope="col">Gem ID</th>
                <th scope="col">Stone Type</th>
                <th scope="col">Remaining pcs</th>
                <th scope="col">Sold pcs</th>
                <th scope="col">Carats</th>
                <th scope="col">Cut</th>
                <th scope="col">Retail Price ($)</th>
                <th scope="col">Status</th>
                <th scope="col">Quick Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="check-inventory-empty-cell">
                    <div className="check-inventory-empty-content">
                      <span className="check-inventory-empty-icon" aria-hidden="true"><IconGem /></span>
                      <p className="check-inventory-empty-title">{items.length === 0 ? 'No inventory yet' : 'No matching items'}</p>
                      <p className="check-inventory-empty-text">
                        {items.length === 0
                          ? 'Add items from Update Inventory to see them here.'
                          : 'Try a different search term or clear the status and category filters.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                pageItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="check-inventory-thumb">
                        {item.image_path ? (
                          <img
                            src={getImageSrc(item.image_path)}
                            alt=""
                            className="check-inventory-thumb-img"
                          />
                        ) : (
                          <div className="check-inventory-thumb-placeholder">
                            <IconGem />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="check-inventory-cell-id">{item.item_code || `#${item.id}`}</td>
                    <td>{item.category}</td>
                    <td>
                      {(() => {
                        const remaining =
                          typeof item.pieces_remaining === 'number'
                            ? item.pieces_remaining
                            : item.pieces;
                        return remaining;
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const remaining =
                          typeof item.pieces_remaining === 'number'
                            ? item.pieces_remaining
                            : item.pieces;
                        const sold = Math.max(0, item.pieces - remaining);
                        return sold;
                      })()}
                    </td>
                    <td>{item.weight_carats != null ? `${item.weight_carats}ct` : '—'}</td>
                    <td>{item.item_type}</td>
                    <td>{item.selling_total_price != null ? formatPrice(item.selling_total_price) : '—'}</td>
                    <td>
                      <span className={`check-inventory-status-badge check-inventory-status-badge--${item.status.toLowerCase().replace(/\s+/g, '-')}`}>
                        {item.status}
                      </span>
                    </td>
                    <td>
                      <div className="check-inventory-quick-actions">
                        <button
                          type="button"
                          className="check-inventory-action-btn"
                          onClick={() => { setViewItem(item); fetchStockHistory(item.id); }}
                          title="View details"
                        >
                          <IconView />
                          <span>View</span>
                        </button>
                        <button
                          type="button"
                          className="check-inventory-action-btn"
                          onClick={() => onNavigate?.('memo')}
                          title="Issue memo"
                        >
                          <IconMemo />
                          <span>Issue Memo</span>
                        </button>
                        <button
                          type="button"
                          className="check-inventory-action-btn"
                          onClick={() => onNavigate?.('selling')}
                          title="Sell item"
                        >
                          <IconSell />
                          <span>Sell</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}

        {!loading && !error && totalFiltered > 0 && totalPages > 1 && (
        <nav className="check-inventory-pagination" aria-label="Pagination">
          <button
            type="button"
            className="check-inventory-page-btn"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            aria-label="Previous page"
          >
            PREV
          </button>
          <div className="check-inventory-page-numbers">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || (p >= currentPage - 2 && p <= currentPage + 2))
              .reduce<number[]>((acc, p, i, arr) => {
                if (i > 0 && p - arr[i - 1] > 1) acc.push(-1);
                acc.push(p);
                return acc;
              }, [])
              .map((p) =>
                p === -1 ? (
                  <span key="ellipsis" className="check-inventory-page-ellipsis">…</span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    className={`check-inventory-page-num ${currentPage === p ? 'is-active' : ''}`}
                    onClick={() => setCurrentPage(p)}
                    aria-label={`Page ${p}`}
                    aria-current={currentPage === p ? 'page' : undefined}
                  >
                    {p}
                  </button>
                )
              )}
          </div>
          <button
            type="button"
            className="check-inventory-page-btn"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            aria-label="Next page"
          >
            NEXT
          </button>
        </nav>
        )}
      </section>

      {viewItem && (
        <div
          className="check-inventory-view-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="view-item-title"
          onClick={() => setViewItem(null)}
        >
          <div
            className="check-inventory-view-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="check-inventory-view-header">
              <span className="check-inventory-view-header-icon" aria-hidden="true"><IconGem /></span>
              <h3 id="view-item-title">{viewItem.category}{viewItem.item_code ? ` · ${viewItem.item_code}` : ''}</h3>
              <button type="button" className="check-inventory-view-close" onClick={() => setViewItem(null)} aria-label="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="check-inventory-view-body">
              <div className="check-inventory-view-top">
                <div className="check-inventory-view-image-wrap">
                  <p className="check-inventory-view-section-label">Image</p>
                  {viewItem.image_path ? (
                    <div className="check-inventory-view-image">
                      <img src={getImageSrc(viewItem.image_path)} alt="" />
                    </div>
                  ) : (
                    <div className="check-inventory-view-image-placeholder">
                      <IconGem />
                      <span>No image</span>
                    </div>
                  )}
                </div>
                <div className="check-inventory-view-details-wrap">
                  <p className="check-inventory-view-section-label">Details</p>
                  <dl className="check-inventory-view-dl">
                    <dt>Gem ID</dt><dd>{viewItem.item_code || `#${viewItem.id}`}</dd>
                    <dt>Stone Type</dt><dd>{viewItem.category}</dd>
                    <dt>Cut</dt><dd>{viewItem.item_type}</dd>
                    <dt>Pieces</dt><dd>{viewItem.pieces}</dd>
                    <dt>Carats</dt><dd>{viewItem.weight_carats != null ? `${viewItem.weight_carats} ct` : '—'}</dd>
                    <dt>Weight (g)</dt><dd>{viewItem.weight_grams != null ? `${viewItem.weight_grams} g` : '—'}</dd>
                    <dt>Retail Price</dt><dd>{viewItem.selling_total_price != null ? `$${formatPrice(viewItem.selling_total_price)}` : '—'}</dd>
                    <dt>Status</dt><dd className="check-inventory-view-dd-status"><span className={`check-inventory-view-status-badge check-inventory-view-status-badge--${viewItem.status.toLowerCase().replace(/\s+/g, '-')}`}>{viewItem.status}</span></dd>
                  </dl>
                </div>
              </div>
              {viewItem.description && (
                <div className="check-inventory-view-description-wrap">
                  <p className="check-inventory-view-section-label">Description</p>
                  <p className="check-inventory-view-description">{viewItem.description}</p>
                </div>
              )}
              <div className="check-inventory-view-history-wrap">
                <p className="check-inventory-view-section-label">Stock history</p>
                {stockHistoryLoading ? (
                  <p className="check-inventory-view-history-empty">Loading history…</p>
                ) : stockHistoryError ? (
                  <p className="check-inventory-view-history-empty">{stockHistoryError}</p>
                ) : stockHistory.length === 0 ? (
                  <p className="check-inventory-view-history-empty">No stock movements recorded.</p>
                ) : (
                  <table className="check-inventory-view-history-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th className="right">Qty</th>
                        <th>User</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockHistory.map(m => (
                        <tr key={m.id}>
                          <td>{new Date(m.created_at).toLocaleString()}</td>
                          <td>{m.type}</td>
                          <td className="right">{m.qty_change > 0 ? `+${m.qty_change}` : m.qty_change}</td>
                          <td>{m.user_name || '—'}</td>
                          <td>{m.note || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
