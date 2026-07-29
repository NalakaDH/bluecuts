import React, { useCallback, useEffect, useState } from 'react';
import { useAlertDialog } from './components/AlertDialog';
import './App.css';
import { apiUrl, parseErrorResponse } from './api';
import { Sidebar, Topbar, useIsMobile, type PageId } from './components/layout/Layout';
import { CloudApp } from './cloud/CloudApp';
import { isCloudFirestoreMode } from './cloud/cloudMode';
import { firstAllowedStaffPage, normalizeStaffAllowedPagesFromApi, staffCanAccessPage } from './lib/pagePermissions';
import {
  DashboardPage,
  UpdateInventoryPage,
  CheckInventoryPage,
  StockCountPage,
  SellingPage,
  PaymentPage,
  InvoiceCheckoutPage,
  CustomersPage,
  MemoPage,
  ReturnsPage,
  ReportsPage,
  InventoryReportPage,
  ProfilePage,
} from './pages';

type UserRole = 'owner' | 'staff';

interface AuthState {
  token: string;
  role: UserRole;
  username: string;
  /** Staff only: pages from server; owner uses null (full access). */
  allowedPages: string[] | null;
}

type ThemeMode = 'light' | 'dark';
type SellingView = 'compose' | 'invoices';
type MemoView = 'create' | 'open';

const LocalApp: React.FC = () => {
  const { showAlert } = useAlertDialog();

  const [auth, setAuth] = useState<AuthState | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return localStorage.getItem('theme-mode') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try {
      return localStorage.getItem('sidebar-hidden') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('sidebar-hidden', sidebarHidden ? '1' : '0');
    } catch {
      // ignore
    }
  }, [sidebarHidden]);
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [sellingView, setSellingView] = useState<SellingView>('compose');
  const [memoView, setMemoView] = useState<MemoView>('create');
  const [headerSyncLoading, setHeaderSyncLoading] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const toggleTheme = () => {
    setTheme(prev => {
      const next: ThemeMode = prev === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem('theme-mode', next);
      } catch {
        // Ignore write failures (private mode / storage disabled)
      }
      return next;
    });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const message = await parseErrorResponse(res, 'Login failed');
        throw new Error(message);
      }
      const data = await res.json();
      const role = data.user.role as UserRole;
      const allowedRaw = data.user.allowed_pages;
      const allowedPages =
        role === 'owner'
          ? null
          : normalizeStaffAllowedPagesFromApi(Array.isArray(allowedRaw) ? allowedRaw.map(String) : null);
      setAuth({
        token: data.token,
        role,
        username: data.user.username,
        allowedPages,
      });
      const landing: PageId =
        role === 'owner' || staffCanAccessPage('staff', 'dashboard', allowedPages)
          ? 'dashboard'
          : (firstAllowedStaffPage(allowedPages) as PageId);
      setActivePage(landing);
      setUsername('');
      setPassword('');
      showAlert({
        title: 'Signed in',
        message: `Welcome back, ${data.user.username}.`,
        variant: 'success',
      });
    } catch (err: any) {
      const msg = err?.message || 'Login failed';
      setLoginError(msg);
      showAlert({ title: 'Sign in failed', message: msg, variant: 'error' });
    }
  };

  const handleLogout = () => {
    setAuth(null);
  };

  const goToPage = useCallback((page: PageId) => {
    setActivePage(page);
    if (page === 'selling') setSellingView('compose');
    if (page === 'memo') setMemoView('create');
  }, []);

  const handleAccountUpdated = useCallback(
    (patch: { username?: string; allowedPages?: string[] | null }) => {
      setAuth(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          ...(patch.username != null ? { username: patch.username } : {}),
          ...(patch.allowedPages !== undefined
            ? {
                allowedPages:
                  prev.role === 'owner'
                    ? null
                    : normalizeStaffAllowedPagesFromApi(patch.allowedPages ?? undefined),
              }
            : {}),
        };
      });
    },
    []
  );

  const syncCloudFromHeader = useCallback(async () => {
    if (!auth || auth.role !== 'owner' || headerSyncLoading) return;
    setHeaderSyncLoading(true);
    try {
      const res = await fetch(apiUrl('/api/cloud/sync-from-app'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Could not sync to cloud dashboard');
        throw new Error(msg);
      }
      await res.json();
      showAlert({
        title: 'Cloud dashboard',
        message: 'Snapshot was sent to the cloud dashboard.',
        variant: 'success',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Cloud sync failed';
      showAlert({ title: 'Cloud sync failed', message: msg, variant: 'error' });
    } finally {
      setHeaderSyncLoading(false);
    }
  }, [auth, headerSyncLoading, showAlert]);

  const renderMain = () => {
    if (!auth) {
      return (
        <div className="auth-container">
          <div className="auth-card">
            <img
              className="auth-logo"
              src={`${process.env.PUBLIC_URL}/app-icon.png`}
              alt=""
              width={88}
              height={88}
            />
            <h1>Blue Cuts</h1>
            <p className="subtitle">Sign in to continue</p>
            <form onSubmit={handleLogin} className="auth-form">
              <label>
                Username
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              {loginError && <div className="error-text">{loginError}</div>}
              <button type="submit" className="primary-button">
                Log in
              </button>
            </form>
          </div>
        </div>
      );
    }

    const staffAllowedForUi = auth.role === 'staff' ? auth.allowedPages : null;
    const fallbackStaffPage = firstAllowedStaffPage(staffAllowedForUi) as PageId;
    const effectivePage: PageId =
      auth.role === 'staff' && !staffCanAccessPage('staff', activePage, staffAllowedForUi)
        ? fallbackStaffPage
        : activePage;

    const contentStretch =
      effectivePage === 'updateInventory' ||
      effectivePage === 'checkInventory' ||
      effectivePage === 'stockCount' ||
      effectivePage === 'inventoryReport' ||
      effectivePage === 'selling';

    const renderPage = () => {
      switch (effectivePage) {
        case 'dashboard':
          return <DashboardPage token={auth.token} onNavigate={goToPage} />;
        case 'updateInventory':
          return <UpdateInventoryPage token={auth.token} role={auth.role} />;
        case 'checkInventory':
          return <CheckInventoryPage token={auth.token} role={auth.role} onNavigate={goToPage} />;
        case 'stockCount':
          return <StockCountPage token={auth.token} />;
        case 'selling':
          return (
            <SellingPage
              token={auth.token}
              onNavigate={goToPage}
              view={sellingView}
              onChangeView={setSellingView}
            />
          );
        case 'payments':
          return <PaymentPage token={auth.token} onNavigate={goToPage} />;
        case 'invoiceCheckout':
          return <InvoiceCheckoutPage token={auth.token} onNavigate={goToPage} />;
        case 'customers':
          return <CustomersPage token={auth.token} onNavigate={goToPage} />;
        case 'memo':
          return <MemoPage token={auth.token} onNavigate={goToPage} view={memoView} onChangeView={setMemoView} />;
        case 'returns':
          return <ReturnsPage token={auth.token} />;
        case 'reports':
          return <ReportsPage token={auth.token} />;
        case 'inventoryReport':
          return <InventoryReportPage token={auth.token} />;
        case 'profile':
          return (
            <ProfilePage
              token={auth.token}
              username={auth.username}
              role={auth.role}
              allowedPages={auth.allowedPages}
              onLogout={handleLogout}
              onAccountUpdated={handleAccountUpdated}
            />
          );
        default:
          return <DashboardPage />;
      }
    };

    const showSidebar = isMobile ? mobileSidebarOpen : !sidebarHidden;

    return (
      <div className={`layout${sidebarHidden && !isMobile ? ' layout--sidebar-hidden' : ''}${isMobile ? ' layout--mobile' : ''}`}>
        {showSidebar && (
          <Sidebar
            activePage={effectivePage}
            onChangePage={goToPage}
            username={auth.username}
            role={auth.role}
            allowedPages={staffAllowedForUi}
            collapsed={isMobile ? false : sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed(v => !v)}
            mobileOpen={isMobile && mobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
          />
        )}
        <main className="main">
          <Topbar
            page={effectivePage}
            username={auth.username}
            role={auth.role}
            allowedPages={staffAllowedForUi}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => {
              if (isMobile) setMobileSidebarOpen(v => !v);
              else setSidebarCollapsed(v => !v);
            }}
            sidebarHidden={isMobile || sidebarHidden}
            onSidebarHiddenChange={h => {
              if (isMobile) setMobileSidebarOpen(!h);
              else setSidebarHidden(h);
            }}
            onChangePage={goToPage}
            theme={theme}
            onToggleTheme={toggleTheme}
            onSync={auth.role === 'owner' ? () => void syncCloudFromHeader() : undefined}
            syncLoading={headerSyncLoading}
            onOpenProfile={() => goToPage('profile')}
            sellingView={sellingView}
            onOpenSellingInvoices={() => setSellingView('invoices')}
            onOpenSellingComposer={() => setSellingView('compose')}
            memoView={memoView}
            onOpenMemoList={() => setMemoView('open')}
            onOpenMemoCreate={() => setMemoView('create')}
          />
          <section className={`content${contentStretch ? ' content--page-stretch' : ''}`}>
            {renderPage()}
          </section>
        </main>
      </div>
    );
  };

  return <div className={`App theme-${theme}`}>{renderMain()}</div>;
};

const App: React.FC = () => {
  if (isCloudFirestoreMode()) return <CloudApp />;
  return <LocalApp />;
};

export default App;
