import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type AlertVariant = 'error' | 'warning' | 'info' | 'success';

export type ShowAlertOptions = {
  title?: string;
  message: string;
  variant?: AlertVariant;
};

export type ShowConfirmOptions = {
  title?: string;
  message: string;
  /** Primary action label (e.g. "Delete") */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Use destructive styling for the confirm button */
  danger?: boolean;
};

type AlertPayload = {
  title: string;
  message: string;
  variant: AlertVariant;
};

type ConfirmPayload = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
};

type OpenDialog = { mode: 'alert'; payload: AlertPayload } | { mode: 'confirm'; payload: ConfirmPayload };

type AlertDialogContextValue = {
  showAlert: (options: ShowAlertOptions | string) => void;
  /** Resolves to true if the user confirms, false if cancelled or dismissed. */
  showConfirm: (options: ShowConfirmOptions) => Promise<boolean>;
};

const AlertDialogContext = createContext<AlertDialogContextValue | null>(null);

const defaultTitle: Record<AlertVariant, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Notice',
  success: 'Success',
};

export function AlertDialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [themeClass, setThemeClass] = useState('');
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null);

  // Detect theme from .App element and keep in sync
  useEffect(() => {
    const detect = () => {
      const app = document.querySelector('.App');
      setThemeClass(app?.classList.contains('theme-dark') ? 'theme-dark' : 'theme-light');
    };
    detect();
    const mo = new MutationObserver(detect);
    mo.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => mo.disconnect();
  }, []);

  const clearConfirmResolver = useCallback((value: boolean) => {
    const fn = confirmResolveRef.current;
    confirmResolveRef.current = null;
    fn?.(value);
  }, []);

  const showAlert = useCallback(
    (options: ShowAlertOptions | string) => {
      if (confirmResolveRef.current) {
        confirmResolveRef.current(false);
        confirmResolveRef.current = null;
      }
      if (typeof options === 'string') {
        setDialog({
          mode: 'alert',
          payload: {
            title: defaultTitle.error,
            message: options,
            variant: 'error',
          },
        });
      } else {
        const v = options.variant ?? 'error';
        setDialog({
          mode: 'alert',
          payload: {
            title: options.title ?? defaultTitle[v],
            message: options.message,
            variant: v,
          },
        });
      }
    },
    []
  );

  const showConfirm = useCallback((options: ShowConfirmOptions) => {
    if (confirmResolveRef.current) {
      confirmResolveRef.current(false);
      confirmResolveRef.current = null;
    }
    return new Promise<boolean>(resolve => {
      confirmResolveRef.current = resolve;
      setDialog({
        mode: 'confirm',
        payload: {
          title: options.title ?? 'Please confirm',
          message: options.message,
          confirmLabel: options.confirmLabel ?? 'OK',
          cancelLabel: options.cancelLabel ?? 'Cancel',
          danger: options.danger !== false,
        },
      });
    });
  }, []);

  const confirmYes = useCallback(() => {
    if (!confirmResolveRef.current) return;
    const fn = confirmResolveRef.current;
    confirmResolveRef.current = null;
    fn(true);
    setDialog(null);
  }, []);

  const value = useMemo(() => ({ showAlert, showConfirm }), [showAlert, showConfirm]);

  useEffect(() => {
    if (!dialog) return;
    const t = window.requestAnimationFrame(() => {
      if (dialog.mode === 'confirm') {
        cancelRef.current?.focus();
      } else {
        okRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(t);
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (dialog.mode === 'confirm') {
          clearConfirmResolver(false);
          setDialog(null);
        } else {
          setDialog(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, clearConfirmResolver]);

  return (
    <AlertDialogContext.Provider value={value}>
      {children}
      {dialog ? (
        <div
          className={`system-alert-overlay ${themeClass}`}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="system-alert-title"
          aria-describedby="system-alert-desc"
          onClick={e => {
            if (e.target === e.currentTarget) {
              if (dialog.mode === 'confirm') {
                clearConfirmResolver(false);
                setDialog(null);
              } else {
                setDialog(null);
              }
            }
          }}
        >
          <div className="system-alert-card" onClick={e => e.stopPropagation()}>
            {dialog.mode === 'alert' ? (
              <>
                <h2
                  id="system-alert-title"
                  className={`system-alert-title system-alert-title--${dialog.payload.variant}`}
                >
                  {dialog.payload.title}
                </h2>
                <p id="system-alert-desc" className="system-alert-message">
                  {dialog.payload.message}
                </p>
                <div className="system-alert-actions">
                  <button
                    ref={okRef}
                    type="button"
                    className="primary-button system-alert-ok"
                    onClick={() => setDialog(null)}
                  >
                    OK
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2
                  id="system-alert-title"
                  className="system-alert-title system-alert-title--warning"
                >
                  {dialog.payload.title}
                </h2>
                <p id="system-alert-desc" className="system-alert-message">
                  {dialog.payload.message}
                </p>
                <div className="system-alert-actions system-alert-actions--split">
                  <button
                    ref={cancelRef}
                    type="button"
                    className="ghost-button system-alert-cancel"
                    onClick={() => {
                      clearConfirmResolver(false);
                      setDialog(null);
                    }}
                  >
                    {dialog.payload.cancelLabel}
                  </button>
                  <button
                    ref={okRef}
                    type="button"
                    className={
                      dialog.payload.danger
                        ? 'primary-button system-alert-confirm-danger'
                        : 'primary-button system-alert-confirm'
                    }
                    onClick={confirmYes}
                  >
                    {dialog.payload.confirmLabel}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </AlertDialogContext.Provider>
  );
}

export function useAlertDialog(): AlertDialogContextValue {
  const ctx = useContext(AlertDialogContext);
  if (!ctx) {
    throw new Error('useAlertDialog must be used within AlertDialogProvider');
  }
  return ctx;
}