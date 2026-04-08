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
    <div className="profile-page-access-grid" role="group" aria-label="Page access">
      {ASSIGNABLE_STAFF_PAGE_IDS.map(id => (
        <label key={id} className="profile-page-access-item">
          <input
            type="checkbox"
            checked={selected.has(id)}
            onChange={() => toggle(id)}
            disabled={disabled}
          />
          <span>{ASSIGNABLE_STAFF_PAGE_LABELS[id]}</span>
        </label>
      ))}
      <p className="profile-page-access-hint">
        Staff always have access to <strong>Profile</strong> (sign out). If <strong>Payments</strong> is on, they can open{' '}
        <strong>Invoice checkout</strong> from that flow.
      </p>
    </div>
  );
}

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
  /** THB per 1 USD (standard quote: how many baht one dollar is worth). */
  const [fxThbPerUsd, setFxThbPerUsd] = useState('');
  /** Units of each foreign currency per 1 USD (e.g. EUR per USD, JPY per USD). */
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

  useEffect(() => {
    fetchAccount();
  }, [fetchAccount]);

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

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

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

  useEffect(() => {
    void fetchExchangeRates();
  }, [fetchExchangeRates]);

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
        message: data.rate_date
          ? `Frankfurter rates saved. ECB reference date: ${data.rate_date}.`
          : 'Frankfurter rates saved.',
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

  useEffect(() => {
    setNewUser(username);
  }, [username]);

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
        allowedPages:
          u.role === 'owner' ? null : normalizeStaffAllowedPagesFromApi(u.allowed_pages as string[] | null),
      });
      setCurPwd('');
      setNewPwd('');
      setAccountMsg('Account updated.');
      showAlert({
        title: 'Account updated',
        message: 'Your login details were saved successfully.',
        variant: 'success',
      });
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
      const msg =
        'Set how many THB equal 1 USD first, then enter other currencies as “how much of that currency per 1 USD”.';
      setFxErr(msg);
      showAlert({ title: 'Exchange rates', message: msg, variant: 'warning' });
      return;
    }

    const thb_per_unit: Record<string, number> = {};

    if (Number.isFinite(thbPerUsd) && thbPerUsd > 0) {
      thb_per_unit.USD = thbPerUsd;
    }

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
      const msg =
        'Enter 1 USD in THB and/or at least one other currency (units per 1 USD), then save. Use Reload to refresh.';
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
      showAlert({
        title: 'Exchange rates saved',
        message: 'Rates saved (stored internally as THB per unit for conversions).',
        variant: 'success',
      });
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
    if (star) {
      try {
        return decodeURIComponent(star[1].trim());
      } catch {
        return star[1].trim();
      }
    }
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
      const res = await fetch(apiUrl('/api/backup/download'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Could not download backup');
        throw new Error(msg);
      }
      const blob = await res.blob();
      const filename = parseBackupFilename(res.headers.get('Content-Disposition'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
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
    if (!file) {
      showAlert({ title: 'Restore', message: 'Choose a .db backup file first.', variant: 'warning' });
      return;
    }
    if (!file.name.toLowerCase().endsWith('.db')) {
      showAlert({ title: 'Restore', message: 'Use a .db file from a previous backup.', variant: 'warning' });
      return;
    }
    const ok = await showConfirm({
      title: 'Restore database?',
      message:
        'This replaces all shop data with the backup. Everyone should stop using the app until it finishes. You will need to refresh the page after restore. This cannot be undone.',
      confirmLabel: 'Restore',
      cancelLabel: 'Cancel',
      danger: true,
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
      showAlert({
        title: 'Database restored',
        message: 'The page will reload so the app uses the restored data.',
        variant: 'success',
      });
      window.setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Restore failed';
      setBackupErr(msg);
      showAlert({ title: 'Restore failed', message: msg, variant: 'error' });
    } finally {
      setRestoreUploading(false);
    }
  };

  const openAdd = () => {
    setAddErr(null);
    setAddUsername('');
    setAddPassword('');
    setAddPages(new Set(normalizeStaffAllowedPagesFromApi(null)));
    setAddOpen(true);
  };

  const submitAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddErr(null);
    if (!addUsername.trim()) {
      const msg = 'Username is required.';
      setAddErr(msg);
      showAlert({ title: 'Add staff', message: msg, variant: 'warning' });
      return;
    }
    if (addPassword.length < 6) {
      const msg = 'Password must be at least 6 characters.';
      setAddErr(msg);
      showAlert({ title: 'Add staff', message: msg, variant: 'warning' });
      return;
    }
    if (addPages.size === 0) {
      const msg = 'Select at least one page.';
      setAddErr(msg);
      showAlert({ title: 'Add staff', message: msg, variant: 'warning' });
      return;
    }
    setAddSaving(true);
    try {
      const res = await fetch(apiUrl('/api/users'), {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          username: addUsername.trim(),
          password: addPassword,
          allowed_pages: Array.from(addPages),
        }),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Could not create staff');
        throw new Error(msg);
      }
      setAddOpen(false);
      await fetchTeam();
      showAlert({
        title: 'Staff member added',
        message: 'The new account was created successfully.',
        variant: 'success',
      });
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
    setEditErr(null);
    setEditUser(u);
    setEditUsername(u.username);
    setEditNewPassword('');
    setEditPages(new Set(normalizeStaffAllowedPagesFromApi(u.allowed_pages ?? undefined)));
  };

  const submitEditStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditErr(null);
    if (!editUsername.trim()) {
      const msg = 'Username is required.';
      setEditErr(msg);
      showAlert({ title: 'Edit staff', message: msg, variant: 'warning' });
      return;
    }
    if (editNewPassword && editNewPassword.length < 6) {
      const msg = 'New password must be at least 6 characters.';
      setEditErr(msg);
      showAlert({ title: 'Edit staff', message: msg, variant: 'warning' });
      return;
    }
    if (editPages.size === 0) {
      const msg = 'Select at least one page.';
      setEditErr(msg);
      showAlert({ title: 'Edit staff', message: msg, variant: 'warning' });
      return;
    }
    setEditSaving(true);
    try {
      const body: { username: string; allowed_pages: string[]; password?: string } = {
        username: editUsername.trim(),
        allowed_pages: Array.from(editPages),
      };
      if (editNewPassword) body.password = editNewPassword;
      const res = await fetch(apiUrl(`/api/users/${editUser.id}`), {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res, 'Could not update staff');
        throw new Error(msg);
      }
      await res.json();
      setEditUser(null);
      await fetchTeam();
      showAlert({
        title: 'Staff member updated',
        message: 'Changes were saved successfully.',
        variant: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not update staff';
      setEditErr(msg);
      showAlert({ title: 'Could not update staff', message: msg, variant: 'error' });
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="page page-profile">
      <header className="page-header page-header-with-icon profile-page-intro">
        <div className="page-header-icon page-header-icon--profile" aria-hidden="true">
          <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div className="profile-intro-copy">
          <h2>Profile &amp; account</h2>
          <p className="page-description">
            {role === 'owner'
              ? 'Manage your sign-in, invite staff, and control which areas of the app they can use.'
              : 'Update your sign-in. Which pages you can open is set by the shop owner.'}
          </p>
        </div>
      </header>

      <div className="profile-shell">
        <section className="profile-overview-card" aria-label="Account summary">
          <div className="profile-overview-main">
            <div className="profile-avatar-block" aria-hidden="true">
              <span className="profile-card__avatar-inner profile-card__avatar-inner--rounded">
                {username.slice(0, 1).toUpperCase() || '?'}
              </span>
            </div>
            <div className="profile-overview-body">
              <p className="profile-display-name">{username}</p>
              <div className="profile-overview-meta">
                <span className={`profile-role-tag profile-role-tag--${role}`}>{roleLabel}</span>
                {role === 'owner' ? (
                  <span className="profile-overview-hint">Full access to all modules</span>
                ) : null}
              </div>
              {role === 'staff' && allowedPages && allowedPages.length > 0 ? (
                <div className="profile-access-block">
                  <span className="profile-access-block-label">Your access</span>
                  <div className="profile-access-list profile-access-list--wrap">
                    {allowedPages.map((p, i) => (
                      <span
                        key={p}
                        className={`profile-access-pill profile-access-pill--tone-${(i % 4) + 1}`}
                      >
                        {ASSIGNABLE_STAFF_PAGE_LABELS[p as StaffAssignablePageId] || p}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <div className="profile-panels">
          <section className="profile-section-card profile-section-card--security">
            <div className="profile-section-head">
              <span className="profile-section-kicker">Security</span>
              <h3 className="profile-section-title">Sign-in &amp; password</h3>
              <p className="profile-section-desc">
                Enter your <strong className="profile-emphasis">current password</strong>, then set a new username
                and/or password if you want to change them.
              </p>
            </div>
        <form className="profile-account-form" onSubmit={submitAccount}>
          <label>
            <span>Current password</span>
            <input
              type="password"
              value={curPwd}
              onChange={e => setCurPwd(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label>
            <span>New username (optional)</span>
            <input
              type="text"
              value={newUser}
              onChange={e => setNewUser(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            <span>New password (optional)</span>
            <input
              type="password"
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          {accountErr ? <p className="profile-form-error">{accountErr}</p> : null}
          {accountMsg ? <p className="profile-form-success">{accountMsg}</p> : null}
          <button type="submit" className="primary-button profile-section-submit" disabled={accountSaving}>
            {accountSaving ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </section>

      {role === 'owner' ? (
        <section className="profile-section-card profile-section-card--team">
          <div className="profile-team-header">
            <div className="profile-section-head profile-section-head--inline">
              <span className="profile-section-kicker profile-section-kicker--violet">Team</span>
              <h3 className="profile-section-title">Staff accounts</h3>
              <p className="profile-section-desc">
                Add logins for your team and tick which screens each person may use. You can edit this later.
              </p>
            </div>
            <button type="button" className="primary-button" onClick={openAdd}>
              + Add staff
            </button>
          </div>

          {teamErr ? <p className="profile-form-error">{teamErr}</p> : null}
          {teamLoading ? (
            <p className="profile-team-loading">Loading team…</p>
          ) : (
            <div className="profile-team-table-wrap">
              <table className="profile-team-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Page access</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {team.map(u => (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td>{u.role === 'owner' ? 'Owner' : 'Staff'}</td>
                      <td className="profile-team-pages">
                        {u.role === 'owner' ? (
                          <span className="profile-access-all">All pages</span>
                        ) : (
                          normalizeStaffAllowedPagesFromApi(u.allowed_pages ?? undefined).map((p, i) => (
                            <span
                              key={p}
                              className={`profile-access-pill profile-access-pill--sm profile-access-pill--tone-${(i % 4) + 1}`}
                            >
                              {ASSIGNABLE_STAFF_PAGE_LABELS[p]}
                            </span>
                          ))
                        )}
                      </td>
                      <td className="profile-team-actions">
                        {u.role === 'staff' ? (
                          <button type="button" className="ghost-button small" onClick={() => openEdit(u)}>
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
        </section>
      ) : null}

      <section className="profile-section-card profile-section-card--fx" aria-label="Exchange rates">
          <div className="profile-section-head">
            <span className="profile-section-kicker profile-section-kicker--violet">Rates</span>
            <h3 className="profile-section-title">Exchange rates (USD is primary)</h3>
            <p className="profile-section-desc">
              The shop&apos;s main reference currency is <strong>USD</strong>. Enter rates as <strong>how much of each currency one US dollar
              is worth</strong>: <strong>1 USD = ? THB</strong>, then <strong>1 USD = ? EUR</strong>, <strong>1 USD = ? JPY</strong>, and so
              on—the same way most FX tables quote against the dollar. Internally the app still stores a THB-per-unit bridge for totals. Use{' '}
              <strong>Fetch live rates</strong> to pull ECB spot rates via the free{' '}
              <a href="https://www.frankfurter.app/" target="_blank" rel="noopener noreferrer">
                Frankfurter
              </a>{' '}
              API (USD base). The server can also refresh these automatically once per day while it is running. Changing rates does{' '}
              <strong>not</strong> change stored inventory list prices—it only affects conversions (invoices, memos, reports, prefill). Leave a
              currency blank when saving manually to keep its current stored rate.
              {role === 'staff' ? (
                <>
                  {' '}
                  Staff can update these rates; they apply shop-wide for everyone.
                </>
              ) : null}
            </p>
          </div>
          {fxErr ? <p className="profile-form-error">{fxErr}</p> : null}
          {fxMsg ? <p className="profile-form-success">{fxMsg}</p> : null}
          {fxLoading ? (
            <p className="profile-team-loading">Loading rates…</p>
          ) : (
            <form className="profile-fx-form" onSubmit={submitExchangeRates}>
              <div className="profile-team-table-wrap profile-fx-table-wrap">
                <table className="profile-team-table profile-fx-table">
                  <thead>
                    <tr>
                      <th>Currency</th>
                      <th>Your rate</th>
                    </tr>
                  </thead>
                  <tbody>
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
                          <tr key={code}>
                            <td>
                              <span className="profile-fx-code">{code}</span>
                              <span className="profile-fx-label">{shortLabel}</span>
                            </td>
                            <td>
                              <div className="profile-fx-usd-ref">
                                <span className="profile-fx-static-eq">1 USD = 1 USD</span>
                                <span className="profile-fx-ref-note">Reference currency — not editable.</span>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      if (code === 'THB') {
                        return (
                          <tr key={code}>
                            <td>
                              <span className="profile-fx-code">{code}</span>
                              <span className="profile-fx-label">{shortLabel}</span>
                            </td>
                            <td>
                              <span className="profile-fx-inline">
                                <span className="profile-fx-eq">1 USD =</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="profile-fx-input profile-fx-input--inline"
                                  value={fxThbPerUsd}
                                  onChange={e => setFxThbPerUsd(e.target.value)}
                                  placeholder="e.g. 35"
                                  aria-label="Thai baht per 1 US dollar"
                                />
                                <span className="profile-fx-suffix">THB</span>
                              </span>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={code}>
                          <td>
                            <span className="profile-fx-code">{code}</span>
                            <span className="profile-fx-label">{shortLabel}</span>
                          </td>
                          <td>
                            <span className="profile-fx-inline">
                              <span className="profile-fx-eq">1 USD =</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                className="profile-fx-input profile-fx-input--inline"
                                value={fxUnitsPerUsd[code] ?? ''}
                                onChange={e =>
                                  setFxUnitsPerUsd(prev => ({ ...prev, [code]: e.target.value }))
                                }
                                placeholder={bridgeOk ? `e.g. ${code === 'JPY' ? '150' : '0.92'}` : 'Set 1 USD in THB first'}
                                disabled={!bridgeOk}
                                aria-label={`${code} per 1 US dollar`}
                              />
                              <span className="profile-fx-suffix">{code}</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="profile-fx-actions">
                <button type="button" className="ghost-button" disabled={fxLoading || fxSaving || fxFrankfurterSyncing} onClick={() => void fetchExchangeRates()}>
                  Reload
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={fxLoading || fxSaving || fxFrankfurterSyncing}
                  onClick={() => void syncFrankfurterFromApi()}
                >
                  {fxFrankfurterSyncing ? 'Fetching…' : 'Fetch live rates'}
                </button>
                <button type="submit" className="primary-button profile-section-submit" disabled={fxSaving || fxLoading || fxFrankfurterSyncing}>
                  {fxSaving ? 'Saving…' : 'Save rates'}
                </button>
              </div>
            </form>
          )}
        </section>

      <section className="profile-section-card profile-section-card--backup" aria-label="Database backup">
        <div className="profile-section-head">
          <span className="profile-section-kicker profile-section-kicker--violet">Data</span>
          <h3 className="profile-section-title">Database backup</h3>
          <p className="profile-section-desc">
            Download a full copy of the shop database (SQLite .db). Store it somewhere safe. Restoring replaces{' '}
            <strong>all</strong> current data—only the shop owner can do that.
          </p>
        </div>
        {backupErr ? <p className="profile-form-error">{backupErr}</p> : null}
        <div className="profile-backup-actions">
          <button
            type="button"
            className="primary-button"
            disabled={backupDownloading || restoreUploading}
            onClick={() => void downloadDatabaseBackup()}
          >
            {backupDownloading ? 'Preparing backup…' : 'Download backup'}
          </button>
        </div>
        {role === 'owner' ? (
          <div className="profile-backup-restore-row">
            <label className="profile-backup-file-input">
              <span className="visually-hidden">Backup file</span>
              <input
                ref={restoreFileRef}
                type="file"
                accept=".db,application/octet-stream"
                disabled={restoreUploading || backupDownloading}
                aria-label="Select backup .db file to restore"
              />
            </label>
            <button
              type="button"
              className="ghost-button"
              disabled={restoreUploading || backupDownloading}
              onClick={() => void restoreDatabaseBackup()}
            >
              {restoreUploading ? 'Restoring…' : 'Restore from backup'}
            </button>
          </div>
        ) : null}
      </section>

      {role === 'owner' ? (
        <section className="profile-section-card profile-section-card--cloud" aria-label="Cloud dashboard sync">
          <div className="profile-section-head">
            <span className="profile-section-kicker profile-section-kicker--violet">Cloud</span>
            <h3 className="profile-section-title">Cloud dashboard</h3>
            <p className="profile-section-desc">
              Push the latest reports and inventory snapshot to Firebase for the online dashboard (Vercel). This PC must
              have <strong>BLUECUTS_SHOP_ID</strong> and Firebase credentials in <strong>backend/.env</strong> as described in the
              hybrid setup guide.
            </p>
          </div>
          {cloudSyncErr ? <p className="profile-form-error">{cloudSyncErr}</p> : null}
          {cloudSyncMsg ? <p className="profile-form-success">{cloudSyncMsg}</p> : null}
          <button
            type="button"
            className="primary-button profile-section-submit"
            disabled={cloudSyncLoading}
            onClick={() => void syncCloudDashboard()}
          >
            {cloudSyncLoading ? 'Syncing…' : 'Sync to cloud dashboard'}
          </button>
        </section>
      ) : null}

          <section className="profile-section-card profile-section-card--logout" aria-label="Sign out">
            <h3 className="profile-section-title profile-section-title--small">End session</h3>
            <p className="profile-section-desc profile-section-desc--tight">
              Sign out on this device. You’ll need your password to sign in again.
            </p>
            <button type="button" className="profile-logout-btn" onClick={onLogout}>
              Log out
            </button>
          </section>
        </div>
      </div>

      {addOpen ? (
        <div className="customers-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-staff-title">
          <div className="customers-modal profile-modal-wide">
            <div className="customers-modal-header">
              <h3 id="add-staff-title">Add staff member</h3>
              <button type="button" className="customers-modal-close" onClick={() => setAddOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <form onSubmit={submitAddStaff}>
              <div className="customers-modal-body">
                <label>
                  <span>Username</span>
                  <input value={addUsername} onChange={e => setAddUsername(e.target.value)} autoComplete="off" />
                </label>
                <label>
                  <span>Initial password</span>
                  <input
                    type="password"
                    value={addPassword}
                    onChange={e => setAddPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <PageAccessCheckboxes selected={addPages} onChange={setAddPages} />
                {addErr ? <p className="customers-modal-error">{addErr}</p> : null}
              </div>
              <div className="customers-modal-footer">
                <button type="button" className="ghost-button" onClick={() => setAddOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={addSaving}>
                  {addSaving ? 'Creating…' : 'Create staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editUser ? (
        <div className="customers-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-staff-title">
          <div className="customers-modal profile-modal-wide">
            <div className="customers-modal-header">
              <h3 id="edit-staff-title">Edit staff: {editUser.username}</h3>
              <button
                type="button"
                className="customers-modal-close"
                onClick={() => setEditUser(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <form onSubmit={submitEditStaff}>
              <div className="customers-modal-body">
                <label>
                  <span>Username</span>
                  <input value={editUsername} onChange={e => setEditUsername(e.target.value)} autoComplete="off" />
                </label>
                <label>
                  <span>New password (leave blank to keep current)</span>
                  <input
                    type="password"
                    value={editNewPassword}
                    onChange={e => setEditNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <PageAccessCheckboxes selected={editPages} onChange={setEditPages} />
                {editErr ? <p className="customers-modal-error">{editErr}</p> : null}
              </div>
              <div className="customers-modal-footer">
                <button type="button" className="ghost-button" onClick={() => setEditUser(null)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={editSaving}>
                  {editSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};
