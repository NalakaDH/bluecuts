import React, { useEffect, useState } from 'react';
import { staffCanAccessPage, type StaffNavAccessOptions } from '../../lib/pagePermissions';

/** Sidebar expanded: panel + divider line */
const IconSidebarCollapse: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

/** Sidebar collapsed: show expand chevron */
const IconSidebarExpand: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
    <polyline points="13 8 16 12 13 16" />
    <line x1="9" y1="12" x2="16" y2="12" />
  </svg>
);

const IconSun: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <line x1="12" y1="2" x2="12" y2="4" />
    <line x1="12" y1="20" x2="12" y2="22" />
    <line x1="2" y1="12" x2="4" y2="12" />
    <line x1="20" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
    <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
    <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
  </svg>
);

const IconMoon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
  </svg>
);

const IconSync: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10M1 14l5.36 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export type PageId =
  | 'dashboard'
  | 'updateInventory'
  | 'checkInventory'
  | 'stockCount'
  | 'selling'
  | 'payments'
  | 'invoiceCheckout'
  | 'customers'
  | 'memo'
  | 'returns'
  | 'reports'
  | 'inventoryReport'
  | 'profile';
type UserRole = 'owner' | 'staff';

const iconSize = 22;
const NavIconDashboard = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" />
  </svg>
);
const NavIconInventory = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
  </svg>
);
const NavIconCheckInventory = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
  </svg>
);
const NavIconSelling = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);
const NavIconPayments = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /><line x1="8" y1="15" x2="10" y2="15" />
  </svg>
);
const NavIconCustomers = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-3-3.87" /><path d="M7 15.13A4 4 0 0 0 4 19v2" /><circle cx="12" cy="7" r="4" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /><path d="M8 10.88a4 4 0 0 1 0-7.75" />
  </svg>
);
const NavIconMemo = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
  </svg>
);
const NavIconReturns = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
  </svg>
);
const NavIconReports = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);
const NavIconProfile = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const NavIconStockCount = () => (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
  </svg>
);

const navIcons: Record<PageId, React.FC> = {
  dashboard: NavIconDashboard,
  updateInventory: NavIconInventory,
  checkInventory: NavIconCheckInventory,
  stockCount: NavIconStockCount,
  selling: NavIconSelling,
  payments: NavIconPayments,
  invoiceCheckout: NavIconPayments,
  customers: NavIconCustomers,
  memo: NavIconMemo,
  returns: NavIconReturns,
  reports: NavIconReports,
  inventoryReport: NavIconReports,
  profile: NavIconProfile,
};

/** Pages shown in sidebar / header quick nav (checkout is reached from Payments). */
const TOPBAR_NAV_ORDER: { id: PageId; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'updateInventory', label: 'Update Inventory' },
  { id: 'checkInventory', label: 'Check Inventory' },
  { id: 'stockCount', label: 'Stock count' },
  { id: 'selling', label: 'Invoice' },
  { id: 'payments', label: 'Payments' },
  { id: 'customers', label: 'Customers' },
  { id: 'memo', label: 'Memos' },
  { id: 'returns', label: 'Return & Restock' },
  { id: 'reports', label: 'Reports' },
  { id: 'inventoryReport', label: 'Monthly inventory report' },
];

/** `allowedPages` is staff’s server list; omit or pass null for owner (all pages). */
export function canAccessPage(
  role: UserRole,
  page: PageId,
  allowedPages?: string[] | null,
  staffNavAccessOptions?: StaffNavAccessOptions | null
): boolean {
  return staffCanAccessPage(role, page, allowedPages ?? null, staffNavAccessOptions ?? undefined);
}

export function getTopbarNavItems(
  role: UserRole,
  allowedPages?: string[] | null,
  staffNavAccessOptions?: StaffNavAccessOptions | null
): { id: PageId; label: string }[] {
  return TOPBAR_NAV_ORDER.filter(item => canAccessPage(role, item.id, allowedPages, staffNavAccessOptions));
}

export type { StaffNavAccessOptions };

const IconSidebarHide: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="15" y1="3" x2="15" y2="21" />
    <polyline points="8 8 5 12 8 16" />
    <line x1="5" y1="12" x2="15" y2="12" />
  </svg>
);

const IconBrandGem: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
    <line x1="12" y1="22" x2="12" y2="15.5" />
    <polyline points="22 8.5 12 15.5 2 8.5" />
  </svg>
);

function usernameInitials(username: string): string {
  const t = username.trim();
  if (!t) return '?';
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0];
    const b = parts[parts.length - 1][0];
    return `${a}${b}`.toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    setMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return mobile;
}

export { useIsMobile };

/* ----- Sidebar ----- */
interface SidebarProps {
  activePage: PageId;
  onChangePage: (page: PageId) => void;
  username: string;
  role: UserRole;
  /** Staff page access from server; ignored for owner (full access). */
  allowedPages: string[] | null | undefined;
  staffNavAccessOptions?: StaffNavAccessOptions | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onChangePage,
  username,
  role,
  allowedPages,
  staffNavAccessOptions,
  collapsed,
  onToggleCollapsed,
  mobileOpen = false,
  onMobileClose,
}) => {
  const canSee = (page: PageId) => canAccessPage(role, page, allowedPages, staffNavAccessOptions);

  const navSections: { title: string; items: { id: PageId; label: string }[] }[] = [
    { title: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard' }] },
    {
      title: 'Inventory',
      items: [
        { id: 'updateInventory', label: 'Update Inventory' },
        { id: 'checkInventory', label: 'Check Inventory' },
        { id: 'stockCount', label: 'Stock count' },
      ],
    },
    {
      title: 'Sales',
      items: [
        { id: 'selling', label: 'Invoice' },
        { id: 'payments', label: 'Payments' },
        { id: 'customers', label: 'Customers' },
        { id: 'memo', label: 'Memos' },
        { id: 'returns', label: 'Return & Restock' },
      ],
    },
    {
      title: 'Reports',
      items: [
        { id: 'reports', label: 'Reports & Analytics' },
        { id: 'inventoryReport', label: 'Monthly inventory report' },
      ],
    },
  ];

  const initials = usernameInitials(username);

  const handleNavClick = (page: PageId) => {
    onChangePage(page);
    onMobileClose?.();
  };

  const sidebarEl = (
    <aside className={`sidebar ${collapsed && !mobileOpen ? 'sidebar--collapsed' : ''}${mobileOpen ? ' sidebar--mobile-open' : ''}`} aria-label="Main navigation">
      <button type="button" className="sidebar-brand" onClick={() => handleNavClick('dashboard')} title="Blue Cuts POS">
        <div className="brand-gem" aria-hidden="true">
          <IconBrandGem />
        </div>
        <span className="brand-name">Blue Cuts</span>
      </button>

      <nav className="sidebar-nav" aria-label="Sections">
        {navSections.map(section => {
          const visible = section.items.filter(item => canSee(item.id));
          if (visible.length === 0) return null;
          return (
            <div key={section.title} className="nav-section">
              <div className="nav-section-label">{section.title}</div>
              {visible.map(item => {
                const Icon = navIcons[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`nav-btn ${activePage === item.id ? 'active' : ''}`}
                    onClick={() => handleNavClick(item.id)}
                    aria-current={activePage === item.id ? 'page' : undefined}
                    title={item.label}
                  >
                    <span className="nav-icon">{Icon && <Icon />}</span>
                    <span className="nav-label">{item.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="user-chip">
          <div className="user-avatar" aria-hidden="true">
            {initials}
          </div>
          <div className="user-chip-info">
            <div className="user-chip-name">{username}</div>
            <div className="user-chip-role">{role === 'owner' ? 'Shop Owner' : 'Staff'}</div>
          </div>
        </div>
      </div>
    </aside>
  );

  if (mobileOpen) {
    return (
      <>
        <div className="sidebar-mobile-backdrop" onClick={onMobileClose} aria-hidden="true" />
        {sidebarEl}
      </>
    );
  }

  return sidebarEl;
};

/* ----- Topbar ----- */
interface TopbarProps {
  page: PageId;
  username: string;
  role: UserRole;
  /** Staff page access from server; omit or null for owner (full nav). */
  allowedPages?: string[] | null;
  staffNavAccessOptions?: StaffNavAccessOptions | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sidebarHidden: boolean;
  onSidebarHiddenChange: (hidden: boolean) => void;
  onChangePage: (page: PageId) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onSync?: () => void;
  syncLoading?: boolean;
  onOpenProfile: () => void;
  sellingView?: 'compose' | 'invoices';
  onOpenSellingInvoices?: () => void;
  onOpenSellingComposer?: () => void;
  memoView?: 'create' | 'open';
  onOpenMemoList?: () => void;
  onOpenMemoCreate?: () => void;
}

export function Topbar(props: TopbarProps) {
  const {
    page,
    username,
    role,
    allowedPages = null,
    staffNavAccessOptions,
    collapsed,
    onToggleCollapsed,
    sidebarHidden,
    onSidebarHiddenChange,
    onChangePage,
    theme,
    onToggleTheme,
    onSync,
    syncLoading = false,
    onOpenProfile,
    sellingView = 'compose',
    onOpenSellingInvoices,
    onOpenSellingComposer,
    memoView = 'create',
    onOpenMemoList,
    onOpenMemoCreate,
  } = props;

  const pageTitleMap: Record<PageId, string> = {
    dashboard: 'Dashboard',
    updateInventory: 'Update Inventory',
    checkInventory: 'Check Inventory',
    stockCount: 'Stock count',
    selling: 'Invoice',
    payments: 'Payments & Loans',
    invoiceCheckout: 'Invoice Checkout',
    customers: 'Customers',
    memo: 'Memos',
    returns: 'Return & Restock',
    reports: 'Reports & Analytics',
    inventoryReport: 'Monthly inventory report',
    profile: 'Profile',
  };

  const quickNavItems = getTopbarNavItems(role, allowedPages, staffNavAccessOptions);
  const CurrentIcon = navIcons[page];
  const profileInitials = usernameInitials(username);
  const sellingSubnav =
    page === 'selling' && onOpenSellingInvoices && onOpenSellingComposer ? (
      <div className="tb-subnav" role="tablist" aria-label="Invoice views">
        <button
          type="button"
          role="tab"
          className={`tb-subnav-btn${sellingView === 'compose' ? ' active' : ''}`}
          onClick={onOpenSellingComposer}
          aria-selected={sellingView === 'compose'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Create invoice
        </button>
        <button
          type="button"
          role="tab"
          className={`tb-subnav-btn${sellingView === 'invoices' ? ' active' : ''}`}
          onClick={onOpenSellingInvoices}
          aria-selected={sellingView === 'invoices'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
            <path d="M9 12h6M9 16h4" />
          </svg>
          Invoice list
        </button>
      </div>
    ) : null;

  const memoSubnav =
    page === 'memo' && onOpenMemoList && onOpenMemoCreate ? (
      <div className="tb-subnav" role="tablist" aria-label="Memo views">
        <button
          type="button"
          role="tab"
          className={`tb-subnav-btn${memoView === 'create' ? ' active' : ''}`}
          onClick={onOpenMemoCreate}
          aria-selected={memoView === 'create'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Create memo
        </button>
        <button
          type="button"
          role="tab"
          className={`tb-subnav-btn${memoView === 'open' ? ' active' : ''}`}
          onClick={onOpenMemoList}
          aria-selected={memoView === 'open'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
            <path d="M9 12h6M9 16h4" />
          </svg>
          Open memos
        </button>
      </div>
    ) : null;

  const activeSubnav = sellingSubnav ?? memoSubnav ?? null;

  return (
    <header className={`topbar${sidebarHidden ? ' topbar--sidebar-hidden' : ''}`}>
      <div className="tb-left">
        <button
          type="button"
          className="tb-icon-btn"
          onClick={() => {
            if (sidebarHidden) onSidebarHiddenChange(false);
            else onToggleCollapsed();
          }}
          aria-label={sidebarHidden ? 'Show sidebar' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={sidebarHidden ? 'Show sidebar' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarHidden || !collapsed ? (
            <IconSidebarCollapse className="tb-icon-btn-svg" />
          ) : (
            <IconSidebarExpand className="tb-icon-btn-svg" />
          )}
        </button>
        {!sidebarHidden ? (
          <button
            type="button"
            className="tb-icon-btn"
            onClick={() => onSidebarHiddenChange(true)}
            aria-label="Hide sidebar"
            title="Hide sidebar"
          >
            <IconSidebarHide className="tb-icon-btn-svg" />
          </button>
        ) : null}
      </div>

      <div className="tb-sep" aria-hidden="true" />

      <div className={`tb-page-id tb-page-id--${page}`}>
        <div className={`tb-page-icon tb-page-icon--${page}`} aria-hidden="true">
          {CurrentIcon ? <CurrentIcon /> : null}
        </div>
        <h1 className="tb-page-title">{pageTitleMap[page]}</h1>
      </div>

      <div className="tb-center" aria-hidden={sidebarHidden ? undefined : true}>
        {sidebarHidden ? (
          <nav className="tb-quicknav tb-quicknav--center" aria-label="Quick navigation">
            {quickNavItems.map(item => {
              const Icon = navIcons[item.id];
              const active = page === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-page={item.id}
                  className={`tb-qnav-btn tb-qnav-btn--${item.id}${active ? ' active' : ''}`}
                  onClick={() => onChangePage(item.id)}
                  aria-current={active ? 'page' : undefined}
                  title={item.label}
                >
                  {Icon ? <Icon /> : null}
                </button>
              );
            })}
          </nav>
        ) : null}
      </div>

      <div className="tb-right">
        {activeSubnav ? <div className="tb-right-subnav">{activeSubnav}</div> : null}
        {onSync ? (
          <button
            type="button"
            className="tb-sync-btn tb-icon-btn"
            onClick={onSync}
            aria-label="Sync now"
            title={syncLoading ? 'Syncing…' : 'Sync now'}
            disabled={syncLoading}
          >
            <IconSync className={`tb-sync-svg${syncLoading ? ' is-spinning' : ''}`} />
          </button>
        ) : null}
        <button
          type="button"
          className="tb-theme-btn tb-icon-btn"
          onClick={onToggleTheme}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          title={theme === 'light' ? 'Dark mode' : 'Light mode'}
        >
          {theme === 'light' ? <IconMoon className="tb-theme-svg" /> : <IconSun className="tb-theme-svg" />}
        </button>
        <button
          type="button"
          className={`tb-profile-btn${page === 'profile' ? ' active' : ''}`}
          onClick={onOpenProfile}
          aria-label="Open profile"
          title="Profile"
        >
          <div className="tb-profile-avatar" aria-hidden="true">
            {profileInitials}
          </div>
          <span className="tb-profile-name">{username}</span>
        </button>
      </div>
    </header>
  );
}
