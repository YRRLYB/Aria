import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

type PendingConfirm = {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
};

const ConfirmDialogContext = createContext<ConfirmFn | null>(null);

/**
 * Provides an Apple-style frosted alertdialog for confirming destructive or irreversible actions.
 * Falls back to `window.confirm` when rendered outside `ConfirmDialogProvider` (e.g. unit tests).
 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;

  const closeWith = useCallback((result: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(result);
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    if (pendingRef.current) {
      pendingRef.current.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      const next = { options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeWith(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeWith, pending]);

  useEffect(() => {
    return () => {
      if (pendingRef.current) {
        pendingRef.current.resolve(false);
        pendingRef.current = null;
      }
    };
  }, []);

  const tone = pending?.options.tone ?? "danger";

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {pending && (
          <motion.div
            key="aria-confirm-backdrop"
            className="fixed inset-0 z-[130] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
          >
            <button
              type="button"
              aria-label="取消确认"
              className="absolute inset-0 cursor-default bg-neutral-950/35 backdrop-blur-[4px]"
              onClick={() => closeWith(false)}
            />
            <motion.section
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="aria-confirm-title"
              aria-describedby={pending.options.description ? "aria-confirm-desc" : undefined}
              className="aria-confirm-sheet relative z-10 w-full max-w-[23.5rem] origin-center rounded-[1.5rem] p-5 text-left"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 6 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            >
              <h2 id="aria-confirm-title" className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                {pending.options.title}
              </h2>
              {pending.options.description && (
                <p id="aria-confirm-desc" className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                  {pending.options.description}
                </p>
              )}
              <div className="mt-5 flex items-center justify-end gap-2">
                <Button
                  autoFocus
                  variant="glass"
                  size="sm"
                  onClick={() => closeWith(false)}
                >
                  {pending.options.cancelLabel ?? "取消"}
                </Button>
                <Button
                  size="sm"
                  className={cn(
                    tone === "danger"
                      ? "bg-rose-600 text-white shadow-[0_6px_18px_rgba(225,29,72,0.28)] hover:bg-rose-500"
                      : undefined,
                  )}
                  onClick={() => closeWith(true)}
                >
                  {pending.options.confirmLabel ?? (tone === "danger" ? "确认删除" : "确认")}
                </Button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmDialogContext);
  return useCallback<ConfirmFn>(
    async (options) => {
      if (ctx) return ctx(options);
      if (typeof window === "undefined") return false;
      const text = options.description ? `${options.title}\n${options.description}` : options.title;
      return window.confirm(text);
    },
    [ctx],
  );
}
