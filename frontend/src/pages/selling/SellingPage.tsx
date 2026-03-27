import React, { useState, useEffect, useRef } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { INVOICE_CHECKOUT_INVOICE_ID_KEY } from '../../constants/invoiceCheckout';
import type { PageId } from '../../components/layout/Layout';
import { mapApiInvoiceToReceipt, openInvoiceReceiptWindow } from '../../lib/receiptDocument';
import {
  DEFAULT_CURRENCY_CODE,
  SUPPORTED_CURRENCIES,
  formatMoneyAmount,
  formatMoneyWhole,
  normalizeCurrencyCode,
  parseMoneyInput,
  roundMoney2,
} from '../../lib/currencies';
import { convertAmountViaThb, hasRateFor, type ThbPerUnitMap } from '../../lib/exchangeConversion';

interface InventoryItem {
  id: number;
  category: string;
  item_type: string;
  pieces: number;
  /** Available pieces in stock (from API); falls back to `pieces` if missing */
  pieces_remaining?: number;
  weight_grams: number | null;
  weight_carats: number | null;
  selling_total_price: number | null;
  selling_carat_price: number | null;
  /** Currency `selling_total_price` is stored in (inventory / edited line) */
  selling_currency?: string | null;
  image_path: string | null;
  item_code: string | null;
  status: string;
}

interface Customer {
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
}

type InvoiceStatus = 'Draft' | 'Unpaid' | 'Partial' | 'Paid';

interface InvoiceSummary {
  id: number;
  invoiceNo: string;
  customerName: string;
  total: number;
  paid: number;
  status: InvoiceStatus;
  createdAt: string;
  currencyCode: string;
}

interface ApiInvoice {
  id: number;
  invoice_no: string;
  customer_name: string | null;
  total: number;
  paid: number;
  status: InvoiceStatus;
  created_at: string;
  currency_code?: string | null;
}

interface InvoiceDetailForEdit {
  id: number;
  invoice_no: string;
  customer_id: number | null;
  customer_name: string | null;
  subtotal: number;
  discount: number;
  total: number;
  status: InvoiceStatus;
  paid?: number;
  currency_code?: string | null;
  items: {
    id: number;
    inventory_item_id: number;
    item_code: string | null;
    description: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
}

const iconSize = 20;
const IconSearch = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);
const IconPlus = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconTrash = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);
const IconCheck = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);
const IconUser = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);

const IconPlusCircle = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

const IconX = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" /><path d="M6 6l12 12" />
  </svg>
);

const IconPrinter = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9V2h12v7" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <path d="M6 14h12v8H6z" />
  </svg>
);

const IconEdit = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

const IconDelete = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const IconCreditCard = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <line x1="2" y1="10" x2="22" y2="10" />
    <line x1="6" y1="15" x2="10" y2="15" />
  </svg>
);

interface SellingPageProps {
  token: string;
  onNavigate?: (page: PageId) => void;
}

export const SellingPage: React.FC<SellingPageProps> = ({ token, onNavigate }) => {
  const { showAlert, showConfirm } = useAlertDialog();
  const [availableItems, setAvailableItems] = useState<InventoryItem[]>([]);
  const [, setLoading] = useState(true);
  const [, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<InventoryItem[]>([]);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
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

  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [, setInvoiceMessage] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [, setNextInvoiceNumber] = useState(1);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutMethod, setCheckoutMethod] = useState<'Cash' | 'Card' | 'QR'>('Cash');
  const [checkoutAmount, setCheckoutAmount] = useState<number>(0);
  const [checkoutDue, setCheckoutDue] = useState<number>(0);
  const [checkoutInvoiceId, setCheckoutInvoiceId] = useState<number | null>(null);
  /** Currency for amounts shown and entered in the checkout modal (converted to invoice currency for API). */
  const [checkoutDisplayCurrency, setCheckoutDisplayCurrency] = useState<string>(DEFAULT_CURRENCY_CODE);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const [itemDiscounts, setItemDiscounts] = useState<Record<number, number>>({});
  const [itemQuantities, setItemQuantities] = useState<Record<number, number>>({});
  /** ISO 4217 for this sale / receipt (THB default). */
  const [saleCurrency, setSaleCurrency] = useState<string>(DEFAULT_CURRENCY_CODE);
  const [thbPerUnit, setThbPerUnit] = useState<ThbPerUnitMap>({ THB: 1 });
  const [invoiceCreatedOpen, setInvoiceCreatedOpen] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<InvoiceSummary | null>(null);
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
  /** Inventory ids whose thumbnail URL failed to load */
  const [cartImageLoadFailed, setCartImageLoadFailed] = useState<Set<number>>(() => new Set());
  const [savingDraft, setSavingDraft] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);

  /** Inline edit: load invoice into the composer (same UI as new sale). */
  const [editingInvoiceId, setEditingInvoiceId] = useState<number | null>(null);
  const [editingInvoiceNo, setEditingInvoiceNo] = useState<string | null>(null);
  /** Pieces already committed on this invoice (for max qty = remaining + reserved). */
  const [reservedPiecesOnEdit, setReservedPiecesOnEdit] = useState<Record<number, number>>({});
  const [invoiceHydrateLoading, setInvoiceHydrateLoading] = useState(false);
  const sellingComposerRef = useRef<HTMLDivElement>(null);

  const getImageSrc = (imagePath: string | null): string => {
    if (!imagePath) return '';
    if (imagePath.startsWith('http')) return imagePath;
    const path = imagePath.startsWith('/') ? imagePath : `/uploads/${imagePath}`;
    return apiUrl(path);
  };

  const fetchAvailable = async (searchTerm?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('status', 'Available');
      params.set('limit', '200');
      if (searchTerm?.trim()) params.set('search', searchTerm.trim());
      const res = await fetch(apiUrl(`/api/inventory?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load inventory');
        throw new Error(msg);
      }
      const data = await res.json();
      setAvailableItems(data);
      if (searchTerm && searchTerm.trim() && data.length === 1) {
        const code = searchTerm.trim().toLowerCase();
        const item = data[0] as InventoryItem;
        if (item.item_code && item.item_code.toLowerCase() === code && !cart.some(c => c.id === item.id)) {
          setCart(prev => [...prev, item]);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load';
      setError(msg);
      setAvailableItems([]);
      showAlert({ title: 'Could not load inventory', message: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAvailable();
  }, [token]);

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

  const mapApiInvoice = (inv: ApiInvoice): InvoiceSummary => ({
    id: inv.id,
    invoiceNo: inv.invoice_no,
    customerName: inv.customer_name || 'Walk-in customer',
    total: inv.total,
    paid: inv.paid,
    status: inv.status,
    createdAt: inv.created_at,
    currencyCode: inv.currency_code || DEFAULT_CURRENCY_CODE,
  });

  const fetchInvoices = async () => {
    setLoadingInvoices(true);
    setInvoicesError(null);
    try {
      const res = await fetch(apiUrl('/api/invoices'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load invoices');
        throw new Error(msg);
      }
      const data: ApiInvoice[] = await res.json();
      setInvoices(data.map(mapApiInvoice));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load invoices';
      setInvoicesError(msg);
      setInvoices([]);
      showAlert({ title: 'Could not load invoices', message: msg, variant: 'error' });
    } finally {
      setLoadingInvoices(false);
    }
  };

  useEffect(() => {
    const id = setTimeout(() => {
      fetchAvailable(search);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    const id = setTimeout(() => {
      fetchCustomers();
    }, 300);
    return () => clearTimeout(id);
  }, [customerSearch]);

  useEffect(() => {
    fetchInvoices();
  }, [token]);

  const maxPcsForItem = (item: InventoryItem) => {
    const base = Math.floor(Number(item.pieces_remaining ?? item.pieces ?? 0));
    const inCart = cart.some(c => c.id === item.id);
    const bonus =
      editingInvoiceId != null && inCart
        ? Math.floor(Number(reservedPiecesOnEdit[item.id] ?? 0))
        : 0;
    return Math.max(1, base + bonus);
  };

  /** Unit list price converted into the selected invoice currency */
  const unitPriceInSaleCurrency = (item: InventoryItem) =>
    convertAmountViaThb(
      Number(item.selling_total_price ?? 0),
      item.selling_currency ?? DEFAULT_CURRENCY_CODE,
      saleCurrency,
      thbPerUnit
    );

  const lineGrossForItem = (item: InventoryItem) => {
    const unit = unitPriceInSaleCurrency(item);
    const q = itemQuantities[item.id] ?? 1;
    return unit * q;
  };

  const lineNetForItem = (item: InventoryItem) => {
    const gross = lineGrossForItem(item);
    const d = Math.min(itemDiscounts[item.id] || 0, gross);
    return Math.max(0, gross - d);
  };

  const addToCart = (item: InventoryItem) => {
    if (cart.some((c) => c.id === item.id)) return;
    setCart((prev) => [...prev, item]);
    setItemQuantities(prev => ({
      ...prev,
      [item.id]: 1,
    }));
  };

  const removeFromCart = (id: number) => {
    setCart((prev) => prev.filter((c) => c.id !== id));
    setItemQuantities(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const setQtyForItem = (item: InventoryItem, raw: number) => {
    const maxPcs = maxPcsForItem(item);
    let q = Math.floor(Number(raw));
    if (!Number.isFinite(q) || q < 1) q = 1;
    if (q > maxPcs) q = maxPcs;
    setItemQuantities(prev => ({ ...prev, [item.id]: q }));
  };

  const cartTotal = cart.reduce((sum, i) => sum + lineGrossForItem(i), 0);
  const itemsDiscountTotal = cart.reduce(
    (sum, item) => sum + Math.min(itemDiscounts[item.id] || 0, lineGrossForItem(item)),
    0
  );
  const parsedDiscount = Number.isFinite(discountAmount) ? discountAmount : 0;
  const finalTotalRaw = cartTotal - itemsDiscountTotal - parsedDiscount;
  const finalTotal = finalTotalRaw > 0 ? finalTotalRaw : 0;

  const fetchCustomers = async () => {
    if (!customerSearch.trim()) {
      setCustomers([]);
      return;
    }
    try {
      const params = new URLSearchParams();
      params.set('search', customerSearch.trim());
      params.set('limit', '20');
      const res = await fetch(apiUrl(`/api/customers?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load customers');
        throw new Error(msg);
      }
      const data = await res.json();
      setCustomers(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load customers';
      setCustomers([]);
      showAlert({ title: 'Could not load customers', message: msg, variant: 'error' });
    }
  };

  const handleNewCustomerChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNewCustomer(prev => ({ ...prev, [name]: value }));
  };

  /** Open printable sale invoice (same template as Payments / Memos). */
  const printInvoiceReceiptById = async (invoiceId: number) => {
    try {
      const res = await fetch(apiUrl(`/api/invoices/${invoiceId}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load invoice');
        throw new Error(msg);
      }
      const data = (await res.json()) as {
        invoice_no: string;
        created_at: string;
        customer_name: string | null;
        customer_phone?: string | null;
        customer_email?: string | null;
        customer_address_line1?: string | null;
        customer_address_line2?: string | null;
        customer_city?: string | null;
        customer_postal_code?: string | null;
        customer_country?: string | null;
        subtotal: number;
        discount: number;
        total: number;
        paid?: number;
        status?: string;
        derived_status?: string;
        items: {
          item_code: string | null;
          description: string | null;
          quantity: number;
          unit_price: number;
          line_total: number;
          weight_grams?: number | null;
          weight_carats?: number | null;
          inv_category?: string | null;
          inv_item_type?: string | null;
          inventory_description?: string | null;
        }[];
        payments?: { method: string; amount: number; created_at: string }[];
        currency_code?: string | null;
      };
      openInvoiceReceiptWindow(
        mapApiInvoiceToReceipt({
          invoice_no: data.invoice_no,
          created_at: data.created_at,
          customer_name: data.customer_name,
          customer_phone: data.customer_phone,
          customer_email: data.customer_email,
          customer_address_line1: data.customer_address_line1,
          customer_address_line2: data.customer_address_line2,
          customer_city: data.customer_city,
          customer_postal_code: data.customer_postal_code,
          customer_country: data.customer_country,
          subtotal: data.subtotal,
          discount: data.discount,
          total: data.total,
          paid: data.paid,
          status: data.status ?? data.derived_status,
          currency_code: data.currency_code,
          items: data.items,
          payments: data.payments,
        })
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to open receipt';
      showAlert({ title: 'Could not open receipt', message: msg, variant: 'error' });
    }
  };

  const saveCustomer = async (): Promise<boolean> => {
    if (!newCustomer.name.trim()) {
      showAlert({
        title: 'Customer required',
        message: 'Customer name is required.',
        variant: 'warning',
      });
      return false;
    }
    try {
      setCustomerSaving(true);
      const res = await fetch(apiUrl('/api/customers'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newCustomer.name.trim(),
          phone: newCustomer.phone || null,
          email: newCustomer.email || null,
          notes: newCustomer.notes || null,
          address_line1: newCustomer.address_line1.trim() || null,
          address_line2: newCustomer.address_line2.trim() || null,
          city: newCustomer.city.trim() || null,
          postal_code: newCustomer.postal_code.trim() || null,
          country: newCustomer.country.trim() || null,
        }),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to save customer');
        throw new Error(msg);
      }
      const created: Customer = await res.json();
      setSelectedCustomer(created);
      setCustomers(prev => [created, ...prev]);
      setNewCustomer({
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
      showAlert({
        title: 'Customer saved',
        message: `${created.name} was added to your customers.`,
        variant: 'success',
      });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save customer';
      showAlert({ title: 'Could not save customer', message: msg, variant: 'error' });
      return false;
    } finally {
      setCustomerSaving(false);
    }
  };

  const createInvoice = async () => {
    if (cart.length === 0) {
      showAlert({
        title: 'No items',
        message: 'Add at least one item before creating an invoice.',
        variant: 'warning',
      });
      return;
    }
    setCreatingInvoice(true);
    setInvoiceMessage(null);
    try {
      const body = {
        customer_id: selectedCustomer ? selectedCustomer.id : null,
        discount: parsedDiscount,
        currency_code: saleCurrency,
        items: cart.map(item => ({
          inventory_item_id: item.id,
          price: unitPriceInSaleCurrency(item),
          quantity: itemQuantities[item.id] ?? 1,
          discount: itemDiscounts[item.id] || 0,
          item_code: item.item_code,
        })),
      };

      if (editingInvoiceId != null) {
        const res = await fetch(apiUrl(`/api/invoices/${editingInvoiceId}`), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const msg = await parseErrorResponse(res, 'Failed to update invoice');
          throw new Error(msg);
        }
        const updated = (await res.json()) as ApiInvoice;
        const summary = mapApiInvoice(updated);
        setInvoices(prev => prev.map(row => (row.id === summary.id ? summary : row)));
        resetInvoice();
        setInvoiceMessage(`Invoice ${summary.invoiceNo} updated.`);
        showAlert({
          title: 'Invoice updated',
          message: `${summary.invoiceNo} was saved successfully.`,
          variant: 'success',
        });
        await fetchAvailable(search);
        return;
      }

      const res = await fetch(apiUrl('/api/invoices'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to create invoice');
        throw new Error(msg);
      }
      const created: ApiInvoice & {
        customer_id?: number | null;
        subtotal?: number;
        discount?: number;
      } = await res.json();

      const summary = mapApiInvoice(created);
      setInvoices(prev => [summary, ...prev]);
      setNextInvoiceNumber(n => n + 1);

      setInvoiceMessage(`Invoice ${summary.invoiceNo} created.`);
      showAlert({
        title: 'Invoice created',
        message: `${summary.invoiceNo} is ready. You can record payment below or from Payments.`,
        variant: 'success',
      });
      setCheckoutInvoiceId(summary.id);
      setCheckoutDue(roundMoney2(summary.total));
      setCheckoutAmount(roundMoney2(summary.total));
      setCheckoutDisplayCurrency(normalizeCurrencyCode(summary.currencyCode));
      setCheckoutMethod('Cash');
      setCreatedInvoice(summary);
      setInvoiceCreatedOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save invoice';
      showAlert({ title: 'Could not save invoice', message: msg, variant: 'error' });
    } finally {
      setCreatingInvoice(false);
    }
  };

  const handleSellingPayClick = (invoiceId: number) => {
    try {
      window.sessionStorage.setItem(INVOICE_CHECKOUT_INVOICE_ID_KEY, String(invoiceId));
    } catch {
      // still navigate
    }
    onNavigate?.('invoiceCheckout');
  };

  const filteredInvoices = invoices.filter(inv => {
    const matchesSearch =
      !invoiceSearch.trim() ||
      inv.invoiceNo.toLowerCase().includes(invoiceSearch.trim().toLowerCase());
    const matchesStatus =
      invoiceStatusFilter === 'all' ? true : inv.status === invoiceStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const checkoutBaseCurrency = normalizeCurrencyCode(
    checkoutInvoiceId ? createdInvoice?.currencyCode ?? saleCurrency : saleCurrency
  );
  const checkoutTotalInInvoice = checkoutInvoiceId ? checkoutDue : finalTotal;
  const checkoutTotalDisplay = convertAmountViaThb(
    checkoutTotalInInvoice,
    checkoutBaseCurrency,
    checkoutDisplayCurrency,
    thbPerUnit
  );
  const checkoutChangeDisplay = Math.max(0, checkoutAmount - checkoutTotalDisplay);
  const checkoutNeedsConversion =
    normalizeCurrencyCode(checkoutDisplayCurrency) !== checkoutBaseCurrency;
  const checkoutFxMissing =
    checkoutNeedsConversion &&
    (!hasRateFor(checkoutBaseCurrency, thbPerUnit) || !hasRateFor(checkoutDisplayCurrency, thbPerUnit));

  const resetInvoice = () => {
    setCart([]);
    setItemDiscounts({});
    setItemQuantities({});
    setDiscountAmount(0);
    setSaleCurrency(DEFAULT_CURRENCY_CODE);
    setSelectedCustomer(null);
    setCustomerSearch('');
    setCustomers([]);
    setSearch('');
    setInvoiceMessage(null);
    setDraftMessage(null);
    setEditingInvoiceId(null);
    setEditingInvoiceNo(null);
    setReservedPiecesOnEdit({});
  };

  const cancelInvoiceEdit = () => {
    resetInvoice();
    fetchAvailable(search);
  };

  const saveDraft = async () => {
    if (cart.length === 0) {
      showAlert({
        title: 'No items',
        message: 'Add at least one item before saving a draft.',
        variant: 'warning',
      });
      return;
    }
    setSavingDraft(true);
    setDraftMessage(null);
    try {
      const payload = {
        selectedCustomer,
        discountAmount,
        itemDiscounts,
        itemQuantities,
        cart,
        saleCurrency,
      };
      const res = await fetch(apiUrl('/api/selling/drafts'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ payload }),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to save draft');
        throw new Error(msg);
      }
      setDraftMessage('Draft saved.');
      showAlert({
        title: 'Draft saved',
        message: 'Your sale cart was saved. You can load it again with “Load draft”.',
        variant: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save draft';
      showAlert({ title: 'Could not save draft', message: msg, variant: 'error' });
    } finally {
      setSavingDraft(false);
    }
  };

  const loadLatestDraft = async () => {
    setLoadingDraft(true);
    setDraftMessage(null);
    try {
      const res = await fetch(apiUrl('/api/selling/drafts/latest'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 404) {
        showAlert({ title: 'No draft', message: 'No saved draft was found.', variant: 'info' });
        return;
      }
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load draft');
        throw new Error(msg);
      }
      const data: {
        id: number;
        payload: {
          selectedCustomer: Customer | null;
          discountAmount: number;
          itemDiscounts: Record<number, number>;
          itemQuantities?: Record<number, number>;
          cart: InventoryItem[];
          saleCurrency?: string;
        };
      } = await res.json();
      const payload = data.payload || ({} as any);
      setSelectedCustomer(payload.selectedCustomer || null);
      setDiscountAmount(roundMoney2(Number(payload.discountAmount || 0)));
      if (payload.saleCurrency && typeof payload.saleCurrency === 'string') {
        setSaleCurrency(payload.saleCurrency);
      }
      setItemDiscounts(payload.itemDiscounts || {});
      const rawCart: InventoryItem[] = Array.isArray(payload.cart) ? payload.cart : [];
      const savedQ =
        payload.itemQuantities && typeof payload.itemQuantities === 'object'
          ? (payload.itemQuantities as Record<number, number>)
          : {};
      const nextQ: Record<number, number> = {};
      rawCart.forEach(it => {
        const maxP = Math.max(1, Math.floor(Number(it.pieces_remaining ?? it.pieces ?? 1)));
        const v = Math.floor(Number(savedQ[it.id]) || 1);
        nextQ[it.id] = Math.max(1, Math.min(maxP, Number.isFinite(v) ? v : 1));
      });
      setItemQuantities(nextQ);
      setCart(rawCart);
      setEditingInvoiceId(null);
      setEditingInvoiceNo(null);
      setReservedPiecesOnEdit({});
      setDraftMessage('Draft loaded.');
      showAlert({
        title: 'Draft loaded',
        message: 'Your saved sale cart was restored.',
        variant: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load draft';
      showAlert({ title: 'Could not load draft', message: msg, variant: 'error' });
    } finally {
      setLoadingDraft(false);
    }
  };

  const completePayment = async () => {
    if (!checkoutInvoiceId) {
      setCheckoutOpen(false);
      return;
    }
    if (!checkoutAmount || checkoutAmount <= 0) {
      showAlert({
        title: 'Invalid payment',
        message: 'Payment amount must be greater than zero.',
        variant: 'warning',
      });
      return;
    }
    const invCur = normalizeCurrencyCode(createdInvoice?.currencyCode ?? saleCurrency);
    const amountInInvoice = roundMoney2(
      convertAmountViaThb(checkoutAmount, checkoutDisplayCurrency, invCur, thbPerUnit)
    );
    if (!amountInInvoice || amountInInvoice <= 0) {
      showAlert({
        title: 'Invalid payment',
        message: 'Payment amount must be greater than zero.',
        variant: 'warning',
      });
      return;
    }
    try {
      const res = await fetch(apiUrl(`/api/invoices/${checkoutInvoiceId}/payments`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          method: checkoutMethod,
          amount: amountInInvoice,
        }),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to record payment');
        throw new Error(msg);
      }
      const data: {
        payment: {
          id: number;
          invoice_id: number;
          method: string;
          amount: number;
          note: string | null;
          created_at: string;
        };
        invoice: {
          id: number;
          invoice_no: string;
          total: number;
          status: InvoiceStatus;
          paid: number;
        };
      } = await res.json();

      setInvoices(prev =>
        prev.map(inv =>
          inv.id === data.invoice.id
            ? {
                ...inv,
                invoiceNo: data.invoice.invoice_no,
                total: data.invoice.total,
                status: data.invoice.status,
                paid: data.invoice.paid,
              }
            : inv
        )
      );

      setInvoiceMessage(`Payment recorded for ${data.invoice.invoice_no}.`);
      showAlert({
        title: 'Payment recorded',
        message: `Payment for ${data.invoice.invoice_no} was saved.`,
        variant: 'success',
      });
      setCheckoutOpen(false);
      setCheckoutInvoiceId(null);
      setCheckoutDue(0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record payment';
      showAlert({ title: 'Payment failed', message: msg, variant: 'error' });
    }
  };

  /** Load invoice into the main composer (search, cart, customer, discounts) — no modal. */
  const beginInlineInvoiceEdit = async (inv: InvoiceSummary) => {
    if (inv.paid > 0) return;
    setInvoiceHydrateLoading(true);
    setDraftMessage(null);
    try {
      const res = await fetch(apiUrl(`/api/invoices/${inv.id}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load invoice');
        throw new Error(msg);
      }
      const data = (await res.json()) as InvoiceDetailForEdit;
      if (Number(data.paid || 0) > 0) {
        throw new Error('This invoice has payments and cannot be edited.');
      }

      const reserved: Record<number, number> = {};
      const cartRows: InventoryItem[] = [];
      const discounts: Record<number, number> = {};
      const quantities: Record<number, number> = {};

      for (const line of data.items) {
        const invRes = await fetch(apiUrl(`/api/inventory/${line.inventory_item_id}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!invRes.ok) {
          const msg = await parseErrorResponse(invRes, 'Failed to load inventory item');
          throw new Error(msg);
        }
        const row = (await invRes.json()) as InventoryItem;
        const merged: InventoryItem = {
          ...row,
          selling_total_price: line.unit_price,
          selling_currency: normalizeCurrencyCode(data.currency_code || DEFAULT_CURRENCY_CODE),
        };
        cartRows.push(merged);
        const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
        quantities[merged.id] = qty;
        reserved[merged.id] = qty;
        const lineGross = qty * Number(line.unit_price || 0);
        const lineDisc = Math.max(0, lineGross - Number(line.line_total || 0));
        discounts[merged.id] = lineDisc;
      }

      let itemsDiscSum = 0;
      for (const line of data.items) {
        const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
        const lg = qty * Number(line.unit_price || 0);
        itemsDiscSum += Math.max(0, lg - Number(line.line_total || 0));
      }
      const orderDisc = Math.max(0, Number(data.discount ?? 0) - itemsDiscSum);

      setCart(cartRows);
      setItemQuantities(quantities);
      setItemDiscounts(discounts);
      setDiscountAmount(orderDisc);
      setReservedPiecesOnEdit(reserved);
      setEditingInvoiceId(data.id);
      setEditingInvoiceNo(data.invoice_no);
      setSaleCurrency(data.currency_code || DEFAULT_CURRENCY_CODE);

      if (data.customer_id != null) {
        const cRes = await fetch(apiUrl(`/api/customers/${data.customer_id}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cRes.ok) {
          setSelectedCustomer((await cRes.json()) as Customer);
        } else {
          setSelectedCustomer({
            id: data.customer_id,
            name: data.customer_name || 'Customer',
            phone: null,
            email: null,
            notes: null,
          });
        }
      } else {
        setSelectedCustomer(null);
      }
      setCustomerSearch('');
      setCustomers([]);

      window.setTimeout(() => {
        sellingComposerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load invoice for editing';
      showAlert({ title: 'Could not load invoice', message: msg, variant: 'error' });
    } finally {
      setInvoiceHydrateLoading(false);
    }
  };

  const confirmDeleteInvoice = async (inv: InvoiceSummary) => {
    if (inv.paid > 0) return;
    const ok = await showConfirm({
      title: 'Delete invoice?',
      message: `Delete ${inv.invoiceNo}? Sold pieces will be returned to inventory.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      setInvoicesError(null);
      const res = await fetch(apiUrl(`/api/invoices/${inv.id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to delete invoice');
        throw new Error(msg);
      }
      setInvoices(prev => prev.filter(i => i.id !== inv.id));
      if (inv.id === editingInvoiceId) {
        resetInvoice();
        fetchAvailable(search);
      }
      showAlert({
        title: 'Invoice deleted',
        message: `${inv.invoiceNo} was removed and stock was adjusted.`,
        variant: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete invoice';
      setInvoicesError(msg);
      showAlert({ title: 'Could not delete invoice', message: msg, variant: 'error' });
    }
  };

  const sellingFxWarning =
    cart.length > 0
      ? cart.some(it => {
          const from = normalizeCurrencyCode(it.selling_currency ?? DEFAULT_CURRENCY_CODE);
          const to = normalizeCurrencyCode(saleCurrency);
          if (from === to) return false;
          return !hasRateFor(from, thbPerUnit) || !hasRateFor(to, thbPerUnit);
        })
      : false;

  const itemSuggestions =
    search.trim().length === 0
      ? []
      : availableItems
          .filter(it => {
            const q = search.trim().toLowerCase();
            const code = (it.item_code || '').toLowerCase();
            const cat = (it.category || '').toLowerCase();
            return code.includes(q) || cat.includes(q);
          })
          .slice(0, 8);

  const addSuggestedItem = (item: InventoryItem) => {
    addToCart(item);
    setSearch('');
  };

  return (
    <div className="page page-selling">
      {editingInvoiceId != null && editingInvoiceNo && (
        <div className="selling-inline-edit-banner" role="status">
          <div className="selling-inline-edit-banner-inner">
            <span>
              Editing <strong>{editingInvoiceNo}</strong> — add or remove items, change quantities, then click{' '}
              <strong>Update invoice</strong>.
            </span>
            <button type="button" className="selling-inline-edit-cancel" onClick={cancelInvoiceEdit}>
              Cancel edit
            </button>
          </div>
        </div>
      )}
      {invoiceHydrateLoading && (
        <div className="selling-inline-edit-loading" aria-live="polite">
          Loading invoice into editor…
        </div>
      )}

      <div className="selling2-grid" ref={sellingComposerRef}>
        <div className="selling2-left">
          <section className="selling2-card">
            <h3 className="selling2-card-title">
              <span className="selling2-card-title-icon" aria-hidden="true"><IconPlus /></span>
              Search &amp; Add Items
            </h3>
            <div className="selling2-search">
              <span className="selling2-search-icon" aria-hidden="true"><IconSearch /></span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="selling2-search-input"
                placeholder="Search by Gem ID, stone type..."
              />
            </div>

            {search.trim() && itemSuggestions.length > 0 && (
              <div className="selling2-suggest">
                {itemSuggestions.map(it => (
                  <button
                    key={it.id}
                    type="button"
                    className="selling2-suggest-row"
                    onClick={() => addSuggestedItem(it)}
                  >
                    <span className="selling2-suggest-code">{it.item_code || `#${it.id}`}</span>
                    <span className="selling2-suggest-name">{it.category}</span>
                    <span className="selling2-suggest-meta">
                      {it.weight_carats != null ? `${it.weight_carats} ct` : '—'} ·{' '}
                      {formatMoneyWhole(
                        convertAmountViaThb(
                          Number(it.selling_total_price ?? 0),
                          it.selling_currency ?? DEFAULT_CURRENCY_CODE,
                          saleCurrency,
                          thbPerUnit
                        ),
                        saleCurrency
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="selling2-card selling2-card--added">
            <h3 className="selling2-card-title">Added Items</h3>
            {cart.length === 0 ? (
              <div className="selling2-empty">
                <div className="selling2-empty-title">No items added yet</div>
                <div className="selling2-empty-sub">Search and add items from the left to get started</div>
              </div>
            ) : (
              <div className="selling2-table-wrap">
                <table className="selling2-table" aria-label="Added items">
                  <thead>
                    <tr>
                      <th className="selling2-item-thumb-cell" scope="col">Image</th>
                      <th>Code</th>
                      <th>Description</th>
                      <th>Pcs</th>
                      <th>Subtotal</th>
                      <th>Discount</th>
                      <th>Net</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map(it => {
                      const rowDiscount = itemDiscounts[it.id] || 0;
                      const maxPcs = maxPcsForItem(it);
                      const qty = itemQuantities[it.id] ?? 1;
                      const lineGross = lineGrossForItem(it);
                      const lineNet = lineNetForItem(it);
                      const avail = it.pieces_remaining ?? it.pieces;
                      const imgSrc = getImageSrc(it.image_path);
                      const showPlaceholder = !imgSrc || cartImageLoadFailed.has(it.id);
                      return (
                        <tr key={it.id}>
                          <td className="selling2-item-thumb-cell">
                            {imgSrc && !cartImageLoadFailed.has(it.id) ? (
                              <img
                                className="selling2-item-thumb"
                                src={imgSrc}
                                alt=""
                                loading="lazy"
                                onError={() =>
                                  setCartImageLoadFailed(prev => new Set(prev).add(it.id))
                                }
                              />
                            ) : null}
                            {showPlaceholder ? (
                              <span className="selling2-item-thumb-placeholder">No img</span>
                            ) : null}
                          </td>
                          <td><span className="selling2-code-badge">{it.item_code || `#${it.id}`}</span></td>
                          <td>
                            <div className="selling2-desc-title">{it.category}</div>
                            <div className="selling2-desc-sub">
                              {it.item_type}
                              {it.weight_carats != null ? ` · ${it.weight_carats} ct` : ''}
                              {avail != null ? ` · ${avail} in stock` : ''}
                            </div>
                          </td>
                          <td>
                            <input
                              type="number"
                              className="selling2-qty-input"
                              value={qty}
                              min={1}
                              max={maxPcs}
                              step={1}
                              title={`Pieces to sell (1–${maxPcs})`}
                              onChange={e => setQtyForItem(it, Number(e.target.value))}
                            />
                          </td>
                          <td className="selling2-price">{formatMoneyAmount(lineGross, saleCurrency)}</td>
                          <td>
                            <input
                              type="number"
                              className="selling2-discount-input"
                              value={rowDiscount}
                              min={0}
                              onChange={e =>
                                setItemDiscounts(prev => ({
                                  ...prev,
                                  [it.id]: parseMoneyInput(e.target.value),
                                }))
                              }
                            />
                          </td>
                          <td className="selling2-net">{formatMoneyAmount(lineNet, saleCurrency)}</td>
                          <td>
                            <button type="button" className="selling2-trash" onClick={() => removeFromCart(it.id)} aria-label="Remove">
                              <IconTrash />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="selling2-right">
          <section className="selling2-card">
            <h3 className="selling2-card-title">Customer</h3>

            {selectedCustomer ? (
              <div className="selling2-customer-selected">
                <span className="selling2-customer-selected-icon" aria-hidden="true"><IconUser /></span>
                <div className="selling2-customer-selected-main">
                  <div className="selling2-customer-selected-name">{selectedCustomer.name}</div>
                  <div className="selling2-customer-selected-phone">{selectedCustomer.phone || ''}</div>
                </div>
                <button type="button" className="selling2-customer-selected-close" onClick={() => setSelectedCustomer(null)} aria-label="Remove customer">
                  <IconX size={16} />
                </button>
              </div>
            ) : (
              <>
                <div className="selling2-customer-search">
                  <span className="selling2-search-icon" aria-hidden="true"><IconUser /></span>
                  <input
                    type="search"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="selling2-search-input"
                    placeholder="Search by name, phone..."
                  />
                </div>
                {customers.length > 0 && (
                  <div className="selling2-customer-list">
                    {customers.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        className="selling2-customer-row"
                        onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); setCustomers([]); }}
                      >
                        <div className="selling2-customer-row-name">{c.name}</div>
                        <div className="selling2-customer-row-phone">{c.phone || ''}</div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <button type="button" className="ghost-button selling2-new-customer" onClick={() => setNewCustomerModalOpen(true)}>
              <span className="btn-icon" aria-hidden="true"><IconPlusCircle /></span>
              New customer
            </button>
          </section>

          <section className="selling2-card selling2-summary">
            <div className="selling2-field selling2-currency-field">
              <label htmlFor="sale-currency" className="selling2-currency-label">
                Invoice currency
              </label>
              <select
                id="sale-currency"
                className="selling2-currency-select"
                value={saleCurrency}
                onChange={e => setSaleCurrency(e.target.value)}
              >
                {SUPPORTED_CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <p className="selling2-currency-hint">
                Prices convert from each item&apos;s list currency using THB-based rates (Profile → Exchange rates).
              </p>
            </div>
            {sellingFxWarning ? (
              <div className="selling2-fx-warning" role="alert">
                Missing rate for a currency in the cart. Set exchange rates under Profile (owner).
              </div>
            ) : null}
            <div className="selling2-summary-row">
              <span>Subtotal</span>
              <strong>{formatMoneyAmount(cartTotal, saleCurrency)}</strong>
            </div>
            <div className="selling2-summary-row">
              <span>Item discounts</span>
              <span className="selling2-neg">−{formatMoneyAmount(itemsDiscountTotal, saleCurrency)}</span>
            </div>

            <div className="selling2-order-discount">
              <div className="selling2-order-discount-label">
                <span className="selling2-percent" aria-hidden="true">%</span>
                <span>Order Discount</span>
              </div>
              <div className="selling2-order-discount-inputrow">
                <input
                  type="number"
                  value={discountAmount}
                  onChange={e => setDiscountAmount(parseMoneyInput(e.target.value))}
                  min={0}
                />
                <span className="selling2-muted">({formatMoneyAmount(discountAmount, saleCurrency)})</span>
              </div>
            </div>

            <div className="selling2-total-discounts">
              <span>Total Discounts</span>
              <span className="selling2-neg">
                −{formatMoneyAmount(itemsDiscountTotal + parsedDiscount, saleCurrency)}
              </span>
            </div>

            <div className="selling2-final">
              <span>Final Total</span>
              <span className="selling2-final-amount">{formatMoneyAmount(finalTotal, saleCurrency)}</span>
            </div>

            {draftMessage && <div className="selling-state">{draftMessage}</div>}

            <button
              type="button"
              className="primary-button selling2-create"
              onClick={createInvoice}
              disabled={creatingInvoice || cart.length === 0 || invoiceHydrateLoading}
            >
              {creatingInvoice
                ? editingInvoiceId
                  ? 'Updating…'
                  : 'Creating…'
                : editingInvoiceId
                  ? 'Update invoice'
                  : 'Create Invoice'}
            </button>

            <div className="selling2-draft-actions">
              <button type="button" className="selling2-draft-btn selling2-draft-btn--new" onClick={resetInvoice}>
                New Bill
              </button>
              <button
                type="button"
                className="selling2-draft-btn selling2-draft-btn--save"
                onClick={saveDraft}
                disabled={savingDraft || cart.length === 0 || editingInvoiceId != null}
                title={editingInvoiceId != null ? 'Save draft is disabled while editing an invoice' : undefined}
              >
                {savingDraft ? 'Saving…' : 'Save Draft'}
              </button>
              <button
                type="button"
                className="selling2-draft-btn selling2-draft-btn--load"
                onClick={loadLatestDraft}
                disabled={loadingDraft}
              >
                {loadingDraft ? 'Loading…' : 'Load Draft'}
              </button>
            </div>
          </section>
        </div>
      </div>

      <section className="selling-invoices-card">
        <h3 className="selling-section-title">Recent invoices</h3>
        {invoicesError && (
          <div className="selling-state selling-state-error">
            <p>{invoicesError}</p>
          </div>
        )}
        <div className="selling-invoices-toolbar">
          <div className="selling-invoices-search-wrap">
            <span className="selling-invoices-search-icon" aria-hidden="true"><IconSearch /></span>
            <input
              type="search"
              className="selling-invoices-search"
              placeholder="Search by invoice number"
              value={invoiceSearch}
              onChange={e => setInvoiceSearch(e.target.value)}
            />
          </div>
          <div className="selling-invoices-filters" role="tablist" aria-label="Invoice status filters">
            {['all', 'Unpaid', 'Partial', 'Paid'].map(key => {
              const value = key as 'all' | InvoiceStatus;
              const label = key === 'all' ? 'All' : key;
              const active = invoiceStatusFilter === value;
              return (
                <button
                  key={key}
                  type="button"
                  className={`selling-invoices-filter${active ? ' is-active' : ''}`}
                  onClick={() => setInvoiceStatusFilter(value)}
                  role="tab"
                  aria-selected={active}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="selling-invoices-table-wrap">
          <table className="selling-invoices-table" aria-label="Invoices">
            <thead>
              <tr>
                <th scope="col">Invoice #</th>
                <th scope="col">Date</th>
                <th scope="col">Customer</th>
                <th scope="col">Total</th>
                <th scope="col">Paid</th>
                <th scope="col">Balance</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadingInvoices ? (
                <tr>
                  <td colSpan={8} className="selling-empty-cell">
                    Loading invoices…
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="selling-empty-cell">
                    No invoices yet. Create an invoice above to see it here.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map(inv => {
                  const remaining = inv.total - inv.paid;
                  const hasLoan = remaining > 0;
                  return (
                    <tr key={inv.id}>
                      <td className="selling-invoice-id">{inv.invoiceNo}</td>
                      <td>{new Date(inv.createdAt).toLocaleDateString()}</td>
                      <td className="selling-invoice-customer">{inv.customerName}</td>
                      <td className="selling-invoice-total">
                        {formatMoneyAmount(inv.total, inv.currencyCode)}
                      </td>
                      <td>
                        <span className="selling-invoice-paid">
                          {formatMoneyAmount(inv.paid, inv.currencyCode)}
                        </span>
                      </td>
                      <td>
                        {hasLoan ? (
                          <span className="selling-invoice-balance">
                            {formatMoneyAmount(remaining, inv.currencyCode)}
                          </span>
                        ) : (
                          <span className="selling-invoice-balance-zero">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`selling-invoice-status selling-invoice-status--${inv.status.toLowerCase()}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="selling-invoice-actions">
                        <div className="selling-invoice-actions-inner">
                          <button
                            type="button"
                            className="selling-invoice-action-btn selling-invoice-action-btn--pay"
                            title={hasLoan ? `Pay ${inv.invoiceNo}` : 'Fully paid — no balance'}
                            aria-label={hasLoan ? `Pay ${inv.invoiceNo}` : `Fully paid — ${inv.invoiceNo}`}
                            disabled={!hasLoan || !onNavigate}
                            onClick={() => handleSellingPayClick(inv.id)}
                          >
                            <IconCreditCard />
                          </button>
                          <button
                            type="button"
                            className="selling-invoice-action-btn selling-invoice-action-btn--edit"
                            title={
                              inv.paid > 0
                                ? 'Cannot edit — invoice has payments'
                                : `Edit ${inv.invoiceNo}`
                            }
                            disabled={inv.paid > 0 || invoiceHydrateLoading}
                            onClick={() => beginInlineInvoiceEdit(inv)}
                          >
                            <IconEdit />
                          </button>
                          <button
                            type="button"
                            className="selling-invoice-action-btn selling-invoice-action-btn--print"
                            title={`Print receipt — ${inv.invoiceNo}`}
                            onClick={() => printInvoiceReceiptById(inv.id)}
                          >
                            <IconPrinter />
                          </button>
                          <button
                            type="button"
                            className="selling-invoice-action-btn selling-invoice-action-btn--delete"
                            title={
                              inv.paid > 0
                                ? 'Cannot delete — invoice has payments'
                                : `Delete ${inv.invoiceNo}`
                            }
                            disabled={inv.paid > 0}
                            onClick={() => confirmDeleteInvoice(inv)}
                          >
                            <IconDelete />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {checkoutOpen && (
        <div className="checkout-overlay" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
          <div className="checkout-modal">
            <header className="checkout-header">
              <h3 id="checkout-title" className="checkout-title">
                Invoice Checkout
              </h3>
              <button
                type="button"
                className="checkout-close"
                onClick={() => setCheckoutOpen(false)}
                aria-label="Close"
              >
                <IconX size={20} />
              </button>
            </header>
            <div className="checkout-body">
              <div className="checkout-field">
                <span className="checkout-field-label">Payment Method</span>
                <div className="checkout-select-wrap">
                  <select
                    className="checkout-select"
                    value={checkoutMethod}
                    onChange={e => setCheckoutMethod(e.target.value as 'Cash' | 'Card' | 'QR')}
                  >
                    <option value="Cash">Cash</option>
                    <option value="Card">Card</option>
                    <option value="QR">QR</option>
                  </select>
                </div>
              </div>

              <div className="checkout-field checkout-field--currency">
                <span className="checkout-field-label">Pay in currency</span>
                <div className="checkout-select-wrap">
                  <select
                    className="checkout-select"
                    value={checkoutDisplayCurrency}
                    onChange={e => {
                      const next = normalizeCurrencyCode(e.target.value);
                      const inv = checkoutBaseCurrency;
                      const prev = checkoutDisplayCurrency;
                      const totalInv = checkoutInvoiceId ? checkoutDue : finalTotal;
                      if (checkoutAmount > 0) {
                        const inInv = convertAmountViaThb(checkoutAmount, prev, inv, thbPerUnit);
                        setCheckoutAmount(convertAmountViaThb(inInv, inv, next, thbPerUnit));
                      } else {
                        setCheckoutAmount(convertAmountViaThb(totalInv, inv, next, thbPerUnit));
                      }
                      setCheckoutDisplayCurrency(next);
                    }}
                    aria-label="Currency for amounts entered at checkout"
                  >
                    {SUPPORTED_CURRENCIES.map(c => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                {(checkoutNeedsConversion || checkoutFxMissing) && (
                  <div className="checkout-currency-notes">
                    {checkoutNeedsConversion && (
                      <p className="checkout-currency-hint">
                        You enter tender and quick amounts in <strong>{checkoutDisplayCurrency}</strong>. They are
                        converted to <strong>{checkoutBaseCurrency}</strong> (invoice currency) using Profile exchange
                        rates (THB base) before the payment is saved.
                      </p>
                    )}
                    {checkoutFxMissing && (
                      <p className="checkout-currency-hint checkout-currency-hint--warn">
                        Missing rate for this pair. Set THB rates under Profile → Exchange rates so conversion is correct.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="checkout-field checkout-field-total">
                <span className="checkout-field-label">Invoice Total</span>
                <div className="checkout-invoice-total">
                  {formatMoneyAmount(checkoutTotalDisplay, checkoutDisplayCurrency)}
                </div>
                {checkoutNeedsConversion && !checkoutFxMissing && (
                  <p className="checkout-currency-hint checkout-currency-hint--balance">
                    Invoice total: {formatMoneyAmount(checkoutTotalInInvoice, checkoutBaseCurrency)}
                  </p>
                )}
              </div>

              <div className="checkout-tender-row">
                <label className="checkout-field checkout-field-half">
                  <span className="checkout-field-label">Amount Tendered</span>
                  <input
                    className="checkout-input"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={checkoutAmount || ''}
                    onChange={e => {
                      const v = e.target.value;
                      setCheckoutAmount(v === '' ? 0 : parseMoneyInput(v));
                    }}
                    placeholder="0"
                  />
                </label>
                <div className="checkout-field checkout-field-half">
                  <span className="checkout-field-label">Change</span>
                  <div className="checkout-change-box" aria-live="polite">
                    {formatMoneyAmount(checkoutChangeDisplay, checkoutDisplayCurrency)}
                  </div>
                </div>
              </div>

              <div className="checkout-quick-section">
                <div className="checkout-quick-header">
                  <span className="checkout-quick-title">Quick Amount</span>
                  <button
                    type="button"
                    className="checkout-quick-clear"
                    onClick={() => setCheckoutAmount(0)}
                  >
                    Clear
                  </button>
                </div>
                <div className="checkout-quick-buttons">
                  {[100, 500, 1000, 5000].map(amount => (
                    <button
                      key={amount}
                      type="button"
                      className="checkout-quick-chip"
                      onClick={() => setCheckoutAmount(prev => roundMoney2(prev + amount))}
                    >
                      +{formatMoneyWhole(amount, checkoutDisplayCurrency)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <footer
              className={`checkout-footer${checkoutInvoiceId != null ? ' checkout-footer--with-print' : ''}`}
            >
              <button
                type="button"
                className="checkout-btn-back"
                onClick={() => setCheckoutOpen(false)}
              >
                Back
              </button>
              {checkoutInvoiceId != null && (
                <button
                  type="button"
                  className="ghost-button checkout-btn-print"
                  onClick={() => printInvoiceReceiptById(checkoutInvoiceId)}
                >
                  <span className="btn-icon" aria-hidden="true">
                    <IconPrinter />
                  </span>
                  Print receipt
                </button>
              )}
              <button type="button" className="checkout-btn-proceed" onClick={completePayment}>
                Proceed
              </button>
            </footer>
          </div>
        </div>
      )}

      {newCustomerModalOpen && (
        <div className="selling2-modal-overlay" role="dialog" aria-modal="true">
          <div className="selling2-modal">
            <div className="selling2-modal-header">
              <h3><span className="btn-icon" aria-hidden="true"><IconPlus /></span> Add New Customer</h3>
              <button type="button" className="selling2-modal-close" onClick={() => setNewCustomerModalOpen(false)} aria-label="Close">
                <IconX />
              </button>
            </div>
            <div className="selling2-modal-body">
              <label>
                <span>Name *</span>
                <input name="name" value={newCustomer.name} onChange={handleNewCustomerChange} placeholder="Customer name" />
              </label>
              <label>
                <span>Phone (optional)</span>
                <input name="phone" value={newCustomer.phone} onChange={handleNewCustomerChange} placeholder="0771234567" />
              </label>
              <label>
                <span>Email (optional)</span>
                <input name="email" value={newCustomer.email} onChange={handleNewCustomerChange} placeholder="customer@example.com" />
              </label>
              <p className="selling2-modal-section-label">Billing address (optional, shown on receipts)</p>
              <label>
                <span>Address line 1</span>
                <input name="address_line1" value={newCustomer.address_line1} onChange={handleNewCustomerChange} placeholder="Street, building" />
              </label>
              <label>
                <span>Address line 2</span>
                <input name="address_line2" value={newCustomer.address_line2} onChange={handleNewCustomerChange} placeholder="Unit, district…" />
              </label>
              <div className="selling2-modal-row2">
                <label>
                  <span>City</span>
                  <input name="city" value={newCustomer.city} onChange={handleNewCustomerChange} placeholder="City" />
                </label>
                <label>
                  <span>Postal code</span>
                  <input name="postal_code" value={newCustomer.postal_code} onChange={handleNewCustomerChange} placeholder="Postal code" />
                </label>
              </div>
              <label>
                <span>Country</span>
                <input name="country" value={newCustomer.country} onChange={handleNewCustomerChange} placeholder="Country" />
              </label>
              <label>
                <span>Notes (optional)</span>
                <textarea name="notes" value={newCustomer.notes} onChange={handleNewCustomerChange} rows={3} placeholder="Any special instructions..." />
              </label>
            </div>
            <div className="selling2-modal-footer">
              <button type="button" className="ghost-button" onClick={() => setNewCustomerModalOpen(false)}>Cancel</button>
              <button
                type="button"
                className="primary-button"
                onClick={async () => {
                  const ok = await saveCustomer();
                  if (ok) setNewCustomerModalOpen(false);
                }}
                disabled={customerSaving}
              >
                {customerSaving ? 'Saving…' : 'Save Customer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {invoiceCreatedOpen && createdInvoice && (
        <div className="selling2-modal-overlay" role="dialog" aria-modal="true">
          <div className="selling2-created">
            <button type="button" className="selling2-modal-close selling2-created-close" onClick={() => setInvoiceCreatedOpen(false)} aria-label="Close">
              <IconX />
            </button>
            <div className="selling2-created-check" aria-hidden="true"><IconCheck /></div>
            <h3 className="selling2-created-title">Invoice Created!</h3>
            <div className="selling2-created-number">
              <div className="selling2-created-number-label">Invoice Number</div>
              <div className="selling2-created-number-value">{createdInvoice.invoiceNo}</div>
            </div>
            <div className="selling2-created-meta">
              <div><span>Customer</span><span>{createdInvoice.customerName}</span></div>
              <div>
                <span>Total Amount</span>
                <span>{formatMoneyAmount(createdInvoice.total, createdInvoice.currencyCode)}</span>
              </div>
              <div>
                <span>Items</span>
                <span>
                  {cart.reduce((n, row) => n + (itemQuantities[row.id] ?? 1), 0)} pcs
                  {cart.length > 1 ? ` · ${cart.length} lines` : ''}
                </span>
              </div>
              <div><span>Date</span><span>{new Date(createdInvoice.createdAt).toLocaleDateString()}</span></div>
            </div>
            {cart.length > 0 && (
              <div className="selling2-created-lines" aria-label="Invoice line details">
                <div className="selling2-created-lines-title">Line details</div>
                <ul className="selling2-created-lines-list">
                  {cart.map(row => {
                    const q = itemQuantities[row.id] ?? 1;
                    const gross = lineGrossForItem(row);
                    const disc = Math.min(itemDiscounts[row.id] || 0, gross);
                    const net = Math.max(0, gross - disc);
                    const label = row.item_code || `#${row.id}`;
                    return (
                      <li key={row.id} className="selling2-created-line">
                        <span className="selling2-created-line-name">{label}</span>
                        <span className="selling2-created-line-amounts">
                          <span className="selling2-created-line-gross">{formatMoneyAmount(gross, createdInvoice.currencyCode)}</span>
                          {disc > 0 ? (
                            <span className="selling2-created-line-disc">−{formatMoneyAmount(disc, createdInvoice.currencyCode)}</span>
                          ) : null}
                          <span className="selling2-created-line-net">{formatMoneyAmount(net, createdInvoice.currencyCode)}</span>
                          <span className="selling2-created-line-qty">×{q}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <button
              type="button"
              className="primary-button selling2-created-btn"
              onClick={() => createdInvoice && printInvoiceReceiptById(createdInvoice.id)}
            >
              <span className="btn-icon" aria-hidden="true"><IconPrinter /></span>
              Print receipt
            </button>
            <button
              type="button"
              className="ghost-button selling2-created-btn"
              onClick={() => {
                setInvoiceCreatedOpen(false);
                if (createdInvoice) {
                  setCheckoutDisplayCurrency(normalizeCurrencyCode(createdInvoice.currencyCode));
                }
                setCheckoutOpen(true);
              }}
            >
              Continue to Checkout
            </button>
            <button
              type="button"
              className="ghost-button selling2-created-btn selling2-created-btn-muted"
              onClick={() => { setInvoiceCreatedOpen(false); resetInvoice(); }}
            >
              Start New Invoice
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
