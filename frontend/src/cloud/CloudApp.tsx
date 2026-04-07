import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { Sidebar, Topbar, type PageId } from '../components/layout/Layout';
import {
  DashboardPage,
  CheckInventoryPage,
  ReportsPage,
  InventoryReportPage,
} from '../pages';
import { getFirebaseAuth } from './firebaseClient';

type ThemeMode = 'light' | 'dark';

export function CloudApp() {
  const auth = getFirebaseAuth();
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Use a non-empty token string so existing pages don't render "Loading..." gates.
  const cloudToken = 'firebase';

  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return localStorage.getItem('theme-mode') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const toggleTheme = () => {
    setTheme(prev => {
      const next: ThemeMode = prev === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem('theme-mode', next);
      } catch {
        // ignore
      }
      return next;
    });
  };

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

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, [auth]);

  const username = useMemo(() => user?.email || 'Owner', [user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await signInWithEmailAndPassword(auth, email, pw);
      setEmail('');
      setPw('');
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : 'Sign-in failed');
    }
  };

  if (!user) {
    return (
      <div className={`App theme-${theme}`}>
        <div className="auth-container">
          <div className="auth-card">
            <h1>Blue Cuts</h1>
            <p className="subtitle">Sign in to view reports</p>
            <form onSubmit={handleLogin} className="auth-form">
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              {err && <div className="error-text">{err}</div>}
              <button type="submit" className="primary-button">
                Log in
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const goToPage = (p: PageId) => setActivePage(p);

  // Restrict navigation to cloud dashboard pages only.
  const allowedPages = ['dashboard', 'checkInventory', 'reports', 'inventoryReport'];

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardPage token={cloudToken} onNavigate={goToPage} />;
      case 'checkInventory':
        return <CheckInventoryPage token={cloudToken} role="owner" onNavigate={goToPage} />;
      case 'reports':
        return <ReportsPage token={cloudToken} />;
      case 'inventoryReport':
        return <InventoryReportPage token={cloudToken} />;
      default:
        return <DashboardPage token={cloudToken} onNavigate={goToPage} />;
    }
  };

  return (
    <div className={`App theme-${theme}`}>
      <div className={`layout${sidebarHidden ? ' layout--sidebar-hidden' : ''}`}>
        {!sidebarHidden && (
          <Sidebar
            activePage={activePage}
            onChangePage={goToPage}
            username={username}
            // Use staff role + explicit allowed pages to limit nav to cloud pages.
            role="staff"
            allowedPages={allowedPages}
            staffNavAccessOptions={{ linkStockCountToCheckInventory: false }}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed(v => !v)}
          />
        )}
        <main className="main">
          <Topbar
            page={activePage}
            role="staff"
            allowedPages={allowedPages}
            staffNavAccessOptions={{ linkStockCountToCheckInventory: false }}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed(v => !v)}
            sidebarHidden={sidebarHidden}
            onSidebarHiddenChange={setSidebarHidden}
            onChangePage={goToPage}
            theme={theme}
            onToggleTheme={toggleTheme}
            onOpenProfile={() => void signOut(auth)}
          />
          <section className={`content${['checkInventory', 'inventoryReport'].includes(activePage) ? ' content--page-stretch' : ''}`}>
            {renderPage()}
          </section>
        </main>
      </div>
    </div>
  );
}

