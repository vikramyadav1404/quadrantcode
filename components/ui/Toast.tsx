'use client';

/**
 * Minimal toast system.
 *
 * The region is `aria-live="polite"` and `role="status"`, so a screen reader
 * announces a toast without stealing focus — a toast that grabs focus would
 * interrupt whatever the user was typing.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';
export type Toast = { id: string; message: string; tone: ToastTone };

const ToastContext = createContext<{
  push: (message: string, tone?: ToastTone) => void;
} | null>(null);

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'border-[var(--border)] text-[var(--text-primary)]',
  success: 'border-[var(--success)] text-[var(--success)]',
  warning: 'border-[var(--warning)] text-[var(--warning)]',
  danger: 'border-[var(--danger)] text-[var(--danger)]',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto w-full max-w-sm rounded-[var(--radius)] border bg-[var(--surface-raised)] px-4 py-3 text-sm shadow-lg ${TONE_CLASS[toast.tone]}`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>.');
  return context;
}
