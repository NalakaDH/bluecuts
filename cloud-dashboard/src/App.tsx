import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { auth } from './firebase';
import { Shell } from './components/Shell';
import { DashboardPage } from './pages/DashboardPage';
import { InventoryPage } from './pages/InventoryPage';
import { ReportsPage } from './pages/ReportsPage';
import { MonthlyReportPage } from './pages/MonthlyReportPage';

export type PageId = 'dashboard' | 'inventory' | 'reports' | 'monthly';
type Theme = 'light' | 'dark';

const GemLogo = () => (
  <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <polygon points="16,4 28,12 28,20 16,28 4,20 4,12" fill="#C9A96E" opacity=".9"/>
    <polygon points="16,4 28,12 16,16" fill="#E2C896" opacity=".9"/>
    <polygon points="4,12 16,16 16,28" fill="#A87C45" opacity=".85"/>
    <polygon points="28,12 28,20 16,16" fill="#B8914E" opacity=".8"/>
    <polygon points="16,16 28,20 16,28" fill="#C9A96E" opacity=".75"/>
  </svg>
);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState<PageId>('dashboard');
  const [syncedAt, setSyncedAt] = useState<string | undefined>(undefined);
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('bc-theme') as Theme) || 'light'
  );

  useEffect(() => {
    return onAuthStateChanged(auth, u => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('bc-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await signInWithEmailAndPassword(auth, email, pw);
      setEmail('');
      setPw('');
    } catch (ex: any) {
      setErr(ex?.message || 'Sign-in failed');
    }
  };

  if (!authReady) {
    return <div className="app-loading" data-theme={theme}><div className="spinner" /></div>;
  }

  if (!user) {
    return (
      <div className="auth-screen" data-theme={theme}>
        <form className="auth-card" onSubmit={login}>
          <div className="auth-logo"><GemLogo /></div>
          <h1>Blue Cuts</h1>
          <p className="auth-sub">Sign in to view your dashboard</p>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            autoComplete="current-password"
            required
          />
          {err && <p className="auth-err">{err}</p>}
          <button type="submit" className="auth-btn">Sign in</button>
        </form>
      </div>
    );
  }

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <DashboardPage onSyncedAt={setSyncedAt} />;
      case 'inventory': return <InventoryPage />;
      case 'reports': return <ReportsPage />;
      case 'monthly': return <MonthlyReportPage />;
    }
  };

  return (
    <Shell
      page={page}
      onChangePage={setPage}
      theme={theme}
      onToggleTheme={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
      onLogout={() => void signOut(auth)}
      syncedAt={syncedAt}
    >
      {renderPage()}
    </Shell>
  );
}
