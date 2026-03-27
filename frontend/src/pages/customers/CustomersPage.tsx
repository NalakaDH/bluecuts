import React, { useEffect, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { DEFAULT_CURRENCY_CODE, formatMoneyAmount } from '../../lib/currencies';

const IconSearch: React.FC = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

interface CustomerRow {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  invoices: number;
  totalInvoiced: number;
  totalPaid: number;
  totalOwed: number;
  lastInvoiceAt?: string;
}

interface CustomerKpiStats {
  customer_count: number;
  total_invoiced: number;
  total_paid: number;
  total_owed: number;
  /** Sum of MIN(invoice total, paid) in THB — ties to outstanding (invoiced − applied = owed). */
  applied_to_invoices_thb: number;
  /** Portion of payments above invoice face (THB equiv). */
  overpayment_thb: number;
}

interface ApiCustomer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
  created_at: string;
  updated_at: string;
  invoices_count: number;
  total_invoiced: number;
  total_paid: number;
  total_owed: number;
  last_invoice_at: string | null;
}

interface CustomersPageProps {
  token: string;
}

interface CustomerInvoiceRow {
  id: number;
  invoice_no: string;
  created_at: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
  items_count: number;
  currency_code?: string | null;
}

interface CustomerMemoRow {
  id: number;
  memo_no: string;
  status: string;
  memo_date: string;
  due_date: string | null;
  notes: string | null;
  currency_code: string;
  items_count: number;
  total_value: number;
  converted_invoice_id: number | null;
}

interface CustomerDetailResponse {
  customer: ApiCustomer;
  invoices: CustomerInvoiceRow[];
  memos: CustomerMemoRow[];
}

interface MemoDetailItem {
  id: number;
  item_code: string | null;
  description: string;
  quantity: number;
  returned_qty: number;
  unit_price: number;
  line_total: number;
}

interface MemoDetailResponse {
  id: number;
  memo_no: string;
  status: string;
  memo_date: string;
  due_date: string | null;
  notes: string | null;
  currency_code: string;
  converted_invoice_id: number | null;
  items: MemoDetailItem[];
}

function memoStatusClass(status: string): string {
  const key = String(status).toLowerCase().replace(/\s+/g, '-');
  return `memo-status memo-status--${key}`;
}

type AddCustomerFormState = {
  name: string;
  phone: string;
  email: string;
  notes: string;
  address_line1: string;
  address_line2: string;
  city: string;
  postal_code: string;
  country: string;
};

const INITIAL_ADD_CUSTOMER_FORM: AddCustomerFormState = {
  name: '',
  phone: '',
  email: '',
  notes: '',
  address_line1: '',
  address_line2: '',
  city: '',
  postal_code: '',
  country: '',
};

/** Renders YYYY-MM-DD (or leading YYYY-MM-DD in a datetime) without local-TZ day shift. */
function formatStoredCalendarDate(raw: string | null | undefined): string {
  if (!raw) return '—';
  const s = String(raw).trim();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!ymd) {
    try {
      return new Date(s).toLocaleDateString();
    } catch {
      return s;
    }
  }
  const y = Number(ymd[1]);
  const m = Number(ymd[2]) - 1;
  const d = Number(ymd[3]);
  return new Date(Date.UTC(y, m, d)).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export const CustomersPage: React.FC<CustomersPageProps> = ({ token }) => {
  const { showAlert, showConfirm } = useAlertDialog();
  const [search, setSearch] = useState('');
  const [filterOwed, setFilterOwed] = useState<'all' | 'withBalance'>('all');
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [kpiStats, setKpiStats] = useState<CustomerKpiStats | null>(null);
  const [listTruncated, setListTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const emptyAddForm = () => ({
    name: '',
    phone: '',
    email: '',
    notes: '',
    address_line1: '',
    address_line2: '',
    city: '',
    postal_code: '',
    country: '',
  });
  const [form, setForm] = useState(emptyAddForm);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerDetailResponse | null>(null);
  const [duplicateMatches, setDuplicateMatches] = useState<
    { id: number; name: string; phone: string | null; email: string | null }[]
  >([]);
  const [forceDuplicateAck, setForceDuplicateAck] = useState(false);
  const [memoDetailOpen, setMemoDetailOpen] = useState(false);
  const [memoDetailLoading, setMemoDetailLoading] = useState(false);
  const [memoDetailError, setMemoDetailError] = useState<string | null>(null);
  const [memoDetail, setMemoDetail] = useState<MemoDetailResponse | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<AddCustomerFormState>({ ...INITIAL_ADD_CUSTOMER_FORM });
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchCustomers = async (term: string, onlyWithBalance: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const listParams = new URLSearchParams();
      if (term.trim()) listParams.set('search', term.trim());
      listParams.set('limit', '500');
      if (onlyWithBalance) listParams.set('only_with_balance', 'true');

      const statsParams = new URLSearchParams();
      if (term.trim()) statsParams.set('search', term.trim());
      if (onlyWithBalance) statsParams.set('only_with_balance', 'true');

      const [listRes, statsRes] = await Promise.all([
        fetch(apiUrl(`/api/customers?${listParams.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(apiUrl(`/api/customers/stats?${statsParams.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (!listRes.ok) {
        const msg = await parseErrorResponse(listRes, 'Failed to load customers');
        throw new Error(msg);
      }
      if (!statsRes.ok) {
        const msg = await parseErrorResponse(statsRes, 'Failed to load customer totals');
        throw new Error(msg);
      }
      const data: ApiCustomer[] = await listRes.json();
      const statsRaw = (await statsRes.json()) as Partial<CustomerKpiStats> & {
        customer_count?: number;
        total_invoiced?: number;
        total_paid?: number;
        total_owed?: number;
      };
      const ti = Number(statsRaw.total_invoiced) || 0;
      const tp = Number(statsRaw.total_paid) || 0;
      const to = Number(statsRaw.total_owed) || 0;
      const applied =
        statsRaw.applied_to_invoices_thb != null
          ? Number(statsRaw.applied_to_invoices_thb)
          : ti - to;
      const over =
        statsRaw.overpayment_thb != null
          ? Number(statsRaw.overpayment_thb)
          : Math.max(0, tp - applied);
      setKpiStats({
        customer_count: Number(statsRaw.customer_count) || 0,
        total_invoiced: ti,
        total_paid: tp,
        total_owed: to,
        applied_to_invoices_thb: applied,
        overpayment_thb: over,
      });
      const totalMatching = Number(statsRaw.customer_count) || 0;
      setListTruncated(data.length >= 500 && totalMatching > 500);
      setCustomers(
        data.map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phone || undefined,
          email: c.email || undefined,
          invoices: Number(c.invoices_count) || 0,
          totalInvoiced: Number(c.total_invoiced) || 0,
          totalPaid: Number(c.total_paid) || 0,
          totalOwed: Number(c.total_owed) || 0,
          lastInvoiceAt: c.last_invoice_at || undefined,
        }))
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load customers';
      setError(msg);
      setCustomers([]);
      setKpiStats(null);
      setListTruncated(false);
      showAlert({ title: 'Could not load customers', message: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const id = setTimeout(() => {
      fetchCustomers(search, filterOwed === 'withBalance');
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced search; showAlert is stable
  }, [search, filterOwed, token]);

  const openDetail = async (id: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const res = await fetch(apiUrl(`/api/customers/${id}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load customer');
        throw new Error(msg);
      }
      const data: CustomerDetailResponse = await res.json();
      setDetail({
        ...data,
        memos: Array.isArray(data.memos) ? data.memos : [],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load customer';
      setDetailError(msg);
      showAlert({ title: 'Could not load customer', message: msg, variant: 'error' });
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    setDuplicateMatches([]);
    setForceDuplicateAck(false);
  }, [form.name, form.phone, form.email]);

  const openEditCustomer = async (id: number) => {
    setEditOpen(true);
    setEditingId(id);
    setEditError(null);
    setEditLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/customers/${id}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load customer');
        throw new Error(msg);
      }
      const data: CustomerDetailResponse = await res.json();
      const c = data.customer;
      setEditForm({
        name: c.name || '',
        phone: c.phone || '',
        email: c.email || '',
        notes: c.notes || '',
        address_line1: c.address_line1 || '',
        address_line2: c.address_line2 || '',
        city: c.city || '',
        postal_code: c.postal_code || '',
        country: c.country || '',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load customer';
      setEditError(msg);
      showAlert({ title: 'Could not load customer', message: msg, variant: 'error' });
      setEditOpen(false);
      setEditingId(null);
    } finally {
      setEditLoading(false);
    }
  };

  const openEditFromDetail = () => {
    if (!detail?.customer?.id) return;
    const c = detail.customer;
    setEditingId(c.id);
    setEditError(null);
    setEditLoading(false);
    setEditForm({
      name: c.name || '',
      phone: c.phone || '',
      email: c.email || '',
      notes: c.notes || '',
      address_line1: c.address_line1 || '',
      address_line2: c.address_line2 || '',
      city: c.city || '',
      postal_code: c.postal_code || '',
      country: c.country || '',
    });
    setEditOpen(true);
  };

  const saveEditCustomer = async () => {
    if (editingId == null) return;
    if (!editForm.name.trim()) {
      const msg = 'Customer name is required.';
      setEditError(msg);
      showAlert({ title: 'Edit customer', message: msg, variant: 'warning' });
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(apiUrl(`/api/customers/${editingId}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: editForm.name.trim(),
          phone: editForm.phone.trim() || null,
          email: editForm.email.trim() || null,
          notes: editForm.notes.trim() || null,
          address_line1: editForm.address_line1.trim() || null,
          address_line2: editForm.address_line2.trim() || null,
          city: editForm.city.trim() || null,
          postal_code: editForm.postal_code.trim() || null,
          country: editForm.country.trim() || null,
        }),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to update customer');
        throw new Error(msg);
      }
      const savedId = editingId;
      const savedName = editForm.name.trim();
      setEditOpen(false);
      setEditingId(null);
      showAlert({
        title: 'Customer updated',
        message: `“${savedName}” was saved successfully.`,
        variant: 'success',
      });
      fetchCustomers(search, filterOwed === 'withBalance');
      if (detailOpen && detail?.customer?.id === savedId) {
        openDetail(savedId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update customer';
      setEditError(msg);
      showAlert({ title: 'Could not save changes', message: msg, variant: 'error' });
    } finally {
      setEditSaving(false);
    }
  };

  const deleteCustomer = async (id: number, nameHint?: string) => {
    const label = nameHint || 'this customer';
    const ok = await showConfirm({
      title: 'Delete customer?',
      message: `Delete ${label}? This cannot be undone. Customers with invoices or memos on file cannot be deleted (the server will reject the request).`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(apiUrl(`/api/customers/${id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to delete customer');
        throw new Error(msg);
      }
      showAlert({
        title: 'Customer deleted',
        message: 'The customer was removed from your records.',
        variant: 'success',
      });
      fetchCustomers(search, filterOwed === 'withBalance');
      if (detailOpen && detail?.customer?.id === id) {
        setDetailOpen(false);
        setDetail(null);
      }
      if (editOpen && editingId === id) {
        setEditOpen(false);
        setEditingId(null);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete customer';
      showAlert({ title: 'Could not delete customer', message: msg, variant: 'error' });
    }
  };

  const openMemoDetail = async (memoId: number) => {
    setMemoDetailOpen(true);
    setMemoDetailLoading(true);
    setMemoDetailError(null);
    setMemoDetail(null);
    try {
      const res = await fetch(apiUrl(`/api/memos/${memoId}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load memo');
        throw new Error(msg);
      }
      const data: MemoDetailResponse = await res.json();
      setMemoDetail(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load memo';
      setMemoDetailError(msg);
      showAlert({ title: 'Could not load memo', message: msg, variant: 'error' });
    } finally {
      setMemoDetailLoading(false);
    }
  };

  const saveCustomer = async () => {
    if (!form.name.trim()) {
      const msg = 'Customer name is required.';
      setSaveError(msg);
      showAlert({ title: 'Add customer', message: msg, variant: 'warning' });
      return;
    }
    if (duplicateMatches.length > 0 && !forceDuplicateAck) {
      const msg = 'Confirm below if you still want to add this customer.';
      setSaveError(msg);
      showAlert({ title: 'Possible duplicate', message: msg, variant: 'warning' });
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(apiUrl('/api/customers'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          notes: form.notes.trim() || null,
          address_line1: form.address_line1.trim() || null,
          address_line2: form.address_line2.trim() || null,
          city: form.city.trim() || null,
          postal_code: form.postal_code.trim() || null,
          country: form.country.trim() || null,
          ...(forceDuplicateAck && duplicateMatches.length > 0 ? { force_duplicate: true } : {}),
        }),
      });
      if (res.status === 409) {
        let data: { error?: string; duplicates?: { id: number; name: string; phone: string | null; email: string | null }[] } =
          {};
        try {
          data = await res.json();
        } catch {
          /* ignore */
        }
        setDuplicateMatches(Array.isArray(data.duplicates) ? data.duplicates : []);
        setForceDuplicateAck(false);
        const dupMsg = data.error || 'This phone or email is already on file.';
        setSaveError(dupMsg);
        showAlert({ title: 'Duplicate customer', message: dupMsg, variant: 'warning' });
        return;
      }
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to add customer');
        throw new Error(msg);
      }
      const savedName = form.name.trim();
      setAddOpen(false);
      setForm({ ...INITIAL_ADD_CUSTOMER_FORM });
      setDuplicateMatches([]);
      setForceDuplicateAck(false);
      showAlert({
        title: 'Customer saved',
        message: `“${savedName}” was added successfully.`,
        variant: 'success',
      });
      fetchCustomers(search, filterOwed === 'withBalance');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add customer';
      setSaveError(msg);
      showAlert({ title: 'Could not save customer', message: msg, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page page-customers">
      <section className="payments-kpi-grid" aria-label="Customer summary stats">
        <div className="payments-kpi-card payments-kpi-card--blue">
          <div className="payments-kpi-label">Total Customers</div>
          <div className="payments-kpi-value">{kpiStats?.customer_count ?? 0}</div>
          <div className="payments-kpi-sub">
            Full count for current search & balance filter (not capped by the table)
            {listTruncated ? ' · Table shows first 500 rows; refine search to narrow' : ''}
          </div>
        </div>
        <div className="payments-kpi-card payments-kpi-card--amber">
          <div className="payments-kpi-label">Total invoiced</div>
          <div className="payments-kpi-value">
            {formatMoneyAmount(kpiStats?.total_invoiced ?? 0, DEFAULT_CURRENCY_CODE)}
          </div>
          <div className="payments-kpi-sub">
            THB equivalent · Red card = this minus &quot;Applied&quot; (green)
          </div>
        </div>
        <div className="payments-kpi-card payments-kpi-card--green">
          <div className="payments-kpi-label">Applied to invoices</div>
          <div className="payments-kpi-value">
            {formatMoneyAmount(kpiStats?.applied_to_invoices_thb ?? 0, DEFAULT_CURRENCY_CODE)}
          </div>
          <div className="payments-kpi-sub">
            Amount counted against invoice totals (THB equiv.) · All payments logged:{' '}
            {formatMoneyAmount(kpiStats?.total_paid ?? 0, DEFAULT_CURRENCY_CODE)}
            {(kpiStats?.overpayment_thb ?? 0) > 0.005
              ? ` · includes ${formatMoneyAmount(kpiStats?.overpayment_thb ?? 0, DEFAULT_CURRENCY_CODE)} paid beyond invoice totals`
              : ''}
          </div>
        </div>
        <div className="payments-kpi-card payments-kpi-card--red">
          <div className="payments-kpi-label">Outstanding balance</div>
          <div className="payments-kpi-value">
            {formatMoneyAmount(kpiStats?.total_owed ?? 0, DEFAULT_CURRENCY_CODE)}
          </div>
          <div className="payments-kpi-sub">
            Still due on open balances (THB equiv.) · Walk-in invoices without a customer are excluded
          </div>
        </div>
      </section>

      <section className="customers-toolbar-card">
        <div className="customers-toolbar-row customers-toolbar-row--top">
          <div className="selling-invoices-search-wrap customers-search-wrap">
            <span className="selling-invoices-search-icon" aria-hidden="true">
              <IconSearch />
            </span>
            <input
              type="search"
              className="selling-invoices-search"
              placeholder="Search by name, phone, or email"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search customers"
            />
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setAddOpen(true);
              setSaveError(null);
              setDuplicateMatches([]);
              setForceDuplicateAck(false);
            }}
          >
            + Add Customer
          </button>
        </div>
        <div className="customers-toolbar-row customers-toolbar-row--bottom">
          <label className="customers-toggle">
            <input
              type="checkbox"
              checked={filterOwed === 'withBalance'}
              onChange={e => setFilterOwed(e.target.checked ? 'withBalance' : 'all')}
            />
            <span>Show only customers with an outstanding balance</span>
          </label>
        </div>
      </section>

      <section className="customers-list-card">
        <h3 className="selling-section-title">Customer List</h3>
        <div className="customers-table-wrap">
          <table className="customers-table" aria-label="Customers">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Phone</th>
                <th scope="col">Email</th>
                <th scope="col">Invoices</th>
                <th scope="col">Invoiced (THB)</th>
                <th scope="col">Paid (THB)</th>
                <th scope="col">Balance (THB)</th>
                <th scope="col">Last invoice</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="customers-empty-cell">
                    Loading customers…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={9} className="customers-empty-cell">
                    {error}
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="customers-empty-cell">
                    No customers found.
                  </td>
                </tr>
              ) : (
                customers.map(c => (
                  <tr key={c.id}>
                    <td className="customers-name">{c.name}</td>
                    <td>{c.phone || '?'}</td>
                    <td>{c.email || '?'}</td>
                    <td>{c.invoices}</td>
                    <td>{formatMoneyAmount(c.totalInvoiced, DEFAULT_CURRENCY_CODE)}</td>
                    <td className="customers-paid">{formatMoneyAmount(c.totalPaid, DEFAULT_CURRENCY_CODE)}</td>
                    <td className={c.totalOwed > 0 ? 'customers-balance customers-balance--neg' : 'customers-balance'}>
                      {formatMoneyAmount(c.totalOwed, DEFAULT_CURRENCY_CODE)}
                    </td>
                    <td>{c.lastInvoiceAt ? formatStoredCalendarDate(c.lastInvoiceAt) : '?'}</td>
                    <td className="customers-actions customers-actions--split">
                      <button type="button" className="ghost-button small" onClick={() => openDetail(c.id)}>
                        View
                      </button>
                      <button type="button" className="ghost-button small" onClick={() => openEditCustomer(c.id)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {addOpen && (
        <div className="customers-modal-overlay" role="dialog" aria-modal="true">
          <div className="customers-modal">
            <div className="customers-modal-header">
              <h3>Add New Customer</h3>
              <button
                type="button"
                className="customers-modal-close"
                onClick={() => {
                  setAddOpen(false);
                  setDuplicateMatches([]);
                  setForceDuplicateAck(false);
                  setSaveError(null);
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="customers-modal-body">
              <div className="customers-form-section">
                <p className="customers-form-section-title">Contact</p>
                <label>
                  <span>Customer name</span>
                  <input
                    value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Full name or business name"
                    autoComplete="name"
                  />
                </label>
                <label>
                  <span>Phone</span>
                  <input
                    value={form.phone}
                    onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="e.g. 0771234567"
                    autoComplete="tel"
                  />
                </label>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="customer@example.com"
                    autoComplete="email"
                  />
                </label>
              </div>

              <div className="customers-form-section">
                <p className="customers-form-section-title">Mailing address</p>
                <p className="customers-form-hint">
                  Used on invoices and memos. All fields are optional but filling them avoids retyping later.
                </p>
                <label>
                  <span>Address line 1</span>
                  <input
                    value={form.address_line1}
                    onChange={e => setForm(prev => ({ ...prev, address_line1: e.target.value }))}
                    placeholder="Street, building, suite"
                    autoComplete="address-line1"
                  />
                </label>
                <label>
                  <span>Address line 2</span>
                  <input
                    value={form.address_line2}
                    onChange={e => setForm(prev => ({ ...prev, address_line2: e.target.value }))}
                    placeholder="Unit, district, landmark…"
                    autoComplete="address-line2"
                  />
                </label>
                <div className="customers-form-row-2">
                  <label>
                    <span>City</span>
                    <input
                      value={form.city}
                      onChange={e => setForm(prev => ({ ...prev, city: e.target.value }))}
                      placeholder="City"
                      autoComplete="address-level2"
                    />
                  </label>
                  <label>
                    <span>Postal code</span>
                    <input
                      value={form.postal_code}
                      onChange={e => setForm(prev => ({ ...prev, postal_code: e.target.value }))}
                      placeholder="Postal / ZIP"
                      autoComplete="postal-code"
                    />
                  </label>
                </div>
                <label>
                  <span>Country</span>
                  <input
                    value={form.country}
                    onChange={e => setForm(prev => ({ ...prev, country: e.target.value }))}
                    placeholder="Country"
                    autoComplete="country-name"
                  />
                </label>
              </div>

              <div className="customers-form-section">
                <p className="customers-form-section-title">Notes</p>
                <label>
                  <span>Internal notes (optional)</span>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                    rows={3}
                    placeholder="Payment preferences, VIP, sourcing notes…"
                  />
                </label>
              </div>

              {duplicateMatches.length > 0 && (
                <div className="customers-duplicate-block" role="alert">
                  <p className="customers-duplicate-title">Possible duplicate</p>
                  <ul className="customers-duplicate-list">
                    {duplicateMatches.map(d => (
                      <li key={d.id}>
                        <strong>{d.name}</strong>
                        {d.phone ? ` · ${d.phone}` : ''}
                        {d.email ? ` · ${d.email}` : ''}
                      </li>
                    ))}
                  </ul>
                  <label className="customers-duplicate-confirm">
                    <input
                      type="checkbox"
                      checked={forceDuplicateAck}
                      onChange={e => setForceDuplicateAck(e.target.checked)}
                    />
                    <span>This is a different person — save anyway</span>
                  </label>
                </div>
              )}

              {saveError && <p className="customers-modal-error">{saveError}</p>}
            </div>
            <div className="customers-modal-footer">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setAddOpen(false);
                  setDuplicateMatches([]);
                  setForceDuplicateAck(false);
                  setSaveError(null);
                }}
              >
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={saveCustomer} disabled={saving}>
                {saving ? 'Adding…' : 'Add Customer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="customers-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="customers-edit-title">
          <div className="customers-modal">
            <div className="customers-modal-header">
              <h3 id="customers-edit-title">Edit Customer</h3>
              <button
                type="button"
                className="customers-modal-close"
                onClick={() => {
                  setEditOpen(false);
                  setEditingId(null);
                  setEditError(null);
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="customers-modal-body">
              {editLoading ? (
                <p className="customers-empty-cell">Loading…</p>
              ) : (
                <>
                  <div className="customers-form-section">
                    <p className="customers-form-section-title">Contact</p>
                    <label>
                      <span>Customer name</span>
                      <input
                        value={editForm.name}
                        onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Full name or business name"
                        autoComplete="name"
                      />
                    </label>
                    <label>
                      <span>Phone</span>
                      <input
                        value={editForm.phone}
                        onChange={e => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="e.g. 0771234567"
                        autoComplete="tel"
                      />
                    </label>
                    <label>
                      <span>Email</span>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={e => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="customer@example.com"
                        autoComplete="email"
                      />
                    </label>
                  </div>

                  <div className="customers-form-section">
                    <p className="customers-form-section-title">Mailing address</p>
                    <label>
                      <span>Address line 1</span>
                      <input
                        value={editForm.address_line1}
                        onChange={e => setEditForm(prev => ({ ...prev, address_line1: e.target.value }))}
                        placeholder="Street, building, suite"
                        autoComplete="address-line1"
                      />
                    </label>
                    <label>
                      <span>Address line 2</span>
                      <input
                        value={editForm.address_line2}
                        onChange={e => setEditForm(prev => ({ ...prev, address_line2: e.target.value }))}
                        placeholder="Unit, district, landmark…"
                        autoComplete="address-line2"
                      />
                    </label>
                    <div className="customers-form-row-2">
                      <label>
                        <span>City</span>
                        <input
                          value={editForm.city}
                          onChange={e => setEditForm(prev => ({ ...prev, city: e.target.value }))}
                          placeholder="City"
                          autoComplete="address-level2"
                        />
                      </label>
                      <label>
                        <span>Postal code</span>
                        <input
                          value={editForm.postal_code}
                          onChange={e => setEditForm(prev => ({ ...prev, postal_code: e.target.value }))}
                          placeholder="Postal / ZIP"
                          autoComplete="postal-code"
                        />
                      </label>
                    </div>
                    <label>
                      <span>Country</span>
                      <input
                        value={editForm.country}
                        onChange={e => setEditForm(prev => ({ ...prev, country: e.target.value }))}
                        placeholder="Country"
                        autoComplete="country-name"
                      />
                    </label>
                  </div>

                  <div className="customers-form-section">
                    <p className="customers-form-section-title">Notes</p>
                    <label>
                      <span>Internal notes (optional)</span>
                      <textarea
                        value={editForm.notes}
                        onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                        rows={3}
                        placeholder="Payment preferences, VIP, sourcing notes…"
                      />
                    </label>
                  </div>
                </>
              )}
              {editError && <p className="customers-modal-error">{editError}</p>}
            </div>
            <div className="customers-modal-footer">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setEditOpen(false);
                  setEditingId(null);
                  setEditError(null);
                }}
              >
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={saveEditCustomer} disabled={editSaving || editLoading}>
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailOpen && (
        <div
          className="customers-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={e => {
            if (e.target === e.currentTarget) setDetailOpen(false);
          }}
        >
          <div className="customers-detail" onClick={e => e.stopPropagation()}>
            {detailLoading && (
              <>
                <button type="button" className="customers-modal-close customers-detail-close" onClick={() => setDetailOpen(false)} aria-label="Close">
                  ✕
                </button>
                <p className="customers-empty-cell customers-detail-loading-msg">Loading…</p>
              </>
            )}
            {!detailLoading && detailError && (
              <>
                <button type="button" className="customers-modal-close customers-detail-close" onClick={() => setDetailOpen(false)} aria-label="Close">
                  ✕
                </button>
                <p className="customers-empty-cell customers-detail-loading-msg">{detailError}</p>
              </>
            )}
            {!detailLoading && detail && (
              <>
                <header className="customers-detail-header-row">
                  <h3 className="customers-detail-title" id="customers-detail-title">
                    {detail.customer.name}
                  </h3>
                  <div className="customers-detail-header-actions">
                    <button type="button" className="ghost-button small" onClick={openEditFromDetail}>
                      Edit details
                    </button>
                    <button
                      type="button"
                      className="ghost-button small customers-btn-danger"
                      onClick={() => deleteCustomer(detail.customer.id, detail.customer.name)}
                    >
                      Delete
                    </button>
                    <button type="button" className="customers-modal-close customers-detail-close-inline" onClick={() => setDetailOpen(false)} aria-label="Close">
                      ✕
                    </button>
                  </div>
                </header>
                <div className="customers-detail-scroll">
                  <div className="customers-detail-contact">
                    {detail.customer.phone ? <p className="customers-detail-line">{detail.customer.phone}</p> : null}
                    {detail.customer.email ? (
                      <p className="customers-detail-line">
                        <a href={`mailto:${detail.customer.email}`}>{detail.customer.email}</a>
                      </p>
                    ) : null}
                    {[
                      detail.customer.address_line1,
                      detail.customer.address_line2,
                      [detail.customer.city, detail.customer.postal_code].filter(Boolean).join(' ').trim() || null,
                      detail.customer.country,
                    ]
                      .filter((line): line is string => Boolean(line && String(line).trim()))
                      .map((line, i) => (
                        <p key={i} className="customers-detail-line customers-detail-line--addr">
                          {line}
                        </p>
                      ))}
                    {detail.customer.notes?.trim() ? (
                      <p className="customers-detail-notes">{detail.customer.notes.trim()}</p>
                    ) : null}
                  </div>
                  <div className="customers-detail-stats">
                    <div className="customers-detail-stat">
                      <span>Total Invoices</span>
                      <strong>{Number(detail.customer.invoices_count) || 0}</strong>
                    </div>
                    <div className="customers-detail-stat">
                      <span>Total Invoiced (THB)</span>
                      <strong>
                        {formatMoneyAmount(Number(detail.customer.total_invoiced || 0), DEFAULT_CURRENCY_CODE)}
                      </strong>
                    </div>
                    <div className="customers-detail-stat customers-detail-stat--paid">
                      <span>Total Paid (THB)</span>
                      <strong>{formatMoneyAmount(Number(detail.customer.total_paid || 0), DEFAULT_CURRENCY_CODE)}</strong>
                    </div>
                    <div className="customers-detail-stat customers-detail-stat--owed">
                      <span>Outstanding (THB)</span>
                      <strong>{formatMoneyAmount(Number(detail.customer.total_owed || 0), DEFAULT_CURRENCY_CODE)}</strong>
                    </div>
                  </div>

                  <h4 className="customers-detail-section">Memos</h4>
                  <p className="customers-detail-memo-intro">
                    Open and partially returned memos are active; closed memos are finished (e.g. fully returned or converted).
                  </p>

                  <h5 className="customers-detail-subsection">Current</h5>
                  <div className="customers-detail-table-wrap">
                    <table className="customers-detail-table" aria-label="Current memos">
                      <thead>
                        <tr>
                          <th>Memo #</th>
                          <th>Date</th>
                          <th>Due</th>
                          <th>Items</th>
                          <th>Value (memo ccy)</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.memos || []).filter(m => m.status === 'Open' || m.status === 'Partially Returned')
                          .length === 0 ? (
                          <tr>
                            <td colSpan={7} className="customers-empty-cell">
                              No active memos.
                            </td>
                          </tr>
                        ) : (
                          (detail.memos || [])
                            .filter(m => m.status === 'Open' || m.status === 'Partially Returned')
                            .map(m => (
                              <tr key={m.id}>
                                <td className="customers-detail-invoice">{m.memo_no}</td>
                                <td>{formatStoredCalendarDate(m.memo_date)}</td>
                                <td>{formatStoredCalendarDate(m.due_date)}</td>
                                <td>{m.items_count}</td>
                                <td>{formatMoneyAmount(Number(m.total_value || 0), m.currency_code)}</td>
                                <td>
                                  <span className={memoStatusClass(m.status)}>{m.status}</span>
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="ghost-button small"
                                    onClick={() => openMemoDetail(m.id)}
                                  >
                                    Details
                                  </button>
                                </td>
                              </tr>
                            ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <h5 className="customers-detail-subsection">Completed</h5>
                  <div className="customers-detail-table-wrap">
                    <table className="customers-detail-table" aria-label="Completed memos">
                      <thead>
                        <tr>
                          <th>Memo #</th>
                          <th>Date</th>
                          <th>Items</th>
                          <th>Value</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.memos || []).filter(m => m.status === 'Closed').length === 0 ? (
                          <tr>
                            <td colSpan={6} className="customers-empty-cell">
                              No completed memos.
                            </td>
                          </tr>
                        ) : (
                          (detail.memos || [])
                            .filter(m => m.status === 'Closed')
                            .map(m => (
                              <tr key={m.id}>
                                <td className="customers-detail-invoice">{m.memo_no}</td>
                                <td>{formatStoredCalendarDate(m.memo_date)}</td>
                                <td>{m.items_count}</td>
                                <td>{formatMoneyAmount(Number(m.total_value || 0), m.currency_code)}</td>
                                <td>
                                  <span className={memoStatusClass(m.status)}>{m.status}</span>
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="ghost-button small"
                                    onClick={() => openMemoDetail(m.id)}
                                  >
                                    Details
                                  </button>
                                </td>
                              </tr>
                            ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <h4 className="customers-detail-section">Invoice History</h4>
                  <div className="customers-detail-table-wrap">
                    <table className="customers-detail-table" aria-labelledby="customers-detail-title">
                      <thead>
                        <tr>
                          <th>Invoice #</th>
                          <th>Date</th>
                          <th>Items</th>
                          <th>Total</th>
                          <th>Paid</th>
                          <th>Balance</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.invoices.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="customers-empty-cell">No invoices.</td>
                          </tr>
                        ) : (
                          detail.invoices.map(inv => (
                            <tr key={inv.id}>
                              <td className="customers-detail-invoice">{inv.invoice_no}</td>
                              <td>{formatStoredCalendarDate(inv.created_at)}</td>
                              <td>{inv.items_count}</td>
                              <td>{formatMoneyAmount(Number(inv.total), inv.currency_code || DEFAULT_CURRENCY_CODE)}</td>
                              <td className="customers-paid">
                                {formatMoneyAmount(Number(inv.paid), inv.currency_code || DEFAULT_CURRENCY_CODE)}
                              </td>
                              <td className={inv.balance > 0 ? 'customers-balance customers-balance--neg' : 'customers-balance'}>
                                {formatMoneyAmount(Number(inv.balance), inv.currency_code || DEFAULT_CURRENCY_CODE)}
                              </td>
                              <td>
                                <span className={`customers-status customers-status--${String(inv.status).toLowerCase()}`}>
                                  {inv.status}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="customers-detail-footer">
                  <button type="button" className="ghost-button" onClick={() => setDetailOpen(false)}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {memoDetailOpen && (
        <div
          className="customers-memo-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="customers-memo-detail-title"
          onClick={() => {
            setMemoDetailOpen(false);
            setMemoDetail(null);
            setMemoDetailError(null);
          }}
        >
          <div className="customers-memo-panel" onClick={e => e.stopPropagation()}>
            <div className="customers-memo-panel-header">
              <h3 id="customers-memo-detail-title">{memoDetail?.memo_no || 'Memo details'}</h3>
              <button
                type="button"
                className="customers-modal-close"
                onClick={() => {
                  setMemoDetailOpen(false);
                  setMemoDetail(null);
                  setMemoDetailError(null);
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="customers-memo-panel-body">
              {memoDetailLoading && <p className="customers-empty-cell customers-memo-loading">Loading…</p>}
              {memoDetailError && !memoDetailLoading && (
                <p className="customers-modal-error customers-memo-error">{memoDetailError}</p>
              )}
              {memoDetail && !memoDetailLoading && (
                <>
                  <div className="customers-memo-meta">
                    <p className="customers-memo-status-row">
                      <span className={memoStatusClass(memoDetail.status)}>{memoDetail.status}</span>
                    </p>
                    <p className="customers-detail-line">
                      Memo date:{' '}
                      {formatStoredCalendarDate(memoDetail.memo_date)}
                      {memoDetail.due_date ? ` · Due: ${formatStoredCalendarDate(memoDetail.due_date)}` : ''}
                    </p>
                    {memoDetail.notes?.trim() ? (
                      <p className="customers-detail-notes">{memoDetail.notes.trim()}</p>
                    ) : null}
                  </div>
                  <div className="customers-detail-table-wrap">
                    <table className="customers-detail-table" aria-label="Memo line items">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Description</th>
                          <th>Qty</th>
                          <th>Returned</th>
                          <th>Unit</th>
                          <th>Line</th>
                        </tr>
                      </thead>
                      <tbody>
                        {memoDetail.items.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="customers-empty-cell">
                              No line items.
                            </td>
                          </tr>
                        ) : (
                          memoDetail.items.map(it => (
                            <tr key={it.id}>
                              <td>{it.item_code || '—'}</td>
                              <td>{it.description}</td>
                              <td>{it.quantity}</td>
                              <td>{it.returned_qty}</td>
                              <td>{formatMoneyAmount(Number(it.unit_price), memoDetail.currency_code)}</td>
                              <td>{formatMoneyAmount(Number(it.line_total), memoDetail.currency_code)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            <div className="customers-memo-panel-footer">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setMemoDetailOpen(false);
                  setMemoDetail(null);
                  setMemoDetailError(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

