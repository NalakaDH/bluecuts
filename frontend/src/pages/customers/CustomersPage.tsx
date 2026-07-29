import React, { useEffect, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import {
  InvoiceDetailCard,
  type InvoiceDetail,
} from '../../components/InvoiceDetailCard';
import { apiUrl, parseErrorResponse } from '../../api';
import type { ThbPerUnitMap } from '../../lib/exchangeConversion';
import { formatUsdOnlyFromThb } from '../../lib/moneyUsdDisplay';
import { DEFAULT_CURRENCY_CODE, formatMoneyAmount } from '../../lib/currencies';
import { mapApiInvoiceToReceipt, openInvoiceReceiptWindow } from '../../lib/receiptDocument';
import { openPaymentReceiptForInvoicePayment } from '../../lib/paymentReceipt';
import { INVOICE_CHECKOUT_INVOICE_ID_KEY } from '../../constants/invoiceCheckout';
import type { PageId } from '../../components/layout/Layout';

const IconSearch: React.FC = () => (
  <svg
    width={13}
    height={13}
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

const IconPlusSm: React.FC = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconPencil: React.FC = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const IconTrash: React.FC = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14H6L5 6" />
  </svg>
);

const IconGlobe: React.FC = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const kpiIconSize = 15;

const IconKpiUsers: React.FC = () => (
  <svg width={kpiIconSize} height={kpiIconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const IconKpiInvoice: React.FC = () => (
  <svg width={kpiIconSize} height={kpiIconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const IconKpiCheck: React.FC = () => (
  <svg width={kpiIconSize} height={kpiIconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconKpiAlert: React.FC = () => (
  <svg width={kpiIconSize} height={kpiIconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

/** Matches reference “detail empty” / Customers nav icon */
const IconCustomersEmpty: React.FC = () => (
  <svg
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

type CustAvatarTone = 'blue' | 'teal' | 'amber' | 'rose';

function customerAvatarTone(id: number): CustAvatarTone {
  const tones: CustAvatarTone[] = ['blue', 'teal', 'amber', 'rose'];
  return tones[Math.abs(id) % 4];
}

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
  onNavigate?: (page: PageId) => void;
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

export const CustomersPage: React.FC<CustomersPageProps> = ({ token, onNavigate }) => {
  const { showAlert, showConfirm } = useAlertDialog();
  const [thbPerUnit, setThbPerUnit] = useState<ThbPerUnitMap>({ THB: 1 });
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
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<'invoices' | 'memos' | 'contact'>('invoices');
  const [detailRefresh, setDetailRefresh] = useState(0);
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
  const [invoiceDetailOpen, setInvoiceDetailOpen] = useState(false);
  const [invoiceDetailLoading, setInvoiceDetailLoading] = useState(false);
  const [invoiceDetailError, setInvoiceDetailError] = useState<string | null>(null);
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetail | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl('/api/exchange-rates'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data?.thb_per_unit && typeof data.thb_per_unit === 'object') {
          setThbPerUnit(data.thb_per_unit as ThbPerUnitMap);
        }
      } catch {
        // keep defaults
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    setDetailTab('invoices');
  }, [selectedCustomerId]);

  useEffect(() => {
    if (selectedCustomerId == null) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/customers/${selectedCustomerId}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const msg = await parseErrorResponse(res, 'Failed to load customer');
          throw new Error(msg);
        }
        const data: CustomerDetailResponse = await res.json();
        if (cancelled) return;
        setDetail({
          ...data,
          memos: Array.isArray(data.memos) ? data.memos : [],
        });
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load customer';
        setDetailError(msg);
        showAlert({ title: 'Could not load customer', message: msg, variant: 'error' });
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomerId, detailRefresh, token, showAlert]);

  useEffect(() => {
    if (selectedCustomerId == null || loading) return;
    const exists = customers.some(c => c.id === selectedCustomerId);
    if (!exists) {
      setSelectedCustomerId(null);
    }
  }, [customers, selectedCustomerId, loading]);

  useEffect(() => {
    setDuplicateMatches([]);
    setForceDuplicateAck(false);
  }, [form.name, form.phone, form.email]);

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
      if (selectedCustomerId === savedId) {
        setDetailRefresh(r => r + 1);
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
      if (selectedCustomerId === id) {
        setSelectedCustomerId(null);
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

  const closeInvoiceDetail = () => {
    setInvoiceDetailOpen(false);
    setInvoiceDetail(null);
    setInvoiceDetailError(null);
  };

  const openInvoiceDetail = async (invoiceId: number) => {
    setInvoiceDetailOpen(true);
    setInvoiceDetailLoading(true);
    setInvoiceDetailError(null);
    setInvoiceDetail(null);
    try {
      const res = await fetch(apiUrl(`/api/invoices/${invoiceId}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load invoice');
        throw new Error(msg);
      }
      const data: InvoiceDetail = await res.json();
      setInvoiceDetail(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load invoice';
      setInvoiceDetailError(msg);
      showAlert({ title: 'Could not load invoice', message: msg, variant: 'error' });
    } finally {
      setInvoiceDetailLoading(false);
    }
  };

  const printInvoiceReceipt = (inv: InvoiceDetail) => {
    openInvoiceReceiptWindow(
      mapApiInvoiceToReceipt({
        invoice_no: inv.invoice_no,
        created_at: inv.created_at,
        customer_name: inv.customer_name,
        customer_phone: inv.customer_phone,
        customer_email: inv.customer_email,
        customer_address_line1: inv.customer_address_line1,
        customer_address_line2: inv.customer_address_line2,
        customer_city: inv.customer_city,
        customer_postal_code: inv.customer_postal_code,
        customer_country: inv.customer_country,
        subtotal: inv.subtotal,
        discount: inv.discount,
        total: inv.total,
        paid: inv.paid,
        status: inv.status,
        currency_code: inv.currency_code,
        items: inv.items.map(it => ({
          item_code: it.item_code,
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price,
          line_total: it.line_total,
          weight_grams: it.weight_grams,
          weight_carats: it.weight_carats,
          inv_category: it.inv_category,
          inv_item_type: it.inv_item_type,
          inventory_description: it.inventory_description,
        })),
        payments: inv.payments.map(p => ({
          method: p.method,
          amount: p.amount,
          created_at: p.created_at,
        })),
      })
    );
  };

  const printPaymentReceipt = (inv: InvoiceDetail, paymentId: number) => {
    const currency =
      inv.currency_code != null && inv.currency_code !== ''
        ? inv.currency_code
        : DEFAULT_CURRENCY_CODE;
    const ok = openPaymentReceiptForInvoicePayment({
      invoice_no: inv.invoice_no,
      customer_name: inv.customer_name,
      currency_code: currency,
      invoice_total: inv.total,
      payments: inv.payments.map(p => ({
        id: p.id,
        method: p.method,
        amount: p.amount,
        created_at: p.created_at,
      })),
      paymentId,
    });
    if (!ok) {
      showAlert({
        title: 'Could not print',
        message: 'Payment receipt could not be opened.',
        variant: 'error',
      });
    }
  };

  const handlePayInvoice = (invoiceId: number) => {
    try {
      window.sessionStorage.setItem(INVOICE_CHECKOUT_INVOICE_ID_KEY, String(invoiceId));
    } catch {
      // Ignore storage errors and still navigate when possible.
    }
    closeInvoiceDetail();
    onNavigate?.('invoiceCheckout');
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
      <section className="payments-kpi-grid customers-kpi-grid" aria-label="Customer summary stats">
        <div className="dashT-kpi-sum dashT-kpi-sum--blue customers-kpi-sum">
          <div className="dashT-kpi-sum__top">
            <span className="dashT-kpi-sum__label">Total customers</span>
            <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--blue" aria-hidden="true">
              <IconKpiUsers />
            </div>
          </div>
          <div className="dashT-kpi-sum__value">{kpiStats?.customer_count ?? 0}</div>
          <div className="payments-kpi-sub customers-kpi-sub">
            Matches search &amp; balance filter · not limited to the table
            {listTruncated ? ' · table lists first 500; narrow search to see all rows' : ''}
          </div>
        </div>
        <div className="dashT-kpi-sum dashT-kpi-sum--orange customers-kpi-sum">
          <div className="dashT-kpi-sum__top">
            <span className="dashT-kpi-sum__label">Total invoiced</span>
            <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--orange" aria-hidden="true">
              <IconKpiInvoice />
            </div>
          </div>
          <div className="dashT-kpi-sum__value">
            {formatUsdOnlyFromThb(kpiStats?.total_invoiced ?? 0, thbPerUnit)}
          </div>
          <div className="payments-kpi-sub customers-kpi-sub">
            USD from Profile exchange rates · invoice face totals in scope
          </div>
        </div>
        <div className="dashT-kpi-sum dashT-kpi-sum--green customers-kpi-sum">
          <div className="dashT-kpi-sum__top">
            <span className="dashT-kpi-sum__label">Applied to invoices</span>
            <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--green" aria-hidden="true">
              <IconKpiCheck />
            </div>
          </div>
          <div className="dashT-kpi-sum__value">
            {formatUsdOnlyFromThb(kpiStats?.applied_to_invoices_thb ?? 0, thbPerUnit)}
          </div>
          <div className="payments-kpi-sub customers-kpi-sub">
            Credited against invoice totals · all payments logged{' '}
            {formatUsdOnlyFromThb(kpiStats?.total_paid ?? 0, thbPerUnit)}
            {(kpiStats?.overpayment_thb ?? 0) > 0.005
              ? ` · includes ${formatUsdOnlyFromThb(kpiStats?.overpayment_thb ?? 0, thbPerUnit)} beyond invoice face`
              : ''}
          </div>
        </div>
        <div className="dashT-kpi-sum dashT-kpi-sum--pink customers-kpi-sum">
          <div className="dashT-kpi-sum__top">
            <span className="dashT-kpi-sum__label">Outstanding balance</span>
            <div className="dashT-kpi-sum__icon dashT-kpi-sum__icon--pink" aria-hidden="true">
              <IconKpiAlert />
            </div>
          </div>
          <div className="dashT-kpi-sum__value">
            {formatUsdOnlyFromThb(kpiStats?.total_owed ?? 0, thbPerUnit)}
          </div>
          <div className="payments-kpi-sub customers-kpi-sub">
            Still due on open balances · walk-in invoices without a customer are excluded
          </div>
        </div>
      </section>

      <section className="payments-layout payments-layout--inv-ui page-customers-split" aria-label="Customer list and details">
        <div className="pay-inv-list-panel">
          <div className="pay-inv-list-card">
            <div className="cust-ui-list-header">
              <div className="cust-ui-list-top">
                <div className="cust-ui-list-title">
                  Customers <span className="cust-ui-list-count">{customers.length}</span>
                </div>
                <button
                  type="button"
                  className="cust-ui-btn-add"
                  onClick={() => {
                    setAddOpen(true);
                    setSaveError(null);
                    setDuplicateMatches([]);
                    setForceDuplicateAck(false);
                  }}
                >
                  <IconPlusSm /> Add Customer
                </button>
              </div>
              <div className="cust-ui-list-search">
                <IconSearch />
                <input
                  type="search"
                  placeholder="Search by name, phone, or email…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  aria-label="Search customers"
                />
              </div>
              <label className="cust-ui-filter">
                <input
                  type="checkbox"
                  checked={filterOwed === 'withBalance'}
                  onChange={e => setFilterOwed(e.target.checked ? 'withBalance' : 'all')}
                />
                <span className="cust-ui-filter-label">
                  Show only customers with <span className="cust-ui-filter-em">outstanding balance</span>
                </span>
              </label>
            </div>
            <div className="cust-ui-list-scroll" role="list" aria-label="Customers">
            {loading ? (
              <p className="cust-ui-list-msg">Loading customers…</p>
            ) : error ? (
              <p className="cust-ui-list-msg cust-ui-list-msg--err">{error}</p>
            ) : customers.length === 0 ? (
              <p className="cust-ui-list-msg">No customers found.</p>
            ) : (
              customers.map(c => {
                const tone = customerAvatarTone(c.id);
                const selected = selectedCustomerId === c.id;
                const sub =
                  c.email?.trim() ||
                  c.phone?.trim() ||
                  '—';
                const invMeta =
                  (c.lastInvoiceAt
                    ? `${c.invoices} invoice${c.invoices === 1 ? '' : 's'} · ${formatStoredCalendarDate(c.lastInvoiceAt)}`
                    : `${c.invoices} invoice${c.invoices === 1 ? '' : 's'}`);
                return (
                  <button
                    type="button"
                    key={c.id}
                    role="listitem"
                    className={`cust-ui-cust-card${selected ? ' cust-ui-cust-card--selected' : ''}`}
                    onClick={() => setSelectedCustomerId(c.id)}
                  >
                    <div className={`cust-ui-avatar cust-ui-avatar--${tone}`}>
                      {(c.name.trim().charAt(0) || '?').toUpperCase()}
                    </div>
                    <div className="cust-ui-cust-main">
                      <div className="cust-ui-cust-name">{c.name}</div>
                      <div className="cust-ui-cust-sub">{sub}</div>
                    </div>
                    <div className="cust-ui-cust-right">
                      {c.totalOwed > 0 ? (
                        <div className="cust-ui-card-balance cust-ui-card-balance--owed">
                          {formatUsdOnlyFromThb(c.totalOwed, thbPerUnit)} due
                        </div>
                      ) : (
                        <div className="cust-ui-card-balance cust-ui-card-balance--clear">Cleared</div>
                      )}
                      <div className="cust-ui-cust-meta">{invMeta}</div>
                    </div>
                  </button>
                );
              })
            )}
            </div>
          </div>
        </div>

        <aside className="pay-inv-detail-aside">
          {selectedCustomerId == null ? (
            <div className="pay-inv-detail-empty">
              <div className="pay-inv-detail-empty-icon" aria-hidden="true">
                <IconCustomersEmpty />
              </div>
              <h3 className="pay-inv-detail-empty-title">Select a customer</h3>
              <p className="pay-inv-detail-empty-text">
                Choose someone from the list to see invoices, memos, and contact details.
              </p>
            </div>
          ) : detailLoading ? (
            <div className="pay-inv-detail-placeholder">Loading customer…</div>
          ) : detailError ? (
            <div className="pay-inv-detail-placeholder pay-inv-detail-placeholder--error">{detailError}</div>
          ) : detail ? (
            <div className="pay-inv-detail-card page-customers-detail-card">
              <div className="cust-ui-detail-inner">
              <header className="cust-ui-profile-header">
                <div className="cust-ui-profile-left">
                  <div
                    className={`cust-ui-avatar cust-ui-profile-avatar cust-ui-avatar--${customerAvatarTone(detail.customer.id)}`}
                  >
                    {(detail.customer.name.trim().charAt(0) || '?').toUpperCase()}
                  </div>
                  <div>
                    <h2 className="cust-ui-profile-name" id="customers-detail-title">
                      {detail.customer.name}
                    </h2>
                    {detail.customer.email ? (
                      <div className="cust-ui-profile-email">
                        <a href={`mailto:${detail.customer.email}`}>{detail.customer.email}</a>
                      </div>
                    ) : null}
                    {detail.customer.country?.trim() ? (
                      <div className="cust-ui-profile-country">
                        <IconGlobe /> {detail.customer.country}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="cust-ui-profile-actions">
                  <button type="button" className="cust-ui-btn-edit" onClick={openEditFromDetail}>
                    <IconPencil /> Edit Details
                  </button>
                  <button
                    type="button"
                    className="cust-ui-btn-delete"
                    onClick={() => deleteCustomer(detail.customer.id, detail.customer.name)}
                  >
                    <IconTrash /> Delete
                  </button>
                </div>
              </header>

              <div className="customers-detail-stats cust-ui-detail-stats">
                <div className="customers-detail-stat">
                  <span>Total Invoices</span>
                  <strong>{Number(detail.customer.invoices_count) || 0}</strong>
                </div>
                <div className="customers-detail-stat">
                  <span>Total Invoiced (USD)</span>
                  <strong>
                    {formatUsdOnlyFromThb(Number(detail.customer.total_invoiced || 0), thbPerUnit)}
                  </strong>
                </div>
                <div className="customers-detail-stat customers-detail-stat--paid">
                  <span>Total Paid (USD)</span>
                  <strong>{formatUsdOnlyFromThb(Number(detail.customer.total_paid || 0), thbPerUnit)}</strong>
                </div>
                <div className="customers-detail-stat customers-detail-stat--owed">
                  <span>Outstanding (USD)</span>
                  <strong>{formatUsdOnlyFromThb(Number(detail.customer.total_owed || 0), thbPerUnit)}</strong>
                </div>
              </div>

              <div className="cust-ui-profile-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'invoices'}
                  className={`cust-ui-ptab${detailTab === 'invoices' ? ' cust-ui-ptab--active' : ''}`}
                  onClick={() => setDetailTab('invoices')}
                >
                  Invoice History
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'memos'}
                  className={`cust-ui-ptab${detailTab === 'memos' ? ' cust-ui-ptab--active' : ''}`}
                  onClick={() => setDetailTab('memos')}
                >
                  Memos
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'contact'}
                  className={`cust-ui-ptab${detailTab === 'contact' ? ' cust-ui-ptab--active' : ''}`}
                  onClick={() => setDetailTab('contact')}
                >
                  Contact Info
                </button>
              </div>

              <div className="cust-ui-profile-body">
                {detailTab === 'invoices' && (
                  <div className="cust-ui-tab-pane" role="tabpanel">
                    <div className="cust-ui-section-heading">All Invoices</div>
                    <div className="customers-detail-table-wrap">
                      <table className="customers-detail-table inv-hist-table" aria-labelledby="customers-detail-title">
                        <thead>
                          <tr>
                            <th>Invoice #</th>
                            <th>Date</th>
                            <th>Items</th>
                            <th>Total</th>
                            <th>Paid</th>
                            <th>Balance</th>
                            <th>Status</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {detail.invoices.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="customers-empty-cell">
                                No invoices.
                              </td>
                            </tr>
                          ) : (
                            detail.invoices.map(inv => (
                              <tr key={inv.id}>
                                <td className="customers-detail-invoice">
                                  <span className="cust-inv-link">{inv.invoice_no}</span>
                                </td>
                                <td>{formatStoredCalendarDate(inv.created_at)}</td>
                                <td>{inv.items_count}</td>
                                <td>{formatMoneyAmount(Number(inv.total), inv.currency_code || DEFAULT_CURRENCY_CODE)}</td>
                                <td className="customers-paid">
                                  {formatMoneyAmount(Number(inv.paid), inv.currency_code || DEFAULT_CURRENCY_CODE)}
                                </td>
                                <td
                                  className={
                                    inv.balance > 0
                                      ? 'customers-balance customers-balance--neg'
                                      : 'customers-balance'
                                  }
                                >
                                  {formatMoneyAmount(Number(inv.balance), inv.currency_code || DEFAULT_CURRENCY_CODE)}
                                </td>
                                <td>
                                  <span
                                    className={`customers-status customers-status--${String(inv.status).toLowerCase()}`}
                                  >
                                    {inv.status}
                                  </span>
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="ghost-button small"
                                    onClick={() => openInvoiceDetail(inv.id)}
                                  >
                                    View
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {detailTab === 'memos' && (
                  <div className="cust-ui-tab-pane" role="tabpanel">
                    <div className="cust-ui-section-heading">Current Memos</div>
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
                    <div className="cust-ui-section-heading cust-ui-section-heading--spaced">Completed Memos</div>
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
                    <p className="cust-ui-memo-footnote">
                      Open and partially returned memos are active; closed memos are finished (e.g. fully returned or
                      converted to invoice).
                    </p>
                  </div>
                )}

                {detailTab === 'contact' && (
                  <div className="cust-ui-tab-pane" role="tabpanel">
                    <div className="cust-ui-section-heading">Contact Details</div>
                    <div className="cust-contact-grid">
                      <div className="cust-contact-item">
                        <div className="cust-contact-key">Full name</div>
                        <div className="cust-contact-val">{detail.customer.name}</div>
                      </div>
                      <div className="cust-contact-item">
                        <div className="cust-contact-key">Phone</div>
                        <div
                          className={
                            detail.customer.phone?.trim()
                              ? 'cust-contact-val'
                              : 'cust-contact-val cust-contact-val--empty'
                          }
                        >
                          {detail.customer.phone?.trim() || 'Not provided'}
                        </div>
                      </div>
                      <div className="cust-contact-item cust-contact-item--full">
                        <div className="cust-contact-key">Email</div>
                        <div
                          className={
                            detail.customer.email?.trim()
                              ? 'cust-contact-val cust-contact-val--link'
                              : 'cust-contact-val cust-contact-val--empty'
                          }
                        >
                          {detail.customer.email?.trim() ? (
                            <a href={`mailto:${detail.customer.email}`}>{detail.customer.email}</a>
                          ) : (
                            'Not provided'
                          )}
                        </div>
                      </div>
                      <div className="cust-contact-item cust-contact-item--full">
                        <div className="cust-contact-key">Address</div>
                        <div
                          className={
                            [detail.customer.address_line1, detail.customer.address_line2]
                              .filter(Boolean)
                              .join(', ')
                              .trim()
                              ? 'cust-contact-val'
                              : 'cust-contact-val cust-contact-val--empty'
                          }
                        >
                          {[detail.customer.address_line1, detail.customer.address_line2]
                            .filter(Boolean)
                            .join(', ')
                            .trim() || 'Not provided'}
                        </div>
                      </div>
                      <div className="cust-contact-item">
                        <div className="cust-contact-key">City</div>
                        <div
                          className={
                            detail.customer.city?.trim()
                              ? 'cust-contact-val'
                              : 'cust-contact-val cust-contact-val--empty'
                          }
                        >
                          {detail.customer.city?.trim() || '—'}
                        </div>
                      </div>
                      <div className="cust-contact-item">
                        <div className="cust-contact-key">Postal / ZIP</div>
                        <div
                          className={
                            detail.customer.postal_code?.trim()
                              ? 'cust-contact-val'
                              : 'cust-contact-val cust-contact-val--empty'
                          }
                        >
                          {detail.customer.postal_code?.trim() || '—'}
                        </div>
                      </div>
                      <div className="cust-contact-item cust-contact-item--full">
                        <div className="cust-contact-key">Country</div>
                        <div
                          className={
                            detail.customer.country?.trim()
                              ? 'cust-contact-val'
                              : 'cust-contact-val cust-contact-val--empty'
                          }
                        >
                          {detail.customer.country?.trim() || '—'}
                        </div>
                      </div>
                      <div className="cust-contact-item cust-contact-item--full">
                        <div className="cust-contact-key">Internal notes</div>
                        <div
                          className={
                            detail.customer.notes?.trim()
                              ? 'cust-contact-val'
                              : 'cust-contact-val cust-contact-val--empty'
                          }
                        >
                          {detail.customer.notes?.trim() || 'No notes'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          ) : null}
        </aside>
      </section>

      {addOpen && (
        <>
          <button
            type="button"
            className="cust-drawer-backdrop"
            aria-label="Close add customer"
            onClick={() => {
              setAddOpen(false);
              setDuplicateMatches([]);
              setForceDuplicateAck(false);
              setSaveError(null);
            }}
          />
          <div
            className="cust-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cust-drawer-add-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="cust-drawer-header">
              <h2 id="cust-drawer-add-title" className="cust-drawer-title">
                Add New Customer
              </h2>
              <button
                type="button"
                className="cust-drawer-close"
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
            <div className="cust-drawer-body customers-modal-body">
              <div className="customers-form-section">
                <p className="cust-form-section-label">Contact information</p>
                <label>
                  <span>Customer name *</span>
                  <input
                    value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Full name or business name"
                    autoComplete="name"
                  />
                </label>
                <div className="customers-form-row-2">
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
              </div>

              <div className="customers-form-section">
                <p className="cust-form-section-label cust-form-section-label--teal">Mailing address</p>
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
                <p className="cust-form-section-label cust-form-section-label--amber">Internal notes</p>
                <label>
                  <span>Notes (optional)</span>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                    rows={3}
                    placeholder="Payment preferences, VIP status, sourcing notes…"
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
            <div className="cust-drawer-footer">
              <button
                type="button"
                className="cust-drawer-btn-cancel"
                onClick={() => {
                  setAddOpen(false);
                  setDuplicateMatches([]);
                  setForceDuplicateAck(false);
                  setSaveError(null);
                }}
              >
                Cancel
              </button>
              <button type="button" className="cust-drawer-btn-save" onClick={saveCustomer} disabled={saving}>
                {saving ? 'Adding…' : 'Add Customer'}
              </button>
            </div>
          </div>
        </>
      )}

      {editOpen && (
        <>
          <button
            type="button"
            className="cust-drawer-backdrop"
            aria-label="Close edit customer"
            onClick={() => {
              setEditOpen(false);
              setEditingId(null);
              setEditError(null);
            }}
          />
          <div
            className="cust-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customers-edit-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="cust-drawer-header">
              <h2 id="customers-edit-title" className="cust-drawer-title">
                Edit Customer
              </h2>
              <button
                type="button"
                className="cust-drawer-close"
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
            <div className="cust-drawer-body customers-modal-body">
              {editLoading ? (
                <p className="customers-empty-cell">Loading…</p>
              ) : (
                <>
                  <div className="customers-form-section">
                    <p className="cust-form-section-label">Contact information</p>
                    <label>
                      <span>Customer name *</span>
                      <input
                        value={editForm.name}
                        onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Full name or business name"
                        autoComplete="name"
                      />
                    </label>
                    <div className="customers-form-row-2">
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
                  </div>

                  <div className="customers-form-section">
                    <p className="cust-form-section-label cust-form-section-label--teal">Mailing address</p>
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
                    <p className="cust-form-section-label cust-form-section-label--amber">Internal notes</p>
                    <label>
                      <span>Notes (optional)</span>
                      <textarea
                        value={editForm.notes}
                        onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                        rows={3}
                        placeholder="Payment preferences, VIP status, sourcing notes…"
                      />
                    </label>
                  </div>
                </>
              )}
              {editError && <p className="customers-modal-error">{editError}</p>}
            </div>
            <div className="cust-drawer-footer">
              <button
                type="button"
                className="cust-drawer-btn-cancel"
                onClick={() => {
                  setEditOpen(false);
                  setEditingId(null);
                  setEditError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cust-drawer-btn-save"
                onClick={saveEditCustomer}
                disabled={editSaving || editLoading}
              >
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </>
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

      {invoiceDetailOpen && (
        <div
          className="customers-memo-overlay customers-invoice-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Invoice details"
          onClick={closeInvoiceDetail}
        >
          <div
            className="customers-memo-panel customers-invoice-panel"
            onClick={e => e.stopPropagation()}
          >
            <InvoiceDetailCard
              invoice={invoiceDetail}
              loading={invoiceDetailLoading}
              error={invoiceDetailError}
              onClose={closeInvoiceDetail}
              onPrintInvoice={printInvoiceReceipt}
              onPrintPayment={printPaymentReceipt}
              onPay={onNavigate ? handlePayInvoice : undefined}
              showPay={Boolean(onNavigate)}
              showClose
            />
          </div>
        </div>
      )}
    </div>
  );
};

