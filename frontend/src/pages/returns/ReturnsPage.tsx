import React, { useEffect, useMemo, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { DEFAULT_CURRENCY_CODE, formatMoneyAmount } from '../../lib/currencies';

type InvoiceStatus = 'Unpaid' | 'Partial' | 'Paid';

interface ReturnInvoiceRow {
  id: number;
  invoice_no: string;
  customer_name: string | null;
  created_at: string;
  total: number;
  paid: number;
  status: InvoiceStatus;
  currency_code?: string | null;
}

interface InvoiceItemRow {
  id: number;
  inventory_item_id: number;
  item_code: string | null;
  description: string | null;
  quantity: number;
  /** Already returned to stock from this invoice line */
  returned_qty?: number;
  unit_price: number;
  line_total: number;
}

interface InvoiceDetail {
  id: number;
  invoice_no: string;
  customer_id: number | null;
  customer_name: string | null;
  subtotal: number;
  discount: number;
  total: number;
  status: InvoiceStatus;
  created_at: string;
  updated_at: string;
  currency_code?: string | null;
  items: InvoiceItemRow[];
  payments: { id: number; method: string; amount: number; note: string | null; created_at: string }[];
  paid: number;
  derived_status: InvoiceStatus;
}

interface InventoryItem {
  id: number;
  item_code?: string | null;
  item_sticker?: string | null;
  description?: string | null;
  category: string;
  item_type: string;
  pieces: number;
  pieces_remaining?: number | null;
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

interface ReturnsPageProps {
  token: string;
}

interface InvoiceStatsForReturns {
  return_eligible_count: number;
  paid_count: number;
  invoices_count: number;
}

const IconTabReturn: React.FC = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

const IconTabBox: React.FC = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const IconSearch: React.FC = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IconEmptyReturn: React.FC = () => (
  <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

const IconEmptyBox: React.FC = () => (
  <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" aria-hidden="true">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const StatusIconPartial: React.FC = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);

const StatusIconUnpaid: React.FC = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const StatusIconPaid: React.FC = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

export const ReturnsPage: React.FC<ReturnsPageProps> = ({ token }) => {
  const { showAlert } = useAlertDialog();
  const [mainTab, setMainTab] = useState<'returns' | 'restock'>('returns');

  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoices, setInvoices] = useState<ReturnInvoiceRow[]>([]);
  const [returnStats, setReturnStats] = useState<InvoiceStatsForReturns | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [invError, setInvError] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [returnDraft, setReturnDraft] = useState<Record<number, number>>({});
  const [returnSaving, setReturnSaving] = useState(false);

  const [itemSearch, setItemSearch] = useState('');
  const [itemSuggestions, setItemSuggestions] = useState<InventoryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [restockQty, setRestockQty] = useState<number>(0);
  const [restockNote, setRestockNote] = useState('');
  const [restockSaving, setRestockSaving] = useState(false);
  const [restockMessage, setRestockMessage] = useState<string | null>(null);
  const [restockError, setRestockError] = useState<string | null>(null);
  const [itemHistory, setItemHistory] = useState<StockMovement[]>([]);
  const [itemHistoryLoading, setItemHistoryLoading] = useState(false);
  const [itemHistoryError, setItemHistoryError] = useState<string | null>(null);

  const kpiEligible = returnStats?.return_eligible_count ?? 0;
  const kpiPaid = returnStats?.paid_count ?? 0;
  const kpiLineItems = detail?.items.length ?? null;
  const kpiStock =
    selectedItem != null
      ? typeof selectedItem.pieces_remaining === 'number'
        ? selectedItem.pieces_remaining
        : selectedItem.pieces
      : null;

  const fetchInvoices = async () => {
    setInvLoading(true);
    setInvError(null);
    try {
      const listParams = new URLSearchParams();
      if (invoiceSearch.trim()) listParams.set('search', invoiceSearch.trim());
      listParams.set('limit', '500');

      const statsParams = new URLSearchParams();
      if (invoiceSearch.trim()) statsParams.set('search', invoiceSearch.trim());

      const [res, statsRes] = await Promise.all([
        fetch(apiUrl(`/api/invoices?${listParams.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(apiUrl(`/api/invoices/stats?${statsParams.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (!statsRes.ok) throw new Error(await parseErrorResponse(statsRes, 'Failed to load invoice totals'));
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load invoices'));
      const st: InvoiceStatsForReturns = await statsRes.json();
      setReturnStats({
        return_eligible_count: Number(st.return_eligible_count) || 0,
        paid_count: Number(st.paid_count) || 0,
        invoices_count: Number(st.invoices_count) || 0,
      });
      const data: any[] = await res.json();
      setInvoices(
        data.map(row => ({
          id: row.id,
          invoice_no: row.invoice_no,
          customer_name: row.customer_name || 'Walk-in customer',
          created_at: row.created_at,
          total: row.total,
          paid: row.paid,
          status: row.status as InvoiceStatus,
          currency_code: row.currency_code,
        }))
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load invoices';
      setInvError(msg);
      setInvoices([]);
      setReturnStats(null);
      showAlert({ title: 'Could not load invoices', message: msg, variant: 'error' });
    } finally {
      setInvLoading(false);
    }
  };

  useEffect(() => {
    const id = window.setTimeout(fetchInvoices, 250);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceSearch, token]);

  const loadInvoiceDetail = async (id: number) => {
    setSelectedInvoiceId(id);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setReturnDraft({});
    try {
      const res = await fetch(apiUrl(`/api/invoices/${id}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load invoice'));
      const data: InvoiceDetail = await res.json();
      setDetail(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load invoice';
      setDetailError(msg);
      showAlert({ title: 'Could not load invoice', message: msg, variant: 'error' });
    } finally {
      setDetailLoading(false);
    }
  };

  const submitReturn = async () => {
    if (!detail) return;
    const plan = detail.items
      .map(it => {
        const draft = Math.floor(Number(returnDraft[it.id] || 0));
        const sold = Math.floor(Number(it.quantity) || 0);
        const already = Math.floor(Number(it.returned_qty) || 0);
        const canStill = Math.max(0, sold - already);
        const qty = Math.max(0, Math.min(draft, canStill));
        return qty > 0 ? { invoice_item_id: it.id, quantity: qty } : null;
      })
      .filter(Boolean) as { invoice_item_id: number; quantity: number }[];
    if (plan.length === 0) {
      const msg = 'Enter a return quantity for at least one item.';
      setDetailError(msg);
      showAlert({ title: 'Nothing to return', message: msg, variant: 'warning' });
      return;
    }
    setReturnSaving(true);
    setDetailError(null);
    try {
      const res = await fetch(apiUrl('/api/returns/from-invoice'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          invoice_id: detail.id,
          items: plan,
          note: 'Customer return',
        }),
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to process return'));
      setReturnDraft({});
      await loadInvoiceDetail(detail.id);
      fetchInvoices();
      showAlert({
        title: 'Return processed',
        message: 'Items were returned to stock and the invoice was updated.',
        variant: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to process return';
      setDetailError(msg);
      showAlert({ title: 'Return failed', message: msg, variant: 'error' });
    } finally {
      setReturnSaving(false);
    }
  };

  useEffect(() => {
    if (!itemSearch.trim()) {
      setItemSuggestions([]);
      return;
    }
    const id = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        params.set('search', itemSearch.trim());
        params.set('limit', '30');
        const res = await fetch(apiUrl(`/api/inventory?${params.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const rows: InventoryItem[] = await res.json();
        setItemSuggestions(rows);
      } catch {
        setItemSuggestions([]);
      }
    }, 250);
    return () => window.clearTimeout(id);
  }, [itemSearch, token]);

  const loadItemHistory = async (id: number) => {
    setItemHistoryLoading(true);
    setItemHistoryError(null);
    try {
      const res = await fetch(apiUrl(`/api/inventory/${id}/stock-history?limit=10`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to load stock history'));
      const data: StockMovement[] = await res.json();
      setItemHistory(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load stock history';
      setItemHistoryError(msg);
      setItemHistory([]);
      showAlert({ title: 'Stock history', message: msg, variant: 'error' });
    } finally {
      setItemHistoryLoading(false);
    }
  };

  const performRestock = async () => {
    if (!selectedItem) return;
    if (!restockQty || restockQty <= 0) {
      const msg = 'Quantity must be greater than zero.';
      setRestockError(msg);
      showAlert({ title: 'Invalid quantity', message: msg, variant: 'warning' });
      return;
    }
    setRestockSaving(true);
    setRestockError(null);
    setRestockMessage(null);
    try {
      const res = await fetch(apiUrl('/api/restock'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          inventory_item_id: selectedItem.id,
          quantity: restockQty,
          note: restockNote || null,
        }),
      });
      if (!res.ok) throw new Error(await parseErrorResponse(res, 'Failed to restock item'));
      setRestockMessage('Restocked successfully.');
      showAlert({
        title: 'Restock completed',
        message: `${restockQty} piece(s) were added to inventory.`,
        variant: 'success',
      });
      setRestockQty(0);
      setRestockNote('');
      loadItemHistory(selectedItem.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to restock item';
      setRestockError(msg);
      showAlert({ title: 'Restock failed', message: msg, variant: 'error' });
    } finally {
      setRestockSaving(false);
    }
  };

  const selectInventoryItem = (it: InventoryItem) => {
    setSelectedItem(it);
    setRestockError(null);
    setRestockMessage(null);
    loadItemHistory(it.id);
  };

  const statusIcon = (s: InvoiceStatus) => {
    if (s === 'Partial') return <StatusIconPartial />;
    if (s === 'Unpaid') return <StatusIconUnpaid />;
    return <StatusIconPaid />;
  };

  return (
    <div className="page page-returns">
      <section className="payments-kpi-grid returns-kpi-grid" aria-label="Returns summary">
        <div className="payments-kpi-card payments-kpi-card--amber">
          <div className="payments-kpi-label">Eligible for return</div>
          <div className="payments-kpi-value">{kpiEligible}</div>
          <div className="payments-kpi-sub">Unpaid or partial invoices</div>
        </div>
        <div className="payments-kpi-card payments-kpi-card--blue">
          <div className="payments-kpi-label">Invoices in list</div>
          <div className="payments-kpi-value">{invoices.length}</div>
          <div className="payments-kpi-sub">
            {kpiPaid} paid in full · {kpiEligible} return-eligible
          </div>
        </div>
        <div className="payments-kpi-card payments-kpi-card--green">
          <div className="payments-kpi-label">Invoice line items</div>
          <div className="payments-kpi-value">{kpiLineItems != null ? kpiLineItems : '—'}</div>
          <div className="payments-kpi-sub">Selected invoice</div>
        </div>
        <div className="payments-kpi-card payments-kpi-card--red">
          <div className="payments-kpi-label">Item on hand</div>
          <div className="payments-kpi-value">{kpiStock != null ? kpiStock : '—'}</div>
          <div className="payments-kpi-sub">Selected restock item (pcs)</div>
        </div>
      </section>

      <div className="returns-segment" role="tablist" aria-label="Returns or restock">
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === 'returns'}
          className={`returns-segment__btn${mainTab === 'returns' ? ' is-active' : ''}`}
          onClick={() => setMainTab('returns')}
        >
          <IconTabReturn />
          <span>Returns from Invoice</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === 'restock'}
          className={`returns-segment__btn${mainTab === 'restock' ? ' is-active' : ''}`}
          onClick={() => setMainTab('restock')}
        >
          <IconTabBox />
          <span>Restock Item</span>
        </button>
      </div>

      {mainTab === 'returns' && (
        <div className="returns-split">
          <section className="returns-panel">
            <div className="returns-panel-head">
              <h3 className="selling-section-title returns-panel-title">Select Invoice</h3>
              <p className="returns-panel-sub">Search and select an invoice to return items from</p>
            </div>
            <div className="selling-invoices-search-wrap returns-panel-search">
              <span className="selling-invoices-search-icon" aria-hidden="true">
                <IconSearch />
              </span>
              <input
                type="search"
                className="selling-invoices-search"
                placeholder="Search by invoice # or customer name..."
                value={invoiceSearch}
                onChange={e => setInvoiceSearch(e.target.value)}
                aria-label="Search invoices"
              />
            </div>
            <div className="returns-table-wrap returns-table-wrap--panel">
              <table className="returns-table returns-table--enhanced" aria-label="Invoices">
                <thead>
                  <tr>
                    <th scope="col">Invoice #</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Date</th>
                    <th scope="col" className="right">
                      Total
                    </th>
                    <th scope="col" className="right">
                      Paid
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col" className="returns-th-action">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invLoading ? (
                    <tr>
                      <td colSpan={7} className="returns-empty">
                        Loading…
                      </td>
                    </tr>
                  ) : invError ? (
                    <tr>
                      <td colSpan={7} className="returns-empty">
                        {invError}
                      </td>
                    </tr>
                  ) : invoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="returns-empty">
                        No invoices found.
                      </td>
                    </tr>
                  ) : (
                    invoices.map(inv => (
                      <tr key={inv.id} className={inv.id === selectedInvoiceId ? 'returns-row--active' : ''}>
                        <td className="returns-code">{inv.invoice_no}</td>
                        <td>{inv.customer_name || 'Walk-in'}</td>
                        <td>{new Date(inv.created_at).toLocaleDateString()}</td>
                        <td className="right returns-numeric">
                          {formatMoneyAmount(inv.total, inv.currency_code || DEFAULT_CURRENCY_CODE)}
                        </td>
                        <td className="right returns-numeric">
                          {formatMoneyAmount(inv.paid, inv.currency_code || DEFAULT_CURRENCY_CODE)}
                        </td>
                        <td>
                          <span className={`returns-status-pill returns-status-pill--${inv.status.toLowerCase()}`}>
                            <span className="returns-status-pill__icon" aria-hidden="true">
                              {statusIcon(inv.status)}
                            </span>
                            {inv.status}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="returns-select-btn"
                            onClick={() => loadInvoiceDetail(inv.id)}
                          >
                            Select
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="returns-panel">
            <div className="returns-panel-head">
              <h3 className="selling-section-title returns-panel-title">Return Summary</h3>
            </div>
            {!detailLoading && !detail && !detailError && (
              <div className="returns-panel-empty">
                <IconEmptyReturn />
                <p>Select an invoice to view return details</p>
              </div>
            )}
            {detailLoading && <p className="returns-empty">Loading invoice…</p>}
            {!detailLoading && detailError && !detail && <p className="returns-error">{detailError}</p>}
            {!detailLoading && detail && (
              <>
                <div className="returns-detail-head">
                  <div>
                    <div className="returns-detail-title">{detail.invoice_no}</div>
                    <div className="returns-detail-sub">
                      {detail.customer_name || 'Walk-in'} • {new Date(detail.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="returns-detail-total">
                    <span>Total</span>
                    <strong>
                      {formatMoneyAmount(detail.total, detail.currency_code || DEFAULT_CURRENCY_CODE)}
                    </strong>
                  </div>
                </div>
                {detailError && <p className="returns-error">{detailError}</p>}
                <div className="returns-detail-table-wrap">
                  <table className="returns-table returns-table--items" aria-label="Invoice items">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="right">Qty</th>
                        <th className="right">Price</th>
                        <th className="right">Return qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map(it => {
                        const sold = Math.floor(Number(it.quantity) || 0);
                        const already = Math.floor(Number(it.returned_qty) || 0);
                        const canReturn = Math.max(0, sold - already);
                        const draft = Math.floor(Number(returnDraft[it.id] || 0));
                        const clamped = Math.max(0, Math.min(draft, canReturn));
                        return (
                          <tr key={it.id}>
                            <td>
                              <div className="returns-item-title">{it.item_code || `#${it.inventory_item_id}`}</div>
                              <div className="returns-item-sub">{it.description || ''}</div>
                              {already > 0 ? (
                                <div className="returns-item-sub returns-item-sub--muted">{already} already returned</div>
                              ) : null}
                            </td>
                            <td className="right">{it.quantity}</td>
                            <td className="right">
                              {formatMoneyAmount(it.unit_price, detail.currency_code || DEFAULT_CURRENCY_CODE)}
                            </td>
                            <td className="right">
                              <input
                                type="number"
                                min={0}
                                max={canReturn}
                                className="returns-qty"
                                value={Number.isFinite(clamped) ? clamped : 0}
                                onChange={e => {
                                  const v = Math.max(0, Math.min(canReturn, Math.floor(Number(e.target.value) || 0)));
                                  setReturnDraft(prev => ({ ...prev, [it.id]: v }));
                                }}
                                disabled={returnSaving || canReturn <= 0}
                                title={canReturn <= 0 ? 'Fully returned' : `Return up to ${canReturn} pc(s)`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="returns-detail-actions">
                  <button type="button" className="primary-button" onClick={submitReturn} disabled={returnSaving}>
                    {returnSaving ? 'Processing…' : 'Return to stock'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {mainTab === 'restock' && (
        <div className="returns-split">
          <section className="returns-panel">
            <div className="returns-panel-head">
              <h3 className="selling-section-title returns-panel-title">Search Items</h3>
              <p className="returns-panel-sub">Search by item code or name</p>
            </div>
            <div className="selling-invoices-search-wrap returns-panel-search">
              <span className="selling-invoices-search-icon" aria-hidden="true">
                <IconSearch />
              </span>
              <input
                type="search"
                className="selling-invoices-search"
                placeholder="Search by item code or type..."
                value={itemSearch}
                onChange={e => setItemSearch(e.target.value)}
                aria-label="Search inventory"
              />
            </div>
            <div className="returns-item-list">
              {!itemSearch.trim() ? (
                <p className="returns-item-list-hint">Type above to find items to restock.</p>
              ) : itemSuggestions.length === 0 ? (
                <p className="returns-item-list-hint">No items match your search.</p>
              ) : (
                itemSuggestions.map(it => {
                  const code = it.item_code || it.item_sticker || '';
                  const remaining = typeof it.pieces_remaining === 'number' ? it.pieces_remaining : it.pieces;
                  const nameLine = [it.category, it.item_type].filter(Boolean).join(' · ');
                  const active = selectedItem?.id === it.id;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      className={`returns-item-card${active ? ' returns-item-card--active' : ''}`}
                      onClick={() => selectInventoryItem(it)}
                    >
                      <div className="returns-item-card-main">
                        <div className="returns-item-card-code">{code || `Item #${it.id}`}</div>
                        <div className="returns-item-card-name">{it.description || nameLine || '—'}</div>
                        <div className="returns-item-card-tags">
                          <span className="returns-item-tag">{it.category}</span>
                          <span className="returns-item-tag">{it.item_type}</span>
                        </div>
                      </div>
                      <div className="returns-item-card-stock">
                        <span className="returns-item-card-stock-num">{remaining}</span>
                        <span className="returns-item-card-stock-label">current pcs</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="returns-panel">
            <div className="returns-panel-head">
              <h3 className="selling-section-title returns-panel-title">Restock Form</h3>
            </div>
            {!selectedItem ? (
              <div className="returns-panel-empty">
                <IconEmptyBox />
                <p>Select an item to restock</p>
              </div>
            ) : (
              <div className="returns-restock returns-restock--panel">
                <div className="returns-selected">
                  <div className="returns-selected-title">
                    {selectedItem.item_code || selectedItem.item_sticker || `Item #${selectedItem.id}`}
                  </div>
                  <div className="returns-selected-sub">
                    {selectedItem.category} • {selectedItem.item_type}
                  </div>
                  <div className="returns-selected-meta">
                    Current:{' '}
                    {typeof selectedItem.pieces_remaining === 'number'
                      ? selectedItem.pieces_remaining
                      : selectedItem.pieces}{' '}
                    pcs
                  </div>
                </div>
                <div className="returns-restock-row">
                  <label>
                    <span>Restock quantity</span>
                    <input
                      type="number"
                      min={0}
                      className="returns-input"
                      value={restockQty || ''}
                      onChange={e => setRestockQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    />
                  </label>
                </div>
                <label>
                  <span>Note (optional)</span>
                  <textarea
                    className="returns-textarea"
                    rows={3}
                    value={restockNote}
                    onChange={e => setRestockNote(e.target.value)}
                    placeholder="Supplier restock, correction, etc."
                  />
                </label>
                {restockError && <div className="returns-error">{restockError}</div>}
                {restockMessage && <div className="returns-success">{restockMessage}</div>}
                <div className="returns-history">
                  <h5 className="returns-history-title">Recent stock activity</h5>
                  {itemHistoryLoading ? (
                    <p className="returns-empty">Loading history…</p>
                  ) : itemHistoryError ? (
                    <p className="returns-error">{itemHistoryError}</p>
                  ) : itemHistory.length === 0 ? (
                    <p className="returns-empty">No movements recorded yet.</p>
                  ) : (
                    <ul className="returns-history-list">
                      {itemHistory.map(m => (
                        <li key={m.id} className="returns-history-item">
                          <div className="returns-history-main">
                            <span className="returns-history-type">{m.type}</span>
                            <span className="returns-history-qty">
                              {m.qty_change > 0 ? `+${m.qty_change}` : m.qty_change} pcs
                            </span>
                          </div>
                          <div className="returns-history-sub">
                            {new Date(m.created_at).toLocaleString()} · {m.user_name || '—'}
                            {m.note ? ` · ${m.note}` : ''}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="returns-restock-actions">
                  <button type="button" className="primary-button" onClick={performRestock} disabled={restockSaving}>
                    {restockSaving ? 'Restocking…' : 'Restock'}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setSelectedItem(null);
                      setRestockQty(0);
                      setRestockNote('');
                      setRestockError(null);
                      setRestockMessage(null);
                      setItemHistory([]);
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
