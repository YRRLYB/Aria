import { useEffect, useState, type CSSProperties } from "react";
import { useRef } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCircle2, Cookie, FolderSearch, Keyboard, Radio, RefreshCw, RotateCcw, Settings2, Sparkles, UserRound, Volume2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/music/shared";
import { api, type NeteaseAccountSummary, type NeteaseQrStart } from "@/lib/api";
import type { NativeAudioState } from "@/lib/audioTypes";
import type { AudioOutputMode } from "@/lib/playerPresentation";
import {
  defaultKeyboardShortcuts,
  formatShortcut,
  shortcutDefinitions,
  shortcutFromKeyboardEvent,
  shortcutsConflict,
  type KeyboardShortcuts,
  type ShortcutCommand,
} from "@/lib/keyboardShortcuts";
import { cn } from "@/lib/utils";
export function SettingsPanel({
  backgroundEnabled,
  onBackgroundEnabledChange,
  neteaseAccount,
  libraryMeta,
  trackCount,
  likedCount,
  lyricProgress,
  volume,
  onVolumeChange,
  audioOutputDevices,
  selectedSinkId,
  onSelectedSinkIdChange,
  hifiEnabled,
  onHifiEnabledChange,
  gaplessEnabled,
  onGaplessEnabledChange,
  nativeAudioSupported,
  nativeAudioState,
  audioOutputMode,
  onAudioOutputModeChange,
  exclusiveMode,
  keyboardShortcuts,
  onKeyboardShortcutsChange,
  onClose,
}: {
  backgroundEnabled: boolean;
  onBackgroundEnabledChange: (value: boolean) => void;
  neteaseAccount: NeteaseAccountSummary | null;
  libraryMeta: { roots: number; updatedAt: string | null };
  trackCount: number;
  likedCount: number;
  lyricProgress: number;
  volume: number;
  onVolumeChange: (value: number) => void;
  audioOutputDevices: Array<{ id: string; label: string }>;
  selectedSinkId: string;
  onSelectedSinkIdChange: (value: string) => void;
  hifiEnabled: boolean;
  onHifiEnabledChange: (value: boolean) => void;
  gaplessEnabled: boolean;
  onGaplessEnabledChange: (value: boolean) => void;
  nativeAudioSupported: boolean;
  nativeAudioState: NativeAudioState | null;
  audioOutputMode: AudioOutputMode;
  onAudioOutputModeChange: (value: AudioOutputMode) => void;
  exclusiveMode: boolean;
  keyboardShortcuts: KeyboardShortcuts;
  onKeyboardShortcutsChange: (shortcuts: KeyboardShortcuts) => void;
  onClose: () => void;
}) {
  const [apiState, setApiState] = useState<"checking" | "online" | "offline">("checking");
  const desktopReady = Boolean(window.ariaDesktop);
  const deviceSwitchSupported = audioOutputDevices.length > 0;
  const exclusiveReady = Boolean(exclusiveMode && nativeAudioSupported && nativeAudioState?.exclusive);
  const outputModeLabel =
    audioOutputMode === "exclusive" ? "WASAPI Exclusive" : audioOutputMode === "shared" ? "WASAPI Shared" : "System";

  function refreshApiState() {
    setApiState("checking");
    api
      .health()
      .then(() => setApiState("online"))
      .catch(() => setApiState("offline"));
  }

  useEffect(() => {
    let mounted = true;
    setApiState("checking");
    api
      .health()
      .then(() => {
        if (mounted) setApiState("online");
      })
      .catch(() => {
        if (mounted) setApiState("offline");
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="glass flex h-full min-h-[620px] flex-col overflow-hidden rounded-[1.5rem] border border-white/75 shadow-[0_24px_80px_rgba(47,55,76,0.14)]">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-950/6 px-5 py-4 sm:px-7">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-400">Settings</p>
            <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Aria 设置</h1>
          </div>
          <Button variant="glass" size="sm" aria-label="返回上一页" onClick={onClose}>
            <ArrowLeft />
            返回
          </Button>
        </div>

        <div className="no-scrollbar grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-y-auto p-5 sm:p-7 lg:grid-cols-2">
          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Runtime</p>
                <h3 className="mt-1 text-base font-semibold">后台托管</h3>
              </div>
              <button
                className={cn(
                  "flex h-8 w-14 items-center rounded-full p-1 transition",
                  backgroundEnabled ? "bg-neutral-950" : "bg-neutral-200",
                )}
                onClick={() => onBackgroundEnabledChange(!backgroundEnabled)}
                aria-label="切换后台托管"
              >
                <span
                  className={cn(
                    "size-6 rounded-full bg-white shadow-sm transition",
                    backgroundEnabled && "translate-x-6",
                  )}
                />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
              <Metric value={desktopReady ? "Desktop" : "Web"} label="模式" />
              <Metric value={apiState === "online" ? "Online" : apiState === "offline" ? "Offline" : "..."} label="后端" />
              <Metric value={backgroundEnabled ? "ON" : "OFF"} label="托管" />
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                className="flex-1"
                variant="subtle"
                size="sm"
                disabled={!desktopReady}
                onClick={() => window.ariaDesktop?.minimizeToTray?.()}
              >
                <Settings2 />
                托管到后台
              </Button>
              <Button
                className="flex-1"
                variant="ghost"
                size="sm"
                onClick={refreshApiState}
              >
                <RefreshCw />
                刷新状态
              </Button>
            </div>
          </section>

          <KeyboardShortcutSettings
            shortcuts={keyboardShortcuts}
            onChange={onKeyboardShortcutsChange}
          />

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Library</p>
                <h3 className="mt-1 text-base font-semibold">曲库状态</h3>
              </div>
              <Badge>{libraryMeta.roots} 个目录</Badge>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
              <Metric value={String(trackCount)} label="曲目" />
              <Metric value={String(likedCount)} label="喜欢" />
              <Metric value={`${lyricProgress}%`} label="歌词" />
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-neutral-950/8">
              <div className="h-full rounded-full bg-neutral-950/65" style={{ width: `${lyricProgress}%` }} />
            </div>
          </section>

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Account</p>
                <h3 className="mt-1 truncate text-base font-semibold">{neteaseAccount?.nickname ?? "网易云未绑定"}</h3>
              </div>
              <Badge>{neteaseAccount?.connected ? "Ready" : "Cookie"}</Badge>
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-[1rem] bg-neutral-950/[0.03] p-3">
              {neteaseAccount?.avatarUrl ? (
                <img src={neteaseAccount.avatarUrl} alt="" draggable={false} className="size-12 rounded-full object-cover" />
              ) : (
                <div className="flex size-12 items-center justify-center rounded-full bg-white shadow-sm">
                  <UserRound className="size-5" />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {neteaseAccount?.connected ? neteaseAccount.userId : "等待绑定 Cookie"}
                </p>
                <p className="mt-1 truncate text-xs text-neutral-500">{neteaseAccount?.cookiePreview ?? "右上角头像里绑定"}</p>
              </div>
            </div>
          </section>

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Audio</p>
                <h3 className="mt-1 text-base font-semibold">默认音量</h3>
              </div>
              <Badge>{volume}</Badge>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Volume2 className="size-4 shrink-0 text-neutral-500" />
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(event) => onVolumeChange(Number(event.target.value))}
                className="aria-range w-full"
                style={
                  {
                    "--range-color": "#171717",
                    "--range-value": Math.min(1, Math.max(0, volume / 100)),
                  } as CSSProperties
                }
              />
            </div>
            <div className="mt-4 rounded-[1.15rem] border border-white/70 bg-white/54 p-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Output</p>
                  <p className="mt-1 text-sm font-semibold">音频输出链路</p>
                </div>
                <Badge>{exclusiveReady ? "Locked" : outputModeLabel}</Badge>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {[
                  {
                    mode: "system" as const,
                    label: "系统音频",
                    badge: "兼容",
                    desc: "WASAPI 共享输出，频谱直接跟随播放器。",
                    Icon: Volume2,
                  },
                  {
                    mode: "shared" as const,
                    label: "WASAPI 共享",
                    badge: "兼容",
                    desc: "独立 Aria 音频会话，适合 OOPZ 等应用共享。",
                    Icon: Radio,
                  },
                  {
                    mode: "exclusive" as const,
                    label: "WASAPI 独占",
                    badge: exclusiveReady ? "Locked" : "直通",
                    desc: "独占端点，适合 DAC 或声卡直连。",
                    Icon: Sparkles,
                  },
                ].map(({ mode, label, badge, desc, Icon }) => {
                  const disabled = mode !== "system" && !nativeAudioSupported;
                  const active = audioOutputMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      disabled={disabled}
                      className={cn(
                        "flex min-h-32 flex-col justify-between rounded-[1.15rem] border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
                        active
                          ? "border-neutral-950 bg-neutral-950 text-white shadow-[0_12px_34px_rgba(23,23,23,0.16)]"
                          : "border-white/72 bg-white/72 text-neutral-950 hover:bg-white",
                      )}
                      onClick={() => onAudioOutputModeChange(mode)}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "flex size-10 items-center justify-center rounded-full",
                            active ? "bg-white/14 text-white" : "bg-neutral-950/[0.045] text-neutral-500",
                          )}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-semibold",
                            active ? "bg-white text-neutral-950" : "bg-white/80 text-neutral-500 shadow-sm",
                          )}
                        >
                          {badge}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{label}</span>
                        <span className={cn("mt-1 block text-xs leading-5", active ? "text-white/62" : "text-neutral-500")}>
                          {desc}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Device</p>
                  <p className="mt-1 text-sm font-semibold">播放设备</p>
                </div>
                <Badge>{deviceSwitchSupported ? "可切换" : "系统默认"}</Badge>
              </div>
              <div className="no-scrollbar mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                {audioOutputDevices.map((device) => {
                  const active = selectedSinkId === device.id;
                  return (
                    <button
                      key={device.id}
                      type="button"
                      disabled={!deviceSwitchSupported}
                      onClick={() => onSelectedSinkIdChange(device.id)}
                      className={cn(
                        "grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-[0.95rem] border px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                        active
                          ? "border-neutral-950 bg-neutral-950 text-white shadow-[0_12px_30px_rgba(23,23,23,0.12)]"
                          : "border-white/70 bg-white/70 hover:bg-white",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-8 items-center justify-center rounded-full",
                          active ? "bg-white/15 text-white" : "bg-neutral-950/[0.045] text-neutral-500",
                        )}
                      >
                        <Volume2 className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{device.label}</span>
                        <span className={cn("mt-0.5 block truncate text-xs", active ? "text-white/60" : "text-neutral-400")}>
                          {device.id === "default" ? "跟随系统默认输出" : device.id}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-semibold",
                          active ? "bg-white text-neutral-950" : "bg-white/80 text-neutral-500 shadow-sm",
                        )}
                      >
                        {active ? "当前" : "选择"}
                      </span>
                    </button>
                  );
                })}
                {!audioOutputDevices.length && (
                  <div className="rounded-[0.95rem] bg-white/65 px-3 py-4 text-sm text-neutral-500">没有检测到可用输出设备。</div>
                )}
              </div>
              <p className="mt-2 truncate text-xs text-neutral-500">
                {nativeAudioState?.deviceId ? `当前设备: ${nativeAudioState.deviceId}` : "当前设备: 默认输出"}
              </p>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-[1rem] bg-neutral-950/[0.03] p-3">
              <div>
                <p className="text-sm font-semibold">HiFi 优先</p>
                <p className="mt-1 text-xs text-neutral-500">自动请求当前歌曲可用的最高音质。</p>
              </div>
              <button
                className={cn(
                  "flex h-8 w-14 items-center rounded-full p-1 transition",
                  hifiEnabled ? "bg-neutral-950" : "bg-neutral-200",
                )}
                onClick={() => onHifiEnabledChange(!hifiEnabled)}
                aria-label="切换 HiFi 优先"
              >
                <span
                  className={cn(
                    "size-6 rounded-full bg-white shadow-sm transition",
                    hifiEnabled && "translate-x-6",
                  )}
                />
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-[1rem] bg-neutral-950/[0.03] p-3">
              <div>
                <p className="text-sm font-semibold">无缝衔接</p>
                <p className="mt-1 text-xs text-neutral-500">提前加载下一首，减少歌曲切换时的空隙。</p>
              </div>
              <button
                className={cn(
                  "flex h-8 w-14 items-center rounded-full p-1 transition",
                  gaplessEnabled ? "bg-neutral-950" : "bg-neutral-200",
                )}
                onClick={() => onGaplessEnabledChange(!gaplessEnabled)}
                aria-label="切换无缝衔接"
                aria-pressed={gaplessEnabled}
              >
                <span
                  className={cn(
                    "size-6 rounded-full bg-white shadow-sm transition",
                    gaplessEnabled && "translate-x-6",
                  )}
                />
              </button>
            </div>
          </section>
        </div>
        <div className="flex items-center justify-between border-t border-neutral-950/6 px-5 py-3 text-xs text-neutral-400 sm:px-7">
          <span>Aria Desktop</span>
          <span>v{__APP_VERSION__}</span>
        </div>
    </div>
  );
}

function KeyboardShortcutSettings({
  shortcuts,
  onChange,
}: {
  shortcuts: KeyboardShortcuts;
  onChange: (shortcuts: KeyboardShortcuts) => void;
}) {
  const [recording, setRecording] = useState<ShortcutCommand | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;

    const captureShortcut = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(null);
        setMessage(null);
        return;
      }

      const candidate = shortcutFromKeyboardEvent(event);
      if (!candidate) {
        setMessage("请按住 Ctrl、Alt、Shift 或 Win，再按一个功能键。");
        return;
      }
      if (shortcutsConflict(shortcuts, recording, candidate)) {
        setMessage("该组合已分配给其他操作。");
        return;
      }

      onChange({ ...shortcuts, [recording]: candidate });
      setRecording(null);
      setMessage(null);
    };

    window.addEventListener("keydown", captureShortcut, true);
    return () => window.removeEventListener("keydown", captureShortcut, true);
  }, [onChange, recording, shortcuts]);

  return (
    <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Shortcuts</p>
          <h3 className="mt-1 text-base font-semibold">全局快捷键</h3>
        </div>
        <Keyboard className="size-5 text-neutral-400" />
      </div>
      <p className="mt-2 text-xs leading-5 text-neutral-500">后台托管或切到其他软件时仍可使用。点击组合键后直接按新的按键。</p>
      <div className="mt-3 space-y-2">
        {shortcutDefinitions.map((definition) => {
          const isRecording = recording === definition.command;
          return (
            <div key={definition.command} className="flex items-center gap-3 rounded-[1rem] bg-white/56 px-3 py-2.5 shadow-sm">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{definition.label}</p>
                <p className="mt-0.5 truncate text-xs text-neutral-500">{definition.description}</p>
              </div>
              <button
                type="button"
                className={cn(
                  "min-w-28 rounded-xl border px-3 py-2 text-xs font-semibold transition",
                  isRecording
                    ? "border-neutral-950 bg-neutral-950 text-white shadow-[0_10px_22px_rgba(23,23,23,0.16)]"
                    : "border-neutral-950/10 bg-white text-neutral-700 hover:border-neutral-950/30",
                )}
                onClick={() => {
                  setRecording(definition.command);
                  setMessage(null);
                }}
              >
                {isRecording ? "按下组合键" : formatShortcut(shortcuts[definition.command])}
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-h-4 text-xs text-rose-500">{message}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange({ ...defaultKeyboardShortcuts });
            setRecording(null);
            setMessage(null);
          }}
        >
          <RotateCcw />
          恢复默认
        </Button>
      </div>
    </section>
  );
}

export function AccountPanel({
  onClose,
  onAccountChange,
  initialAccount = null,
  embedded = false,
}: {
  onClose: () => void;
  onAccountChange?: (account: NeteaseAccountSummary) => void;
  initialAccount?: NeteaseAccountSummary | null;
  embedded?: boolean;
}) {
  const [cookie, setCookie] = useState("");
  const [account, setAccount] = useState<NeteaseAccountSummary | null>(initialAccount);
  const [qrLogin, setQrLogin] = useState<NeteaseQrStart | null>(null);
  const [qrStatus, setQrStatus] = useState("点击生成二维码后，用网易云音乐扫码登录。");
  const [showCookie, setShowCookie] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const qrSyncingRef = useRef(false);
  const accountChangeRef = useRef(onAccountChange);
  accountChangeRef.current = onAccountChange;

  useEffect(() => {
    let mounted = true;
    api
      .getSettings()
      .then((settings) => {
        if (mounted) {
          setAccount((current) => (current?.connected ? current : settings.neteaseAccount));
        }
      })
      .catch(() => {
        if (mounted) setMessage("后端未连接");
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (initialAccount?.connected) setAccount(initialAccount);
  }, [initialAccount]);

  useEffect(() => {
    if (!qrLogin) return;

    let cancelled = false;
    const check = async () => {
      try {
        const result = await api.checkNeteaseQrLogin(qrLogin.key);
        if (cancelled) return;

        if (result.status === "success" && result.account) {
          setAccount(result.account);
          accountChangeRef.current?.(result.account);
          if (qrSyncingRef.current) return;
          qrSyncingRef.current = true;
          setQrStatus("登录已确认，正在同步账号信息...");
          setMessage("网易云账号已登录");
          let attempts = 0;
          const refreshAccount = () => {
            attempts += 1;
            void api.getSettings().then((settings) => {
              if (settings.neteaseAccount.connected) {
                setAccount(settings.neteaseAccount);
                accountChangeRef.current?.(settings.neteaseAccount);
                setQrLogin(null);
                setQrStatus("登录成功，账号信息已同步。");
                qrSyncingRef.current = false;
                return;
              }
              if (attempts < 12 && !cancelled) window.setTimeout(refreshAccount, 500);
              else qrSyncingRef.current = false;
            }).catch(() => {
              if (attempts < 12 && !cancelled) window.setTimeout(refreshAccount, 500);
              else qrSyncingRef.current = false;
            });
          };
          refreshAccount();
          return;
        }

        if (result.status === "expired") {
          setQrStatus("二维码已过期，请重新生成。");
          return;
        }

        setQrStatus(result.status === "scanned" ? "已扫码，请在手机上确认登录。" : "等待扫码确认。");
      } catch {
        if (!cancelled) setQrStatus("扫码状态获取失败，稍后会自动重试。");
      }
    };

    check();
    const timer = window.setInterval(check, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [qrLogin]);

  async function startQrLogin() {
    setQrLoading(true);
    setMessage(null);
    qrSyncingRef.current = false;
    try {
      const result = await api.startNeteaseQrLogin();
      setQrLogin(result);
      setQrStatus("请用网易云音乐 App 扫码。");
    } catch {
      setMessage("二维码生成失败，请确认后端正在运行。");
    } finally {
      setQrLoading(false);
    }
  }

  async function bindCookie() {
    if (!cookie.trim()) {
      setMessage("请先粘贴 Cookie");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const result = await api.saveNeteaseCookie(cookie.trim());
      setAccount(result.account);
      onAccountChange?.(result.account);
      setCookie("");
      setMessage("Cookie 已保存");
    } catch {
      setMessage("保存失败，请确认后端正在运行");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.22 }}
      className={cn(
        "glass z-50 w-[min(25rem,calc(100vw-2rem))] rounded-[1.4rem] p-4",
        embedded ? "relative right-auto top-auto w-full shadow-none" : "absolute right-0 top-14",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {account?.avatarUrl ? (
            <img src={account.avatarUrl} alt="" draggable={false} className="size-12 rounded-full object-cover shadow-sm" />
          ) : (
            <div className="flex size-12 items-center justify-center rounded-full bg-neutral-950 text-white">
              <UserRound className="size-5" />
            </div>
          )}
          <div>
            <p className="font-semibold">{account?.nickname ?? "网易云账号"}</p>
            <p className="mt-1 text-xs text-neutral-500">
              {account?.connected ? "已登录并同步 Cookie" : "扫码登录更适合日常使用"}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭账号面板" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="mt-4 rounded-[1.2rem] border border-white/70 bg-white/64 p-3 shadow-sm">
        <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[1rem] bg-white shadow-inner">
            {qrLogin?.qrImage ? (
              <img src={qrLogin.qrImage} alt="网易云扫码登录二维码" draggable={false} className="size-full object-contain p-2" />
            ) : account?.avatarUrl ? (
              <img src={account.avatarUrl} alt="" draggable={false} className="size-full object-cover" />
            ) : (
              <UserRound className="size-9 text-neutral-300" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{account?.connected ? "账号已同步" : "扫码登录"}</p>
            <p className="mt-1 min-h-10 text-xs leading-relaxed text-neutral-500">{qrStatus}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={startQrLogin} disabled={qrLoading}>
                <RefreshCw />
                {qrLoading ? "生成中" : qrLogin ? "刷新二维码" : "生成二维码"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="mt-3 flex w-full items-center justify-between rounded-[1rem] bg-white/50 px-3 py-2 text-left text-sm font-medium shadow-sm transition hover:bg-white/72"
        onClick={() => setShowCookie((value) => !value)}
      >
        <span className="flex items-center gap-2">
          <Cookie className="size-4" />
          Cookie 备用绑定
        </span>
        <span className="text-xs text-neutral-400">{showCookie ? "收起" : "展开"}</span>
      </button>

      {showCookie && (
        <div className="mt-3 rounded-[1.1rem] bg-white/58 p-3 shadow-sm">
          <label className="text-xs font-medium text-neutral-500" htmlFor="cookie">
            网易云 Cookie
          </label>
          <textarea
            id="cookie"
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            rows={4}
            placeholder="MUSIC_U=...; NMTID=..."
            className="mt-2 w-full resize-none rounded-[0.9rem] border border-white/70 bg-white/70 p-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-300"
          />
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={bindCookie} disabled={saving}>
              <Cookie />
              {saving ? "保存中" : "绑定 Cookie"}
            </Button>
          </div>
        </div>
      )}
      {message && <p className="mt-3 text-xs text-neutral-500">{message}</p>}

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
        <Metric value={account?.connected ? "ON" : "--"} label="状态" />
        <Metric value={account?.userId ?? "--"} label="用户" />
        <Metric value={account?.connected ? "Ready" : "--"} label="同步" />
      </div>
    </motion.div>
  );
}

export function OnboardingDialog({
  neteaseAccount,
  hifiEnabled,
  onHifiEnabledChange,
  backgroundEnabled,
  onBackgroundEnabledChange,
  gaplessEnabled,
  onGaplessEnabledChange,
  onAddLocalMusic,
  localMusicInfo,
  scanProgress,
  onAccountChange,
  onComplete,
}: {
  neteaseAccount: NeteaseAccountSummary | null;
  hifiEnabled: boolean;
  onHifiEnabledChange: (value: boolean) => void;
  backgroundEnabled: boolean;
  onBackgroundEnabledChange: (value: boolean) => void;
  gaplessEnabled: boolean;
  onGaplessEnabledChange: (value: boolean) => void;
  onAddLocalMusic: () => void;
  localMusicInfo: { path: string; count: number } | null;
  scanProgress: { phase: string; processed: number; total: number; status: string; error?: string | null } | null;
  onAccountChange: (account: NeteaseAccountSummary) => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState(0);

  function finish() {
    try {
      window.localStorage.setItem("aria-onboarding-complete", "1");
    } catch {
      // The wizard should never block normal playback when storage is unavailable.
    }
    onComplete();
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-neutral-950/25 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="max-h-[min(90vh,52rem)] w-full max-w-2xl overflow-y-auto rounded-[1.5rem] border border-white/80 bg-[#f7f8fa]/95 p-5 shadow-[0_30px_100px_rgba(20,24,35,0.24)] sm:p-7"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-400">Aria</p>
            <h1 className="mt-1 text-2xl font-semibold">开始使用 Aria</h1>
          </div>
          <div className="flex items-center gap-1.5" aria-label={`第 ${step + 1} 步，共 4 步`}>
            {[0, 1, 2, 3].map((item) => (
              <span key={item} className={cn("size-2 rounded-full", item === step ? "bg-neutral-950" : "bg-neutral-300")} />
            ))}
          </div>
        </div>

        {step === 0 && (
          <div className="mt-8 grid gap-5 sm:grid-cols-[1.1fr_0.9fr] sm:items-center">
            <div>
              <h2 className="text-3xl font-semibold leading-tight">你的音乐，<br />从这里开始。</h2>
              <p className="mt-4 text-sm leading-6 text-neutral-500">Aria 把本地音乐、网易云歌单和高音质播放集中在一个安静的工作台里。</p>
            </div>
            <div className="rounded-[1.25rem] bg-neutral-950 p-5 text-white shadow-lg">
              <p className="text-xs uppercase tracking-[0.2em] text-white/55">Ready when you are</p>
              <div className="mt-5 space-y-3 text-sm text-white/80">
                <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#9db2ff]" />网易云流媒体</p>
                <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#9db2ff]" />本地无损音乐</p>
                <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#9db2ff]" />任务栏快捷控制</p>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold">添加你的本地音乐</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-500">选择一个音乐文件夹，Aria 会扫描歌曲、封面、码率和采样率。文件不会被复制或移动，扫描完成后可以在左侧“本地音乐”查看。</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[1.1rem] bg-white/70 p-4 shadow-sm"><p className="font-medium">选择文件夹</p><p className="mt-1 text-xs leading-5 text-neutral-500">支持 FLAC、ALAC、WAV、MP3 等常见格式。</p></div>
              <div className="rounded-[1.1rem] bg-white/70 p-4 shadow-sm"><p className="font-medium">自动识别</p><p className="mt-1 text-xs leading-5 text-neutral-500">读取内嵌封面、艺术家、专辑和真实音频参数。</p></div>
              <div className="rounded-[1.1rem] bg-white/70 p-4 shadow-sm"><p className="font-medium">随时管理</p><p className="mt-1 text-xs leading-5 text-neutral-500">设置中的本地音乐入口可以重新扫描或清除索引。</p></div>
            </div>
            {localMusicInfo && (
              <div className="mt-5 grid gap-3 rounded-[1.1rem] border border-emerald-200/70 bg-emerald-50/70 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-700/70">已选择本地音乐</p>
                  <p className="mt-1 truncate text-sm font-semibold text-emerald-950" title={localMusicInfo.path}>{localMusicInfo.path}</p>
                </div>
                <p className="text-lg font-semibold text-emerald-900">{localMusicInfo.count} 首</p>
              </div>
            )}
            {scanProgress?.status === "running" && (
              <div className="mt-4 rounded-[1rem] border border-sky-200/70 bg-sky-50/70 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">正在扫描本地音乐</span>
                  <span className="text-sky-700">{scanProgress.total ? String(scanProgress.processed) + "/" + String(scanProgress.total) : "准备中"}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-sky-100">
                  <div className="h-full rounded-full bg-sky-500 transition-[width] duration-200" style={{ width: (scanProgress.total ? Math.min(100, scanProgress.processed / scanProgress.total * 100) : 8) + "%" }} />
                </div>
              </div>
            )}
            <Button className="mt-5" onClick={onAddLocalMusic}><FolderSearch />{localMusicInfo ? "重新选择文件夹" : "选择本地音乐文件夹"}</Button>
          </div>
        )}

        {step === 2 && (
          <div className="mt-5">
            <h2 className="text-xl font-semibold">连接网易云音乐</h2>
            <p className="mt-2 text-sm text-neutral-500">登录后可以同步每日推荐、私人漫游、歌单和真实音质信息。也可以稍后在右上角完成。</p>
            {neteaseAccount?.connected && (
              <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="size-4" />已登录：{neteaseAccount.nickname ?? "网易云账号"}</p>
            )}
            <div className="mt-4 overflow-hidden rounded-[1.25rem] bg-white/55">
              <AccountPanel
                embedded
                initialAccount={neteaseAccount}
                onClose={() => undefined}
                onAccountChange={onAccountChange}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold">设置你的播放偏好</h2>
            <p className="mt-2 text-sm text-neutral-500">这些选项之后都可以在设置中修改。</p>
            <div className="mt-5 space-y-3">
              {[
                ["后台托管", "关闭主窗口后继续播放，并保留任务栏与媒体快捷控制。", backgroundEnabled, onBackgroundEnabledChange],
                ["HiFi 优先", "自动请求当前歌曲可用的最高音质。", hifiEnabled, onHifiEnabledChange],
                ["无缝衔接", "提前加载下一首，减少歌曲切换时的空隙。", gaplessEnabled, onGaplessEnabledChange],
              ].map(([label, description, enabled, onChange]) => (
                <div key={String(label)} className="flex items-center justify-between gap-4 rounded-[1.1rem] bg-white/70 p-4 shadow-sm">
                  <div><p className="font-medium">{String(label)}</p><p className="mt-1 text-xs leading-5 text-neutral-500">{String(description)}</p></div>
                  <button
                    className={cn("flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition", enabled ? "bg-neutral-950" : "bg-neutral-200")}
                    onClick={() => (onChange as (value: boolean) => void)(!enabled)}
                    aria-label={`切换 ${String(label)}`}
                    aria-pressed={Boolean(enabled)}
                  >
                    <span className={cn("size-6 rounded-full bg-white shadow-sm transition", enabled && "translate-x-6")} />
                  </button>
                </div>
              ))}
            </div>
            {neteaseAccount?.connected && (
              <p className="mt-4 flex items-center gap-2 text-sm text-neutral-600"><CheckCircle2 className="size-4 text-emerald-600" />已连接 {neteaseAccount.nickname ?? "网易云账号"}</p>
            )}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          <button className="text-sm text-neutral-500 transition hover:text-neutral-950" onClick={finish}>稍后设置</button>
          <Button onClick={() => (step < 3 ? setStep((value) => value + 1) : finish())}>
            {step < 3 ? "继续" : "完成"}
            {step < 3 ? <ArrowRight /> : <CheckCircle2 />}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}







