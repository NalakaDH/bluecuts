import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import {
  SUPPORTED_CURRENCIES,
  normalizeCurrencyCode,
  formatMoneyWhole,
  formatMoneyAmount,
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
  inventoryCategoryDisplay,
  inventoryItemPrimaryLabel,
  deriveInventoryDisplayStatus,
  matchesInventoryStatusFilter,
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

type ActivityRow = {
  shrink_units: number;
  memo_units?: number;
  sold_units?: number;
  last_activity: string | null;
  has_manual_edit: boolean;
};

type ActivitySummaryMap = Record<string, ActivityRow>;

type EnrichedInventoryItem = InventoryItem & {
  memoUnits: number;
  soldUnits: number;
  effectiveStatus: string;
};

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

function formatIsoDateUtc(iso: string): string {
  const d = dateFromServerUtc(iso);
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toISOString().slice(0, 10);
}

/** Markup vs cost on list price (USD form entry); null if not computable. */
function formatMarginPercentLabel(item: InventoryItem): string | null {
  const sell = item.selling_total_price;
  const buy = item.purchasing_total_price;
  if (sell == null || buy == null) return null;
  const s = Number(sell);
  const b = Number(buy);
  if (!Number.isFinite(s) || !Number.isFinite(b) || b <= 0) return null;
  const pct = ((s - b) / b) * 100;
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}%`;
}

function statusSlugForUi(status: string): string {
  return String(status || '')
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function ItemDetailDrawerFinanceSections({ item }: { item: EnrichedInventoryItem }) {
  const sellCur = normalizeCurrencyCode(item.selling_currency);
  const marginLabel = formatMarginPercentLabel(item);
  const sellTotal = item.selling_total_price;
  const buyTotal = item.purchasing_total_price;
  const grossNum =
    sellTotal != null && buyTotal != null ? roundMoney2(Number(sellTotal) - Number(buyTotal)) : null;
  const marginNegative = marginLabel != null && marginLabel.startsWith('-');
  const grossNegative = grossNum != null && grossNum < 0;

  return (
    <>
      <section className="upd-inv-detail-drawer__section" aria-label="Selling price">
        <h4 className="upd-inv-detail-drawer__section-kicker">Selling price ({sellCur})</h4>
        <div className="upd-inv-detail-drawer__rule upd-inv-detail-drawer__rule--subtle" aria-hidden="true" />
        <dl className="upd-inv-detail-drawer__kv">
          <div className="upd-inv-detail-drawer__kv-row">
            <dt>List total</dt>
            <dd>{sellTotal != null ? formatMoneyAmount(Number(sellTotal), sellCur) : '—'}</dd>
          </div>
          <div className="upd-inv-detail-drawer__kv-row">
            <dt>Per carat</dt>
            <dd>
              {item.selling_carat_price != null
                ? `${formatMoneyAmount(Number(item.selling_carat_price), sellCur)}/ct`
                : '—'}
            </dd>
          </div>
          <div className="upd-inv-detail-drawer__kv-row">
            <dt>Currency</dt>
            <dd>{sellCur}</dd>
          </div>
        </dl>
      </section>

      <section className="upd-inv-detail-drawer__section" aria-label="Purchasing cost">
        <h4 className="upd-inv-detail-drawer__section-kicker">
          Purchasing cost ({INVENTORY_FORM_CURRENCY})
        </h4>
        <div className="upd-inv-detail-drawer__rule upd-inv-detail-drawer__rule--subtle" aria-hidden="true" />
        <dl className="upd-inv-detail-drawer__kv">
          <div className="upd-inv-detail-drawer__kv-row upd-inv-detail-drawer__kv-row--cost">
            <dt>Total cost</dt>
            <dd>
              {buyTotal != null ? formatMoneyAmount(Number(buyTotal), INVENTORY_FORM_CURRENCY) : '—'}
            </dd>
          </div>
          <div className="upd-inv-detail-drawer__kv-row upd-inv-detail-drawer__kv-row--cost">
            <dt>Per carat</dt>
            <dd>
              {item.purchasing_carat_price != null
                ? `${formatMoneyAmount(Number(item.purchasing_carat_price), INVENTORY_FORM_CURRENCY)}/ct`
                : '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="upd-inv-detail-drawer__section" aria-label="Profitability">
        <h4 className="upd-inv-detail-drawer__section-kicker">Profitability</h4>
        <div className="upd-inv-detail-drawer__rule upd-inv-detail-drawer__rule--subtle" aria-hidden="true" />
        <dl className="upd-inv-detail-drawer__kv">
          <div
            className={`upd-inv-detail-drawer__kv-row upd-inv-detail-drawer__kv-row--profit${grossNegative ? ' is-negative' : ''}`}
          >
            <dt>Gross profit</dt>
            <dd>{grossNum != null ? formatMoneyAmount(grossNum, sellCur) : '—'}</dd>
          </div>
          <div
            className={`upd-inv-detail-drawer__kv-row upd-inv-detail-drawer__kv-row--profit${marginNegative ? ' is-negative' : ''}`}
          >
            <dt>Margin</dt>
            <dd>{marginLabel ?? '—'}</dd>
          </div>
        </dl>
        <div className={`upd-inv-detail-drawer__net-margin${marginNegative ? ' is-negative' : ''}`}>
          <span className="upd-inv-detail-drawer__net-margin-label">Net margin</span>
          <span className="upd-inv-detail-drawer__net-margin-value">{marginLabel ?? '—'}</span>
        </div>
      </section>

      <section className="upd-inv-detail-drawer__section" aria-label="Record">
        <h4 className="upd-inv-detail-drawer__section-kicker">Record</h4>
        <div className="upd-inv-detail-drawer__rule upd-inv-detail-drawer__rule--subtle" aria-hidden="true" />
        <dl className="upd-inv-detail-drawer__kv">
          <div className="upd-inv-detail-drawer__kv-row">
            <dt>Item ID</dt>
            <dd>#{item.id}</dd>
          </div>
          <div className="upd-inv-detail-drawer__kv-row">
            <dt>Date added</dt>
            <dd>{formatIsoDateUtc(item.created_at)}</dd>
          </div>
        </dl>
      </section>
    </>
  );
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
const IconGrid = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
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
const IconEye = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
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
  { value: 'Out of stock', label: 'Out of stock' },
  { value: 'On Memo', label: 'On Memo' },
  { value: 'Sold', label: 'Sold' },
];

/** Quick filters above list/grid (synced with status dropdown). */
const QUICK_STATUS_PILLS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'Available', label: 'Available' },
  { value: 'Out of stock', label: 'Out of Stock' },
  { value: 'On Memo', label: 'On Memo' },
  { value: 'Sold', label: 'Sold' },
];

type ListSortMode =
  | 'newest'
  | 'oldest'
  | 'price_high'
  | 'price_low'
  | 'name_az'
  | 'weight_heavy';

const LIST_SORT_OPTIONS: { value: ListSortMode; label: string }[] = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'price_high', label: 'Price: High → Low' },
  { value: 'price_low', label: 'Price: Low → High' },
  { value: 'name_az', label: 'Name A → Z' },
  { value: 'weight_heavy', label: 'Weight: Heavy → Light' },
];

function sellingPriceForSort(i: InventoryItem): number {
  const n = i.selling_total_price;
  return n != null && Number.isFinite(Number(n)) ? Number(n) : 0;
}

/** Carats for weight sort; falls back from grams using shop conversion. */
function weightCaratsForSort(i: InventoryItem): number {
  const c = i.weight_carats;
  const g = i.weight_grams;
  if (c != null && Number.isFinite(Number(c)) && Number(c) > 0) return Number(c);
  if (g != null && Number.isFinite(Number(g)) && Number(g) > 0) return Number(g) * WEIGHT_GRAMS_TO_CARATS;
  return 0;
}

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
  const [activitySummary, setActivitySummary] = useState<ActivitySummaryMap>({});
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const lastPurchasePriceEditedRef = useRef<'total' | 'carat'>('carat');
  const lastSellingPriceEditedRef = useRef<'total' | 'carat'>('carat');
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
  const [selectedViewItemId, setSelectedViewItemId] = useState<number | null>(null);
  const [listViewMode, setListViewMode] = useState<'list' | 'grid'>('list');
  const [listSort, setListSort] = useState<ListSortMode>('newest');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

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
    // Status includes virtual states (On Memo / Sold), so we filter client-side.
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      const headers = { Authorization: `Bearer ${token}` };
      const [invRes, sumRes] = await Promise.all([
        fetch(apiUrl(`/api/inventory?${params.toString()}`), { headers }),
        fetch(apiUrl('/api/inventory/activity-summary'), { headers }),
      ]);
      if (!invRes.ok) throw new Error(await parseErrorResponse(invRes, 'Failed to load inventory'));
      if (!sumRes.ok) throw new Error(await parseErrorResponse(sumRes, 'Failed to load activity summary'));
      const data = (await invRes.json()) as InventoryItem[];
      const summary = (await sumRes.json()) as ActivitySummaryMap;
      setItems(Array.isArray(data) ? data : []);
      setActivitySummary(summary && typeof summary === 'object' ? summary : {});
    } catch (err: any) {
      const msg = err.message || 'Failed to load list';
      setListError(msg);
      setItems([]);
      setActivitySummary({});
      showAlert({ title: 'Could not load inventory', message: msg, variant: 'error' });
    } finally {
      setListLoading(false);
    }
  }, [listSearch, token, showAlert]);

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
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) setSortDropdownOpen(false);
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

  const enrichedItems: EnrichedInventoryItem[] = useMemo(() => {
    return (items || []).map((i) => {
      const s = activitySummary[String(i.id)] || ({} as ActivityRow);
      const memoUnits = Math.max(0, Math.round(Number((s as any).memo_units) || 0));
      const soldUnits = Math.max(0, Math.round(Number((s as any).sold_units) || 0));
      const effectiveStatus = deriveInventoryDisplayStatus(i, memoUnits);
      return { ...i, memoUnits, soldUnits, effectiveStatus };
    });
  }, [items, activitySummary]);

  const displayedItems = useMemo(() => {
    let list = enrichedItems;
    if (listCategoryFilter) list = list.filter((i) => i.category === listCategoryFilter);
    if (listStatusFilter) list = list.filter((i) => matchesInventoryStatusFilter(i, listStatusFilter));
    return list;
  }, [enrichedItems, listCategoryFilter, listStatusFilter]);

  const kpiStats = useMemo(() => {
    const list = enrichedItems;
    return {
      total: list.length,
      available: list.filter((i) => i.effectiveStatus === 'Available').length,
      onMemo: list.filter((i) => i.effectiveStatus === 'On Memo').length,
      outOfStock: list.filter((i) => i.effectiveStatus === 'Out of stock').length,
      sold: list.filter((i) => i.soldUnits > 0).length,
    };
  }, [enrichedItems]);

  const sortedDisplayedItems = useMemo(() => {
    const arr = [...displayedItems];
    switch (listSort) {
      case 'newest':
        arr.sort((a, b) => dateFromServerUtc(b.created_at).getTime() - dateFromServerUtc(a.created_at).getTime());
        break;
      case 'oldest':
        arr.sort((a, b) => dateFromServerUtc(a.created_at).getTime() - dateFromServerUtc(b.created_at).getTime());
        break;
      case 'price_high':
        arr.sort((a, b) => sellingPriceForSort(b) - sellingPriceForSort(a));
        break;
      case 'price_low':
        arr.sort((a, b) => sellingPriceForSort(a) - sellingPriceForSort(b));
        break;
      case 'name_az':
        arr.sort((a, b) =>
          inventoryItemPrimaryLabel(a).localeCompare(inventoryItemPrimaryLabel(b), undefined, { sensitivity: 'base' })
        );
        break;
      case 'weight_heavy':
        arr.sort((a, b) => weightCaratsForSort(b) - weightCaratsForSort(a));
        break;
      default:
        break;
    }
    return arr;
  }, [displayedItems, listSort]);

  const selectedViewItem = useMemo(
    () => (selectedViewItemId == null ? null : sortedDisplayedItems.find((i) => i.id === selectedViewItemId) ?? null),
    [sortedDisplayedItems, selectedViewItemId]
  );

  useEffect(() => {
    if (selectedViewItemId == null) return;
    if (!sortedDisplayedItems.some((i) => i.id === selectedViewItemId)) {
      setSelectedViewItemId(null);
    }
  }, [sortedDisplayedItems, selectedViewItemId]);

  useEffect(() => {
    if (selectedViewItemId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedViewItemId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedViewItemId]);

  useEffect(() => {
    if (selectedViewItemId == null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [selectedViewItemId]);

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
      if (name === 'selling_total_price') lastSellingPriceEditedRef.current = 'total';
      if (name === 'selling_carat_price') lastSellingPriceEditedRef.current = 'carat';
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
        // Only recalc selling_total from selling_carat if carat is the last edited source
        // (or if the user is actively editing selling_carat_price right now).
        const keepSellingTotalAsSource =
          (name === 'weight_carats' || name === 'weight_grams') &&
          lastSellingPriceEditedRef.current === 'total';
        if (!keepSellingTotalAsSource) {
          if (Number.isFinite(weightCarats) && weightCarats > 0 && Number.isFinite(sellingCaratPrice) && sellingCaratPrice >= 0) {
            next.selling_total_price = roundMoney2(weightCarats * sellingCaratPrice).toFixed(2);
          } else {
            next.selling_total_price = '';
          }
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

      // Selling total -> selling carat (bidirectional).
      const shouldRecalcSellingCarat =
        name === 'selling_total_price' || name === 'weight_carats' || name === 'weight_grams';
      if (shouldRecalcSellingCarat) {
        const weightCarats = Number(next.weight_carats);
        const total = Number(next.selling_total_price);
        const last = lastSellingPriceEditedRef.current;
        if ((name === 'weight_carats' || name === 'weight_grams') && last === 'carat') {
          // When weight changes, keep carat price as the "source of truth" (existing behavior).
        } else if (Number.isFinite(weightCarats) && weightCarats > 0 && Number.isFinite(total) && total >= 0) {
          next.selling_carat_price = roundMoney2(total / weightCarats).toFixed(2);
        } else if (name === 'selling_total_price') {
          // Only clear the derived field when the user is editing total (avoid wiping on other edits).
          next.selling_carat_price = '';
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

  const openAddForm = () => {
    resetForm();
    setFormOpen(true);
    setSelectedViewItemId(null);
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
    setSelectedViewItemId(item.id);
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
      if (selectedViewItemId === item.id) setSelectedViewItemId(null);
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

  const sortMenuLabel = LIST_SORT_OPTIONS.find((o) => o.value === listSort)?.label ?? 'Newest First';

  return (
    <div className="page page-update-inventory">
      <div className="upd-inv-page-top">
        <div className="upd-inv-top-row">
          <button type="button" className="primary-button upd-inv-add-top" onClick={openAddForm}>
            <span className="btn-icon" aria-hidden="true">
              <IconAdd />
            </span>
            Add new item
          </button>
          {formOpen ? (
            <div className={`section-card section-card--form upd-inv-form-slot${categoryOpen ? ' section-card--form-dropdown-open' : ''}`}>
              <div className="inventory-form-section">
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
                    onClick={() => {
                      resetForm();
                      setFormOpen(false);
                    }}
                    aria-label="Close form"
                  >
                    <IconClose />
                    <span>Close</span>
                  </button>
                </div>
                <form ref={formRef} className="inventory-form inventory-form-three-cols upd-inv-form-new" onSubmit={handleSubmit}>
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
                <span className="form-field-hint">Code used on the Invoice page</span>
              </div>
            </div>
          </div>

          {/* Column 2: Photo + QR (new UI layout) */}
          <div className="form-col form-col-card section-card-inner section-card-inner--image upd-inv-form-photo-col">
            <div className="form-section-title section-title-with-icon">
              <span className="section-title-icon section-title-icon--image"><IconImage /></span>
              Photo · file or QR
            </div>
            <div className="form-col-fields">
              <div className="form-field">
                <label>Image file</label>
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
                <div className="mobile-upload-card upd-inv-qr-panel">
                  <div className="upd-inv-qr-heading">
                    <div className="mobile-upload-title">QR code — add image from phone</div>
                    <span className="upd-inv-qr-required-badge">Use for showroom photos</span>
                  </div>
                  <p className="mobile-upload-text">
                    Start a session, scan the QR with your phone camera, then take or upload a picture. Phone and this
                    computer must be on the same Wi‑Fi. You can still save the item after uploading from the phone.
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
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="upd-inv-kpi-row" aria-label="Inventory summary">
        <div className="upd-inv-kpi-card">
          <div className="upd-inv-kpi-label">Total items</div>
          <div className="upd-inv-kpi-value">{kpiStats.total}</div>
          <p className="upd-inv-kpi-hint">From the latest load (filters below apply to the list only).</p>
        </div>
        <div className="upd-inv-kpi-card">
          <div className="upd-inv-kpi-label">Available</div>
          <div className="upd-inv-kpi-value upd-inv-kpi-value--accent">{kpiStats.available}</div>
        </div>
        <div className="upd-inv-kpi-card">
          <div className="upd-inv-kpi-label">On memo</div>
          <div className="upd-inv-kpi-value">{kpiStats.onMemo}</div>
        </div>
        <div className="upd-inv-kpi-card">
          <div className="upd-inv-kpi-label">Out of stock</div>
          <div className="upd-inv-kpi-value">{kpiStats.outOfStock}</div>
        </div>
        <div className="upd-inv-kpi-card">
          <div className="upd-inv-kpi-label">Sold</div>
          <div className="upd-inv-kpi-value">{kpiStats.sold}</div>
        </div>
      </div>

      <div className="upd-inv-filters-surface">
      <section
        className={`upd-inv-filters-card${
          listStatusDropdownOpen || listCategoryDropdownOpen || sortDropdownOpen ? ' is-dropdown-open' : ''
        }`}
        aria-label="Search and filters"
      >
        <div className="upd-inv-filters-row">
          <div className="upd-inv-filters-search-wrap">
            <span className="upd-inv-filters-search-icon" aria-hidden="true">
              <IconSearch />
            </span>
            <input
              type="search"
              className="upd-inv-filters-search-input"
              placeholder="Search by category, type, code, description…"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), applyListFilters())}
              aria-label="Search inventory"
            />
          </div>

          <div className="check-inventory-dropdown upd-inv-filters-dd" ref={listStatusDropdownRef}>
            <button
              type="button"
              className="check-inventory-dropdown-trigger upd-inv-filters-dd-trigger"
              onClick={() => {
                setSortDropdownOpen(false);
                setListStatusDropdownOpen((o) => !o);
                setListCategoryDropdownOpen(false);
              }}
              aria-haspopup="listbox"
              aria-expanded={listStatusDropdownOpen}
              aria-label="Filter by status"
            >
              <span className="check-inventory-dropdown-trigger-icon check-inventory-dropdown-trigger-icon--status upd-inv-filters-dd-trigger-icon">
                <IconStatus />
              </span>
              <span className="check-inventory-dropdown-trigger-label">
                {LIST_STATUS_OPTIONS.find((o) => o.value === listStatusFilter)?.label || 'All statuses'}
              </span>
              <span className={`check-inventory-dropdown-chevron ${listStatusDropdownOpen ? 'is-open' : ''}`}>
                <IconChevronDown />
              </span>
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
                    {opt.value === '' && (
                      <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--all">
                        <IconFilter />
                      </span>
                    )}
                    {opt.value === 'Available' && (
                      <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--available">
                        <IconCheck />
                      </span>
                    )}
                    {opt.value === 'On Memo' && (
                      <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--memo">
                        <IconMemo />
                      </span>
                    )}
                    {opt.value === 'Sold' && (
                      <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--sold">
                        <IconSell />
                      </span>
                    )}
                    {opt.label}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="check-inventory-dropdown upd-inv-filters-dd upd-inv-filters-dd--category" ref={listCategoryDropdownRef}>
            <button
              type="button"
              className="check-inventory-dropdown-trigger upd-inv-filters-dd-trigger"
              onClick={() => {
                setSortDropdownOpen(false);
                setListCategoryDropdownOpen((o) => !o);
                setListStatusDropdownOpen(false);
              }}
              aria-haspopup="listbox"
              aria-expanded={listCategoryDropdownOpen}
              aria-label="Filter by category"
            >
              <span className="check-inventory-dropdown-trigger-icon check-inventory-dropdown-trigger-icon--category upd-inv-filters-dd-trigger-icon">
                <IconCategory />
              </span>
              <span className="check-inventory-dropdown-trigger-label">{listCategoryFilter || 'All categories'}</span>
              <span className={`check-inventory-dropdown-chevron ${listCategoryDropdownOpen ? 'is-open' : ''}`}>
                <IconChevronDown />
              </span>
            </button>
            {listCategoryDropdownOpen && (
              <ul className="check-inventory-dropdown-list" role="listbox" aria-label="Category">
                <li
                  role="option"
                  aria-selected={!listCategoryFilter}
                  className={`check-inventory-dropdown-option ${!listCategoryFilter ? 'is-selected' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setListCategoryFilter('');
                    setListCategoryDropdownOpen(false);
                  }}
                >
                  <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--category">
                    <IconGem />
                  </span>
                  All categories
                </li>
                {uniqueCategories.map((cat) => (
                  <li
                    key={cat}
                    role="option"
                    aria-selected={listCategoryFilter === cat}
                    className={`check-inventory-dropdown-option ${listCategoryFilter === cat ? 'is-selected' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setListCategoryFilter(cat);
                      setListCategoryDropdownOpen(false);
                    }}
                  >
                    <span className="check-inventory-dropdown-option-icon check-inventory-dropdown-option-icon--category">
                      <IconGem />
                    </span>
                    {cat}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="upd-inv-filters-dd upd-inv-sort-dropdown" ref={sortDropdownRef}>
            <button
              type="button"
              className="upd-inv-filters-dd-trigger upd-inv-filters-dd-trigger--sort"
              aria-haspopup="listbox"
              aria-expanded={sortDropdownOpen}
              aria-label="Sort items"
              onClick={() => {
                setSortDropdownOpen((o) => !o);
                setListStatusDropdownOpen(false);
                setListCategoryDropdownOpen(false);
              }}
            >
              <span className="upd-inv-filters-dd-trigger-label">{sortMenuLabel}</span>
              <span className={`upd-inv-filters-dd-chevron${sortDropdownOpen ? ' is-open' : ''}`}>
                <IconChevronDown />
              </span>
            </button>
            {sortDropdownOpen && (
              <ul className="upd-inv-sort-list" role="listbox" aria-label="Sort by">
                {LIST_SORT_OPTIONS.map((opt) => (
                  <li
                    key={opt.value}
                    role="option"
                    aria-selected={listSort === opt.value}
                    className={`upd-inv-sort-option${listSort === opt.value ? ' is-selected' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setListSort(opt.value);
                      setSortDropdownOpen(false);
                    }}
                  >
                    {opt.label}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="upd-inv-filters-view-toggle" role="group" aria-label="View layout">
            <button
              type="button"
              className={`upd-inv-filters-view-btn${listViewMode === 'list' ? ' is-active' : ''}`}
              onClick={() => setListViewMode('list')}
              aria-pressed={listViewMode === 'list'}
              title="List view"
            >
              <IconList />
            </button>
            <button
              type="button"
              className={`upd-inv-filters-view-btn${listViewMode === 'grid' ? ' is-active' : ''}`}
              onClick={() => setListViewMode('grid')}
              aria-pressed={listViewMode === 'grid'}
              title="Grid view"
            >
              <IconGrid />
            </button>
          </div>

          <button
            type="button"
            className="upd-inv-filters-refresh"
            onClick={() => fetchItems({ search: listSearch, status: listStatusFilter })}
            aria-label="Refresh list"
            disabled={listLoading}
          >
            <IconRefresh />
            <span>{listLoading ? 'Loading…' : 'Refresh'}</span>
          </button>
        </div>
      </section>
      </div>

      <div className="upd-inv-main upd-inv-main--single">
        <div className="upd-inv-list-column">
      {/* Items list */}
      <section className="section-card section-card--list upd-inv-items-section" aria-label="Items">
        {!listLoading && !listError && enrichedItems.length > 0 && (
          <div className="upd-inv-results-bar">
            <p className="upd-inv-results-count" aria-live="polite">
              Showing {sortedDisplayedItems.length} of {enrichedItems.length} items
            </p>
            <div className="upd-inv-status-pills" role="tablist" aria-label="Quick status filter">
              {QUICK_STATUS_PILLS.map((pill) => (
                <button
                  key={pill.value || 'all'}
                  type="button"
                  role="tab"
                  aria-selected={listStatusFilter === pill.value}
                  className={`upd-inv-status-pill${listStatusFilter === pill.value ? ' is-active' : ''}`}
                  onClick={() => {
                    setListStatusFilter(pill.value);
                    setListStatusDropdownOpen(false);
                    setListCategoryDropdownOpen(false);
                    setSortDropdownOpen(false);
                    fetchItems({ search: listSearch, status: pill.value });
                  }}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>
        )}
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
        {!listLoading && !listError && enrichedItems.length === 0 && (
          <div className="inventory-list-state inventory-list-state--empty">
            <span className="inventory-list-state-icon" aria-hidden="true">📦</span>
            <p className="inventory-list-message">No items yet.</p>
            <p className="inventory-list-message inventory-list-message-sub">Use Add item to create stock.</p>
          </div>
        )}
        {!listLoading && !listError && enrichedItems.length > 0 && displayedItems.length === 0 && (
          <div className="inventory-list-state inventory-list-state--empty">
            <span className="inventory-list-state-icon" aria-hidden="true">🔍</span>
            <p className="inventory-list-message">No items match the current filters.</p>
            <p className="inventory-list-message inventory-list-message-sub">Try different search or filter options.</p>
          </div>
        )}
        {!listLoading && !listError && sortedDisplayedItems.length > 0 && listViewMode === 'list' && (
          <ul className="upd-inv-list-v2">
            {sortedDisplayedItems.map((item) => {
              const stSlug = statusSlugForUi(item.effectiveStatus);
              const marginLabel = formatMarginPercentLabel(item);
              const cat = (item.category || '').trim();
              const showCatPill = cat && !categoryLooksLikeShortCode(cat);
              const specParts: string[] = [formatItemTypeDisplay(item.item_type)];
              if (item.weight_carats != null) specParts.push(`${item.weight_carats}ct`);
              if (item.weight_grams != null) specParts.push(`${item.weight_grams} g`);
              specParts.push(`${item.pieces}pc${item.pieces === 1 ? '' : 's'}`);
              const descShort = (item.description || '').trim();
              return (
                <li
                  key={item.id}
                  className={`upd-inv-list-card-v2${selectedViewItemId === item.id ? ' is-selected' : ''}`}
                  onClick={() => setSelectedViewItemId(item.id)}
                >
                  <div className="upd-inv-list-card-v2__rail">
                    <span className={`upd-inv-status-dot upd-inv-status-dot--${stSlug}`} title={item.effectiveStatus} aria-hidden />
                    <div className="upd-inv-list-card-v2__thumb">
                      {item.image_path ? (
                        <img
                          src={getImageSrc(item.image_path)}
                          alt=""
                          onError={(e) => {
                            e.currentTarget.style.visibility = 'hidden';
                          }}
                        />
                      ) : (
                        <span className="upd-inv-list-card-v2__thumb-ph">No image</span>
                      )}
                    </div>
                  </div>
                  <div className="upd-inv-list-card-v2__body">
                    <div className="upd-inv-list-card-v2__title-row">
                      <h3 className="upd-inv-list-card-v2__title">{inventoryItemPrimaryLabel(item)}</h3>
                      {item.item_code ? (
                        <span className="upd-inv-pill upd-inv-pill--code">{item.item_code}</span>
                      ) : null}
                      <span className={`upd-inv-pill upd-inv-pill--status upd-inv-pill--status-${stSlug}`}>
                        {item.effectiveStatus}
                      </span>
                      {showCatPill ? <span className="upd-inv-pill upd-inv-pill--category">{cat}</span> : null}
                    </div>
                    <div className="upd-inv-spec-chips" aria-label="Specifications">
                      {specParts.map((t) => (
                        <span key={t} className="upd-inv-spec-chip">
                          {t}
                        </span>
                      ))}
                      {descShort ? (
                        <span className="upd-inv-spec-chip upd-inv-spec-chip--wide">{descShort}</span>
                      ) : null}
                    </div>
                    <div className="upd-inv-list-card-v2__finance" aria-label="Pricing">
                      <div className="upd-inv-fin-cell">
                        <span className="upd-inv-fin-label">List price</span>
                        <span className="upd-inv-fin-value upd-inv-fin-value--list">
                          {item.selling_total_price != null
                            ? formatMoneyWhole(item.selling_total_price, item.selling_currency)
                            : '—'}
                        </span>
                      </div>
                      <div className="upd-inv-fin-cell">
                        <span className="upd-inv-fin-label">Per carat</span>
                        <span className="upd-inv-fin-value">
                          {item.selling_carat_price != null
                            ? `${formatMoneyAmount(roundMoney2(Number(item.selling_carat_price)), item.selling_currency)}/ct`
                            : '—'}
                        </span>
                      </div>
                      <div className="upd-inv-fin-cell">
                        <span className="upd-inv-fin-label">Cost</span>
                        <span className="upd-inv-fin-value upd-inv-fin-value--cost">
                          {item.purchasing_total_price != null
                            ? formatMoneyWhole(item.purchasing_total_price, INVENTORY_FORM_CURRENCY)
                            : '—'}
                        </span>
                      </div>
                      <div className="upd-inv-fin-cell">
                        <span className="upd-inv-fin-label">Margin</span>
                        <span
                          className={`upd-inv-fin-value upd-inv-fin-value--margin${marginLabel && marginLabel.startsWith('+') ? ' is-positive' : ''}${marginLabel && marginLabel.startsWith('-') ? ' is-negative' : ''}`}
                        >
                          {marginLabel ?? '—'}
                        </span>
                      </div>
                    </div>
                    <p className="upd-inv-list-card-v2__dates">
                      Added: {formatIsoDateUtc(item.created_at)} · Updated: {formatIsoDateUtc(item.updated_at)}
                    </p>
                  </div>
                  <div
                    className="upd-inv-list-card-v2__actions"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="upd-inv-stack-btn upd-inv-stack-btn--view"
                      onClick={() => setSelectedViewItemId(item.id)}
                    >
                      <IconEye />
                      <span>View</span>
                    </button>
                    {canEditOrDelete ? (
                      <>
                        <button type="button" className="upd-inv-stack-btn upd-inv-stack-btn--edit" onClick={() => handleEdit(item)}>
                          <IconEdit />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          className="upd-inv-stack-btn upd-inv-stack-btn--delete"
                          onClick={() => handleDelete(item)}
                        >
                          <IconDelete />
                          <span>Delete</span>
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!listLoading && !listError && sortedDisplayedItems.length > 0 && listViewMode === 'grid' && (
          <ul className="upd-inv-grid-v2">
            {sortedDisplayedItems.map((item) => {
              const stSlug = statusSlugForUi(item.effectiveStatus);
              const marginLabel = formatMarginPercentLabel(item);
              const spec1 = [
                formatItemTypeDisplay(item.item_type),
                item.weight_carats != null ? `${item.weight_carats}ct` : null,
                `${item.pieces}pc${item.pieces === 1 ? '' : 's'}`,
              ]
                .filter(Boolean)
                .join(' · ');
              const descLine = (item.description || '').trim();
              return (
                <li key={item.id} className="upd-inv-grid-v2__cell">
                  <div
                    className={`upd-inv-grid-card-v2${selectedViewItemId === item.id ? ' is-selected' : ''}`}
                    onClick={() => setSelectedViewItemId(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedViewItemId(item.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`View ${inventoryItemPrimaryLabel(item)}`}
                  >
                    <div className="upd-inv-grid-card-v2__media">
                      {item.image_path ? (
                        <img
                          src={getImageSrc(item.image_path)}
                          alt=""
                          onError={(e) => {
                            e.currentTarget.style.visibility = 'hidden';
                          }}
                        />
                      ) : (
                        <div className="upd-inv-grid-card-v2__media-ph">No image</div>
                      )}
                      <span className={`upd-inv-grid-card-v2__status-ribbon upd-inv-grid-card-v2__status-ribbon--${stSlug}`}>
                        {item.effectiveStatus}
                      </span>
                    </div>
                    <div className="upd-inv-grid-card-v2__main">
                      <div className="upd-inv-grid-card-v2__headline">
                        <span className="upd-inv-grid-card-v2__name">{inventoryItemPrimaryLabel(item)}</span>
                        {item.item_code ? (
                          <span className="upd-inv-pill upd-inv-pill--code upd-inv-pill--sm">{item.item_code}</span>
                        ) : null}
                      </div>
                      <p className="upd-inv-grid-card-v2__spec1">{spec1}</p>
                      {descLine ? <p className="upd-inv-grid-card-v2__spec2">{descLine}</p> : null}
                      <div className="upd-inv-grid-card-v2__price-row">
                        <span className="upd-inv-grid-card-v2__list-price">
                          {item.selling_total_price != null
                            ? formatMoneyWhole(item.selling_total_price, item.selling_currency)
                            : '—'}
                        </span>
                        <span
                          className={`upd-inv-grid-card-v2__margin${marginLabel && marginLabel.startsWith('+') ? ' is-positive' : ''}`}
                        >
                          {marginLabel ?? ''}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="upd-inv-grid-card-v2__footer" onClick={(e) => e.stopPropagation()}>
                    {canEditOrDelete ? (
                      <>
                        <button
                          type="button"
                          className="upd-inv-grid-footer-btn upd-inv-grid-footer-btn--edit"
                          onClick={() => handleEdit(item)}
                        >
                          <IconEdit />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          className="upd-inv-grid-footer-btn upd-inv-grid-footer-btn--delete"
                          onClick={() => handleDelete(item)}
                          aria-label="Delete item"
                        >
                          <IconDelete />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="upd-inv-grid-footer-btn upd-inv-grid-footer-btn--edit"
                        onClick={() => setSelectedViewItemId(item.id)}
                      >
                        <IconEye />
                        <span>View</span>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
        </div>
      </div>

      {selectedViewItem ? (
        <div className="upd-inv-detail-overlay">
          <button
            type="button"
            className="upd-inv-detail-backdrop"
            aria-label="Close item details"
            onClick={() => setSelectedViewItemId(null)}
          />
          <aside
            className="upd-inv-detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upd-inv-detail-drawer-title"
            aria-label="Item details"
          >
            <div className="upd-inv-detail-drawer__inner">
              <header className="upd-inv-detail-drawer__header">
                <h2 id="upd-inv-detail-drawer-title" className="upd-inv-detail-drawer__header-title">
                  {inventoryItemPrimaryLabel(selectedViewItem)}
                </h2>
                <button
                  type="button"
                  className="upd-inv-detail-drawer__close"
                  onClick={() => setSelectedViewItemId(null)}
                  aria-label="Close"
                >
                  <IconClose />
                </button>
              </header>
              <div className="upd-inv-detail-drawer__rule" aria-hidden="true" />
              <div className="upd-inv-detail-drawer__body">
                <div className="upd-inv-detail-drawer__media">
                  {selectedViewItem.image_path ? (
                    <img
                      src={getImageSrc(selectedViewItem.image_path)}
                      alt=""
                      className="upd-inv-detail-drawer__img"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="upd-inv-detail-drawer__img-ph">
                      <IconGem />
                      <span>No photo</span>
                    </div>
                  )}
                </div>
                <h3 className="upd-inv-detail-drawer__name">{inventoryItemPrimaryLabel(selectedViewItem)}</h3>
                <div className="upd-inv-detail-drawer__id-row">
                  <span className="upd-inv-detail-drawer__code">{selectedViewItem.item_code?.trim() || '—'}</span>
                  <span className="upd-inv-detail-drawer__dot" aria-hidden="true" />
                  {selectedViewItem.effectiveStatus ? (
                    <span
                      className={`inventory-list-item-badge inventory-list-item-badge--${selectedViewItem.effectiveStatus
                        .toLowerCase()
                        .replace(/\s+/g, '-')}`}
                    >
                      {selectedViewItem.effectiveStatus}
                    </span>
                  ) : (
                    <span className="inventory-list-item-badge">—</span>
                  )}
                </div>
                <section className="upd-inv-detail-drawer__section" aria-label="Physical details">
                  <h4 className="upd-inv-detail-drawer__section-kicker">Physical details</h4>
                  <div className="upd-inv-detail-drawer__rule upd-inv-detail-drawer__rule--subtle" aria-hidden="true" />
                  <dl className="upd-inv-detail-drawer__kv">
                    <div className="upd-inv-detail-drawer__kv-row">
                      <dt>Category</dt>
                      <dd>
                        {inventoryCategoryDisplay(selectedViewItem.category) ??
                          (selectedViewItem.category?.trim() || '—')}
                      </dd>
                    </div>
                    <div className="upd-inv-detail-drawer__kv-row">
                      <dt>Cut / Form</dt>
                      <dd>{formatItemTypeDisplay(selectedViewItem.item_type)}</dd>
                    </div>
                    <div className="upd-inv-detail-drawer__kv-row">
                      <dt>Pieces</dt>
                      <dd>{selectedViewItem.pieces}</dd>
                    </div>
                    <div className="upd-inv-detail-drawer__kv-row">
                      <dt>Weight (carats)</dt>
                      <dd>
                        {selectedViewItem.weight_carats != null ? `${selectedViewItem.weight_carats} ct` : '—'}
                      </dd>
                    </div>
                    <div className="upd-inv-detail-drawer__kv-row">
                      <dt>Weight (grams)</dt>
                      <dd>
                        {selectedViewItem.weight_grams != null ? `${selectedViewItem.weight_grams} g` : '—'}
                      </dd>
                    </div>
                    <div className="upd-inv-detail-drawer__kv-row">
                      <dt>Description</dt>
                      <dd>{selectedViewItem.description?.trim() || '—'}</dd>
                    </div>
                  </dl>
                </section>

                <ItemDetailDrawerFinanceSections item={selectedViewItem} />
              </div>
              <footer className="upd-inv-detail-drawer__footer">
                {canEditOrDelete ? (
                  <>
                    <button
                      type="button"
                      className="upd-inv-detail-drawer__btn-edit"
                      onClick={() => handleEdit(selectedViewItem)}
                    >
                      <IconEdit />
                      <span>Edit This Item</span>
                    </button>
                    <button
                      type="button"
                      className="upd-inv-detail-drawer__btn-delete"
                      onClick={() => handleDelete(selectedViewItem)}
                    >
                      <IconDelete />
                      <span>Delete</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="upd-inv-detail-drawer__btn-edit"
                    onClick={() => setSelectedViewItemId(null)}
                  >
                    <span>Close</span>
                  </button>
                )}
              </footer>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
};
