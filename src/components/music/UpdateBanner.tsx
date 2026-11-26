import { useState } from "react";
import { Download, ExternalLink, RefreshCw, RotateCw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UpdateState } from "@/lib/api";
import { cn } from "@/lib/utils";

export function formatTransferSpeed(bytesPerSecond: number | null | undefined): string | null {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`;
}

export function UpdateHeaderPill({
  state,
  onClick,
}: {
  state: UpdateState | null;
  onClick: () => void;
}) {
  if (!state) return null;
  const isAvailable = state.status === "available";
  const isDownloading = state.status === "downloading";
  const isDownloaded = state.status === "downloaded";
  const isInstalling = state.status === "installing";
  if (!isAvailable && !isDownloading && !isDownloaded && !isInstalling) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={
        isDownloaded
          ? `v${state.availableVersion ?? ""} 已就绪，点击重启并更新`
          : isDownloading
            ? `正在下载 v${state.availableVersion ?? ""} (${Math.round(state.percent ?? 0)}%)`
            : isInstalling
              ? "正在启动安装程序…"
              : `发现新版本 v${state.availableVersion ?? ""}`
      }
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition",
        isDownloaded || isInstalling
          ? "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
          : "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)] hover:brightness-95",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isDownloaded || isInstalling ? "bg-emerald-500" : "bg-[var(--accent)]",
          isDownloading && "animate-pulse",
        )}
      />
      {isDownloaded ? (
        <span>重启更新</span>
      ) : isInstalling ? (
        <span>正在安装…</span>
      ) : isDownloading ? (
        <span className="tabular-nums">更新 {Math.round(state.percent ?? 0)}%</span>
      ) : (
        <span>新版本 v{state.availableVersion}</span>
      )}
    </button>
  );
}

export function UpdateToastCard({
  state,
  open,
  onClose,
  onRunAction,
}: {
  state: UpdateState | null;
  open: boolean;
  onClose: () => void;
  onRunAction: (action: () => Promise<UpdateState | boolean>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  if (!open || !state) return null;
  const visibleStatus =
    state.status === "available" ||
    state.status === "downloading" ||
    state.status === "downloaded" ||
    state.status === "installing" ||
    (state.status === "error" && Boolean(state.availableVersion));
  if (!visibleStatus) return null;

  const updates = window.ariaDesktop?.updates;
  if (!updates) return null;
  const speedText = formatTransferSpeed(state.bytesPerSecond);

  const invoke = async (fn: () => Promise<UpdateState | boolean>) => {
    setBusy(true);
    try {
      await onRunAction(fn);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Aria 软件更新"
      className="fixed bottom-5 right-5 z-[85] w-[min(92vw,372px)] rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4 text-[var(--text-primary)] shadow-[0_24px_60px_rgba(18,22,36,0.22)] backdrop-blur-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {state.status === "downloaded"
                ? `v${state.availableVersion ?? ""} 已准备就绪`
                : state.status === "installing"
                  ? "正在安装更新…"
                  : `发现新版本 v${state.availableVersion ?? ""}`}
            </p>
            <p className="text-[11px] text-[var(--text-secondary)]">
              当前 v{state.currentVersion}
              {state.availableVersion ? ` → v${state.availableVersion}` : ""}
            </p>
          </div>
        </div>
        {state.status !== "installing" && (
          <button
            type="button"
            aria-label="稍后再说"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {state.releaseNotes && (
        <div className="mt-3 max-h-36 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)] whitespace-pre-line">
          {state.releaseNotes}
        </div>
      )}

      {state.status === "downloading" && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] tabular-nums">
            <span>正在下载安装包… {Math.round(state.percent ?? 0)}%</span>
            {speedText && <span>{speedText}</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-200"
              style={{ width: `${Math.max(2, Math.min(100, state.percent ?? 0))}%` }}
            />
          </div>
        </div>
      )}

      {state.status === "error" && state.error && (
        <p className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/8 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
          {state.error}
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2">
        {state.status !== "downloading" && state.status !== "installing" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            稍后提醒
          </Button>
        )}
        {state.status === "available" && state.manualDownloadOnly && updates.openReleases && (
          <Button size="sm" disabled={busy} onClick={() => void invoke(() => updates.openReleases!())}>
            <ExternalLink />
            前往下载
          </Button>
        )}
        {state.status === "available" && !state.manualDownloadOnly && (
          <Button size="sm" disabled={busy} onClick={() => void invoke(() => updates.download())}>
            <Download />
            立即下载更新
          </Button>
        )}
        {state.status === "error" && state.availableVersion && !state.manualDownloadOnly && (
          <Button size="sm" disabled={busy} onClick={() => void invoke(() => updates.download())}>
            <RefreshCw />
            重试下载
          </Button>
        )}
        {(state.status === "error" || state.manualDownloadOnly) && updates.openReleases && (
          <Button size="sm" variant="glass" disabled={busy} onClick={() => void invoke(() => updates.openReleases!())}>
            打开发布页
          </Button>
        )}
        {state.status === "downloaded" && (
          <Button size="sm" disabled={busy} onClick={() => void invoke(() => updates.install())}>
            <RotateCw />
            立即重启并安装
          </Button>
        )}
      </div>
    </div>
  );
}
