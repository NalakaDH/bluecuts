import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import {
  SUPPORTED_CURRENCIES,
  normalizeCurrencyCode,
  formatMoneyWhole,
  parseMoneyInput,
  roundMoney2,
} from '../../lib/currencies';
import {
  ITEM_TYPE_OPTIONS,
  INVENTORY_CATEGORY_MIN_DISPLAY_LENGTH,
  categoryLooksLikeShortCode,
  normalizeItemType,
  isSingleItemTypeForm,
  formatItemTypeDisplay,
  inventoryItemPrimaryLabel,
} from '../../lib/inventoryDisplay';
import { dateFromServerUtc } from '../../lib/serverTime';

const CATEGORY_OPTIONS: string[] = [
  'Blue Sapphire', 'Yellow Sapphire', 'Pink Sapphire', 'White Sapphire', 'Ruby', 'Aquamarine',
  'Tsavorite', 'Zircon', 'Sphene', 'Andradite', 'Amethyst', 'Mali Garnet', 'Malaya Garnet',
  'Dimantoide Garnet', 'Yellow Beryl', 'Green Beryl', 'Emerald', 'Spinel', 'Quartz', 'Lemon Quartz',
  'Peridot', 'Citrine', 'Andalusite', 'Enstatite', 'Sinhalite', 'Topaz', 'Star Ruby', 'Star Sapphire',
  'Chrysoberyl Cats Ey', 'Chrysoberyl', 'Rhodolite Garnet', 'Hessonite Garnet', 'Spessartine Garnet',
  'Fancy Sapphire', 'Benitoite', 'Alexandrite', 'Rhodonite', 'Epidote', 'Taaffeite', 'Kyanite',
  'Idocrase', 'Tanzanite', 'Diopside', 'Kornerupine', 'Kunzite', 'Jeremejevite', 'Apatite', 'Danburite',
  'Tourmaline', 'Rubalite', 'Actinolite', 'Turquoise', 'Morganite', 'Labradorite', 'Scapolite',
  'Sunstone', 'Iolite', 'Chalcedony', 'Pearl', 'Moonstone', 'Petalite', 'Lapis Lazuli', 'Coral',
  'Opal', 'Fluorite', 'Purple Sapphire', 'Spinel Star', 'Kornerupine cats ey', 'Paraiba Tourmaline',
  'Beryl', 'Garnet cats eye', 'Padparajsha', 'Garnet', 'Crom Tourmaline', 'Zircon Cats Eye',
  'Color Change Garnet', 'Blue Sapphire Cab', 'Green Sapphire', 'Garnet Star', 'Diopside', 'Green Zircon',
  'Zoisite', 'Rutile Cats Eye', 'Fiborlite', 'Tourmaline Cab', 'Blue Opal', 'Sapprine', 'Calsidony cab',
  'Ametrine', 'Axinite', 'Casatarite', 'Rutile quartz', 'Spinel Cats eye', 'Emarald Cab', 'Trichi Sapphire',
  'Silimanite', 'Emarald', 'Grosular Garnet', 'Mint Garnet', 'Blue Zircon', 'Chrysoberyl Star',
  'Tsavorite Cab', 'Rubalite cab', '9stones', 'Torquoise', 'Ruby cab', 'Sapphire Crystals', 'Ruby Crystals',
  'Spinel Crystals', 'Masgravite', 'Enstatite Cats eye', 'Orange Sapphire', 'Bicolour Sapphire',
  'Sapphire Cats Eye', 'Rubalite Cab', 'White Zircon', 'Phenakite', 'Garnet Cabichon', 'Cobolt Spinel',
  'Aquamarine Cabichon', 'Grandidirite', 'Moissanite', 'Spodumene',
];

const DESCRIPTION_SHAPE_HINT = 'e.g. Oval 3ct, round brilliant — optional';

function resolveInventoryCategory(stored: string, search: string, choices: readonly string[]): string {
  const t = stored.trim();
  if (t) return t;
  const q = search.trim();
  if (!q) return '';
  return choices.find((c) => c.toLowerCase() === q.toLowerCase()) ?? '';
}

/** 1 gram = 5 carats (client-specified conversion) */
const WEIGHT_GRAMS_TO_CARATS = 5;
const INVENTORY_FORM_CURRENCY = 'USD';

interface UpdateInventoryPageProps {
  token: string;
  role?: 'owner' | 'staff';
}

interface InventoryItem {
  id: number;
  category: string;
  item_type: string;
  pieces: number;
  weight_grams: number | null;
  weight_carats: number | null;
  purchasing_total_price: number | null;
  purchasing_carat_price: number | null;
  selling_total_price: number | null;
  selling_carat_price: number | null;
  selling_currency?: string | null;
  image_path: string | null;
  item_code: string | null;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface MobileUploadSession {
  session_id: string;
  expires_at: string;
  inventory_item_id: number | null;
  category: string;
  item_code: string;
  paths: string[];
  urls: string[];
}

interface MobileUploadSessionStatus {
  session_id: string;
  expires_at: string;
  used: boolean;
  image_path: string | null;
}

const MAX_CATEGORY_DROPDOWN = 16;

function formatDateTime(iso: string): string {
  try {
    const d = dateFromServerUtc(iso);
    return d.toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const iconSize = 20;
const IconDetails = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" />
  </svg>
);
const IconImage = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);
const IconPricing = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
const IconList = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);
const IconAdd = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconSearch = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);
const IconRefresh = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
const IconEdit = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const IconDelete = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);
const IconClose = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconFilter = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
const IconCheck = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
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

const LIST_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'Available', label: 'Available' },
  { value: 'On Memo', label: 'On Memo' },
  { value: 'Sold', label: 'Sold' },
];

export const UpdateInventoryPage: React.FC<UpdateInventoryPageProps> = ({ token, role = 'staff' }) => {
  const { showAlert, showConfirm } = useAlertDialog();
  const canEditOrDelete = role === 'owner';
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const [photoFileName, setPhotoFileName] = useState<string | null>(null);
  const [dropZoneActive, setDropZoneActive] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryHighlight, setCategoryHighlight] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const lastPurchasePriceEditedRef = useRef<'total' | 'carat'>('carat');
  const [formOpen, setFormOpen] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const [listStatusFilter, setListStatusFilter] = useState<string>('');
  const [listCategoryFilter, setListCategoryFilter] = useState<string>('');
  const [listCategoryDropdownOpen, setListCategoryDropdownOpen] = useState(false);
  const [listStatusDropdownOpen, setListStatusDropdownOpen] = useState(false);
  const listCategoryDropdownRef = useRef<HTMLDivElement>(null);
  const listStatusDropdownRef = useRef<HTMLDivElement>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [mobileSession, setMobileSession] = useState<MobileUploadSession | null>(null);
  const [mobileStarting, setMobileStarting] = useState(false);
  const [mobileUploadHint, setMobileUploadHint] = useState<string | null>(null);
  const [mobileCopied, setMobileCopied] = useState(false);

  const [form, setForm] = useState({
    category: '',
    item_type: '',
    pieces: '1',
    weight_grams: '',
    weight_carats: '',
    purchasing_total_price: '',
    purchasing_carat_price: '',
    selling_total_price: '',
    selling_carat_price: '',
    selling_currency: INVENTORY_FORM_CURRENCY,
    image_path: '',
    item_code: '',
    description: '',
  });

  const allCategoryChoices = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of CATEGORY_OPTIONS) map.set(c.toLowerCase(), c);
    for (const it of items) {
      const c = (it.category || '').trim();
      if (c.length >= INVENTORY_CATEGORY_MIN_DISPLAY_LENGTH && !map.has(c.toLowerCase())) {
        map.set(c.toLowerCase(), c);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    const base = q
      ? allCategoryChoices.filter((c) => c.toLowerCase().includes(q))
      : allCategoryChoices;
    return base.slice(0, MAX_CATEGORY_DROPDOWN);
  }, [allCategoryChoices, categorySearch]);

  const categorySearchRef = useRef(categorySearch);
  categorySearchRef.current = categorySearch;
  const allCategoryChoicesRef = useRef(allCategoryChoices);
  allCategoryChoicesRef.current = allCategoryChoices;

  const categoryInputValue = categoryOpen ? categorySearch : (form.category || categorySearch);

  const fetchItems = useCallback(async (opts?: { search?: string; status?: string }) => {
    const search = opts?.search !== undefined ? opts.search : listSearch;
    const status = opts?.status !== undefined ? opts.status : listStatusFilter;
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (status.trim()) params.set('status', status.trim());
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
      const msg = err.message || 'Failed to load list';
      setListError(msg);
      setItems([]);
      showAlert({ title: 'Could not load inventory', message: msg, variant: 'error' });
    } finally {
      setListLoading(false);
    }
  }, [listSearch, listStatusFilter, token, showAlert]);

  const applyListFilters = () => {
    fetchItems({ search: listSearch, status: listStatusFilter });
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    setImageUploadError(null);
    setImageUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch(apiUrl('/api/inventory/upload'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const message = await parseErrorResponse(res, 'Upload failed');
        throw new Error(message);
      }
      const data = await res.json();
      return (data.imagePath ?? data.path ?? null) as string | null;
    } catch (err: any) {
      setImageUploadError(err.message || 'Upload failed');
      return null;
    } finally {
      setImageUploading(false);
    }
  };

  const getImageSrc = (imagePath: string | null): string => {
    if (!imagePath) return '';
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
    const path = imagePath.startsWith('/') ? imagePath : `/uploads/${imagePath}`;
    return apiUrl(path);
  };

  const startMobileUpload = async () => {
    setMobileStarting(true);
    setMobileUploadHint(null);
    setMobileCopied(false);
    try {
      const res = await fetch(apiUrl('/api/mobile-upload/session'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          inventory_item_id: editingId,
          category: form.category || '',
          item_code: form.item_code || '',
        }),
      });
      if (!res.ok) {
        const message = await parseErrorResponse(res, 'Could not start mobile upload');
        throw new Error(message);
      }
      const data = (await res.json()) as MobileUploadSession;
      setMobileSession(data);
      if (!data.urls?.length) {
        setMobileUploadHint('No LAN address detected. Connect laptop and phone to same Wi-Fi, then retry.');
      }
    } catch (err: any) {
      showAlert({
        title: 'Mobile upload unavailable',
        message: err.message || 'Could not start mobile upload.',
        variant: 'error',
      });
    } finally {
      setMobileStarting(false);
    }
  };

  const cancelMobileUpload = async () => {
    if (!mobileSession) return;
    try {
      await fetch(apiUrl(`/api/mobile-upload/session/${mobileSession.session_id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // ignore
    }
    setMobileSession(null);
    setMobileUploadHint(null);
    setMobileCopied(false);
  };

  const copyMobileLink = async () => {
    if (!mobileSession?.urls?.[0]) return;
    try {
      await navigator.clipboard.writeText(mobileSession.urls[0]);
      setMobileCopied(true);
      setTimeout(() => setMobileCopied(false), 2000);
    } catch {
      setMobileUploadHint('Could not copy automatically. Please copy the link manually.');
    }
  };

  useEffect(() => {
    fetchItems({ search: '', status: '' });
    // This should run once on mount. Including `fetchItems` here causes filter/search resets
    // because `fetchItems` is recreated when listSearch/listStatusFilter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (listCategoryDropdownRef.current && !listCategoryDropdownRef.current.contains(e.target as Node)) setListCategoryDropdownOpen(false);
      if (listStatusDropdownRef.current && !listStatusDropdownRef.current.contains(e.target as Node)) setListStatusDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!mobileSession) return;
    let alive = true;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const res = await fetch(apiUrl(`/api/mobile-upload/session/${mobileSession.session_id}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!alive) return;
        if (res.status === 404) {
          setMobileUploadHint('Mobile upload session expired. Start a new one.');
          setMobileSession(null);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as MobileUploadSessionStatus;
        if (data.used && data.image_path) {
          setForm(prev => ({ ...prev, image_path: data.image_path || '' }));
          setPhotoFileName('Uploaded from phone');
          setImageUploadError(null);
          setMobileSession(null);
          setMobileUploadHint('Photo received from phone and attached.');
          showAlert({
            title: 'Photo uploaded',
            message: 'Mobile photo uploaded and linked to this item.',
            variant: 'success',
          });
          return;
        }
      } catch {
        // ignore transient poll errors
      }
      timer = window.setTimeout(poll, 3000);
    };
    poll();
    return () => {
      alive = false;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [mobileSession, token, showAlert]);

  const displayedItems = listCategoryFilter
    ? items.filter((i) => i.category === listCategoryFilter)
    : items;
  const uniqueCategories = Array.from(
    new Set(items.map((i) => i.category).filter((c) => !categoryLooksLikeShortCode(c)))
  ).sort();

  const validateForm = (): Record<string, string> => {
    const err: Record<string, string> = {};
    const cat = resolveInventoryCategory(form.category, categorySearch, allCategoryChoices);
    if (!cat) err.category = 'Stone type is required.';
    else {
      const allowedCat = allCategoryChoices.some((a) => a.toLowerCase() === cat.toLowerCase());
      if (!allowedCat) {
        err.category =
          cat.length < INVENTORY_CATEGORY_MIN_DISPLAY_LENGTH
            ? `Use the full stone name (at least ${INVENTORY_CATEGORY_MIN_DISPLAY_LENGTH} letters), not a short code.`
            : 'Pick a stone type from the list or match an existing full category from inventory.';
      }
    }
    const itemTypeNorm = normalizeItemType(form.item_type);
    if (!itemTypeNorm) {
      err.item_type = 'Choose product form: cut single, cut lot, rough single, or rough lot.';
    }
    const piecesNum = Number(form.pieces);
    if (form.pieces === '' || isNaN(piecesNum)) err.pieces = 'Pieces is required.';
    else if (piecesNum < 1) err.pieces = 'Pieces must be at least 1.';
    else if (!Number.isInteger(piecesNum)) err.pieces = 'Pieces must be a whole number.';
    else if (itemTypeNorm && (itemTypeNorm === 'cut single' || itemTypeNorm === 'rough single') && piecesNum !== 1) {
      err.pieces = 'For cut single/rough single, pieces must be exactly 1.';
    }
    const wg = form.weight_grams.trim();
    if (wg && (isNaN(Number(wg)) || Number(wg) <= 0)) err.weight_grams = 'Weight must be greater than 0.';
    const wc = form.weight_carats.trim();
    if (wc && (isNaN(Number(wc)) || Number(wc) <= 0)) err.weight_carats = 'Weight must be greater than 0.';
    const pt = form.purchasing_total_price.trim();
    if (pt && (isNaN(Number(pt)) || Number(pt) < 0)) err.purchasing_total_price = 'Must be 0 or greater.';
    const pc = form.purchasing_carat_price.trim();
    if (pc && (isNaN(Number(pc)) || Number(pc) < 0)) err.purchasing_carat_price = 'Must be 0 or greater.';
    const st = form.selling_total_price.trim();
    if (st && (isNaN(Number(st)) || Number(st) < 0)) err.selling_total_price = 'Must be 0 or greater.';
    const sc = form.selling_carat_price.trim();
    if (sc && (isNaN(Number(sc)) || Number(sc) < 0)) err.selling_carat_price = 'Must be 0 or greater.';
    return err;
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'purchasing_total_price') lastPurchasePriceEditedRef.current = 'total';
      if (name === 'purchasing_carat_price') lastPurchasePriceEditedRef.current = 'carat';
      if (name === 'item_type') {
        if (isSingleItemTypeForm(String(value || ''))) {
          next.pieces = '1';
        }
      }
      if (name === 'weight_grams') {
        const num = value === '' ? NaN : Number(value);
        if (!value.trim()) next.weight_carats = '';
        else if (!isNaN(num) && num >= 0) next.weight_carats = (num * WEIGHT_GRAMS_TO_CARATS).toFixed(3);
      } else if (name === 'weight_carats') {
        const num = value === '' ? NaN : Number(value);
        if (!value.trim()) next.weight_grams = '';
        else if (!isNaN(num) && num >= 0) next.weight_grams = (num / WEIGHT_GRAMS_TO_CARATS).toFixed(3);
      }
      const shouldRecalcTotals =
        name === 'weight_carats' ||
        name === 'weight_grams' ||
        name === 'purchasing_carat_price' ||
        name === 'selling_carat_price';
      if (shouldRecalcTotals) {
        const weightCarats = Number(next.weight_carats);
        const purchasingCaratPrice = Number(next.purchasing_carat_price);
        const sellingCaratPrice = Number(next.selling_carat_price);
        if (Number.isFinite(weightCarats) && weightCarats > 0 && Number.isFinite(purchasingCaratPrice) && purchasingCaratPrice >= 0) {
          next.purchasing_total_price = roundMoney2(weightCarats * purchasingCaratPrice).toFixed(2);
        } else {
          next.purchasing_total_price = '';
        }
        if (Number.isFinite(weightCarats) && weightCarats > 0 && Number.isFinite(sellingCaratPrice) && sellingCaratPrice >= 0) {
          next.selling_total_price = roundMoney2(weightCarats * sellingCaratPrice).toFixed(2);
        } else {
          next.selling_total_price = '';
        }
      }

      // Purchasing total -> purchasing carat (bidirectional).
      const shouldRecalcPurchaseCarat =
        name === 'purchasing_total_price' || name === 'weight_carats' || name === 'weight_grams';
      if (shouldRecalcPurchaseCarat) {
        const weightCarats = Number(next.weight_carats);
        const total = Number(next.purchasing_total_price);
        const last = lastPurchasePriceEditedRef.current;
        if ((name === 'weight_carats' || name === 'weight_grams') && last === 'carat') {
          // When weight changes, keep carat price as the "source of truth" (existing behavior).
        } else if (Number.isFinite(weightCarats) && weightCarats > 0 && Number.isFinite(total) && total >= 0) {
          next.purchasing_carat_price = roundMoney2(total / weightCarats).toFixed(2);
        } else if (name === 'purchasing_total_price') {
          // Only clear the derived field when the user is editing total (avoid wiping on other edits).
          next.purchasing_carat_price = '';
        }
      }

      next.selling_currency = INVENTORY_FORM_CURRENCY;
      return next;
    });
    setFieldErrors(prev => {
      const nextErr = { ...prev };
      delete nextErr[name];
      if (name === 'weight_grams') delete nextErr.weight_carats;
      if (name === 'weight_carats') delete nextErr.weight_grams;
      return nextErr;
    });
    setSaveError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const msg = 'Please fix the errors below.';
      setSaveError(msg);
      showAlert({ title: 'Check the form', message: msg, variant: 'warning' });
      return;
    }
    setFieldErrors({});
    const itemTypeNorm = normalizeItemType(form.item_type)!;
    const catRaw = resolveInventoryCategory(form.category, categorySearch, allCategoryChoices);
    const catNorm =
      allCategoryChoices.find((a) => a.toLowerCase() === catRaw.toLowerCase()) ?? catRaw.trim();
    const body = {
      category: catNorm,
      item_type: itemTypeNorm,
      pieces: Number(form.pieces),
      weight_grams: form.weight_grams ? Number(form.weight_grams) : null,
      weight_carats: form.weight_carats ? Number(form.weight_carats) : null,
      purchasing_total_price: form.purchasing_total_price.trim()
        ? roundMoney2(parseMoneyInput(form.purchasing_total_price))
        : null,
      purchasing_carat_price: form.purchasing_carat_price.trim()
        ? roundMoney2(parseMoneyInput(form.purchasing_carat_price))
        : null,
      selling_total_price: form.selling_total_price.trim()
        ? roundMoney2(parseMoneyInput(form.selling_total_price))
        : null,
      selling_carat_price: form.selling_carat_price.trim()
        ? roundMoney2(parseMoneyInput(form.selling_carat_price))
        : null,
      selling_currency: normalizeCurrencyCode(form.selling_currency),
      image_path: form.image_path || null,
      item_code: form.item_code || null,
      description: form.description || null,
    };
    setSaving(true);
    setSaveError(null);
    try {
      const url = editingId ? apiUrl(`/api/inventory/${editingId}`) : apiUrl('/api/inventory');
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to save item');
      }
      await res.json();
      showAlert({
        title: editingId ? 'Item updated' : 'Item saved',
        message: editingId ? 'Your changes were saved successfully.' : 'The new item was added to inventory.',
        variant: 'success',
      });
      setPhotoFileName(null);
      setEditingId(null);
      setFormOpen(false);
      setForm({
        category: '',
        item_type: '',
        pieces: '1',
        weight_grams: '',
        weight_carats: '',
        purchasing_total_price: '',
        purchasing_carat_price: '',
        selling_total_price: '',
        selling_carat_price: '',
        selling_currency: INVENTORY_FORM_CURRENCY,
        image_path: '',
        item_code: '',
        description: '',
      });
      setCategorySearch('');
      fetchItems();
    } catch (err: any) {
      const msg = err.message || 'Failed to save item';
      setSaveError(msg);
      showAlert({ title: 'Could not save item', message: msg, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
      if (e.key === 'Escape') {
        setCategoryOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (categoryContainerRef.current && !categoryContainerRef.current.contains(e.target as Node)) {
        setCategoryOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const selectCategory = (cat: string) => {
    setForm(prev => ({ ...prev, category: cat }));
    setCategorySearch('');
    setCategoryOpen(false);
    setCategoryHighlight(0);
    setFieldErrors(prev => { const next = { ...prev }; delete next.category; return next; });
  };

  const resetForm = () => {
    setForm({
      category: '',
      item_type: '',
      pieces: '1',
      weight_grams: '',
      weight_carats: '',
      purchasing_total_price: '',
      purchasing_carat_price: '',
      selling_total_price: '',
      selling_carat_price: '',
      selling_currency: INVENTORY_FORM_CURRENCY,
      image_path: '',
      item_code: '',
      description: '',
    });
    setPhotoFileName(null);
    setSaveError(null);
    setCategorySearch('');
    setCategoryOpen(false);
    setFieldErrors({});
    setEditingId(null);
    setImageUploadError(null);
    setMobileSession(null);
    setMobileUploadHint(null);
    setMobileCopied(false);
  };

  const handleEdit = (item: InventoryItem) => {
    setForm({
      category: item.category,
      item_type: normalizeItemType(item.item_type) ?? '',
      pieces: String(item.pieces),
      weight_grams: item.weight_grams != null ? String(item.weight_grams) : '',
      weight_carats: item.weight_carats != null ? String(item.weight_carats) : '',
      purchasing_total_price: item.purchasing_total_price != null ? String(item.purchasing_total_price) : '',
      purchasing_carat_price: item.purchasing_carat_price != null ? String(item.purchasing_carat_price) : '',
      selling_total_price: item.selling_total_price != null ? String(item.selling_total_price) : '',
      selling_carat_price: item.selling_carat_price != null ? String(item.selling_carat_price) : '',
      selling_currency: INVENTORY_FORM_CURRENCY,
      image_path: item.image_path || '',
      item_code: item.item_code || '',
      description: item.description || '',
    });
    setCategorySearch(item.category);
    setEditingId(item.id);
    setFormOpen(true);
    setSaveError(null);
    setFieldErrors({});
    // After opening the edit form, scroll to it (long lists on small screens).
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  // (No auto-focus) Avoid triggering the Category combobox dropdown unexpectedly.

  const handleDelete = async (item: InventoryItem) => {
    const ok = await showConfirm({
      title: 'Delete item?',
      message: `Delete "${inventoryItemPrimaryLabel(item)}" (${item.item_code || item.id})? This cannot be undone if the item has no invoice or memo history.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(apiUrl(`/api/inventory/${item.id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const message = await parseErrorResponse(res, 'Failed to delete');
        throw new Error(message);
      }
      fetchItems({ search: listSearch, status: listStatusFilter });
      showAlert({
        title: 'Item deleted',
        message: `"${inventoryItemPrimaryLabel(item)}" was removed from inventory.`,
        variant: 'success',
      });
    } catch (err: any) {
      const msg = err.message || 'Failed to delete item';
      setListError(msg);
      showAlert({ title: 'Could not delete item', message: msg, variant: 'error' });
    }
  };

  return (
    <div className="page page-update-inventory">
        <div className={`section-card section-card--form ${categoryOpen ? 'section-card--form-dropdown-open' : ''}`}>
        <div className="inventory-form-section">
          {!formOpen ? (
            <button
              type="button"
              className="primary-button inventory-form-toggle"
              onClick={() => setFormOpen(true)}
            >
              <span className="btn-icon"><IconAdd /></span>
              Add new item
            </button>
          ) : (
            <>
              <div className="inventory-form-header">
                <span className="inventory-form-title">
                  <span className="section-title-icon section-title-icon--form">
                    <IconAdd />
                  </span>
                  {editingId ? 'Edit item' : 'Add new item'}
                </span>
                <button
                  type="button"
                  className="ghost-button inventory-form-close"
                  onClick={() => { resetForm(); setFormOpen(false); }}
                  aria-label="Close form"
                >
                  <IconClose />
                  <span>Close</span>
                </button>
              </div>
      <form ref={formRef} className="inventory-form inventory-form-three-cols" onSubmit={handleSubmit}>
        {saveError && (
          <div className="alert alert-error" role="alert">{saveError}</div>
        )}
        <div className="form-three-cols">
          {/* Column 1 */}
          <div className="form-col form-col-card section-card-inner section-card-inner--details">
            <div className="form-section-title section-title-with-icon">
              <span className="section-title-icon section-title-icon--details"><IconDetails /></span>
              Details
            </div>
            <div className="form-col-fields">
              <div className="form-field form-field-combobox" ref={categoryContainerRef}>
                <label className="label-required">Stone type</label>
                <span className="form-field-hint">Full gem name (e.g. Ruby), not a one-letter code</span>
                <input
                  type="text"
                  autoComplete="off"
                  value={categoryInputValue}
                  onChange={e => {
                    setCategorySearch(e.target.value);
                    setCategoryOpen(true);
                    setCategoryHighlight(0);
                  }}
                  onFocus={() => {
                    setCategoryOpen(true);
                    setCategorySearch(form.category || '');
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      setCategoryOpen(false);
                      const q = categorySearchRef.current.trim();
                      if (!q) return;
                      const choices = allCategoryChoicesRef.current;
                      const m = choices.find((c) => c.toLowerCase() === q.toLowerCase());
                      if (m) {
                        setCategorySearch('');
                        setForm((prev) => ({ ...prev, category: m }));
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          delete next.category;
                          return next;
                        });
                      }
                    }, 150);
                  }}
                  onKeyDown={e => {
                    if (!categoryOpen) {
                      if (e.key === 'ArrowDown' || e.key === 'Enter') setCategoryOpen(true);
                      return;
                    }
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setCategoryHighlight(i => Math.min(i + 1, filteredCategories.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setCategoryHighlight(i => Math.max(i - 1, 0));
                    } else if (e.key === 'Enter' && filteredCategories[categoryHighlight]) {
                      e.preventDefault();
                      selectCategory(filteredCategories[categoryHighlight]);
                    } else if (e.key === 'Escape') {
                      setCategoryOpen(false);
                    }
                  }}
                  placeholder="Type to search..."
                  className={fieldErrors.category ? 'input-invalid' : ''}
                />
                {categoryOpen && (
                  <ul className="combobox-list" role="listbox">
                    {filteredCategories.length === 0 ? (
                      <li className="combobox-item combobox-item-empty">No matches</li>
                    ) : (
                      filteredCategories.map((cat, i) => (
                        <li
                          key={cat}
                          role="option"
                          aria-selected={form.category === cat}
                          className={`combobox-item ${i === categoryHighlight ? 'combobox-item-highlight' : ''}`}
                          onMouseEnter={() => setCategoryHighlight(i)}
                          onMouseDown={e => {
                            e.preventDefault();
                            selectCategory(cat);
                          }}
                        >
                          {cat}
                        </li>
                      ))
                    )}
                  </ul>
                )}
                {fieldErrors.category && (
                  <span className="form-field-error" role="alert">{fieldErrors.category}</span>
                )}
              </div>
              <div className="form-field">
                <label className="label-required">Cut / product form</label>
                <span className="form-field-hint">Single vs lot and cut vs rough — not gem shape (use description for oval, round, etc.)</span>
                <select
                  name="item_type"
                  value={form.item_type}
                  onChange={handleChange}
                  required
                  className={fieldErrors.item_type ? 'input-invalid' : ''}
                >
                  <option value="">Select…</option>
                  {ITEM_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t === 'cut single'
                        ? 'Cut — single stone'
                        : t === 'cut lot'
                          ? 'Cut — lot (multiple)'
                          : t === 'rough single'
                            ? 'Rough — single piece'
                            : 'Rough — lot (multiple)'}
                    </option>
                  ))}
                </select>
                {fieldErrors.item_type && (
                  <span className="form-field-error" role="alert">{fieldErrors.item_type}</span>
                )}
              </div>
              <div className="form-field">
                <label className="label-required">Pieces</label>
                <input
                  name="pieces"
                  type="number"
                  min={1}
                  max={isSingleItemTypeForm(form.item_type) ? 1 : undefined}
                  value={form.pieces}
                  onChange={handleChange}
                  disabled={isSingleItemTypeForm(form.item_type)}
                  required
                  className={fieldErrors.pieces ? 'input-invalid' : ''}
                />
                {isSingleItemTypeForm(form.item_type) && (
                  <span className="form-field-hint">Single types are fixed at 1 piece.</span>
                )}
                {fieldErrors.pieces && (
                  <span className="form-field-error" role="alert">{fieldErrors.pieces}</span>
                )}
              </div>
              <div className="form-field">
                <label>Weight (grams)</label>
                <input
                  name="weight_grams"
                  type="number"
                  step="0.001"
                  value={form.weight_grams}
                  onChange={handleChange}
                  placeholder="0.000"
                  className={fieldErrors.weight_grams ? 'input-invalid' : ''}
                />
                {fieldErrors.weight_grams && (
                  <span className="form-field-error" role="alert">{fieldErrors.weight_grams}</span>
                )}
              </div>
              <div className="form-field">
                <label>Weight (carats)</label>
                <input
                  name="weight_carats"
                  type="number"
                  step="0.001"
                  value={form.weight_carats}
                  onChange={handleChange}
                  placeholder="0.000"
                  className={fieldErrors.weight_carats ? 'input-invalid' : ''}
                />
                {fieldErrors.weight_carats && (
                  <span className="form-field-error" role="alert">{fieldErrors.weight_carats}</span>
                )}
              </div>
              <div className="form-field">
                <label>Item code</label>
                <input
                  name="item_code"
                  type="text"
                  value={form.item_code}
                  onChange={handleChange}
                  placeholder="e.g. BCG-001"
                />
                <span className="form-field-hint">Code used on the Selling page</span>
              </div>
            </div>
          </div>

          {/* Column 2: Image */}
          <div className="form-col form-col-card section-card-inner section-card-inner--image">
            <div className="form-section-title section-title-with-icon">
              <span className="section-title-icon section-title-icon--image"><IconImage /></span>
              Image
            </div>
            <div className="form-col-fields">
              <div className="form-field">
                <label>Image</label>
                <div
                  className={`drop-zone ${dropZoneActive ? 'drop-zone-dragover' : ''}`}
                  onClick={() => photoInputRef.current?.click()}
                  onDragOver={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDropZoneActive(true);
                  }}
                  onDragLeave={() => setDropZoneActive(false)}
                  onDrop={async e => {
                    e.preventDefault();
                    setDropZoneActive(false);
                    const f = e.dataTransfer.files[0];
                    if (f?.type.startsWith('image/')) {
                      const path = await uploadImage(f);
                      if (path) {
                        setForm(prev => ({ ...prev, image_path: path }));
                        setPhotoFileName(f.name);
                      }
                    }
                  }}
                >
                  <span className="drop-zone-icon">🖼</span>
                  <span className="drop-zone-text">
                    {imageUploading
                      ? 'Uploading…'
                      : dropZoneActive
                        ? 'Drop image here'
                        : 'Drag and drop or click to upload'}
                  </span>
                  {imageUploadError && (
                    <span className="drop-zone-error" role="alert">{imageUploadError}</span>
                  )}
                  {photoFileName && !imageUploading && (
                    <span className="drop-zone-uploaded">{photoFileName}</span>
                  )}
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="drop-zone-input"
                    onClick={(e) => e.stopPropagation()}
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      if (f) {
                        const path = await uploadImage(f);
                        if (path) {
                          setForm(prev => ({ ...prev, image_path: path }));
                          setPhotoFileName(f.name);
                        }
                      }
                      e.target.value = '';
                    }}
                  />
                </div>
                <div className="mobile-upload-card">
                  <div className="mobile-upload-title">Mobile Camera Upload</div>
                  <p className="mobile-upload-text">
                    Scan with phone, take photo, and upload directly to this item or draft form before save.
                  </p>
                  <div className="mobile-upload-actions">
                    {!mobileSession ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={startMobileUpload}
                        disabled={mobileStarting || imageUploading}
                      >
                        {mobileStarting ? 'Starting…' : 'Start mobile upload'}
                      </button>
                    ) : (
                      <>
                        <button type="button" className="secondary-button" onClick={copyMobileLink}>
                          {mobileCopied ? 'Link copied' : 'Copy link'}
                        </button>
                        <button type="button" className="ghost-button" onClick={cancelMobileUpload}>
                          Cancel session
                        </button>
                      </>
                    )}
                  </div>
                  {mobileSession && (
                    <div className="mobile-upload-session">
                      {mobileSession.urls?.[0] ? (
                        <>
                          <img
                            className="mobile-upload-qr"
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(mobileSession.urls[0])}`}
                            alt="QR code for mobile upload"
                          />
                          <a href={mobileSession.urls[0]} target="_blank" rel="noreferrer" className="mobile-upload-link">
                            {mobileSession.urls[0]}
                          </a>
                        </>
                      ) : (
                        <p className="mobile-upload-note">No LAN URL detected for QR. Use the copied link manually.</p>
                      )}
                    </div>
                  )}
                  {mobileUploadHint && <p className="mobile-upload-note">{mobileUploadHint}</p>}
                </div>
              </div>
              <div className="form-field">
                <label>Image (path)</label>
                <input
                  name="image_path"
                  type="text"
                  value={form.image_path}
                  onChange={handleChange}
                  placeholder="Or enter file path / URL"
                />
                <span className="form-field-hint">If you didn’t upload a file</span>
              </div>
            </div>
          </div>

          {/* Column 3: Financials & description */}
          <div className="form-col form-col-card section-card-inner section-card-inner--pricing">
            <div className="form-section-title section-title-with-icon">
              <span className="section-title-icon section-title-icon--pricing"><IconPricing /></span>
              Pricing & notes
            </div>
            <div className="form-col-fields">
              <div className="form-field">
                <label>Purchasing total price</label>
                <input
                  name="purchasing_total_price"
                  type="number"
                  step="0.01"
                  value={form.purchasing_total_price}
                  onChange={handleChange}
                  placeholder="0.00"
                  className={fieldErrors.purchasing_total_price ? 'input-invalid' : ''}
                />
                <span className="form-field-hint">
                  In {INVENTORY_FORM_CURRENCY} (same as list price). Reports compare this cost to each sale in THB; profit goes negative if cost is higher than the allocated sale (e.g. after invoice discounts).
                </span>
                {fieldErrors.purchasing_total_price && (
                  <span className="form-field-error" role="alert">{fieldErrors.purchasing_total_price}</span>
                )}
              </div>
              <div className="form-field">
                <label>Purchasing carat price</label>
                <input
                  name="purchasing_carat_price"
                  type="number"
                  step="0.01"
                  value={form.purchasing_carat_price}
                  onChange={handleChange}
                  placeholder="0.00"
                  className={fieldErrors.purchasing_carat_price ? 'input-invalid' : ''}
                />
                {fieldErrors.purchasing_carat_price && (
                  <span className="form-field-error" role="alert">{fieldErrors.purchasing_carat_price}</span>
                )}
              </div>
              <div className="form-field">
                <label>Selling price currency</label>
                <select
                  name="selling_currency"
                  value={form.selling_currency}
                  onChange={handleChange}
                  disabled
                  aria-label="Currency for list / selling prices"
                >
                  {SUPPORTED_CURRENCIES.filter(({ code }) => code === INVENTORY_FORM_CURRENCY).map(({ code, label }) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
                <span className="form-field-hint">USD only for item entry. Selling total auto-calculates from carat price × carats.</span>
              </div>
              <div className="form-field">
                <label>Selling total price</label>
                <input
                  name="selling_total_price"
                  type="number"
                  step="0.01"
                  value={form.selling_total_price}
                  onChange={handleChange}
                  placeholder="0.00"
                  className={fieldErrors.selling_total_price ? 'input-invalid' : ''}
                />
                {fieldErrors.selling_total_price && (
                  <span className="form-field-error" role="alert">{fieldErrors.selling_total_price}</span>
                )}
              </div>
              <div className="form-field">
                <label>Selling carat price</label>
                <input
                  name="selling_carat_price"
                  type="number"
                  step="0.01"
                  value={form.selling_carat_price}
                  onChange={handleChange}
                  placeholder="0.00"
                  className={fieldErrors.selling_carat_price ? 'input-invalid' : ''}
                />
                {fieldErrors.selling_carat_price && (
                  <span className="form-field-error" role="alert">{fieldErrors.selling_carat_price}</span>
                )}
              </div>
              <div className="form-field form-field-full">
                <label>Description</label>
                <textarea
                  name="description"
                  rows={4}
                  value={form.description}
                  onChange={handleChange}
                  placeholder={DESCRIPTION_SHAPE_HINT}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="form-actions form-actions-end">
          <span className="form-actions-hint" aria-hidden="true">
            Ctrl+Enter to save
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => { resetForm(); setFormOpen(false); }}
          >
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? (editingId ? 'Updating…' : 'Saving…') : (editingId ? 'Update item' : 'Save item')}
          </button>
        </div>
      </form>
          </>
        )}
        </div>
      </div>

      {/* Card 1: Find items */}
      <section className={`section-card section-card--find ${listStatusDropdownOpen || listCategoryDropdownOpen ? 'dropdown-open' : ''}`} aria-label="Find items">
        <div className="inventory-list-toolbar">
          <h3 className="inventory-list-title">
            <span className="section-title-icon section-title-icon--find"><IconFilter /></span>
            Find items
          </h3>
          <div className="inventory-list-controls">
            <div className="inventory-list-search-wrap">
              <span className="inventory-list-search-icon" aria-hidden="true">
                <IconSearch />
              </span>
              <input
                type="search"
                className="inventory-list-search"
                placeholder="Category, type, or ID…"
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), applyListFilters())}
                aria-label="Search inventory"
              />
            </div>
            <div className="check-inventory-dropdown" ref={listStatusDropdownRef}>
              <button
                type="button"
                className="check-inventory-dropdown-trigger"
                onClick={() => { setListStatusDropdownOpen((o) => !o); setListCategoryDropdownOpen(false); }}
                aria-haspopup="listbox"
                aria-expanded={listStatusDropdownOpen}
                aria-label="Filter by status"
              >
                <span className="check-inventory-dropdown-trigger-icon check-inventory-dropdown-trigger-icon--status"><IconStatus /></span>
                <span className="check-inventory-dropdown-trigger-label">
                  {LIST_STATUS_OPTIONS.find((o) => o.value === listStatusFilter)?.label || 'All statuses'}
                </span>
                <span className={`check-inventory-dropdown-chevron ${listStatusDropdownOpen ? 'is-open' : ''}`}><IconChevronDown /></span>
              </button>
              {listStatusDropdownOpen && (
                <ul className="check-inventory-dropdown-list" role="listbox" aria-label="Status">
                  {LIST_STATUS_OPTIONS.map((opt) => (
                    <li
                      key={opt.value || 'all'}
                      role="option"
                      aria-selected={listStatusFilter === opt.value}
                      className={`check-inventory-dropdown-option check-inventory-dropdown-option--${opt.value || 'all'} ${listStatusFilter === opt.value ? 'is-selected' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setListStatusFilter(opt.value);
                        setListStatusDropdownOpen(false);
                        fetchItems({ search: listSearch, status: opt.value });
                      }}
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
            <div className="check-inventory-dropdown" ref={listCategoryDropdownRef}>
              <button
                type="button"
                className="check-inventory-dropdown-trigger"
                onClick={() => { setListCategoryDropdownOpen((o) => !o); setListStatusDropdownOpen(false); }}
                aria-haspopup="listbox"
                aria-expanded={listCategoryDropdownOpen}
                aria-label="Filter by category"
              >
                <span className="check-inventory-dropdown-trigger-icon check-inventory-dropdown-trigger-icon--category"><IconCategory /></span>
                <span className="check-inventory-dropdown-trigger-label">{listCategoryFilter || 'All categories'}</span>
                <span className={`check-inventory-dropdown-chevron ${listCategoryDropdownOpen ? 'is-open' : ''}`}><IconChevronDown /></span>
              </button>
              {listCategoryDropdownOpen && (
                <ul className="check-inventory-dropdown-list" role="listbox" aria-label="Category">
                  <li
                    role="option"
                    aria-selected={!listCategoryFilter}
                    className={`check-inventory-dropdown-option ${!listCategoryFilter ? 'is-selected' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setListCategoryFilter(''); setListCategoryDropdownOpen(false); }}
                  >
                    <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--category"><IconGem /></span>
                    All categories
                  </li>
                  {uniqueCategories.map((cat) => (
                    <li
                      key={cat}
                      role="option"
                      aria-selected={listCategoryFilter === cat}
                      className={`check-inventory-dropdown-option ${listCategoryFilter === cat ? 'is-selected' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setListCategoryFilter(cat); setListCategoryDropdownOpen(false); }}
                    >
                      <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--category"><IconGem /></span>
                      {cat}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              className="primary-button inventory-list-apply-btn"
              onClick={applyListFilters}
              disabled={listLoading}
            >
              <IconSearch />
              <span>Search</span>
            </button>
            <button
              type="button"
              className="ghost-button inventory-list-refresh"
              onClick={() => fetchItems({ search: listSearch, status: listStatusFilter })}
              aria-label="Refresh list"
              disabled={listLoading}
            >
              <IconRefresh />
              <span>{listLoading ? 'Loading…' : 'Refresh'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Card 2: Items list */}
      <section className="section-card section-card--list" aria-label="Items">
        <div className="inventory-list-card-header">
          <h3 className="inventory-list-title">
            <span className="section-title-icon section-title-icon--list"><IconList /></span>
            Items
          </h3>
          {!listLoading && !listError && displayedItems.length > 0 && (
            <p className="inventory-list-count" aria-live="polite">
              Showing {displayedItems.length} item{displayedItems.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        {listLoading && (
          <div className="inventory-list-state inventory-list-state--loading">
            <span className="inventory-list-state-icon">◇</span>
            <p className="inventory-list-message">Loading…</p>
          </div>
        )}
        {listError && (
          <div className="inventory-list-state inventory-list-state--error">
            <p className="inventory-list-message inventory-list-error">{listError}</p>
          </div>
        )}
        {!listLoading && !listError && items.length === 0 && (
          <div className="inventory-list-state inventory-list-state--empty">
            <span className="inventory-list-state-icon" aria-hidden="true">📦</span>
            <p className="inventory-list-message">No items yet.</p>
            <p className="inventory-list-message inventory-list-message-sub">Add one using the form above.</p>
          </div>
        )}
        {!listLoading && !listError && items.length > 0 && displayedItems.length === 0 && (
          <div className="inventory-list-state inventory-list-state--empty">
            <span className="inventory-list-state-icon" aria-hidden="true">🔍</span>
            <p className="inventory-list-message">No items match the current filters.</p>
            <p className="inventory-list-message inventory-list-message-sub">Try different search or filter options.</p>
          </div>
        )}
        {!listLoading && !listError && displayedItems.length > 0 && (
          <ul className="inventory-list">
            {displayedItems.map((item) => (
              <li key={item.id} className="inventory-list-item">
                <div className="inventory-list-item-main">
                  <div className="inventory-list-thumb">
                    {item.image_path ? (
                      <img
                        src={getImageSrc(item.image_path)}
                        alt={inventoryItemPrimaryLabel(item)}
                        className="inventory-list-thumb-img"
                        onError={(e) => {
                          e.currentTarget.style.visibility = 'hidden';
                        }}
                      />
                    ) : (
                      <div className="inventory-list-thumb-placeholder">
                        <span>NO IMAGE</span>
                      </div>
                    )}
                  </div>
                  <div className="inventory-list-item-text">
                    <div className="inventory-list-item-heading">
                      <span className="inventory-list-item-category">{inventoryItemPrimaryLabel(item)}</span>
                      {item.status && (
                        <span className={`inventory-list-item-badge inventory-list-item-badge--${item.status.toLowerCase().replace(/\s+/g, '-')}`}>
                          {item.status}
                        </span>
                      )}
                    </div>
                    <span className="inventory-list-item-meta">
                      {formatItemTypeDisplay(item.item_type)} · {item.pieces} pc{item.pieces !== 1 ? 's' : ''}
                      {(item.weight_carats != null || item.weight_grams != null) && (
                        <> · {item.weight_carats != null ? `${item.weight_carats} ct` : ''}
                          {item.weight_carats != null && item.weight_grams != null && ' / '}
                          {item.weight_grams != null ? `${item.weight_grams} g` : ''}</>
                      )}
                    </span>
                    {item.item_code && (
                      <span className="inventory-list-item-sticker">{item.item_code}</span>
                    )}
                    {item.selling_total_price != null && (
                      <span className="inventory-list-item-price">
                        List: {formatMoneyWhole(item.selling_total_price, item.selling_currency)}
                      </span>
                    )}
                    <div className="inventory-list-item-dates">
                      <span title="Added">Added: {formatDateTime(item.created_at)}</span>
                      {item.updated_at !== item.created_at && (
                        <span title="Last updated">Updated: {formatDateTime(item.updated_at)}</span>
                      )}
                    </div>
                  </div>
                </div>
                {canEditOrDelete ? (
                  <div className="inventory-list-item-actions">
                    <button
                      type="button"
                      className="ghost-button inventory-list-btn"
                      onClick={() => handleEdit(item)}
                    >
                      <IconEdit />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      className="ghost-button inventory-list-btn inventory-list-btn-danger"
                      onClick={() => handleDelete(item)}
                    >
                      <IconDelete />
                      <span>Delete</span>
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
