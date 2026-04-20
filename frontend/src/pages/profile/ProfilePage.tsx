import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAlertDialog } from '../../components/AlertDialog';
import { apiUrl, parseErrorResponse } from '../../api';
import { SUPPORTED_CURRENCIES, roundRate6 } from '../../lib/currencies';
import {
  ASSIGNABLE_STAFF_PAGE_IDS,
  ASSIGNABLE_STAFF_PAGE_LABELS,
  type StaffAssignablePageId,
  normalizeStaffAllowedPagesFromApi,
} from '../../lib/pagePermissions';

interface TeamUserRow {
  id: number;
  username: string;
  role: 'owner' | 'staff';
  allowed_pages: string[] | null;
}

export interface ProfilePageProps {
  token: string;
  username: string;
  role: 'owner' | 'staff';
  allowedPages: string[] | null;
  onLogout: () => void;
  onAccountUpdated: (patch: { username?: string; allowedPages?: string[] | null }) => void;
}

const authHeaders = (token: string) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

// ── Section icon tiles ────────────────────────────────────────────────────────
function IconSecurity() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function IconTeam() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconRates() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}
function IconBackup() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 9 20 20 4 20 4 9" /><path d="M9 22V12h6v10" /><path d="M3 9l9-7 9 7" />
    </svg>
  );
}
function IconCloud() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// ── Page access checkboxes ─────────────────────────────────────────────────────
function PageAccessCheckboxes({
  selected,
  onChange,
  disabled,
}: {
  selected: Set<StaffAssignablePageId>;
  onChange: (next: Set<StaffAssignablePageId>) => void;
  disabled?: boolean;
}) {
  const toggle = (id: StaffAssignablePageId) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="prf2-access-grid" role="group" aria-label="Page access">
      <p className="prf2-access-label">Page access</p>
      <div className="prf2-access-checks">
        {ASSIGNABLE_STAFF_PAGE_IDS.map(id => (
          <label key={id} className={`prf2-check-item${selected.has(id) ? ' prf2-check-item--on' : ''}${disabled ? ' prf2-check-item--disabled' : ''}`}>
            <input
              type="checkbox"
              checked={selected.has(id)}
              onChange={() => toggle(id)}
              disabled={disabled}
              className="prf2-check-input"
            />
            <span className="prf2-check-mark" aria-hidden="true">
              {selected.has(id) ? (
                <svg width={10} height={10} viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              ) : null}
            </span>
            <span className="prf2-check-label">{ASSIGNABLE_STAFF_PAGE_LABELS[id]}</span>
          </label>
        ))}
      </div>
      <p className="prf2-access-hint">
        Staff always have access to <strong>Profile</strong> (sign out). If <strong>Payments</strong> is on, they can open <strong>Invoice checkout</strong> from that flow.
      </p>
    </div>
  );
}

// ── Avatar initial tile ────────────────────────────────────────────────────────
function AvatarTile({ name, size = 'lg' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const palettes = [
    ['#4f46e5', '#818cf8'], ['#0d9488', '#34d399'], ['#d97706', '#fbbf24'],
    ['#e11d48', '#fb7185'], ['#0284c7', '#38bdf8'], ['#7c3aed', '#c4b5fd'],
  ];
  const idx = name.charCodeAt(0) % palettes.length;
  const [from, to] = palettes[idx];
  const initial = name.slice(0, 1).toUpperCase() || '?';
  return (
    <span
      className={`prf2-avatar prf2-avatar--${size}`}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

// ── Section card wrapper ───────────────────────────────────────────────────────
function SectionCard({
  icon,
  iconColor,
  kicker,
  title,
  description,
  children,
  className = '',
  id,
}: {
  icon: React.ReactNode;
  iconColor: string;
  kicker: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`prf2-card ${className}`} aria-labelledby={id}>
      <div className="prf2-card-head">
        <div className="prf2-card-icon" style={{ '--icon-color': iconColor } as React.CSSProperties}>
          {icon}
        </div>
        <div className="prf2-card-head-text">
          <span className="prf2-kicker" style={{ color: iconColor }}>{kicker}</span>
          <h3 className="prf2-card-title" id={id}>{title}</h3>
          {description ? <p className="prf2-card-desc">{description}</p> : null}
        </div>
      </div>
      <div className="prf2-card-body">{children}</div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export const ProfilePage: React.FC<ProfilePageProps> = ({
  token,
  username,
  role,
  allowedPages,
  onLogout,
  onAccountUpdated,
}) => {
  const { showAlert, showConfirm } = useAlertDialog();
  const roleLabel = role === 'owner' ? 'Shop owner' : 'Staff';

  // ── State (unchanged) ──────────────────────────────────────────────────────
  const [cloudSyncLoading, setCloudSyncLoading] = useState(false);
  const [cloudSyncMsg, setCloudSyncMsg] = useState<string | null>(null);
  const [cloudSyncErr, setCloudSyncErr] = useState<string | null>(null);

  const [curPwd, setCurPwd] = useState('');
  const [newUser, setNewUser] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [accountMsg, setAccountMsg] = useState<string | null>(null);
  const [accountErr, setAccountErr] = useState<string | null>(null);
  const [accountSaving, setAccountSaving] = useState(false);

  const [team, setTeam] = useState<TeamUserRow[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamErr, setTeamErr] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addUsername, setAddUsername] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addPages, setAddPages] = useState<Set<StaffAssignablePageId>>(
    () => new Set(normalizeStaffAllowedPagesFromApi(null))
  );
  const [addSaving, setAddSaving] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  const [editUser, setEditUser] = useState<TeamUserRow | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editNewPassword, setEditNewPassword] = useState('');
  const [editPages, setEditPages] = useState<Set<StaffAssignablePageId>>(new Set());
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const [fxLoading, setFxLoading] = useState(false);
  const [fxSaving, setFxSaving] = useState(false);
  const [fxFrankfurterSyncing, setFxFrankfurterSyncing] = useState(false);
  const [fxErr, setFxErr] = useState<string | null>(null);
  const [fxMsg, setFxMsg] = useState<string | null>(null);
  const [fxThbPerUsd, setFxThbPerUsd] = useState('');
  const [fxUnitsPerUsd, setFxUnitsPerUsd] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const { code } of SUPPORTED_CURRENCIES) {
      if (code !== 'USD' && code !== 'THB') d[code] = '';
    }
    return d;
  });

  const [backupDownloading, setBackupDownloading] = useState(false);
  const [restoreUploading, setRestoreUploading] = useState(false);
  const [backupErr, setBackupErr] = useState<string | null>(null);
  const restoreFileRef = useRef<HTMLInputElement>(null);

  const usernameRef = useRef(username);
  const allowedPagesRef = useRef(allowedPages);
  usernameRef.current = username;
  allowedPagesRef.current = allowedPages;

  // ── Data fetching (unchanged) ──────────────────────────────────────────────
  const fetchAccount = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/account'), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      const u = data.user;
      const nextPages =
        u.role === 'owner' ? null : normalizeStaffAllowedPagesFromApi(u.allowed_pages as string[] | null);
      const curUser = usernameRef.current;
      const curPages = allowedPagesRef.current;
      const pagesMatch =
        u.role === 'owner'
          ? curPages == null
          : curPages != null &&
            nextPages != null &&
            nextPages.length === curPages.length &&
            nextPages.every((p, i) => p === curPages[i]);
      if (u.username !== curUser || !pagesMatch) {
        onAccountUpdated({ username: u.username, allowedPages: nextPages });
      }
    } catch {
      // ignore
    }
  }, [token, onAccountUpdated]);

  useEffect(() => { fetchAccount(); }, [fetchAccount]);

  const fetchTeam = useCallback(async () => {
    if (role !== 'owner') return;
    setTeamLoading(true);
    setTeamErr(null);
    try {
      const res = await fetch(apiUrl('/api/users'), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load team');
        throw new Error(msg);
      }
      const rows: TeamUserRow[] = await res.json();
      setTeam(rows);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load team';
      setTeamErr(msg);
      setTeam([]);
      showAlert({ title: 'Team', message: msg, variant: 'error' });
    } finally {
      setTeamLoading(false);
    }
  }, [role, token, showAlert]);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  const fetchExchangeRates = useCallback(async () => {
    setFxLoading(true);
    setFxErr(null);
    setFxMsg(null);
    try {
      const res = await fetch(apiUrl('/api/exchange-rates'), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Failed to load exchange rates');
        throw new Error(msg);
      }
      const data = await res.json();
      const map = (data.thb_per_unit || {}) as Record<string, number>;
      const thbPerUsd = Number(map.USD);
      const hasBridge = Number.isFinite(thbPerUsd) && thbPerUsd > 0;
      setFxThbPerUsd(hasBridge ? String(roundRate6(thbPerUsd)) : '');
      const nextUnits: Record<string, string> = {};
      for (const { code } of SUPPORTED_CURRENCIES) {
        if (code === 'USD' || code === 'THB') continue;
        const thbPer = map[code];
        if (hasBridge && thbPer != null && Number.isFinite(Number(thbPer)) && Number(thbPer) > 0) {
          nextUnits[code] = String(roundRate6(thbPerUsd / Number(thbPer)));
        } else {
          nextUnits[code] = '';
        }
      }
      setFxUnitsPerUsd(nextUnits);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load exchange rates';
      setFxErr(msg);
      showAlert({ title: 'Exchange rates', message: msg, variant: 'error' });
    } finally {
      setFxLoading(false);
    }
  }, [token, showAlert]);

  useEffect(() => { void fetchExchangeRates(); }, [fetchExchangeRates]);

  const syncCloudDashboard = useCallback(async () => {
    setCloudSyncErr(null);
    setCloudSyncMsg(null);
    setCloudSyncLoading(true);
    try {
      const res = await fetch(apiUrl('/api/cloud/sync-from-app'), {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Could not sync to cloud dashboard');
        throw new Error(msg);
      }
      await res.json();
      const ok = 'Snapshot was sent to the cloud dashboard.';
      setCloudSyncMsg(ok);
      showAlert({ title: 'Cloud dashboard', message: ok, variant: 'success' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Cloud sync failed';
      setCloudSyncErr(msg);
      showAlert({ title: 'Cloud sync failed', message: msg, variant: 'error' });
    } finally {
      setCloudSyncLoading(false);
    }
  }, [token, showAlert]);

  const syncFrankfurterFromApi = useCallback(async () => {
    setFxFrankfurterSyncing(true);
    setFxErr(null);
    setFxMsg(null);
    try {
      const res = await fetch(apiUrl('/api/exchange-rates/sync-frankfurter'), {
        method: 'POST',
        headers: authHeaders(token),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Could not sync exchange rates');
        throw new Error(msg);
      }
      const data = (await res.json()) as { rate_date?: string | null };
      const d = data.rate_date ? ` (ECB date ${data.rate_date})` : '';
      setFxMsg(`Live rates applied from Frankfurter${d}.`);
      await fetchExchangeRates();
      showAlert({
        title: 'Exchange rates updated',
        message: data.rate_date ? `Frankfurter rates saved. ECB reference date: ${data.rate_date}.` : 'Frankfurter rates saved.',
        variant: 'success',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Frankfurter sync failed';
      setFxErr(msg);
      showAlert({ title: 'Frankfurter sync', message: msg, variant: 'error' });
    } finally {
      setFxFrankfurterSyncing(false);
    }
  }, [token, fetchExchangeRates, showAlert]);

  useEffect(() => { setNewUser(username); }, [username]);

  // ── Form submissions (unchanged) ──────────────────────────────────────────
  const submitAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountErr(null);
    setAccountMsg(null);
    const nu = newUser.trim();
    const np = newPwd;
    if (!curPwd) {
      const msg = 'Enter your current password.';
      setAccountErr(msg);
      showAlert({ title: 'Account', message: msg, variant: 'warning' });
      return;
    }
    if (nu === username && !np) {
      const msg = 'Enter a new username and/or new password, or change the fields.';
      setAccountErr(msg);
      showAlert({ title: 'Account', message: msg, variant: 'warning' });
      return;
    }
    if (np && np.length < 6) {
      const msg = 'New password must be at least 6 characters.';
      setAccountErr(msg);
      showAlert({ title: 'Account', message: msg, variant: 'warning' });
      return;
    }
    setAccountSaving(true);
    try {
      const body: Record<string, string> = { currentPassword: curPwd };
      if (nu && nu !== username) body.newUsername = nu;
      if (np) body.newPassword = np;
      const res = await fetch(apiUrl('/api/account'), {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Could not update account');
        throw new Error(msg);
      }
      const data = await res.json();
      const u = data.user;
      onAccountUpdated({
        username: u.username,
        allowedPages: u.role === 'owner' ? null : normalizeStaffAllowedPagesFromApi(u.allowed_pages as string[] | null),
      });
      setCurPwd('');
      setNewPwd('');
      setAccountMsg('Account updated.');
      showAlert({ title: 'Account updated', message: 'Your login details were saved successfully.', variant: 'success' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not update account';
      setAccountErr(msg);
      showAlert({ title: 'Could not update account', message: msg, variant: 'error' });
    } finally {
      setAccountSaving(false);
    }
  };

  const submitExchangeRates = async (e: React.FormEvent) => {
    e.preventDefault();
    setFxErr(null);
    setFxMsg(null);
    const tRaw = fxThbPerUsd.trim().replace(/,/g, '');
    const tUsd = Number(tRaw);
    const thbPerUsd = Number.isFinite(tUsd) && tUsd > 0 ? roundRate6(tUsd) : NaN;
    const otherFilled = SUPPORTED_CURRENCIES.some(({ code }) => {
      if (code === 'USD' || code === 'THB') return false;
      return (fxUnitsPerUsd[code] ?? '').trim() !== '';
    });
    if (otherFilled && (!Number.isFinite(thbPerUsd) || thbPerUsd <= 0)) {
      const msg = 'Set how many THB equal 1 USD first, then enter other currencies as "how much of that currency per 1 USD".';
      setFxErr(msg);
      showAlert({ title: 'Exchange rates', message: msg, variant: 'warning' });
      return;
    }
    const thb_per_unit: Record<string, number> = {};
    if (Number.isFinite(thbPerUsd) && thbPerUsd > 0) thb_per_unit.USD = thbPerUsd;
    if (otherFilled) {
      for (const { code } of SUPPORTED_CURRENCIES) {
        if (code === 'USD' || code === 'THB') continue;
        const s = (fxUnitsPerUsd[code] ?? '').trim();
        if (!s) continue;
        const n = Number(s.replace(/,/g, ''));
        if (!Number.isFinite(n) || n <= 0) {
          const msg = `Invalid rate for ${code}: enter a positive number (${code} per 1 USD).`;
          setFxErr(msg);
          showAlert({ title: 'Exchange rates', message: msg, variant: 'warning' });
          return;
        }
        thb_per_unit[code] = roundRate6(thbPerUsd / n);
      }
    }
    if (Object.keys(thb_per_unit).length === 0) {
      const msg = 'Enter 1 USD in THB and/or at least one other currency (units per 1 USD), then save. Use Reload to refresh.';
      setFxErr(msg);
      showAlert({ title: 'Exchange rates', message: msg, variant: 'warning' });
      return;
    }
    setFxSaving(true);
    try {
      const res = await fetch(apiUrl('/api/exchange-rates'), {
        method: 'PUT',
        headers: authHeaders(token),
        body: JSON.stringify({ thb_per_unit }),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Could not save exchange rates');
        throw new Error(msg);
      }
      await res.json();
      setFxMsg('Exchange rates saved.');
      await fetchExchangeRates();
      showAlert({ title: 'Exchange rates saved', message: 'Rates saved (stored internally as THB per unit for conversions).', variant: 'success' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not save exchange rates';
      setFxErr(msg);
      showAlert({ title: 'Exchange rates', message: msg, variant: 'error' });
    } finally {
      setFxSaving(false);
    }
  };

  function parseBackupFilename(cd: string | null): string {
    if (!cd) return 'blue-cuts-backup.db';
    const star = /filename\*=UTF-8''([^;\s]+)/i.exec(cd);
    if (star) { try { return decodeURIComponent(star[1].trim()); } catch { return star[1].trim(); } }
    const quoted = /filename="([^"]+)"/i.exec(cd);
    if (quoted) return quoted[1];
    const plain = /filename=([^;\s]+)/i.exec(cd);
    if (plain) return plain[1].replace(/^"|"$/g, '');
    return 'blue-cuts-backup.db';
  }

  const downloadDatabaseBackup = async () => {
    setBackupErr(null);
    setBackupDownloading(true);
    try {
      const res = await fetch(apiUrl('/api/backup/download'), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Could not download backup');
        throw new Error(msg);
      }
      const blob = await res.blob();
      const filename = parseBackupFilename(res.headers.get('Content-Disposition'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      showAlert({ title: 'Backup ready', message: 'Save the .db file in a safe place.', variant: 'success' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Download failed';
      setBackupErr(msg);
      showAlert({ title: 'Backup', message: msg, variant: 'error' });
    } finally {
      setBackupDownloading(false);
    }
  };

  const restoreDatabaseBackup = async () => {
    const input = restoreFileRef.current;
    const file = input?.files?.[0];
    if (!file) { showAlert({ title: 'Restore', message: 'Choose a .db backup file first.', variant: 'warning' }); return; }
    if (!file.name.toLowerCase().endsWith('.db')) { showAlert({ title: 'Restore', message: 'Use a .db file from a previous backup.', variant: 'warning' }); return; }
    const ok = await showConfirm({
      title: 'Restore database?',
      message: 'This replaces all shop data with the backup. Everyone should stop using the app until it finishes. You will need to refresh the page after restore. This cannot be undone.',
      confirmLabel: 'Restore', cancelLabel: 'Cancel', danger: true,
    });
    if (!ok) return;
    setBackupErr(null);
    setRestoreUploading(true);
    try {
      const fd = new FormData();
      fd.append('backup', file);
      const res = await fetch(apiUrl('/api/backup/restore'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Restore failed');
        throw new Error(msg);
      }
      if (input) input.value = '';
      showAlert({ title: 'Database restored', message: 'The page will reload so the app uses the restored data.', variant: 'success' });
      window.setTimeout(() => { window.location.reload(); }, 800);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Restore failed';
      setBackupErr(msg);
      showAlert({ title: 'Restore failed', message: msg, variant: 'error' });
    } finally {
      setRestoreUploading(false);
    }
  };

  const openAdd = () => {
    setAddErr(null); setAddUsername(''); setAddPassword('');
    setAddPages(new Set(normalizeStaffAllowedPagesFromApi(null)));
    setAddOpen(true);
  };

  const submitAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddErr(null);
    if (!addUsername.trim()) { const msg = 'Username is required.'; setAddErr(msg); showAlert({ title: 'Add staff', message: msg, variant: 'warning' }); return; }
    if (addPassword.length < 6) { const msg = 'Password must be at least 6 characters.'; setAddErr(msg); showAlert({ title: 'Add staff', message: msg, variant: 'warning' }); return; }
    if (addPages.size === 0) { const msg = 'Select at least one page.'; setAddErr(msg); showAlert({ title: 'Add staff', message: msg, variant: 'warning' }); return; }
    setAddSaving(true);
    try {
      const res = await fetch(apiUrl('/api/users'), {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ username: addUsername.trim(), password: addPassword, allowed_pages: Array.from(addPages) }),
      });
      if (!res.ok) { const msg = await parseErrorResponse(res, 'Could not create staff'); throw new Error(msg); }
      setAddOpen(false);
      await fetchTeam();
      showAlert({ title: 'Staff member added', message: 'The new account was created successfully.', variant: 'success' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not create staff';
      setAddErr(msg);
      showAlert({ title: 'Could not create staff', message: msg, variant: 'error' });
    } finally {
      setAddSaving(false);
    }
  };

  const openEdit = (u: TeamUserRow) => {
    if (u.role === 'owner') return;
    setEditErr(null); setEditUser(u); setEditUsername(u.username); setEditNewPassword('');
    setEditPages(new Set(normalizeStaffAllowedPagesFromApi(u.allowed_pages ?? undefined)));
  };

  const submitEditStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditErr(null);
    if (!editUsername.trim()) { const msg = 'Username is required.'; setEditErr(msg); showAlert({ title: 'Edit staff', message: msg, variant: 'warning' }); return; }
    if (editNewPassword && editNewPassword.length < 6) { const msg = 'New password must be at least 6 characters.'; setEditErr(msg); showAlert({ title: 'Edit staff', message: msg, variant: 'warning' }); return; }
    if (editPages.size === 0) { const msg = 'Select at least one page.'; setEditErr(msg); showAlert({ title: 'Edit staff', message: msg, variant: 'warning' }); return; }
    setEditSaving(true);
    try {
      const body: { username: string; allowed_pages: string[]; password?: string } = {
        username: editUsername.trim(), allowed_pages: Array.from(editPages),
      };
      if (editNewPassword) body.password = editNewPassword;
      const res = await fetch(apiUrl(`/api/users/${editUser.id}`), {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) { const msg = await parseErrorResponse(res, 'Could not update staff'); throw new Error(msg); }
      await res.json();
      setEditUser(null);
      await fetchTeam();
      showAlert({ title: 'Staff member updated', message: 'Changes were saved successfully.', variant: 'success' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not update staff';
      setEditErr(msg);
      showAlert({ title: 'Could not update staff', message: msg, variant: 'error' });
    } finally {
      setEditSaving(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="page page-profile prf2-root">

      {/* ── Hero identity card ─────────────────────────────────────────────── */}
      <div className="prf2-hero">
        <div className="prf2-hero-rainbow" aria-hidden="true" />
        <div className="prf2-hero-inner">
          <AvatarTile name={username} size="lg" />
          <div className="prf2-hero-text">
            <p className="prf2-hero-name">{username}</p>
            <div className="prf2-hero-meta">
              <span className={`prf2-role-badge prf2-role-badge--${role}`}>{roleLabel}</span>
              {role === 'owner' ? (
                <span className="prf2-hero-hint">
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  Full access to all modules
                </span>
              ) : null}
            </div>
            {role === 'staff' && allowedPages && allowedPages.length > 0 ? (
              <div className="prf2-hero-access">
                <span className="prf2-hero-access-label">Your access</span>
                <div className="prf2-hero-access-pills">
                  {allowedPages.map((p, i) => (
                    <span key={p} className={`profile-access-pill profile-access-pill--tone-${(i % 4) + 1}`}>
                      {ASSIGNABLE_STAFF_PAGE_LABELS[p as StaffAssignablePageId] || p}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Section grid ──────────────────────────────────────────────────── */}
      <div className="prf2-grid">

        {/* Security */}
        <SectionCard
          id="prf2-security"
          icon={<IconSecurity />}
          iconColor="#2563eb"
          kicker="Security"
          title="Sign-in & password"
          description={<>Enter your <strong>current password</strong>, then set a new username and/or password if you want to change them.</>}
          className="prf2-card--security"
        >
          <form className="prf2-form" onSubmit={submitAccount}>
            <div className="prf2-field">
              <label className="prf2-field-label" htmlFor="prf2-cur-pwd">Current password <span className="prf2-required">*</span></label>
              <input
                id="prf2-cur-pwd"
                type="password"
                className="prf2-input"
                value={curPwd}
                onChange={e => setCurPwd(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter your current password"
              />
            </div>
            <div className="prf2-field-row">
              <div className="prf2-field">
                <label className="prf2-field-label" htmlFor="prf2-new-user">New username <span className="prf2-optional">optional</span></label>
                <input
                  id="prf2-new-user"
                  type="text"
                  className="prf2-input"
                  value={newUser}
                  onChange={e => setNewUser(e.target.value)}
                  autoComplete="username"
                  placeholder="New username"
                />
              </div>
              <div className="prf2-field">
                <label className="prf2-field-label" htmlFor="prf2-new-pwd">New password <span className="prf2-optional">optional</span></label>
                <input
                  id="prf2-new-pwd"
                  type="password"
                  className="prf2-input"
                  value={newPwd}
                  onChange={e => setNewPwd(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Min 6 characters"
                />
              </div>
            </div>
            {accountErr ? <p className="prf2-msg prf2-msg--error">{accountErr}</p> : null}
            {accountMsg ? <p className="prf2-msg prf2-msg--success">✓ {accountMsg}</p> : null}
            <button type="submit" className="primary-button prf2-submit-btn" disabled={accountSaving}>
              {accountSaving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        </SectionCard>

        {/* Logout */}
        <SectionCard
          id="prf2-logout"
          icon={<IconLogout />}
          iconColor="#e11d48"
          kicker="Session"
          title="End session"
          description="Sign out on this device. You'll need your password to sign in again."
          className="prf2-card--logout"
        >
          <button type="button" className="prf2-logout-btn" onClick={onLogout}>
            <IconLogout />
            Log out
          </button>
        </SectionCard>

        {/* Team — owner only */}
        {role === 'owner' ? (
          <SectionCard
            id="prf2-team"
            icon={<IconTeam />}
            iconColor="#db2777"
            kicker="Team"
            title="Staff accounts"
            description="Add logins for your team and control which screens each person can access."
            className="prf2-card--team prf2-card--wide"
          >
            <div className="prf2-team-toolbar">
              {teamErr ? <p className="prf2-msg prf2-msg--error">{teamErr}</p> : null}
              <button type="button" className="prf2-add-btn" onClick={openAdd}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add staff member
              </button>
            </div>
            {teamLoading ? (
              <p className="prf2-loading">Loading team…</p>
            ) : team.length === 0 ? (
              <div className="prf2-team-empty">
                <div className="prf2-team-empty-icon"><IconTeam /></div>
                <p>No staff accounts yet. Add your first team member above.</p>
              </div>
            ) : (
              <div className="prf2-team-table-wrap">
                <table className="prf2-team-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Role</th>
                      <th>Page access</th>
                      <th style={{ width: '72px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {team.map(u => (
                      <tr key={u.id}>
                        <td>
                          <div className="prf2-team-member">
                            <AvatarTile name={u.username} size="sm" />
                            <span className="prf2-team-username">{u.username}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`prf2-role-badge prf2-role-badge--${u.role}`}>
                            {u.role === 'owner' ? 'Owner' : 'Staff'}
                          </span>
                        </td>
                        <td className="prf2-team-pages">
                          {u.role === 'owner' ? (
                            <span className="prf2-all-pages">All pages</span>
                          ) : (
                            <div className="prf2-pages-wrap">
                              {normalizeStaffAllowedPagesFromApi(u.allowed_pages ?? undefined).map((p, i) => (
                                <span key={p} className={`profile-access-pill profile-access-pill--sm profile-access-pill--tone-${(i % 4) + 1}`}>
                                  {ASSIGNABLE_STAFF_PAGE_LABELS[p]}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          {u.role === 'staff' ? (
                            <button type="button" className="prf2-edit-btn" onClick={() => openEdit(u)}>
                              Edit
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        ) : null}

        {/* Exchange rates */}
        <SectionCard
          id="prf2-fx"
          icon={<IconRates />}
          iconColor="#d97706"
          kicker="Rates"
          title="Exchange rates"
          description={
            <>
              USD is the primary currency. Enter rates as <strong>1 USD = ?</strong> for each currency.
              Use <strong>Fetch live rates</strong> to pull ECB spot rates via{' '}
              <a href="https://www.frankfurter.app/" target="_blank" rel="noopener noreferrer" className="prf2-link">Frankfurter</a>.
              Changing rates does <strong>not</strong> alter stored prices — only affects conversions.
              {role === 'staff' ? <> Staff can update these rates; they apply shop-wide.</> : null}
            </>
          }
          className="prf2-card--fx prf2-card--wide"
        >
          {fxErr ? <p className="prf2-msg prf2-msg--error">{fxErr}</p> : null}
          {fxMsg ? <p className="prf2-msg prf2-msg--success">✓ {fxMsg}</p> : null}
          {fxLoading ? (
            <p className="prf2-loading">Loading rates…</p>
          ) : (
            <form className="prf2-fx-form" onSubmit={submitExchangeRates}>
              <div className="prf2-fx-grid">
                {[
                  SUPPORTED_CURRENCIES.find(c => c.code === 'USD')!,
                  SUPPORTED_CURRENCIES.find(c => c.code === 'THB')!,
                  ...SUPPORTED_CURRENCIES.filter(c => c.code !== 'USD' && c.code !== 'THB'),
                ].map(({ code, label }) => {
                  const shortLabel = label.replace(/^[^—]+—\s*/, '');
                  const tThb = Number(fxThbPerUsd.trim().replace(/,/g, ''));
                  const bridgeOk = Number.isFinite(tThb) && tThb > 0;

                  if (code === 'USD') {
                    return (
                      <div key={code} className="prf2-fx-row prf2-fx-row--ref">
                        <div className="prf2-fx-currency">
                          <span className="prf2-fx-code">{code}</span>
                          <span className="prf2-fx-name">{shortLabel}</span>
                        </div>
                        <div className="prf2-fx-value-wrap">
                          <span className="prf2-fx-ref-eq">1 USD = 1 USD</span>
                          <span className="prf2-fx-ref-note">Reference — not editable</span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={code} className={`prf2-fx-row${code === 'THB' ? ' prf2-fx-row--thb' : ''}`}>
                      <div className="prf2-fx-currency">
                        <span className="prf2-fx-code">{code}</span>
                        <span className="prf2-fx-name">{shortLabel}</span>
                      </div>
                      <div className="prf2-fx-input-wrap">
                        <span className="prf2-fx-eq-label">1 USD =</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          className={`prf2-fx-input${code !== 'THB' && !bridgeOk ? ' prf2-fx-input--disabled' : ''}`}
                          value={code === 'THB' ? fxThbPerUsd : (fxUnitsPerUsd[code] ?? '')}
                          onChange={e =>
                            code === 'THB'
                              ? setFxThbPerUsd(e.target.value)
                              : setFxUnitsPerUsd(prev => ({ ...prev, [code]: e.target.value }))
                          }
                          placeholder={
                            code === 'THB' ? 'e.g. 35' :
                            !bridgeOk ? 'Set THB first' :
                            code === 'JPY' ? 'e.g. 150' : 'e.g. 0.92'
                          }
                          disabled={code !== 'THB' && !bridgeOk}
                          aria-label={`${code} per 1 US dollar`}
                        />
                        <span className="prf2-fx-suffix">{code}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="prf2-fx-actions">
                <button type="button" className="ghost-button" disabled={fxLoading || fxSaving || fxFrankfurterSyncing} onClick={() => void fetchExchangeRates()}>
                  ↺ Reload
                </button>
                <button type="button" className="ghost-button" disabled={fxLoading || fxSaving || fxFrankfurterSyncing} onClick={() => void syncFrankfurterFromApi()}>
                  {fxFrankfurterSyncing ? 'Fetching…' : '⬇ Fetch live rates'}
                </button>
                <button type="submit" className="primary-button" disabled={fxSaving || fxLoading || fxFrankfurterSyncing}>
                  {fxSaving ? 'Saving…' : 'Save rates'}
                </button>
              </div>
            </form>
          )}
        </SectionCard>

        {/* Database backup */}
        <SectionCard
          id="prf2-backup"
          icon={<IconBackup />}
          iconColor="#0d9488"
          kicker="Data"
          title="Database backup"
          description={<>Download a full copy of the shop database (.db file). Store it somewhere safe. Restoring replaces <strong>all</strong> current data—only the shop owner can do that.</>}
          className="prf2-card--backup"
        >
          {backupErr ? <p className="prf2-msg prf2-msg--error">{backupErr}</p> : null}
          <div className="prf2-backup-zone">
            <div className="prf2-backup-download">
              <div className="prf2-backup-info">
                <div className="prf2-backup-icon-wrap">
                  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </div>
                <div>
                  <p className="prf2-backup-action-title">Download backup</p>
                  <p className="prf2-backup-action-desc">SQLite .db file — save it somewhere safe</p>
                </div>
              </div>
              <button
                type="button"
                className="primary-button"
                disabled={backupDownloading || restoreUploading}
                onClick={() => void downloadDatabaseBackup()}
              >
                {backupDownloading ? 'Preparing…' : 'Download'}
              </button>
            </div>

            {role === 'owner' ? (
              <div className="prf2-backup-restore">
                <div className="prf2-backup-restore-inner">
                  <div className="prf2-backup-restore-info">
                    <div className="prf2-backup-icon-wrap prf2-backup-icon-wrap--danger">
                      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    </div>
                    <div>
                      <p className="prf2-backup-action-title">Restore from backup</p>
                      <p className="prf2-backup-action-desc prf2-backup-action-desc--danger">Replaces all current data — irreversible</p>
                    </div>
                  </div>
                  <div className="prf2-backup-restore-controls">
                    <label className="prf2-file-label">
                      <span className="visually-hidden">Backup file</span>
                      <input
                        ref={restoreFileRef}
                        type="file"
                        accept=".db,application/octet-stream"
                        disabled={restoreUploading || backupDownloading}
                        aria-label="Select backup .db file to restore"
                        className="prf2-file-input"
                      />
                    </label>
                    <button
                      type="button"
                      className="prf2-restore-btn"
                      disabled={restoreUploading || backupDownloading}
                      onClick={() => void restoreDatabaseBackup()}
                    >
                      {restoreUploading ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </SectionCard>

        {/* Cloud sync — owner only */}
        {role === 'owner' ? (
          <SectionCard
            id="prf2-cloud"
            icon={<IconCloud />}
            iconColor="#7c3aed"
            kicker="Cloud"
            title="Cloud dashboard sync"
            description={
              <>
                Push the latest reports and inventory snapshot to Firebase for the online dashboard (Vercel). This PC must have <strong>BLUECUTS_SHOP_ID</strong> and Firebase credentials in <strong>backend/.env</strong>.
              </>
            }
            className="prf2-card--cloud"
          >
            {cloudSyncErr ? <p className="prf2-msg prf2-msg--error">{cloudSyncErr}</p> : null}
            {cloudSyncMsg ? <p className="prf2-msg prf2-msg--success">✓ {cloudSyncMsg}</p> : null}
            <div className="prf2-cloud-action">
              <div className="prf2-cloud-status">
                <div className="prf2-cloud-dot" />
                <span>Sync sends a full snapshot to Firestore</span>
              </div>
              <button
                type="button"
                className="primary-button"
                disabled={cloudSyncLoading}
                onClick={() => void syncCloudDashboard()}
              >
                {cloudSyncLoading ? (
                  <><span className="prf2-spinner" /> Syncing…</>
                ) : (
                  <><IconCloud /> Sync now</>
                )}
              </button>
            </div>
          </SectionCard>
        ) : null}

      </div>{/* /prf2-grid */}


      {/* ── Add staff modal ───────────────────────────────────────────────── */}
      {addOpen ? (
        <div className="customers-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="prf2-add-staff-title">
          <div className="customers-modal profile-modal-wide prf2-modal">
            <div className="customers-modal-header prf2-modal-header">
              <div className="prf2-modal-title-row">
                <div className="prf2-modal-icon prf2-modal-icon--pink"><IconTeam /></div>
                <h3 id="prf2-add-staff-title">Add staff member</h3>
              </div>
              <button type="button" className="customers-modal-close" onClick={() => setAddOpen(false)} aria-label="Close">✕</button>
            </div>
            <form onSubmit={submitAddStaff}>
              <div className="customers-modal-body prf2-modal-body">
                <div className="prf2-modal-field-row">
                  <div className="prf2-field">
                    <label className="prf2-field-label" htmlFor="prf2-add-username">Username <span className="prf2-required">*</span></label>
                    <input id="prf2-add-username" className="prf2-input" value={addUsername} onChange={e => setAddUsername(e.target.value)} autoComplete="off" placeholder="e.g. staff01" />
                  </div>
                  <div className="prf2-field">
                    <label className="prf2-field-label" htmlFor="prf2-add-pwd">Initial password <span className="prf2-required">*</span></label>
                    <input id="prf2-add-pwd" className="prf2-input" type="password" value={addPassword} onChange={e => setAddPassword(e.target.value)} autoComplete="new-password" placeholder="Min 6 characters" />
                  </div>
                </div>
                <PageAccessCheckboxes selected={addPages} onChange={setAddPages} />
                {addErr ? <p className="prf2-msg prf2-msg--error">{addErr}</p> : null}
              </div>
              <div className="customers-modal-footer">
                <button type="button" className="ghost-button" onClick={() => setAddOpen(false)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={addSaving}>{addSaving ? 'Creating…' : 'Create staff'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* ── Edit staff modal ──────────────────────────────────────────────── */}
      {editUser ? (
        <div className="customers-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="prf2-edit-staff-title">
          <div className="customers-modal profile-modal-wide prf2-modal">
            <div className="customers-modal-header prf2-modal-header">
              <div className="prf2-modal-title-row">
                <AvatarTile name={editUser.username} size="sm" />
                <h3 id="prf2-edit-staff-title">Edit: {editUser.username}</h3>
              </div>
              <button type="button" className="customers-modal-close" onClick={() => setEditUser(null)} aria-label="Close">✕</button>
            </div>
            <form onSubmit={submitEditStaff}>
              <div className="customers-modal-body prf2-modal-body">
                <div className="prf2-modal-field-row">
                  <div className="prf2-field">
                    <label className="prf2-field-label" htmlFor="prf2-edit-username">Username <span className="prf2-required">*</span></label>
                    <input id="prf2-edit-username" className="prf2-input" value={editUsername} onChange={e => setEditUsername(e.target.value)} autoComplete="off" />
                  </div>
                  <div className="prf2-field">
                    <label className="prf2-field-label" htmlFor="prf2-edit-pwd">New password <span className="prf2-optional">leave blank to keep</span></label>
                    <input id="prf2-edit-pwd" className="prf2-input" type="password" value={editNewPassword} onChange={e => setEditNewPassword(e.target.value)} autoComplete="new-password" placeholder="Leave blank to keep current" />
                  </div>
                </div>
                <PageAccessCheckboxes selected={editPages} onChange={setEditPages} />
                {editErr ? <p className="prf2-msg prf2-msg--error">{editErr}</p> : null}
              </div>
              <div className="customers-modal-footer">
                <button type="button" className="ghost-button" onClick={() => setEditUser(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save changes'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

    </div>
  );
};
