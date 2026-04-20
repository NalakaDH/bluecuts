import React, { useEffect, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { DEFAULT_CURRENCY_CODE, formatMoneyAmount } from '../../lib/currencies';
import { dateFromServerUtc } from '../../lib/serverTime';

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
  returnable_qty?: number;
  returned_qty?: number;
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

const IconSearchSm: React.FC = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

const IconDocInvoice: React.FC = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const IconReturnArrow: React.FC = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 .49-3.48" />
  </svg>
);

const IconHexNut: React.FC = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
  </svg>
);

const kpiIco = 15;
const IconKpiInvoiceDoc: React.FC = () => (
  <svg
    width={kpiIco}
    height={kpiIco}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);
const IconKpiListLines: React.FC = () => (
  <svg
    width={kpiIco}
    height={kpiIco}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

function retStatusBadgeClass(s: InvoiceStatus): string {
  if (s === 'Paid') return 'ret-ui-badge-paid';
  if (s === 'Unpaid') return 'ret-ui-badge-unpaid';
  return 'ret-ui-badge-partial';
}

function retActivityBadge(type: string): 'sale' | 'memo' | 'restock' {
  const t = (type || '').toUpperCase();
  if (t.includes('RESTOCK')) return 'restock';
  if (t.includes('MEMO')) return 'memo';
  return 'sale';
}

function retStockDeltaClass(qty: number): string {
  if (qty > 0) return 'ret-ui-delta-pos';
  if (qty < 0) return 'ret-ui-delta-neg';
  return 'ret-ui-delta-zero';
}

function retStockDeltaText(qty: number): string {
  if (qty > 0) return `+${qty} pcs`;
  if (qty < 0) return `${qty} pcs`;
  return '0 pcs';
}

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
  const kpiLineItems = detail
    ? detail.items.filter(it => {
        const sold = Math.floor(Number(it.quantity) || 0);
        const already = Math.floor(Number(it.returned_qty) || 0);
        return Math.max(0, sold - already) > 0;
      }).length
    : null;
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
      listParams.set('returnable_only', '1');

      const statsParams = new URLSearchParams();
      if (invoiceSearch.trim()) statsParams.set('search', invoiceSearch.trim());
      statsParams.set('returnable_only', '1');

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
          returnable_qty: Number(row.returnable_qty) || 0,
          returned_qty: Number(row.returned_qty) || 0,
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

  return (
    <div className="page page-returns">
      <section className="payments-kpi-grid returns-kpi-grid" aria-label="Returns summary">
        <div className="dashT-kpi-sum dashT-kpi-sum--orange returns-kpi-sum">
          <div className="dashT-kpi-sum__top">
            <span className="dashT-kpi-sum__label">Eligible for return</span>
            <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--orange" aria-hidden="true">
              <IconReturnArrow />
            </div>
          </div>
          <div className="dashT-kpi-sum__value">{kpiEligible}</div>
          <div className="payments-kpi-sub returns-kpi-sub">
            Unpaid or partial invoices · matches search · same scope as stats
          </div>
        </div>
        <div className="dashT-kpi-sum dashT-kpi-sum--blue returns-kpi-sum">
          <div className="dashT-kpi-sum__top">
            <span className="dashT-kpi-sum__label">Invoices in list</span>
            <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--blue" aria-hidden="true">
              <IconKpiInvoiceDoc />
            </div>
          </div>
          <div className="dashT-kpi-sum__value">{invoices.length}</div>
          <div className="payments-kpi-sub returns-kpi-sub">
            {kpiPaid} paid in full · {kpiEligible} return-eligible
            {returnStats && returnStats.invoices_count > invoices.length
              ? ` · up to ${returnStats.invoices_count} in scope (list capped)`
              : ''}
          </div>
        </div>
        <div className="dashT-kpi-sum dashT-kpi-sum--green returns-kpi-sum">
          <div className="dashT-kpi-sum__top">
            <span className="dashT-kpi-sum__label">Invoice line items</span>
            <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--green" aria-hidden="true">
              <IconKpiListLines />
            </div>
          </div>
          <div className="dashT-kpi-sum__value">{kpiLineItems != null ? kpiLineItems : '—'}</div>
          <div className="payments-kpi-sub returns-kpi-sub">Selected invoice · lines you can return</div>
        </div>
        <div className="dashT-kpi-sum returns-kpi-sum returns-kpi-sum--stock">
          <div className="dashT-kpi-sum__top">
            <span className="dashT-kpi-sum__label">Item on hand</span>
            <div className="dashT-kpi-sum__icon returns-kpi-sum__icon-stock" aria-hidden="true">
              <IconHexNut />
            </div>
          </div>
          <div className="dashT-kpi-sum__value">{kpiStock != null ? kpiStock : '—'}</div>
          <div className="payments-kpi-sub returns-kpi-sub">Selected restock item · pieces in inventory</div>
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
        <div className="ret-ui-workspace">
          <div className="ret-ui-left-card">
            <div className="ret-ui-card-head">
              <div className="ret-ui-card-title">
                <span className="ret-ui-card-title-icon ret-ui-icon-orange" aria-hidden="true">
                  <IconDocInvoice />
                </span>
                Select Invoice
              </div>
              <p className="ret-ui-card-sub">Only invoices with returnable items are listed</p>
              <div className="ret-ui-card-search">
                <IconSearchSm />
                <input
                  type="search"
                  placeholder="Search by invoice # or customer name…"
                  value={invoiceSearch}
                  onChange={e => setInvoiceSearch(e.target.value)}
                  aria-label="Search invoices"
                />
              </div>
            </div>
            <div className="ret-ui-inv-scroll">
              <table className="ret-ui-inv-table" aria-label="Invoices">
                <thead>
                  <tr>
                    <th scope="col">Invoice #</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Date</th>
                    <th scope="col">Total</th>
                    <th scope="col">Paid</th>
                    <th scope="col">Status</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invLoading ? (
                    <tr>
                      <td colSpan={7} className="ret-ui-panel-msg">
                        Loading…
                      </td>
                    </tr>
                  ) : invError ? (
                    <tr>
                      <td colSpan={7} className="ret-ui-panel-msg--err">
                        {invError}
                      </td>
                    </tr>
                  ) : invoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="ret-ui-panel-msg">
                        No invoices with returnable items found.
                      </td>
                    </tr>
                  ) : (
                    invoices.map(inv => {
                      const rowSel = selectedInvoiceId === inv.id;
                      return (
                        <tr
                          key={inv.id}
                          className={rowSel ? 'ret-ui-inv-row--selected' : undefined}
                          onClick={() => loadInvoiceDetail(inv.id)}
                        >
                          <td className="ret-ui-inv-num">{inv.invoice_no}</td>
                          <td>{inv.customer_name || 'Walk-in'}</td>
                          <td>{dateFromServerUtc(inv.created_at).toLocaleDateString()}</td>
                          <td>{formatMoneyAmount(inv.total, inv.currency_code || DEFAULT_CURRENCY_CODE)}</td>
                          <td>{formatMoneyAmount(inv.paid, inv.currency_code || DEFAULT_CURRENCY_CODE)}</td>
                          <td>
                            <span className={`ret-ui-status-badge ${retStatusBadgeClass(inv.status)}`}>
                              <span className="ret-ui-status-dot" aria-hidden="true" />
                              {inv.status}
                            </span>
                            {(inv.returned_qty || 0) > 0 ? (
                              <div className="ret-ui-col-label" style={{ marginTop: 4 }}>
                                Returned: {inv.returned_qty}
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <button
                              type="button"
                              className={`ret-ui-btn-select${rowSel ? ' ret-ui-btn-select--active' : ''}`}
                              onClick={e => {
                                e.stopPropagation();
                                loadInvoiceDetail(inv.id);
                              }}
                            >
                              {rowSel ? 'Selected' : 'Select'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="ret-ui-right-card ret-ui-right-card--returns">
            <div className="ret-ui-right-head">
              <div className="ret-ui-right-title">Return Summary</div>
            </div>
            {!detailLoading && !detail && !detailError && (
              <div className="ret-ui-empty-block ret-ui-empty-block--sm">
                <div className="ret-ui-empty-icon--muted" aria-hidden="true">
                  <IconReturnArrow />
                </div>
                <p>Select an invoice to view items and set return quantities</p>
              </div>
            )}
            {detailLoading && <div className="ret-ui-panel-msg">Loading invoice…</div>}
            {!detailLoading && detailError && !detail && <div className="ret-ui-panel-msg--err">{detailError}</div>}
            {!detailLoading && detail && (
              <div className="ret-ui-summary-stack">
                {(() => {
                  const allReturned = detail.items.every(it => {
                    const sold = Math.floor(Number(it.quantity) || 0);
                    const already = Math.floor(Number(it.returned_qty) || 0);
                    return Math.max(0, sold - already) <= 0;
                  });
                  return (
                <div className="ret-ui-inv-meta">
                  <div className="ret-ui-inv-meta-id">{detail.invoice_no}</div>
                  <div className="ret-ui-inv-meta-sub">
                    {detail.customer_name || 'Walk-in'} · {dateFromServerUtc(detail.created_at).toLocaleString()}
                  </div>
                  {allReturned ? (
                    <div className="ret-ui-status-badge ret-ui-badge-paid" style={{ marginTop: 8, width: 'fit-content' }}>
                      <span className="ret-ui-status-dot" aria-hidden="true" />
                      Fully Returned
                    </div>
                  ) : null}
                  <div className="ret-ui-inv-meta-total">
                    {formatMoneyAmount(detail.total, detail.currency_code || DEFAULT_CURRENCY_CODE)}
                  </div>
                </div>
                  );
                })()}
                {detailError ? <div className="ret-ui-panel-msg--err">{detailError}</div> : null}
                <div className="ret-ui-return-items-scroll">
                  <div className="ret-ui-section-label">Items to Return</div>
                  {detail.items
                    .filter(it => {
                      const sold = Math.floor(Number(it.quantity) || 0);
                      const already = Math.floor(Number(it.returned_qty) || 0);
                      return Math.max(0, sold - already) > 0;
                    })
                    .map(it => {
                    const sold = Math.floor(Number(it.quantity) || 0);
                    const already = Math.floor(Number(it.returned_qty) || 0);
                    const canReturn = Math.max(0, sold - already);
                    const draft = Math.floor(Number(returnDraft[it.id] || 0));
                    const clamped = Math.max(0, Math.min(draft, canReturn));
                    const code = it.item_code || `#${it.inventory_item_id}`;
                    const cur = detail.currency_code || DEFAULT_CURRENCY_CODE;
                    return (
                      <div key={it.id} className="ret-ui-return-row">
                        <div className="ret-ui-return-item-main">
                          <div className="ret-ui-return-item-name">{it.description || code}</div>
                          <div className="ret-ui-return-item-meta">
                            Code {code} · {it.quantity} sold · {formatMoneyAmount(it.line_total, cur)}
                            {already > 0 ? ` · ${already} returned` : ''}
                          </div>
                        </div>
                        <div>
                          <div className="ret-ui-col-label">Qty</div>
                          <div className="ret-ui-col-val">{it.quantity}</div>
                        </div>
                        <div>
                          <div className="ret-ui-col-label">Price</div>
                          <div className="ret-ui-col-val">{formatMoneyAmount(it.unit_price, cur)}</div>
                        </div>
                        <div>
                          <div className="ret-ui-col-label">Return Qty</div>
                          <input
                            type="number"
                            min={0}
                            max={canReturn}
                            className="ret-ui-qty-input"
                            value={Number.isFinite(clamped) ? clamped : 0}
                            onChange={e => {
                              const v = Math.max(0, Math.min(canReturn, Math.floor(Number(e.target.value) || 0)));
                              setReturnDraft(prev => ({ ...prev, [it.id]: v }));
                            }}
                            disabled={returnSaving || canReturn <= 0}
                            title={canReturn <= 0 ? 'Fully returned' : `Return up to ${canReturn} pc(s)`}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {detail.items.every(it => {
                    const sold = Math.floor(Number(it.quantity) || 0);
                    const already = Math.floor(Number(it.returned_qty) || 0);
                    return Math.max(0, sold - already) <= 0;
                  }) ? (
                    <div className="ret-ui-panel-msg">All items on this invoice are already fully returned.</div>
                  ) : null}
                </div>
                <div className="ret-ui-right-footer">
                  <button type="button" className="ret-ui-btn-return" onClick={submitReturn} disabled={returnSaving}>
                    <IconReturnArrow />
                    {returnSaving ? 'Processing…' : 'Return to Stock'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {mainTab === 'restock' && (
        <div className="ret-ui-workspace">
          <div className="ret-ui-left-card">
            <div className="ret-ui-card-head">
              <div className="ret-ui-card-title">
                <span className="ret-ui-card-title-icon ret-ui-icon-orange" aria-hidden="true">
                  <IconSearchSm />
                </span>
                Search Items
              </div>
              <p className="ret-ui-card-sub">Search by item code or name to restock</p>
              <div className="ret-ui-card-search">
                <IconSearchSm />
                <input
                  type="search"
                  placeholder="Search by item code or type…"
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                  aria-label="Search inventory"
                />
              </div>
            </div>
            {!itemSearch.trim() ? (
              <div className="ret-ui-empty-block">
                <div className="ret-ui-empty-icon ret-ui-empty-icon--teal" aria-hidden="true">
                  <IconSearchSm />
                </div>
                <p>Type above to find items to restock</p>
              </div>
            ) : (
              <div className="ret-ui-inv-scroll" style={{ padding: '0 20px 16px' }}>
                {itemSuggestions.length === 0 ? (
                  <p className="ret-ui-panel-msg">No items match your search.</p>
                ) : (
                  itemSuggestions.map(it => {
                    const code = (it.item_code || it.item_sticker || '').trim() || '—';
                    const remaining = typeof it.pieces_remaining === 'number' ? it.pieces_remaining : it.pieces;
                    const nameLine = it.description?.trim() || [it.category, it.item_type].filter(Boolean).join(' · ') || '—';
                    const active = selectedItem?.id === it.id;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        className={`ret-ui-item-result${active ? ' ret-ui-item-result--selected' : ''}`}
                        onClick={() => selectInventoryItem(it)}
                      >
                        <div className="ret-ui-item-result-left">
                          <div className="ret-ui-item-code">{code.slice(0, 3).toUpperCase()}</div>
                          <div>
                            <div className="ret-ui-item-name">{nameLine}</div>
                            <div className="ret-ui-item-tags">
                              {it.category ? <span className="ret-ui-item-tag">{it.category}</span> : null}
                              {it.item_type ? <span className="ret-ui-item-tag">{it.item_type}</span> : null}
                            </div>
                          </div>
                        </div>
                        <div className="ret-ui-item-stock">
                          <div className="ret-ui-item-stock-num">{remaining}</div>
                          <div className="ret-ui-item-stock-label">current pcs</div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className="ret-ui-right-card ret-ui-right-card--restock">
            <div className="ret-ui-right-head">
              <div className="ret-ui-right-title">Restock Form</div>
            </div>
            {!selectedItem ? (
              <div className="ret-ui-empty-block ret-ui-empty-block--sm">
                <div className="ret-ui-empty-icon--muted" aria-hidden="true">
                  <IconHexNut />
                </div>
                <p>Select an item from the left to fill in the restock form</p>
              </div>
            ) : (
              <div className="ret-ui-restock-stack">
                <div className="ret-ui-restock-scroll">
                  <div className="ret-ui-restock-info">
                    <div className="ret-ui-restock-info-head">
                      <div className="ret-ui-restock-code">
                        {(selectedItem.item_code || selectedItem.item_sticker || '—').slice(0, 1).toUpperCase() || '—'}
                      </div>
                      <div>
                        <div className="ret-ui-restock-item-name">
                          {selectedItem.description?.trim() ||
                            [selectedItem.category, selectedItem.item_type].filter(Boolean).join(' · ') ||
                            `Item #${selectedItem.id}`}
                        </div>
                        <div className="ret-ui-restock-item-sub">
                          Gem code {selectedItem.item_code || selectedItem.item_sticker || selectedItem.id}
                        </div>
                      </div>
                    </div>
                    <div className="ret-ui-restock-stock-pill">
                      Current stock:{' '}
                      <span className="ret-ui-stock-em">
                        {typeof selectedItem.pieces_remaining === 'number'
                          ? selectedItem.pieces_remaining
                          : selectedItem.pieces}{' '}
                        pcs
                      </span>
                    </div>
                  </div>

                  <div className="ret-ui-form-group">
                    <label className="ret-ui-form-label" htmlFor="ret-ui-restock-qty">
                      Restock Quantity *
                    </label>
                    <input
                      id="ret-ui-restock-qty"
                      type="number"
                      min={0}
                      className="ret-ui-form-input"
                      value={restockQty || ''}
                      onChange={e => setRestockQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                      placeholder="Enter quantity to add"
                    />
                  </div>

                  <div className="ret-ui-form-group">
                    <label className="ret-ui-form-label" htmlFor="ret-ui-restock-note">
                      Note <span>(optional)</span>
                    </label>
                    <textarea
                      id="ret-ui-restock-note"
                      className="ret-ui-form-textarea"
                      rows={3}
                      value={restockNote}
                      onChange={e => setRestockNote(e.target.value)}
                      placeholder="Supplier restock, correction, audit…"
                    />
                  </div>

                  {restockError && <div className="returns-error">{restockError}</div>}
                  {restockMessage && <div className="returns-success">{restockMessage}</div>}

                  <div>
                    <div className="ret-ui-activity-label">
                      Recent Stock Activity <span className="ret-ui-activity-line" aria-hidden="true" />
                    </div>
                    <div className="ret-ui-activity-log">
                      {itemHistoryLoading ? (
                        <p className="ret-ui-panel-msg">Loading history…</p>
                      ) : itemHistoryError ? (
                        <p className="ret-ui-panel-msg--err">{itemHistoryError}</p>
                      ) : itemHistory.length === 0 ? (
                        <p className="ret-ui-panel-msg">No movements recorded yet.</p>
                      ) : (
                        itemHistory.map(m => {
                          const kind = retActivityBadge(m.type);
                          const badgeClass =
                            kind === 'restock'
                              ? 'ret-ui-activity-badge ret-ui-badge-restock'
                              : kind === 'memo'
                                ? 'ret-ui-activity-badge ret-ui-badge-memo'
                                : 'ret-ui-activity-badge ret-ui-badge-sale';
                          const label = kind === 'restock' ? 'Restock' : kind === 'memo' ? 'Memo Out' : 'Sale';
                          const desc =
                            m.note?.trim() ||
                            [m.type, m.ref_type && `#${m.ref_id}`].filter(Boolean).join(' · ') ||
                            'Stock movement';
                          return (
                            <div key={m.id} className="ret-ui-activity-entry">
                              <span className={badgeClass}>{label}</span>
                              <div className="ret-ui-activity-main">
                                <div className="ret-ui-activity-desc">{desc}</div>
                                <div className="ret-ui-activity-time">
                                  {dateFromServerUtc(m.created_at).toLocaleString()} · {m.user_name || '—'}
                                </div>
                              </div>
                              <div className={`ret-ui-activity-delta ${retStockDeltaClass(m.qty_change)}`}>
                                {retStockDeltaText(m.qty_change)}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
                <div className="ret-ui-right-footer">
                  <button
                    type="button"
                    className="ret-ui-btn-restock"
                    onClick={performRestock}
                    disabled={restockSaving}
                  >
                    <IconHexNut />
                    {restockSaving ? 'Restocking…' : 'Restock'}
                  </button>
                  <button
                    type="button"
                    className="ret-ui-btn-clear"
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
          </div>
        </div>
      )}
    </div>
  );
};
