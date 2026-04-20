/**
 * Printable sale invoice & memo — matches provided Blue Cuts HTML template (class names & CSS).
 * Override company block via localStorage key `bluecuts-receipt-company` (JSON).
 */

import { currencyReceiptLabel, normalizeCurrencyCode, roundMoney2 } from './currencies';
import { dateFromServerUtc } from './serverTime';

const STORAGE_KEY = 'bluecuts-receipt-company';

export interface CompanyReceiptSettings {
  name: string;
  tagline: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  paymentTerms: string;
  countryOfOrigin: string;
  currencyLabel: string;
  currencyCode: string;
  marksAndNumbers: string;
  notesConditions: string;
  /** Shown on memo under “For Information Only” (template wording). */
  memoForInformationBody?: string;
  /** Right-column “Memo Terms” on printed memo (e.g. On Approval). */
  memoTermsLine?: string;
}

export function getDefaultCompanySettings(): CompanyReceiptSettings {
  return {
    name: 'BLUE CUTS CO., LTD.',
    tagline: 'FINE GEMSTONES & PRECIOUS STONES',
    addressLine1: '919/1, JTC Building, B1 Floor, BB036-037, Silom, Bangrak, Bangkok 10500',
    addressLine2: '',
    city: '',
    phone: '+66 848995468 · +66 22381633',
    email: 'bluecuts@yahoo.com',
    website: '',
    taxId: '',
    paymentTerms: 'Net 15 Days',
    countryOfOrigin: 'Thailand',
    currencyLabel: 'THB (Thai Baht)',
    currencyCode: 'THB',
    marksAndNumbers: 'BLUE CUTS CO., LTD.',
    notesConditions:
      'All gemstones are accompanied by internationally recognized laboratory certificates. Ownership of goods remains with Blue Cuts Co., Ltd. until full payment is received. Amounts are in the currency stated on this document. Any discrepancy must be reported within 48 hours of receipt.',
    memoForInformationBody:
      'Prices are subject to change without prior notice. Blue Cuts Co., Ltd. is not responsible for any damage or loss of goods on memo. Recipient is solely responsible for the safety and security of the goods while on memo.',
    memoTermsLine: 'On Approval',
  };
}

export function loadCompanyReceiptSettings(): CompanyReceiptSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CompanyReceiptSettings>;
      return { ...getDefaultCompanySettings(), ...parsed };
    }
  } catch {
    /* ignore */
  }
  return getDefaultCompanySettings();
}

export function saveCompanyReceiptSettings(partial: Partial<CompanyReceiptSettings>): CompanyReceiptSettings {
  const next = { ...loadCompanyReceiptSettings(), ...partial };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** For HTML double-quoted attributes (e.g. style="..."). */
function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function formatMoney(n: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    }).format(Number(n) || 0);
  } catch {
    return `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function formatMoneyAmountOnly(n: number, currencyCode: string): string {
  const full = formatMoney(n, currencyCode);
  const m = full.match(/[\d,.]+/);
  return m ? m[0] : full;
}

function formatInvoiceDate(iso: string): string {
  if (!iso) return '—';
  const d = dateFromServerUtc(iso);
  if (Number.isNaN(d.getTime())) return escapeHtml(String(iso).slice(0, 10));
  return escapeHtml(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
}

/** Days between memo date and due date (inclusive-friendly rounding). */
function memoDurationDaysLabel(memoDate: string, dueDate: string | null): string {
  if (!dueDate || !memoDate) return '—';
  const parse = (s: string) => new Date(s.length <= 10 ? `${s}T12:00:00` : s);
  const a = parse(memoDate);
  const b = parse(dueDate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '—';
  const days = Math.round((b.getTime() - a.getTime()) / 86400000);
  if (!Number.isFinite(days)) return '—';
  return `${days} Day${days === 1 ? '' : 's'}`;
}

function formatWtCtShort(ct: number | null | undefined, g: number | null | undefined): string {
  if (ct != null && Number.isFinite(Number(ct))) return escapeHtml(String(Number(ct)));
  if (g != null && Number.isFinite(Number(g))) return escapeHtml(`${Number(g)} g`);
  return '—';
}

/** Strip inventory item `description` prose when it appears as a ·-separated segment (fallback path). */
function stripInventoryNoteFromMergedDescription(merged: string, invNote: string): string {
  const n = invNote.trim();
  if (!n) return merged;
  return merged
    .split(/\s*·\s*/)
    .map(s => s.trim())
    .filter(s => s.toLowerCase() !== n.toLowerCase())
    .join(' · ')
    .replace(/\s*·\s*·\s*/g, ' · ')
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .trim();
}

/**
 * Invoice receipt line text: category, type, and weights only — not the inventory freeform description.
 */
function invoiceLineDescription(row: ReceiptInvoiceLine): string {
  const typeLine = [row.inv_category, row.inv_item_type].filter(Boolean).join(' ').trim();
  const wSegs: string[] = [];
  const ct = row.weight_carats != null ? Number(row.weight_carats) : NaN;
  const g = row.weight_grams != null ? Number(row.weight_grams) : NaN;
  if (Number.isFinite(ct)) wSegs.push(`${ct} ct`);
  if (Number.isFinite(g)) wSegs.push(`${g} g`);
  const weightPart = wSegs.join(' · ');

  const specParts: string[] = [];
  if (typeLine) specParts.push(typeLine);
  if (weightPart) specParts.push(weightPart);
  const fromSpecs = specParts.join(' · ').trim();
  if (fromSpecs) return fromSpecs;

  const invNote = (row.inventory_description || '').trim();
  let merged = (row.description || '').trim();
  if (merged && invNote) merged = stripInventoryNoteFromMergedDescription(merged, invNote);
  return merged || (row.item_code || '').trim() || '—';
}

function splitDescriptionForTable(desc: string): { title: string; sub: string } {
  const raw = desc.trim() || '—';
  const parts = raw.split(/\s*·\s*/);
  if (parts.length >= 2) {
    return { title: parts[0].trim(), sub: parts.slice(1).join(' · ').trim() };
  }
  const lineBreak = raw.indexOf('\n');
  if (lineBreak > 0) {
    return { title: raw.slice(0, lineBreak).trim(), sub: raw.slice(lineBreak + 1).trim() };
  }
  return { title: raw, sub: '' };
}

function pricePerCarat(lineTotal: number, qty: number, carats: number | null | undefined): number | null {
  const ct = carats != null && Number.isFinite(Number(carats)) ? Number(carats) : NaN;
  const q = Math.max(1, qty || 1);
  if (!Number.isFinite(ct) || ct <= 0) return null;
  return (Number(lineTotal) || 0) / (q * ct);
}

/** Gross line amount from stored unit price × qty (before line discount). */
function invoiceLineGross(row: ReceiptInvoiceLine): number {
  const q = Math.max(0, Number(row.quantity) || 0);
  const u = Number(row.unit_price) || 0;
  return q * u;
}

/** Line-level discount implied by gross − net (item-level reduction). */
function invoiceLineDiscount(row: ReceiptInvoiceLine): number {
  const gross = invoiceLineGross(row);
  const net = Number(row.line_total) || 0;
  const d = gross - net;
  return d > 0.0001 ? d : 0;
}

/** Served from `frontend/public/receipt-logo.png` — absolute URL for print popups (`about:blank`). */
export function resolveReceiptLogoUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const rawPub = process.env.PUBLIC_URL || '';
    const pub = rawPub === '.' ? '' : rawPub.replace(/\/+$/, '');
    const path = `${pub}/receipt-logo.png`.replace(/\/+/g, '/');
    const absolutePath = path.startsWith('/') ? path : `/${path}`;
    return `${window.location.origin}${absolutePath}`;
  } catch {
    return '';
  }
}

/** Large BC crest for faint page watermark — `frontend/public/receipt-watermark.png`. */
export function resolveReceiptWatermarkUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const rawPub = process.env.PUBLIC_URL || '';
    const pub = rawPub === '.' ? '' : rawPub.replace(/\/+$/, '');
    const path = `${pub}/receipt-watermark.png`.replace(/\/+/g, '/');
    const absolutePath = path.startsWith('/') ? path : `/${path}`;
    return `${window.location.origin}${absolutePath}`;
  } catch {
    return '';
  }
}

/** Fallback if logo file is missing (e.g. offline). */
function fallbackReceiptLogoDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="14" fill="#fff"/><text x="60" y="70" text-anchor="middle" font-size="18" fill="#0A2356" font-family="Georgia,serif">BC</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function receiptLogoSrcForHtml(): string {
  const u = resolveReceiptLogoUrl();
  return u || fallbackReceiptLogoDataUrl();
}

function escapeForSingleQuotedJs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function receiptLogoOnErrorJs(): string {
  const fallback = fallbackReceiptLogoDataUrl();
  return `this.onerror=null;this.src='${escapeForSingleQuotedJs(fallback)}';`;
}

function fullAddressLines(p: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  postal?: string | null;
  country?: string | null;
}): string[] {
  const lines: string[] = [];
  if (p.line1?.trim()) lines.push(p.line1.trim());
  if (p.line2?.trim()) lines.push(p.line2.trim());
  const tail = [p.city, p.postal, p.country].filter(x => x?.trim()).join(', ');
  if (tail) lines.push(tail);
  return lines;
}

export interface ReceiptInvoiceLine {
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
}

export interface ReceiptInvoicePayload {
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
  /** ISO 4217; receipt formatting when set */
  currency_code?: string | null;
  items: ReceiptInvoiceLine[];
  payments?: { method: string; amount: number; created_at: string }[];
}

export interface ReceiptMemoLine {
  item_code: string | null;
  description: string | null;
  quantity: number;
  returned_qty: number;
  unit_price: number;
  line_total: number;
  weight_grams?: number | null;
  weight_carats?: number | null;
  category?: string | null;
  item_type?: string | null;
}

export interface ReceiptMemoPayload {
  memo_no: string;
  memo_date: string;
  due_date: string | null;
  customer_name: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address_line1?: string | null;
  customer_address_line2?: string | null;
  customer_city?: string | null;
  customer_postal_code?: string | null;
  customer_country?: string | null;
  notes?: string | null;
  status?: string;
  items: ReceiptMemoLine[];
  currency_code?: string | null;
}

/**
 * CSS from the provided template (+ A4 page size + tab/print helpers).
 */
const RECEIPT_STYLES = `
@page{size:A4 portrait;margin:12mm}
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:100%}
body{background:#E8F1FA;font-family:'Lato',sans-serif;min-height:100vh;padding:24px 16px 48px;-webkit-print-color-adjust:exact;print-color-adjust:exact}

.app-header{text-align:center;margin-bottom:24px}
.app-header h1{font-family:'Cormorant Garamond',serif;font-size:22px;color:#0D2B5E;font-weight:700;letter-spacing:.5px}
.app-header p{font-size:13px;color:#5A7A9A;margin-top:4px}

.tab-bar{display:flex;justify-content:center;gap:10px;margin-bottom:28px}
.tab-btn{padding:10px 28px;border-radius:25px;border:none;cursor:pointer;font-family:'Lato',sans-serif;font-size:13px;font-weight:700;letter-spacing:.5px;transition:all .2s}
.tab-btn.active{background:#0D2B5E;color:#fff;box-shadow:0 4px 16px rgba(13,43,94,0.28)}
.tab-btn:not(.active){background:#fff;color:#5A7A9A;border:1.5px solid #C5D8EE}
.tab-btn:not(.active):hover{background:#EDF4FB;color:#0D2B5E;border-color:#0D2B5E}

.print-btn{display:block;width:fit-content;margin:0 auto 22px;padding:11px 32px;background:linear-gradient(135deg,#1565C0,#29B6F6);color:#fff;border:none;border-radius:25px;font-family:'Lato',sans-serif;font-size:13px;font-weight:700;letter-spacing:.6px;cursor:pointer;box-shadow:0 4px 18px rgba(21,101,192,0.30);transition:all .2s}
.print-btn:hover{transform:translateY(-2px);box-shadow:0 7px 24px rgba(21,101,192,0.38)}

.doc-wrap{
  position:relative;
  width:210mm;max-width:210mm;min-height:297mm;margin:0 auto;background:#fff;
  box-shadow:0 8px 48px rgba(13,43,94,0.14),0 2px 8px rgba(13,43,94,0.06);
  border-radius:4px;overflow:hidden
}
.doc-watermark{
  position:absolute;
  left:50%;
  top:50%;
  transform:translate(-50%,-50%);
  width:min(82%,400px);
  max-width:min(400px,90vw);
  aspect-ratio:1;
  background:center/contain no-repeat;
  opacity:0.14;
  pointer-events:none;
  z-index:0;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
.doc-wrap > .doc{
  position:relative;
  z-index:1;
}

.doc{font-size:14px;color:#1A1A2E;line-height:1.62}
.doc.is-hidden{display:none!important}

.doc-header{
  background:linear-gradient(135deg,#0A2356 0%,#1565C0 55%,#1E88E5 100%);
  padding:30px 48px 26px;
  display:flex;align-items:center;justify-content:space-between;
  position:relative;overflow:hidden;
}
.doc-header::before{content:'';position:absolute;right:-40px;top:-40px;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,0.05)}
.doc-header::after{content:'';position:absolute;right:60px;bottom:-60px;width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,0.04)}

.header-logo-box{
  width:96px;height:96px;flex-shrink:0;
  background:rgba(255,255,255,0.96);
  border-radius:12px;
  display:flex;align-items:center;justify-content:center;
  padding:4px;
  position:relative;z-index:2;
  box-shadow:0 4px 18px rgba(0,0,0,0.25);
}
.header-logo-img{width:100%;height:100%;object-fit:contain}

.header-center{text-align:center;flex:1;position:relative;z-index:1;padding:0 20px}
.company-name{font-family:'Lato',sans-serif;font-size:30px;font-weight:900;color:#fff;letter-spacing:2px;text-transform:uppercase;text-shadow:0 2px 8px rgba(0,0,0,0.2)}
.company-tagline{font-size:10.5px;color:rgba(255,255,255,0.65);letter-spacing:3px;text-transform:uppercase;margin-top:5px;font-weight:300}
.doc-type-badge{flex-shrink:0;text-align:right;position:relative;z-index:1}
.doc-type-text{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:700;color:rgba(255,255,255,0.92);letter-spacing:2px}
.memo-receipt-doc .doc-type-text{letter-spacing:1px}
.doc-number{font-size:11.5px;color:rgba(255,255,255,0.60);letter-spacing:1.5px;margin-top:5px;font-weight:300}

.addr-strip{background:#F0F7FF;padding:12px 48px;border-bottom:1px solid #D6E8FA;display:flex;align-items:center;justify-content:center;gap:30px;flex-wrap:wrap}
.addr-item{display:flex;align-items:center;gap:6px;font-size:11px;color:#4A6A8A;font-weight:400}

.doc-body{padding:34px 48px}

.meta-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px;gap:22px}
.bill-to-box{background:#F7FBFF;border:1px solid #D6E8FA;border-radius:8px;padding:16px 20px;flex:1;max-width:340px}
.bill-to-lbl{font-size:8.5px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#7FA8C4;margin-bottom:9px}
.bill-to-name{font-size:16px;font-weight:700;color:#0D2B5E;font-family:'Cormorant Garamond',serif}
.bill-to-company{font-size:12.5px;color:#3A6080;font-weight:700;margin-top:2px}
.bill-to-addr{font-size:12px;color:#5A7A9A;margin-top:7px;line-height:1.72}
.doc-meta{text-align:right}
.meta-table{border-collapse:collapse;margin-left:auto}
.meta-table td{padding:4px 0 4px 16px;font-size:13px}
.meta-table td:first-child{color:#7FA8C4;font-weight:400;text-align:left}
.meta-table td:last-child{color:#0D2B5E;font-weight:700;text-align:right}

.divider{height:2px;background:linear-gradient(90deg,#0D2B5E,#1565C0,#29B6F6,transparent);border-radius:2px;margin:0 0 28px;border:none}

.items-table{width:100%;border-collapse:collapse;margin-bottom:28px}
.items-table thead tr{background:linear-gradient(135deg,#0D2B5E,#1565C0)}
.items-table th{padding:12px 15px;text-align:left;font-size:9.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.85);white-space:nowrap}
.items-table th:last-child,.items-table td:last-child{text-align:right}
.items-table th.center,.items-table td.center{text-align:center}
.items-table th.right,.items-table td.right{text-align:right}
.memo-totals-disc{color:#B71C1C;font-weight:600}
.items-table tbody tr{border-bottom:1px solid #E8F2FA}
.items-table tbody tr:last-child{border-bottom:none}
.items-table tbody tr:nth-child(even) td{background:#F7FBFF}
.items-table td{padding:13px 15px;font-size:13px;color:#1A1A2E;vertical-align:middle}
.items-table .td-discount{text-align:right;font-weight:600;color:#B71C1C;font-size:12.5px}
.td-gem-name{font-weight:700;color:#0D2B5E}
.td-gem-sub{font-size:11px;color:#7FA8C4;margin-top:2px;font-weight:400}
.td-mono{font-family:monospace;font-size:12px;color:#3A6080}
.td-price{font-weight:700;color:#0D2B5E;font-size:14px}
.td-total{font-weight:700;color:#1565C0;font-size:14px}
.items-empty td{text-align:center;color:#7FA8C4;padding:24px 14px}

.totals-section{display:flex;justify-content:flex-end;margin-bottom:32px}
.totals-box{min-width:280px}
.totals-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #E8F2FA;font-size:13px}
.totals-row:last-child{border-bottom:none}
.totals-row .tkey{color:#7FA8C4;font-weight:500}
.totals-row .tval{font-weight:700;color:#0D2B5E}
.memo-totals-note{font-size:11px;color:#5A7A9A;margin-top:2px}
.memo-receipt-doc .items-table th,.invoice-receipt-doc .items-table th{font-size:9px;letter-spacing:1.4px;text-transform:uppercase}

.meta-due-highlight{color:#E65100!important;font-weight:700!important}

.td-gem-wrap{display:flex;align-items:flex-start;gap:10px}
.td-gem-dot{
  width:11px;height:11px;border-radius:50%;flex-shrink:0;margin-top:5px;
  background:linear-gradient(135deg,#FF9800,#F57C00);
  box-shadow:0 1px 3px rgba(245,124,0,0.35);
}

.grand-total-row{
  display:flex;justify-content:space-between;align-items:baseline;
  margin-top:14px;
  padding:16px 20px;
  border-top:2px solid #0D2B5E;
  border-bottom:2px solid #0D2B5E;
}
.grand-total-key{
  font-size:10.5px;font-weight:700;letter-spacing:2px;
  text-transform:uppercase;color:#0D2B5E;
}
.grand-total-val{
  font-family:'Cormorant Garamond',serif;
  font-size:26px;font-weight:700;
  color:#0D2B5E;letter-spacing:.5px;
  font-style:italic;
}
.memo-receipt-doc .memo-declared-grand-row{
  margin-top:4px;
  font-family:'Lato',sans-serif;
}
.memo-receipt-doc .memo-declared-grand-row .grand-total-key{
  font-family:'Lato',sans-serif;
}

.notes-box{background:#F0F7FF;border-left:3px solid #1565C0;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:32px}
.notes-title{font-size:9.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7FA8C4;margin-bottom:7px}
.notes-body{font-size:13px;color:#3A6080;line-height:1.75}

.sig-row{display:grid;grid-template-columns:1fr 1fr;gap:34px;margin-bottom:32px;margin-top:12px}

.doc-footer{background:linear-gradient(135deg,#0A2356,#1565C0);padding:16px 48px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
.footer-text{font-size:10.5px;color:rgba(255,255,255,0.65);font-weight:300;letter-spacing:.5px}
.footer-brand{font-size:12px;font-weight:700;color:rgba(255,255,255,0.85);letter-spacing:1px;font-family:'Lato',sans-serif}

.memo-gem-card{
  background:linear-gradient(135deg,#F0F7FF,#EBF3FF);
  border:1.5px solid #C5D8EE;border-radius:10px;
  padding:18px 22px;margin-bottom:22px;
  display:flex;align-items:center;gap:18px;
}
.mgc-icon{font-size:38px;flex-shrink:0;line-height:1}
.mgc-name{font-size:17px;font-weight:700;color:#0D2B5E;font-family:'Cormorant Garamond',serif;letter-spacing:.3px}
.mgc-specs{font-size:12px;color:#5A7A9A;margin-top:4px;line-height:1.65}
.mgc-cert{font-size:10px;font-family:monospace;color:#7FA8C4;margin-top:4px}
.mgc-val{margin-left:auto;text-align:right;flex-shrink:0}
.mgc-price{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700;color:#1565C0;font-style:italic}
.mgc-plbl{font-size:9px;color:#7FA8C4;letter-spacing:1px;text-transform:uppercase;margin-top:3px}

.terms-section{
  border:1px solid #D0DFEE;border-radius:10px;
  overflow:hidden;margin-bottom:30px;margin-top:4px;
}
.terms-header{
  background:linear-gradient(135deg,#0D2B5E,#1565C0);
  padding:13px 22px;
}
.terms-header-text{
  font-size:9.5px;font-weight:700;letter-spacing:2px;
  text-transform:uppercase;color:rgba(255,255,255,0.85);
}
.terms-body{padding:20px 22px}
.term-item{
  display:flex;gap:14px;
  padding:10px 0;
  border-bottom:1px solid #EEF4FA;
  font-size:12.5px;color:#2A3A50;line-height:1.75;
}
.term-item:last-child{border-bottom:none}
.term-num{
  width:24px;height:24px;border-radius:50%;
  background:linear-gradient(135deg,#0D2B5E,#1565C0);
  color:#fff;font-size:9.5px;font-weight:700;
  display:flex;align-items:center;justify-content:center;
  flex-shrink:0;margin-top:2px;
}
.term-text{flex:1;min-width:0;max-width:100%}
.term-text strong{color:#0D2B5E}
.term-text ul{margin:6px 0 0 4px;padding:0;list-style:none}
.term-text ul li{
  padding:3px 0 3px 16px;position:relative;
  font-size:12px;color:#3A5070;
}
.term-text ul li::before{content:'•';position:absolute;left:4px;color:#7FA8C4}
.term-text p{margin:0 0 8px}
.term-text p:last-child{margin-bottom:0}
.term-sublist{margin:6px 0 8px 0;padding:0;list-style:none}
.term-sublist li{
  padding:4px 0 4px 18px;position:relative;
  font-size:12px;color:#3A5070;line-height:1.65;
}
.term-sublist li::before{content:'•';position:absolute;left:4px;color:#9E9E9E}

/* Memo receipt — screen: clearer gaps between blocks + wider terms + more room to sign */
.memo-receipt-doc .addr-strip{margin-bottom:4px}
.memo-receipt-doc .doc-body{padding-top:38px;padding-bottom:38px}
.memo-receipt-doc .meta-row{margin-bottom:34px}
.memo-receipt-doc .divider{margin:0 0 32px}
.memo-receipt-doc .items-table{margin-bottom:34px}
.memo-receipt-doc .totals-section{margin-bottom:36px}
.memo-receipt-doc .notes-box{margin-bottom:36px}
.memo-receipt-doc .terms-section{margin-top:10px;margin-bottom:36px}
.memo-receipt-doc .terms-body{padding:22px 24px}
.memo-receipt-doc .term-text{
  text-align:justify;
  text-justify:inter-word;
  hyphens:auto;
  -webkit-hyphens:auto;
}
.memo-receipt-doc .term-sublist,.memo-receipt-doc .term-text ul{text-align:left}
.memo-receipt-doc .sig-row{margin-top:18px;margin-bottom:38px;gap:38px}
.memo-receipt-doc .sig-pretitle{margin-bottom:8px}
.memo-receipt-doc .sig-line{margin-top:46px;margin-bottom:12px}
.memo-receipt-doc .sig-subtitle{margin-top:2px}

/* Room to sign above the line (pen needs ~28–40mm vertical space). */
.sig-pretitle{font-size:12px;font-weight:700;color:#0D2B5E;letter-spacing:.3px;margin-bottom:6px;min-height:2.5em}
.sig-line{
  align-self:stretch;width:100%;max-width:100%;
  border-top:1.5px solid #C5D8EE;
  margin-top:38px;margin-bottom:10px;
  min-height:0;
}
.sig-subtitle{font-size:11px;color:#7FA8C4;margin-top:0}
.sig-box{text-align:center;display:flex;flex-direction:column;align-items:center;width:100%}

@media print{
  @page{size:A4 portrait;margin:5mm}
  body{background:#fff!important;padding:0!important}
  .app-header,.tab-bar,.print-btn{display:none!important}
  .doc-wrap{
    width:100%!important;max-width:100%!important;min-height:0!important;
    box-shadow:none!important;border-radius:0!important;margin:0!important
  }
  .doc-watermark{opacity:0.11!important}
  .doc.is-hidden{display:none!important}
  .doc-header,.doc-footer,.sig-row,.notes-box,.terms-section{break-inside:avoid-page}
  .items-table thead{display:table-header-group}
  .items-table tbody tr{break-inside:avoid}

  /* One-page receipts: compact print (memo + invoice). */
  .memo-receipt-doc,.invoice-receipt-doc{
    font-size:10.5px!important;
    line-height:1.34!important;
    -webkit-print-color-adjust:exact!important;
    print-color-adjust:exact!important;
  }
  .memo-receipt-doc .doc-header,.invoice-receipt-doc .doc-header{
    padding:12px 20px 10px!important;
    break-inside:avoid!important;
  }
  .memo-receipt-doc .header-logo-box,.invoice-receipt-doc .header-logo-box{width:56px!important;height:56px!important;border-radius:8px!important}
  .memo-receipt-doc .company-name,.invoice-receipt-doc .company-name{font-size:19px!important;letter-spacing:1px!important}
  .memo-receipt-doc .company-tagline,.invoice-receipt-doc .company-tagline{font-size:7.5px!important;margin-top:2px!important}
  .memo-receipt-doc .doc-type-text,.invoice-receipt-doc .doc-type-text{font-size:19px!important}
  .memo-receipt-doc .doc-number,.invoice-receipt-doc .doc-number{font-size:10px!important}
  .memo-receipt-doc .addr-strip,.invoice-receipt-doc .addr-strip{padding:7px 20px!important;gap:16px!important}
  .memo-receipt-doc .addr-item,.invoice-receipt-doc .addr-item{font-size:9.5px!important}
  .memo-receipt-doc .doc-body,.invoice-receipt-doc .doc-body{padding:11px 20px 9px!important}
  .memo-receipt-doc .meta-row,.invoice-receipt-doc .meta-row{margin-bottom:12px!important;gap:14px!important;align-items:flex-start!important}
  .memo-receipt-doc .bill-to-box,.invoice-receipt-doc .bill-to-box{padding:10px 12px!important;max-width:42%!important}
  .memo-receipt-doc .bill-to-lbl,.invoice-receipt-doc .bill-to-lbl{font-size:8px!important;margin-bottom:5px!important}
  .memo-receipt-doc .bill-to-name,.invoice-receipt-doc .bill-to-name{font-size:13.5px!important}
  .memo-receipt-doc .bill-to-company,.invoice-receipt-doc .bill-to-company{font-size:10px!important}
  .memo-receipt-doc .bill-to-addr,.invoice-receipt-doc .bill-to-addr{font-size:9.5px!important;margin-top:4px!important;line-height:1.38!important}
  .memo-receipt-doc .meta-table td,.invoice-receipt-doc .meta-table td{font-size:9.75px!important;padding:2px 0 2px 11px!important}
  .memo-receipt-doc .divider,.invoice-receipt-doc .divider{margin:0 0 10px!important;height:1px!important}
  .memo-receipt-doc .items-table,.invoice-receipt-doc .items-table{margin-bottom:10px!important}
  .memo-receipt-doc .items-table th,.invoice-receipt-doc .items-table th{padding:5px 7px!important;font-size:7px!important;letter-spacing:0.8px!important}
  .memo-receipt-doc .items-table td,.invoice-receipt-doc .items-table td{padding:5px 7px!important;font-size:10px!important}
  .memo-receipt-doc .td-gem-name,.invoice-receipt-doc .td-gem-name{font-size:10px!important}
  .memo-receipt-doc .td-gem-sub,.invoice-receipt-doc .td-gem-sub{font-size:8px!important;margin-top:1px!important}
  .memo-receipt-doc .td-gem-dot,.invoice-receipt-doc .td-gem-dot{width:8px!important;height:8px!important;margin-top:3px!important}
  .memo-receipt-doc .td-mono,.invoice-receipt-doc .td-mono{font-size:9px!important}
  .memo-receipt-doc .td-total,.invoice-receipt-doc .td-total,.memo-receipt-doc .td-price,.invoice-receipt-doc .td-price{font-size:10px!important}
  .memo-receipt-doc .items-table tbody tr,.invoice-receipt-doc .items-table tbody tr{break-inside:auto!important;page-break-inside:auto!important}
  .memo-receipt-doc .totals-section,.invoice-receipt-doc .totals-section{margin-bottom:12px!important}
  .memo-receipt-doc .totals-box,.invoice-receipt-doc .totals-box{min-width:240px!important}
  .memo-receipt-doc .totals-row,.invoice-receipt-doc .totals-row{padding:4px 0!important;font-size:9.75px!important}
  .memo-receipt-doc .grand-total-row,.invoice-receipt-doc .grand-total-row{margin-top:4px!important;padding:8px 10px!important}
  .memo-receipt-doc .grand-total-key,.invoice-receipt-doc .grand-total-key{font-size:9px!important;letter-spacing:1px!important}
  .memo-receipt-doc .grand-total-val,.invoice-receipt-doc .grand-total-val{font-size:17px!important}
  .memo-receipt-doc .notes-box,.invoice-receipt-doc .notes-box{
    margin-bottom:12px!important;padding:8px 12px!important;
    break-inside:auto!important;
    page-break-inside:auto!important;
  }
  .memo-receipt-doc .notes-title,.invoice-receipt-doc .notes-title{font-size:8px!important;margin-bottom:4px!important}
  .memo-receipt-doc .notes-body,.invoice-receipt-doc .notes-body{font-size:9.5px!important;line-height:1.38!important}
  .memo-receipt-doc .terms-section{
    margin-top:16px!important;
    margin-bottom:16px!important;
    break-inside:auto!important;
    page-break-inside:auto!important;
  }
  .memo-receipt-doc .terms-header{padding:7px 12px!important}
  .memo-receipt-doc .terms-header-text{font-size:8px!important;letter-spacing:1.2px!important}
  .memo-receipt-doc .terms-body{
    padding:10px 14px!important;
    width:100%!important;
    max-width:none!important;
    column-count:1!important;
    column-gap:0!important;
    box-sizing:border-box!important;
  }
  .memo-receipt-doc .term-text{
    flex:1!important;
    min-width:0!important;
    max-width:none!important;
    text-align:justify!important;
    text-justify:inter-word!important;
    hyphens:auto!important;
    -webkit-hyphens:auto!important;
  }
  .memo-receipt-doc .term-sublist,
  .memo-receipt-doc .term-text ul{
    text-align:left!important;
  }
  .memo-receipt-doc .term-item{
    padding:3px 0!important;
    font-size:8.25px!important;
    line-height:1.38!important;
    width:100%!important;
    break-inside:avoid!important;
    page-break-inside:avoid!important;
  }
  .memo-receipt-doc .term-num{width:16px!important;height:16px!important;font-size:7.5px!important;margin-top:1px!important}
  .memo-receipt-doc .term-text ul li{font-size:7.75px!important;padding:2px 0 2px 12px!important}
  .memo-receipt-doc .term-sublist{margin:4px 0 5px!important}
  .memo-receipt-doc .term-sublist li{font-size:7.75px!important;padding:2px 0 2px 12px!important;line-height:1.3!important}
  .memo-receipt-doc .term-text p{margin:0 0 4px!important}
  .memo-receipt-doc .sig-row,.invoice-receipt-doc .sig-row{
    gap:18px!important;
    margin-bottom:12px!important;
    margin-top:6px!important;
    break-inside:avoid!important;
  }
  .memo-receipt-doc .sig-row{
    gap:22px!important;
    margin-top:12px!important;
    margin-bottom:16px!important;
  }
  .memo-receipt-doc .sig-pretitle,.invoice-receipt-doc .sig-pretitle{font-size:9.5px!important;margin-bottom:3px!important;min-height:0!important}
  .memo-receipt-doc .sig-pretitle{margin-bottom:6px!important}
  .memo-receipt-doc .sig-line,.invoice-receipt-doc .sig-line{margin-top:30px!important;margin-bottom:6px!important}
  .memo-receipt-doc .sig-line{margin-top:36px!important;margin-bottom:8px!important}
  .memo-receipt-doc .sig-subtitle,.invoice-receipt-doc .sig-subtitle{font-size:8.25px!important}
  .memo-receipt-doc .doc-footer,.invoice-receipt-doc .doc-footer{padding:9px 20px!important;break-inside:avoid!important}
  .memo-receipt-doc .footer-text,.invoice-receipt-doc .footer-text{font-size:8.5px!important}
  .memo-receipt-doc .footer-brand,.invoice-receipt-doc .footer-brand{font-size:9.5px!important}

  /*
   * Memo-only: still compact for many lines, but full-width T&Cs + a bit more air between blocks.
   */
  .memo-receipt-doc .doc-header{padding:8px 16px 7px!important}
  .memo-receipt-doc .header-logo-box{width:48px!important;height:48px!important}
  .memo-receipt-doc .company-name{font-size:16px!important}
  .memo-receipt-doc .company-tagline{font-size:6.5px!important}
  .memo-receipt-doc .doc-type-text{font-size:16px!important}
  .memo-receipt-doc .doc-number{font-size:9px!important}
  .memo-receipt-doc .addr-strip{padding:5px 16px!important;gap:12px!important}
  .memo-receipt-doc .addr-item{font-size:8.5px!important}
  .memo-receipt-doc .doc-body{padding:8px 16px 7px!important}
  .memo-receipt-doc .meta-row{margin-bottom:10px!important;gap:12px!important}
  .memo-receipt-doc .bill-to-box{padding:7px 10px!important}
  .memo-receipt-doc .bill-to-name{font-size:12px!important}
  .memo-receipt-doc .bill-to-addr{font-size:8.5px!important;margin-top:2px!important;line-height:1.3!important}
  .memo-receipt-doc .meta-table td{font-size:8.5px!important;padding:1px 0 1px 8px!important}
  .memo-receipt-doc .divider{margin:0 0 9px!important}
  .memo-receipt-doc .items-table{margin-bottom:9px!important}
  .memo-receipt-doc .items-table th{padding:3px 5px!important;font-size:6px!important}
  .memo-receipt-doc .items-table td{padding:3px 5px!important;font-size:8.5px!important;vertical-align:top!important}
  .memo-receipt-doc .td-gem-name{font-size:8.5px!important;line-height:1.2!important}
  .memo-receipt-doc .td-gem-sub{
    font-size:6.75px!important;line-height:1.2!important;margin-top:0!important;
    display:-webkit-box!important;-webkit-line-clamp:2!important;-webkit-box-orient:vertical!important;
    overflow:hidden!important;
  }
  .memo-receipt-doc .td-gem-dot{width:6px!important;height:6px!important;margin-top:2px!important}
  .memo-receipt-doc .td-mono{font-size:8px!important}
  .memo-receipt-doc .td-total{font-size:8.5px!important}
  .memo-receipt-doc .totals-section{margin-bottom:9px!important}
  .memo-receipt-doc .totals-row{padding:2px 0!important;font-size:8.5px!important}
  .memo-receipt-doc .grand-total-row{margin-top:2px!important;padding:5px 7px!important}
  .memo-receipt-doc .grand-total-key{font-size:8px!important}
  .memo-receipt-doc .grand-total-val{font-size:14px!important}
  .memo-receipt-doc .notes-box{margin-bottom:9px!important;padding:6px 10px!important}
  .memo-receipt-doc .notes-body{font-size:8.5px!important;line-height:1.3!important}
  .memo-receipt-doc .terms-section{margin-top:10px!important;margin-bottom:10px!important}
  .memo-receipt-doc .terms-header{padding:5px 10px!important}
  .memo-receipt-doc .terms-header-text{font-size:7px!important}
  .memo-receipt-doc .terms-body{
    padding:8px 12px!important;
    width:100%!important;
    max-width:none!important;
    column-count:1!important;
    column-gap:0!important;
  }
  .memo-receipt-doc .term-item{
    padding:2px 0!important;
    font-size:7px!important;
    line-height:1.28!important;
    break-inside:avoid!important;
    page-break-inside:avoid!important;
  }
  .memo-receipt-doc .term-num{width:13px!important;height:13px!important;font-size:6.5px!important}
  .memo-receipt-doc .term-text ul li{font-size:6.75px!important;padding:1px 0 1px 10px!important}
  .memo-receipt-doc .term-sublist{margin:3px 0 4px!important}
  .memo-receipt-doc .term-sublist li{font-size:6.75px!important;padding:1px 0 1px 10px!important;line-height:1.22!important}
  .memo-receipt-doc .term-text p{margin:0 0 3px!important}
  .memo-receipt-doc .sig-row{gap:20px!important;margin-bottom:14px!important;margin-top:12px!important}
  .memo-receipt-doc .sig-pretitle{font-size:8.5px!important;margin-bottom:6px!important}
  .memo-receipt-doc .sig-line{margin-top:40px!important;margin-bottom:8px!important}
  .memo-receipt-doc .sig-subtitle{font-size:7.5px!important}
  .memo-receipt-doc .doc-footer{padding:6px 16px!important}
  .memo-receipt-doc .footer-text{font-size:7.5px!important}
  .memo-receipt-doc .footer-brand{font-size:8.5px!important}
  .doc-wrap:has(.memo-receipt-doc) > .doc-watermark{opacity:0.07!important}
}
`;

function buildInvoiceTableRows(
  inv: ReceiptInvoicePayload | null,
  currencyCode: string
): string {
  if (!inv?.items?.length) {
    return `<tr class="items-empty"><td colspan="7">No line items.</td></tr>`;
  }
  return inv.items
    .map((row, i) => {
      const descFull = invoiceLineDescription(row);
      const parts = splitDescriptionForTable(descFull);
      const qty = row.quantity || 0;
      const ct = row.weight_carats;
      const ppc = pricePerCarat(row.line_total, qty, ct);
      const priceCol =
        ppc != null ? formatMoney(ppc, currencyCode) : formatMoney(row.unit_price, currencyCode);
      const idx = String(i + 1).padStart(2, '0');
      const codeMono = (row.item_code || '').trim();
      const subExtra = codeMono ? `${parts.sub ? `${parts.sub} · ` : ''}Code: ${codeMono}` : parts.sub;
      const lineDisc = invoiceLineDiscount(row);
      const discCol =
        lineDisc > 0 ? `− ${formatMoney(lineDisc, currencyCode)}` : '—';
          return `<tr>
        <td class="center td-mono">${escapeHtml(idx)}</td>
        <td>
          <div class="td-gem-name">${escapeHtml(parts.title)}</div>
          ${subExtra ? `<div class="td-gem-sub">${escapeHtml(subExtra)}</div>` : ''}
        </td>
        <td class="center">${escapeHtml(String(qty))}</td>
        <td class="center">${formatWtCtShort(ct, row.weight_grams)}</td>
        <td class="td-price">${escapeHtml(priceCol)}</td>
        <td class="td-discount">${escapeHtml(discCol)}</td>
        <td class="td-total">${escapeHtml(formatMoney(row.line_total, currencyCode))}</td>
          </tr>`;
        })
    .join('');
}

function buildInvoiceDoc(
  co: CompanyReceiptSettings,
  inv: ReceiptInvoicePayload | null,
  currencyCode: string,
  tabId: 'tab-sale' | 'tab-memo',
  docClass: string,
  logoSrc: string,
  logoOnErrorJs: string
): string {
  const invPaid = inv ? Number(inv.paid || 0) : 0;
  const invTotal = inv ? Number(inv.total || 0) : 0;
  const invBalance = Math.max(0, invTotal - invPaid);
  const sub = inv ? Number(inv.subtotal) : 0;
  const disc = inv ? Number(inv.discount) : 0;

  const addrLine = [co.addressLine1, co.addressLine2, co.city].filter(x => x?.trim()).join(' ');
  const custName = inv?.customer_name?.trim() || '';
  const addrLines = inv
    ? fullAddressLines({
        line1: inv.customer_address_line1,
        line2: inv.customer_address_line2,
        city: inv.customer_city,
        postal: inv.customer_postal_code,
        country: inv.customer_country,
      })
    : [];
  const billAddrHtml = addrLines.map(l => `${escapeHtml(l)}<br/>`).join('') || '—';

  const metaRows: string[] = [
    `<tr><td>Invoice Date</td><td>${inv ? formatInvoiceDate(inv.created_at) : '—'}</td></tr>`,
    `<tr><td>Invoice No.</td><td>${inv ? escapeHtml(inv.invoice_no) : '—'}</td></tr>`,
    `<tr><td>Payment Terms</td><td>${escapeHtml(co.paymentTerms || '—')}</td></tr>`,
    `<tr><td>Country of Origin</td><td>${escapeHtml(co.countryOfOrigin || '—')}</td></tr>`,
    `<tr><td>Currency</td><td>${escapeHtml(co.currencyLabel || currencyCode)}</td></tr>`,
  ];
  if (inv && (inv.paid != null || inv.status)) {
    metaRows.push(`<tr><td>Status</td><td>${escapeHtml(inv.status || '—')}</td></tr>`);
    metaRows.push(`<tr><td>Paid</td><td>${escapeHtml(formatMoney(invPaid, currencyCode))}</td></tr>`);
    metaRows.push(`<tr><td>Balance</td><td>${escapeHtml(formatMoney(invBalance, currencyCode))}</td></tr>`);
  }

  const discountRow =
    disc > 0 ?
      `<div class="totals-row"><span class="tkey">Discount</span><span class="tval">− ${escapeHtml(formatMoney(disc, currencyCode))}</span></div>` :
      '';

  const grandVal = inv ?
    `${escapeHtml(currencyCode)} ${escapeHtml(formatMoneyAmountOnly(invTotal, currencyCode))}` :
    '—';

  return `<div id="${tabId}" class="doc invoice-receipt-doc ${docClass}">
  <div class="doc-header">
    <div class="header-logo-box">
      <img class="header-logo-img" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(co.name)}" onerror="${escapeHtmlAttr(logoOnErrorJs)}"/>
            </div>
    <div class="header-center">
      <div class="company-name">${escapeHtml(co.name)}</div>
      <div class="company-tagline">${escapeHtml(co.tagline)}</div>
          </div>
    <div class="doc-type-badge">
      <div class="doc-type-text">INVOICE</div>
      <div class="doc-number">No. ${inv ? escapeHtml(inv.invoice_no) : '—'}</div>
          </div>
        </div>
  <div class="addr-strip">
    <div class="addr-item"><span aria-hidden="true">📍</span><span>${escapeHtml(addrLine || '—')}</span></div>
    <div class="addr-item"><span aria-hidden="true">📞</span><span>${escapeHtml(co.phone || '—')}</span></div>
    <div class="addr-item"><span aria-hidden="true">✉️</span><span>${escapeHtml(co.email || '—')}</span></div>
          </div>
  <div class="doc-body">
    <div class="meta-row">
      <div class="bill-to-box">
        <div class="bill-to-lbl">Bill To</div>
        <div class="bill-to-name">${escapeHtml(custName || '—')}</div>
        ${inv?.customer_email?.trim() ? `<div class="bill-to-company">${escapeHtml(inv.customer_email.trim())}</div>` : ''}
        <div class="bill-to-addr">${billAddrHtml}</div>
        ${inv?.customer_phone?.trim() ? `<div class="bill-to-addr">Tel: ${escapeHtml(inv.customer_phone.trim())}</div>` : ''}
            </div>
      <div class="doc-meta">
        <table class="meta-table">${metaRows.join('')}</table>
          </div>
        </div>
    <div class="divider" aria-hidden="true"></div>
    <table class="items-table">
            <thead>
              <tr>
          <th class="center">#</th>
                <th>Description</th>
          <th class="center">Pcs</th>
          <th class="center">Weight (cts)</th>
          <th>Price / ct</th>
          <th>Line disc.</th>
          <th>Total</th>
              </tr>
            </thead>
      <tbody>${buildInvoiceTableRows(inv, currencyCode)}</tbody>
          </table>
    <div class="totals-section">
      <div class="totals-box">
        <div class="totals-row"><span class="tkey">Subtotal</span><span class="tval">${inv ? escapeHtml(formatMoney(sub, currencyCode)) : '—'}</span></div>
        ${discountRow}
        <div class="grand-total-row">
          <div class="grand-total-key">Grand Total</div>
          <div class="grand-total-val">${grandVal}</div>
        </div>
        </div>
        </div>
    <div class="notes-box">
      <div class="notes-title">Notes &amp; Conditions</div>
      <div class="notes-body">${escapeHtml(co.notesConditions)}</div>
      </div>
    <div class="sig-row">
      <div class="sig-box">
        <div class="sig-pretitle">Authorized Signature</div>
        <div class="sig-line"></div>
        <div class="sig-subtitle">${escapeHtml(co.name.replace(/\.$/, ''))}</div>
            </div>
      <div class="sig-box">
        <div class="sig-pretitle">Customer Signature</div>
        <div class="sig-line"></div>
        <div class="sig-subtitle">Received &amp; Accepted</div>
          </div>
          </div>
        </div>
  <footer class="doc-footer">
    <div class="footer-text">Marks &amp; Numbers: ${escapeHtml(co.marksAndNumbers)} | Country of Origin: ${escapeHtml(co.countryOfOrigin)}</div>
    <div class="footer-brand">${escapeHtml(co.name)}</div>
  </footer>
</div>`;
}

/** Per-line amounts for remaining pcs (memo stores gross `unit_price`, net `line_total` for full qty). */
export function memoReceiptLineRemainingAmounts(row: ReceiptMemoLine): {
  remaining: number;
  lineGrossRem: number;
  lineDiscRem: number;
  lineNetRem: number;
} {
  const remaining = Math.max(0, (row.quantity || 0) - (row.returned_qty || 0));
  const q = Math.max(1, Math.floor(Number(row.quantity) || 1));
  const grossPc = Number(row.unit_price || 0);
  const lineNetFull = roundMoney2(Number(row.line_total) || 0);
  const lineGrossFull = roundMoney2(grossPc * q);
  const lineGrossRem = q > 0 ? roundMoney2((lineGrossFull * remaining) / q) : 0;
  const lineNetRem = q > 0 ? roundMoney2((lineNetFull * remaining) / q) : 0;
  const lineDiscRem = Math.max(0, roundMoney2(lineGrossRem - lineNetRem));
  return { remaining, lineGrossRem, lineDiscRem, lineNetRem };
}

function memoReceiptRollupTotals(me: ReceiptMemoPayload | null): {
  subtotalGross: number;
  discount: number;
  net: number;
} {
  if (!me?.items?.length) return { subtotalGross: 0, discount: 0, net: 0 };
  let subtotalGross = 0;
  let discount = 0;
  for (const row of me.items) {
    const a = memoReceiptLineRemainingAmounts(row);
    subtotalGross += a.lineGrossRem;
    discount += a.lineDiscRem;
  }
  return {
    subtotalGross: roundMoney2(subtotalGross),
    discount: roundMoney2(discount),
    net: roundMoney2(subtotalGross - discount),
  };
}

function buildMemoTableRows(me: ReceiptMemoPayload | null, currencyCode: string): string {
  if (!me?.items?.length) {
    return `<tr class="items-empty"><td colspan="7">No line items.</td></tr>`;
  }
  return me.items
    .map((row, i) => {
      const { remaining, lineGrossRem, lineDiscRem, lineNetRem } = memoReceiptLineRemainingAmounts(row);
      const descFull = row.description || `${row.item_code || ''}`.trim() || '—';
      const parts = splitDescriptionForTable(descFull);
      const ct = row.weight_carats;
      const wt =
        ct != null && Number.isFinite(Number(ct)) ?
          escapeHtml(String(Number(ct))) :
          row.weight_grams != null && Number.isFinite(Number(row.weight_grams)) ?
            escapeHtml(`${Number(row.weight_grams)} g`) :
            '—';
      const idx = String(i + 1).padStart(2, '0');
      const codeMono = (row.item_code || '').trim();
      const subExtra = codeMono ? `${parts.sub ? `${parts.sub} · ` : ''}Code: ${codeMono}` : parts.sub;
      const discCol =
        lineDiscRem > 0.0001 ? `− ${formatMoney(lineDiscRem, currencyCode)}` : '—';
      return `<tr>
        <td class="center td-mono">${escapeHtml(idx)}</td>
        <td>
          <div class="td-gem-wrap">
            <span class="td-gem-dot" aria-hidden="true"></span>
            <div>
              <div class="td-gem-name">${escapeHtml(parts.title)}</div>
              ${subExtra ? `<div class="td-gem-sub">${escapeHtml(subExtra)}</div>` : ''}
            </div>
          </div>
        </td>
        <td class="center">${escapeHtml(String(remaining))}</td>
        <td class="center">${wt}</td>
        <td class="td-price">${escapeHtml(formatMoney(lineGrossRem, currencyCode))}</td>
        <td class="td-discount">${escapeHtml(discCol)}</td>
        <td class="td-total">${escapeHtml(formatMoney(lineNetRem, currencyCode))}</td>
      </tr>`;
    })
    .join('');
}

function memoTotalsSummary(me: ReceiptMemoPayload | null): { pieces: number; carats: number | null } {
  if (!me?.items?.length) return { pieces: 0, carats: null };
  let pieces = 0;
  let carats = 0;
  let hasCt = false;
  for (const row of me.items) {
    const remaining = Math.max(0, (row.quantity || 0) - (row.returned_qty || 0));
    pieces += remaining;
    const ct = row.weight_carats;
    const q = Math.max(1, row.quantity || 1);
    if (ct != null && Number.isFinite(Number(ct)) && remaining > 0) {
      hasCt = true;
      carats += (Number(ct) * remaining) / q;
    }
  }
  return { pieces, carats: hasCt ? carats : null };
}

/** Fixed legal text for memo receipts; company name from settings. */
function buildMemoTermsConditionsHtml(co: CompanyReceiptSettings): string {
  const company = escapeHtml(co.name.trim() || 'Blue Cuts Co., Ltd.');
  const items: string[] = [
    `<div class="term-item"><div class="term-num">1</div><div class="term-text"><p>The goods described above are delivered solely for inspection purposes. <strong>This document does not constitute a sale.</strong></p></div></div>`,
    `<div class="term-item"><div class="term-num">2</div><div class="term-text"><p>Title to and ownership of the Goods shall at all times remain with <strong>${company}</strong>. The Goods shall not be considered the property of the Recipient under any circumstances unless expressly agreed in writing.</p></div></div>`,
    `<div class="term-item"><div class="term-num">3</div><div class="term-text"><p>The Recipient shall have no right, power, or authority to sell, transfer, pledge, assign, encumber, or otherwise dispose of the Goods, in whole or in part, without the prior written consent of <strong>${company}</strong>.</p></div></div>`,
    `<div class="term-item"><div class="term-num">4</div><div class="term-text"><p>The Recipient shall not represent or imply that the Goods belong to them. The Recipient must clearly inform all customers and third parties that the Goods remain the property of <strong>${company}</strong>.</p></div></div>`,
    `<div class="term-item"><div class="term-num">5</div><div class="term-text"><p>A sale shall only be valid if:</p><ul class="term-sublist"><li><strong>(a)</strong> an official invoice is issued by <strong>${company}</strong>; and</li><li><strong>(b)</strong> full payment has been received and cleared.</li></ul><p>This document shall not be considered an invoice or proof of sale.</p></div></div>`,
    `<div class="term-item"><div class="term-num">6</div><div class="term-text"><p>The Recipient shall return the Goods:</p><ul class="term-sublist"><li><strong>(a)</strong> immediately upon demand by <strong>${company}</strong>; or</li><li><strong>(b)</strong> upon expiration of the inspection period,</li></ul><p>whichever occurs first.<br/>All Goods must be returned in their original condition, without damage, alteration, or substitution.</p></div></div>`,
    `<div class="term-item"><div class="term-num">7</div><div class="term-text"><p>The Recipient assumes full responsibility for all risks of loss, theft, or damage to the Goods from the time of receipt until they are returned and accepted by <strong>${company}</strong>.</p></div></div>`,
    `<div class="term-item"><div class="term-num">8</div><div class="term-text"><p>The Recipient shall be fully liable for any loss or damage to the Goods and shall compensate <strong>${company}</strong> for the full value of such Goods.</p></div></div>`,
    `<div class="term-item"><div class="term-num">9</div><div class="term-text"><p>Any discrepancies must be reported in writing within <strong>three (3) days</strong> from the date of receipt. Failing this, the Goods and all Terms and Conditions shall be deemed accepted.</p></div></div>`,
    `<div class="term-item"><div class="term-num">10</div><div class="term-text"><p>This agreement shall be governed by and construed in accordance with the laws of the <strong>Kingdom of Thailand</strong>.</p></div></div>`,
  ];
  return items.join('');
}

function buildMemoDoc(
  co: CompanyReceiptSettings,
  me: ReceiptMemoPayload | null,
  currencyCode: string,
  tabId: 'tab-sale' | 'tab-memo',
  docClass: string,
  logoSrc: string,
  logoOnErrorJs: string
): string {
  const addrLine = [co.addressLine1, co.addressLine2, co.city].filter(x => x?.trim()).join(' ');
  const custName = me?.customer_name?.trim() || '—';
  const addrLines = me
    ? fullAddressLines({
        line1: me.customer_address_line1,
        line2: me.customer_address_line2,
                    city: me.customer_city,
        postal: me.customer_postal_code,
                    country: me.customer_country,
                  })
    : [];
  const billAddrHtml = addrLines.map(l => `${escapeHtml(l)}<br/>`).join('') || '—';

  const memoDateDisp = me ? formatInvoiceDate(me.memo_date) : '—';
  const dueDisp =
    me?.due_date ? formatInvoiceDate(me.due_date) : '—';
  const durationDisp = me ? memoDurationDaysLabel(me.memo_date, me.due_date) : '—';

  const metaRows: string[] = [
    `<tr><td>Memo Date</td><td>${memoDateDisp}</td></tr>`,
    `<tr><td>Memo No.</td><td>${me ? escapeHtml(me.memo_no) : '—'}</td></tr>`,
    `<tr><td>Return Deadline</td><td${me?.due_date ? ' class="meta-due-highlight"' : ''}>${dueDisp}</td></tr>`,
    `<tr><td>Duration</td><td>${escapeHtml(durationDisp)}</td></tr>`,
    `<tr><td>Country of Origin</td><td>${escapeHtml(co.countryOfOrigin || '—')}</td></tr>`,
    `<tr><td>Memo Terms</td><td>${escapeHtml((co.memoTermsLine ?? getDefaultCompanySettings().memoTermsLine) || 'On Approval')}</td></tr>`,
    `<tr><td>Currency</td><td>${escapeHtml(co.currencyLabel || currencyCode)}</td></tr>`,
  ];

  const totals = memoTotalsSummary(me);
  const piecesLabel =
    totals.pieces <= 0 ? '—' : totals.pieces === 1 ? '1 Stone' : `${totals.pieces} Stones`;
  const wtLabel =
    totals.carats != null ? `${totals.carats.toFixed(2)} cts` : '—';

  const rollup = memoReceiptRollupTotals(me);
  const declaredTotal = rollup.net;
  const subtotalDisplay = `${escapeHtml(currencyCode)} ${escapeHtml(formatMoneyAmountOnly(rollup.subtotalGross, currencyCode))}`;
  const discountDisplay =
    rollup.discount > 0.0001 ?
      `− ${escapeHtml(currencyCode)} ${escapeHtml(formatMoneyAmountOnly(rollup.discount, currencyCode))}` :
      `—`;
  const declaredValueDisplay = `${escapeHtml(currencyCode)} ${escapeHtml(formatMoneyAmountOnly(declaredTotal, currencyCode))}`;

  const notesExtra =
    me?.notes?.trim() ?
      `<div class="notes-box" style="margin-top:12px"><div class="notes-title">Memo notes</div><div class="notes-body">${escapeHtml(me.notes.trim())}</div></div>` :
      '';

  const issuerShort = escapeHtml(co.name.replace(/\.$/, ''));
  const recipientLine =
    custName !== '—' ? `Received By — ${escapeHtml(custName)}` : 'Received By —';

  return `<div id="${tabId}" class="doc memo-receipt-doc ${docClass}">
  <div class="doc-header">
    <div class="header-logo-box">
      <img class="header-logo-img" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(co.name)}" onerror="${escapeHtmlAttr(logoOnErrorJs)}"/>
          </div>
    <div class="header-center">
      <div class="company-name">${escapeHtml(co.name)}</div>
      <div class="company-tagline">${escapeHtml(co.tagline)}</div>
          </div>
    <div class="doc-type-badge">
      <div class="doc-type-text">MEMORANDUM</div>
      <div class="doc-number">No. ${me ? escapeHtml(me.memo_no) : '—'}</div>
        </div>
  </div>
  <div class="addr-strip">
    <div class="addr-item"><span aria-hidden="true">📍</span><span>${escapeHtml(addrLine || '—')}</span></div>
    <div class="addr-item"><span aria-hidden="true">📞</span><span>${escapeHtml(co.phone || '—')}</span></div>
    <div class="addr-item"><span aria-hidden="true">✉️</span><span>${escapeHtml(co.email || '—')}</span></div>
  </div>
  <div class="doc-body">
    <div class="meta-row">
      <div class="bill-to-box">
        <div class="bill-to-lbl">Issued To</div>
        <div class="bill-to-name">${escapeHtml(custName)}</div>
        ${me?.customer_email?.trim() ? `<div class="bill-to-company">${escapeHtml(me.customer_email.trim())}</div>` : ''}
        <div class="bill-to-addr">${billAddrHtml}</div>
        ${me?.customer_phone?.trim() ? `<div class="bill-to-addr">Tel: ${escapeHtml(me.customer_phone.trim())}</div>` : ''}
      </div>
      <div class="doc-meta">
        <table class="meta-table">${metaRows.join('')}</table>
      </div>
    </div>
    <div class="divider" aria-hidden="true"></div>
    <table class="items-table">
            <thead>
              <tr>
          <th class="center">#</th>
          <th>Gemstone description</th>
          <th class="center">Pcs</th>
          <th class="center">Weight (cts)</th>
          <th class="right">Subtotal</th>
          <th class="right">Discount</th>
          <th class="right">Declared value</th>
              </tr>
            </thead>
      <tbody>${buildMemoTableRows(me, currencyCode)}</tbody>
          </table>
    <div class="totals-section">
      <div class="totals-box">
        <div class="totals-row"><span class="tkey">Total pieces</span><span class="tval">${escapeHtml(piecesLabel)}</span></div>
        <div class="totals-row"><span class="tkey">Total weight</span><span class="tval">${escapeHtml(wtLabel)}</span></div>
        <div class="totals-row"><span class="tkey">Subtotal</span><span class="tval">${subtotalDisplay}</span></div>
        <div class="totals-row"><span class="tkey">Discounts</span><span class="tval memo-totals-disc">${discountDisplay}</span></div>
        <div class="grand-total-row memo-declared-grand-row">
          <div class="grand-total-key">Total declared value</div>
          <div class="grand-total-val">${declaredValueDisplay}</div>
          </div>
        </div>
        </div>
    ${notesExtra}
    <div class="terms-section">
      <div class="terms-header"><div class="terms-header-text">Terms &amp; Conditions of Memo</div></div>
      <div class="terms-body">${buildMemoTermsConditionsHtml(co)}</div>
      </div>
    <div class="sig-row">
      <div class="sig-box">
        <div class="sig-pretitle">Issued By — ${issuerShort}</div>
        <div class="sig-line"></div>
        <div class="sig-subtitle">Authorized Representative &amp; Date</div>
    </div>
      <div class="sig-box">
        <div class="sig-pretitle">${recipientLine}</div>
        <div class="sig-line"></div>
        <div class="sig-subtitle">Signature, Name &amp; Date of Receipt</div>
      </div>
    </div>
  </div>
  <footer class="doc-footer">
    <div class="footer-text">Marks &amp; Numbers: ${escapeHtml(co.marksAndNumbers)} | Country of Origin: ${escapeHtml(co.countryOfOrigin)}</div>
    <div class="footer-brand">${escapeHtml(co.name)}</div>
  </footer>
</div>`;
}

export function buildInvoiceMemoReceiptHtml(
  company: CompanyReceiptSettings,
  initialTab: 'invoice' | 'memo',
  invoice: ReceiptInvoicePayload | null,
  memo: ReceiptMemoPayload | null,
  logoSrc?: string,
  watermarkSrc?: string
): string {
  const docCurrencyCode = normalizeCurrencyCode(
    invoice?.currency_code || memo?.currency_code || company.currencyCode
  );
  const companyForDoc: CompanyReceiptSettings = {
    ...company,
    currencyCode: docCurrencyCode,
    currencyLabel: currencyReceiptLabel(docCurrencyCode),
  };
  const currencyCode = companyForDoc.currencyCode;
  const hasInvoice = invoice != null;
  const hasMemo = memo != null;
  const showTabs = hasInvoice && hasMemo;

  const invHidden = showTabs && initialTab === 'memo';
  const memHidden = showTabs && initialTab === 'invoice';

  const invClass = invHidden ? 'is-hidden' : '';
  const memClass = memHidden ? 'is-hidden' : '';

  const resolvedLogo = logoSrc ?? receiptLogoSrcForHtml();
  const resolvedLogoOnErrorJs = receiptLogoOnErrorJs();
  const resolvedWatermark = watermarkSrc ?? resolveReceiptWatermarkUrl();
  const watermarkCss =
    resolvedWatermark ?
      `background-image:url(${JSON.stringify(resolvedWatermark)})` :
      '';
  const watermarkAttr = watermarkCss ? ` style="${escapeHtmlAttr(watermarkCss)}"` : '';

  const invoiceDoc = buildInvoiceDoc(companyForDoc, invoice, currencyCode, 'tab-sale', invClass, resolvedLogo, resolvedLogoOnErrorJs);
  const memoDoc = buildMemoDoc(companyForDoc, memo, currencyCode, 'tab-memo', memClass, resolvedLogo, resolvedLogoOnErrorJs);

  const tabsHtml = showTabs
    ? `<div class="tab-bar" role="tablist">
      <button type="button" class="tab-btn${initialTab === 'invoice' ? ' active' : ''}" id="btn-sale" onclick="showTab('sale')">🧾 Sale Invoice</button>
      <button type="button" class="tab-btn${initialTab === 'memo' ? ' active' : ''}" id="btn-memo" onclick="showTab('memo')">📋 Memo Agreement</button>
    </div>`
    : '';

  const title =
    initialTab === 'invoice' || !hasMemo ?
      escapeHtml(invoice?.invoice_no || 'Invoice') :
      escapeHtml(memo?.memo_no || 'Memo');

  const innerDocs = `${hasInvoice ? invoiceDoc : ''}${hasMemo ? memoDoc : ''}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Blue Cuts Co., Ltd. — ${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet"/>
  <style>${RECEIPT_STYLES}</style>
</head>
<body>
  <div class="app-header">
    <h1>Blue Cuts Co., Ltd. — Document Preview</h1>
    <p>${showTabs ? 'Switch between Invoice and Memo · Print or Save as PDF' : 'Print or Save as PDF'}</p>
  </div>
  ${tabsHtml}
  <button type="button" class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
  <div class="doc-wrap">
    ${watermarkCss ? `<div class="doc-watermark" aria-hidden="true"${watermarkAttr}></div>` : ''}
    ${innerDocs}
  </div>
  <script>
    function scrollMemoTermsIntoView() {
      var memo = document.getElementById('tab-memo');
      if (memo && memo.classList.contains('is-hidden')) return;
      var el = document.querySelector('.memo-receipt-doc .terms-section');
      if (!el) return;
      setTimeout(function() {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, 200);
    }
    function showTab(which) {
      var sale = document.getElementById('tab-sale');
      var memo = document.getElementById('tab-memo');
      var b1 = document.getElementById('btn-sale');
      var b2 = document.getElementById('btn-memo');
      if (!sale || !memo) return;
      sale.classList.toggle('is-hidden', which !== 'sale');
      memo.classList.toggle('is-hidden', which !== 'memo');
      if (b1) { b1.classList.toggle('active', which === 'sale'); }
      if (b2) { b2.classList.toggle('active', which === 'memo'); }
      if (which === 'memo') scrollMemoTermsIntoView();
    }
    window.addEventListener('load', function() {
      var memo = document.getElementById('tab-memo');
      if (!memo) return;
      if (!document.getElementById('tab-sale') || !memo.classList.contains('is-hidden')) {
        scrollMemoTermsIntoView();
      }
    });
  </script>
</body>
</html>`;
}

export function openInvoiceReceiptWindow(payload: ReceiptInvoicePayload): void {
  const html = buildInvoiceMemoReceiptHtml(loadCompanyReceiptSettings(), 'invoice', payload, null);
  const w = window.open('', '_blank', 'width=840,height=1180');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}

export function openMemoReceiptWindow(payload: ReceiptMemoPayload): void {
  const html = buildInvoiceMemoReceiptHtml(loadCompanyReceiptSettings(), 'memo', null, payload);
  const w = window.open('', '_blank', 'width=840,height=1180');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}

export function mapApiInvoiceToReceipt(inv: {
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
  currency_code?: string | null;
  items: ReceiptInvoiceLine[];
  payments?: { method: string; amount: number; created_at: string }[];
}): ReceiptInvoicePayload {
  return {
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
    items: inv.items,
    payments: inv.payments,
  };
}
