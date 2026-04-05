import React from 'react';
import { staffCanAccessPage } from '../../lib/pagePermissions';

const IconMenu: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

const IconClose: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
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
  profile: NavIconProfile,
};

/** Pages shown in sidebar / header quick nav (checkout is reached from Payments). */
const TOPBAR_NAV_ORDER: { id: PageId; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'updateInventory', label: 'Update Inventory' },
  { id: 'checkInventory', label: 'Check Inventory' },
  { id: 'stockCount', label: 'Stock count' },
  { id: 'selling', label: 'Selling' },
  { id: 'payments', label: 'Payments' },
  { id: 'customers', label: 'Customers' },
  { id: 'memo', label: 'Memos' },
  { id: 'returns', label: 'Return & Restock' },
  { id: 'reports', label: 'Reports' },
];

/** `allowedPages` is staff’s server list; omit or pass null for owner (all pages). */
export function canAccessPage(
  role: UserRole,
  page: PageId,
  allowedPages?: string[] | null
): boolean {
  return staffCanAccessPage(role, page, allowedPages ?? null);
}

export function getTopbarNavItems(
  role: UserRole,
  allowedPages?: string[] | null
): { id: PageId; label: string }[] {
  return TOPBAR_NAV_ORDER.filter(item => canAccessPage(role, item.id, allowedPages));
}

const IconSidebarShow: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

const IconSidebarHide: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="15" y1="3" x2="15" y2="21" />
    <polyline points="8 8 5 12 8 16" />
    <line x1="5" y1="12" x2="15" y2="12" />
  </svg>
);

/* ----- Sidebar ----- */
interface SidebarProps {
  activePage: PageId;
  onChangePage: (page: PageId) => void;
  username: string;
  role: UserRole;
  /** Staff page access from server; ignored for owner (full access). */
  allowedPages: string[] | null | undefined;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onChangePage,
  username,
  role,
  allowedPages,
  collapsed,
  onToggleCollapsed,
}) => {
  const canSee = (page: PageId) => canAccessPage(role, page, allowedPages);

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
        { id: 'selling', label: 'Selling' },
        { id: 'payments', label: 'Payments' },
        { id: 'customers', label: 'Customers' },
        { id: 'memo', label: 'Memos' },
        { id: 'returns', label: 'Return & Restock' },
      ],
    },
    { title: 'Reports', items: [{ id: 'reports', label: 'Reports' }] },
  ];

  return (
    <aside
      className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}
      onDoubleClick={onToggleCollapsed}
      title={collapsed ? 'Double-click to expand' : 'Double-click to collapse'}
    >
      <div className="sidebar-header">
        <div className="logo-circle logo-circle--brand" aria-hidden="true">
          <img
            className="sidebar-brand-logo"
            src={`${process.env.PUBLIC_URL}/app-icon.png`}
            alt=""
          />
        </div>
        <div className="brand">
          <span className="brand-title">Blue Cuts</span>
        </div>
      </div>
      <nav className="nav" aria-label="Main navigation">
        {navSections.map(section => {
          const visible = section.items.filter(item => canSee(item.id));
          if (visible.length === 0) return null;
          return (
            <div key={section.title} className="nav-section">
              <div className="nav-section-title">
                <span className="nav-section-title-text">{section.title}</span>
              </div>
              {visible.map(item => {
                const Icon = navIcons[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`nav-item ${activePage === item.id ? 'active' : ''}`}
                    onClick={() => onChangePage(item.id)}
                    aria-current={activePage === item.id ? 'page' : undefined}
                    title={item.label}
                  >
                    <span className="nav-item-icon">{Icon && <Icon />}</span>
                    <span className="nav-item-label">{item.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="user-info">
          <span className="user-name">{username}</span>
          <span className="user-role">{role === 'owner' ? 'Shop Owner' : 'Staff'}</span>
        </div>
      </div>
    </aside>
  );
};

const IconUser: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

/* ----- Topbar ----- */
interface TopbarProps {
  page: PageId;
  role: UserRole;
  /** Staff page access from server; omit or null for owner (full nav). */
  allowedPages?: string[] | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sidebarHidden: boolean;
  onSidebarHiddenChange: (hidden: boolean) => void;
  onChangePage: (page: PageId) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenProfile: () => void;
}

export function Topbar(props: TopbarProps) {
  const {
    page,
    role,
    allowedPages = null,
    collapsed,
    onToggleCollapsed,
    sidebarHidden,
    onSidebarHiddenChange,
    onChangePage,
    theme,
    onToggleTheme,
    onOpenProfile,
  } = props;

  const pageTitleMap: Record<PageId, string> = {
    dashboard: 'Dashboard',
    updateInventory: 'Update Inventory',
    checkInventory: 'Check Inventory',
    stockCount: 'Stock count',
    selling: 'Selling',
    payments: 'Payments & Loans',
    invoiceCheckout: 'Invoice Checkout',
    customers: 'Customers',
    memo: 'Memos',
    returns: 'Return & Restock',
    reports: 'Reports & Analytics',
    profile: 'Profile',
  };

  const quickNavItems = getTopbarNavItems(role, allowedPages);
  const CurrentIcon = navIcons[page];

  return (
    <header className={`topbar${sidebarHidden ? ' topbar--sidebar-hidden' : ''}`}>
      <div className="topbar-inner">
        <div className="topbar-left-cluster">
          <div className="topbar-left">
            <button
              type="button"
              className="topbar-menu-btn"
              onClick={() => {
                if (sidebarHidden) onSidebarHiddenChange(false);
                else onToggleCollapsed();
              }}
              aria-label={
                sidebarHidden ? 'Show sidebar' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'
              }
              title={sidebarHidden ? 'Show sidebar' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarHidden ? (
                <IconSidebarShow className="topbar-menu-icon" />
              ) : collapsed ? (
                <IconClose className="topbar-menu-icon" />
              ) : (
                <IconMenu className="topbar-menu-icon" />
              )}
            </button>
            {!sidebarHidden && (
              <button
                type="button"
                className="topbar-menu-btn topbar-hide-sidebar-btn"
                onClick={() => onSidebarHiddenChange(true)}
                aria-label="Hide sidebar"
                title="Hide sidebar"
              >
                <IconSidebarHide className="topbar-menu-icon" />
              </button>
            )}
          </div>

          <div className={`topbar-title-group topbar-title-group--${page}`}>
            <span className={`topbar-page-icon topbar-page-icon--${page}`} aria-hidden="true">
              {CurrentIcon && <CurrentIcon />}
            </span>
            <h1 className="page-title" title={pageTitleMap[page]}>
              {pageTitleMap[page]}
            </h1>
          </div>

          {sidebarHidden && (
            <nav className="topbar-page-nav topbar-page-nav--inline" aria-label="Quick navigation">
              {quickNavItems.map(item => {
                const Icon = navIcons[item.id];
                const active = page === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-page={item.id}
                    className={`topbar-page-nav__btn topbar-page-nav__btn--${item.id}${active ? ' is-active' : ''}`}
                    onClick={() => onChangePage(item.id)}
                    aria-current={active ? 'page' : undefined}
                    title={item.label}
                  >
                    <span className="topbar-page-nav__icon" aria-hidden="true">
                      {Icon && <Icon />}
                    </span>
                  </button>
                );
              })}
            </nav>
          )}
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className={`topbar-icon-btn topbar-theme-btn topbar-theme-btn--${theme}`}
            onClick={onToggleTheme}
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            title={theme === 'light' ? 'Dark mode' : 'Light mode'}
          >
            <span className="topbar-theme-btn__glow" aria-hidden="true" />
            {theme === 'light' ? <IconMoon className="topbar-theme-icon" /> : <IconSun className="topbar-theme-icon" />}
          </button>
          <button
            type="button"
            className={`topbar-icon-btn topbar-profile-btn${page === 'profile' ? ' is-active' : ''}`}
            onClick={onOpenProfile}
            aria-label="Open profile"
            title="Profile"
          >
            <IconUser className="topbar-profile-icon" />
          </button>
        </div>
      </div>
    </header>
  );
}
