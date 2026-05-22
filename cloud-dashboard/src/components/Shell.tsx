import { useRef } from 'react';
import type { PageId } from '../App';

const GemLogo = () => (
  <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <polygon points="16,4 28,12 28,20 16,28 4,20 4,12" fill="#C9A96E" opacity=".9"/>
    <polygon points="16,4 28,12 16,16" fill="#E2C896" opacity=".9"/>
    <polygon points="4,12 16,16 16,28" fill="#A87C45" opacity=".85"/>
    <polygon points="28,12 28,20 16,16" fill="#B8914E" opacity=".8"/>
    <polygon points="16,16 28,20 16,28" fill="#C9A96E" opacity=".75"/>
  </svg>
);

const tabs: { id: PageId; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'M3,3h7a1,1,0,0,1,1,1v6a1,1,0,0,1-1,1H3a1,1,0,0,1-1-1V4A1,1,0,0,1,3,3Z M14,3h7a1,1,0,0,1,1,1v6a1,1,0,0,1-1,1H14a1,1,0,0,1-1-1V4A1,1,0,0,1,14,3Z M3,14h7a1,1,0,0,1,1,1v6a1,1,0,0,1-1,1H3a1,1,0,0,1-1-1V15A1,1,0,0,1,3,14Z M14,14h7a1,1,0,0,1,1,1v6a1,1,0,0,1-1,1H14a1,1,0,0,1-1-1V15A1,1,0,0,1,14,14Z' },
  { id: 'inventory', label: 'Inventory', icon: 'M12,2 L22,8.5 L22,15.5 L12,22 L2,15.5 L2,8.5Z M12,2 L12,22 M2,8.5 L22,8.5 M2,15.5 L22,15.5' },
  { id: 'reports', label: 'Reports', icon: 'M18,20 L18,10 M12,20 L12,4 M6,20 L6,14' },
  { id: 'monthly', label: 'Monthly', icon: 'M3,6 h18 a2,2,0,0,1,2,2 v12 a2,2,0,0,1,-2,2 H3 a2,2,0,0,1,-2,-2 V8 A2,2,0,0,1,3,6Z M16,2 L16,6 M8,2 L8,6 M3,10 L21,10' },
];

function relTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Props {
  page: PageId;
  onChangePage: (p: PageId) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onLogout: () => void;
  syncedAt?: string;
  children: React.ReactNode;
}

export function Shell({ page, onChangePage, theme, onToggleTheme, onLogout, syncedAt, children }: Props) {
  const contentRef = useRef<HTMLElement>(null);

  const scrollMainToTop = () => {
    const el = contentRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="hd-gem"><GemLogo /></div>
        <div className="hd-titles">
          <div className="hd-shop">Blue Cuts</div>
          <div className="hd-sync">
            <span className="hd-sync-dot" />
            {syncedAt ? `Synced ${relTime(syncedAt)}` : 'Synced'}
          </div>
        </div>
        <button className="hd-btn" onClick={onLogout} title="Sign out" aria-label="Sign out">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5-5-5m5 5H9"/>
          </svg>
        </button>
        <button className="hd-btn" onClick={onToggleTheme} title={theme === 'light' ? 'Dark mode' : 'Light mode'} aria-label="Toggle theme">
          {theme === 'light' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          )}
        </button>
      </header>

      <main ref={contentRef} className="shell-content">{children}</main>

      <nav className="shell-tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`tab-btn${page === t.id ? ' active' : ''}`}
            type="button"
            onClick={() => {
              onChangePage(t.id);
              requestAnimationFrame(() => scrollMainToTop());
            }}
          >
            <div className="tab-ico">
              <svg viewBox="0 0 24 24">
                <path d={t.icon} />
              </svg>
            </div>
            <div className="tab-lbl">{t.label}</div>
            <div className="tab-pip" />
          </button>
        ))}
      </nav>
    </div>
  );
}
