import { useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Cloud,
  Eye,
  EyeOff,
  FolderSync,
  HardDrive,
  Info,
  LoaderCircle,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Track } from "@/data/music";
import { api, type PrivateCloudInstancePublic, type PrivateCloudUpsertPayload } from "@/lib/api";
import { formatAudioDetail } from "@/lib/playerPresentation";
import { cn } from "@/lib/utils";
import { SourceBadge } from "./SourceLogos";
import { AddToPlaylistButton } from "./PlaylistActions";
import { CopyableTrackText, CoverArt, EmptyState } from "./shared";
import { useTrackContextMenu } from "./TrackContextMenu";

type QualityFilter = "all" | "hires" | "lossless" | "high";

type QuickPreset = {
  id: "alist" | "navidrome" | "nas" | "jianguoyun";
  kind: "subsonic" | "webdav";
  title: string;
  shortTitle: string;
  subtitle: string;
  defaultName: string;
  defaultUrl: string;
  placeholderUrl: string;
  defaultRootPath: string;
  helperTip: string;
};

const QUICK_PRESETS: QuickPreset[] = [
  {
    id: "alist",
    kind: "webdav",
    title: "Alist 网盘挂载",
    shortTitle: "Alist 网盘",
    subtitle: "阿里云盘 / 夸克 / 百度等挂载直连",
    defaultName: "Alist 网盘",
    defaultUrl: "http://127.0.0.1:5244/dav",
    placeholderUrl: "http://你的IP:5244/dav",
    defaultRootPath: "/",
    helperTip: "Alist 地址末尾通常需要保留 /dav，用户名与密码请在 Alist 后台用户管理中查看。",
  },
  {
    id: "navidrome",
    kind: "subsonic",
    title: "Navidrome 音乐库",
    shortTitle: "Navidrome / Gonic",
    subtitle: "支持 Navidrome / Gonic / OpenSubsonic",
    defaultName: "家庭 Navidrome",
    defaultUrl: "http://192.168.1.100:4533",
    placeholderUrl: "http://192.168.1.100:4533",
    defaultRootPath: "/",
    helperTip: "直接粘贴网页登录地址（无需去掉 #/app 后缀，Aria 会自动识别）并填写你的登录账号密码。",
  },
  {
    id: "nas",
    kind: "webdav",
    title: "飞牛 / 群晖 / 极空间 NAS",
    shortTitle: "家用 NAS",
    subtitle: "群晖 WebDAV / 飞牛 fnOS / Alist局域网",
    defaultName: "家庭 NAS 音乐库",
    defaultUrl: "http://192.168.1.100:5005",
    placeholderUrl: "http://192.168.1.100:5005",
    defaultRootPath: "/Music",
    helperTip: "先在 NAS 套件中心启用 WebDAV Server，再填写局域网地址及音乐所在文件夹路径（如 /Music）。",
  },
  {
    id: "jianguoyun",
    kind: "webdav",
    title: "坚果云 WebDAV",
    shortTitle: "坚果云",
    subtitle: "云端个人曲库与设置漫游通用",
    defaultName: "坚果云 WebDAV",
    defaultUrl: "https://dav.jianguoyun.com/dav",
    placeholderUrl: "https://dav.jianguoyun.com/dav",
    defaultRootPath: "/Aria",
    helperTip: "请在坚果云网页版「账户信息 → 安全选项 → 第三方应用管理」中生成专用应用密码，不可用登录密码。",
  },
];

function cleanPastedUrl(raw: string, kind: "subsonic" | "webdav"): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const parsed = new URL(withScheme);
    parsed.hash = "";
    parsed.search = "";
    if (kind === "subsonic") {
      parsed.pathname = parsed.pathname.replace(/\/+(?:app|rest|login)(?:\/.*)?$/i, "") || "/";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

export function PrivateCloudSurface({
  instances,
  tracks,
  loading,
  error,
  activeTrackId,
  onRefreshInstances,
  onRefreshTracks,
  onPickTrack,
  onPlayNext,
  onNotice,
  headerTabs,
}: {
  instances: PrivateCloudInstancePublic[];
  tracks: Track[];
  loading: boolean;
  error: string | null;
  activeTrackId?: string;
  onRefreshInstances: () => Promise<void>;
  onRefreshTracks: (instanceId?: string) => Promise<void>;
  onPickTrack: (id: string, queue?: Track[]) => void;
  onPlayNext: (id: string) => void;
  onNotice: (message: string) => void;
  headerTabs?: ReactNode;
}) {
  const confirm = useConfirm();
  const trackMenu = useTrackContextMenu();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("all");
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [searchFilter, setSearchFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<QuickPreset["id"]>("navidrome");
  const [kind, setKind] = useState<"subsonic" | "webdav">("subsonic");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rootPath, setRootPath] = useState("/");
  const [mobileTranscodeBitrate, setMobileTranscodeBitrate] = useState(192);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draftTesting, setDraftTesting] = useState(false);
  const [draftStatus, setDraftStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [testBadges, setTestBadges] = useState<Record<string, { ok: boolean; label: string }>>({});

  function applyPreset(preset: QuickPreset) {
    setActivePresetId(preset.id);
    setKind(preset.kind);
    if (!editingId) {
      setName(preset.defaultName);
      setBaseUrl(preset.defaultUrl);
      setRootPath(preset.defaultRootPath);
    }
    setDraftStatus(null);
  }

  function openCreateWithPreset(preset: QuickPreset = QUICK_PRESETS[0]) {
    setEditingId(null);
    setActivePresetId(preset.id);
    setKind(preset.kind);
    setName(preset.defaultName);
    setBaseUrl(preset.defaultUrl);
    setUsername("");
    setPassword("");
    setShowPassword(false);
    setRootPath(preset.defaultRootPath);
    setMobileTranscodeBitrate(192);
    setShowAdvanced(false);
    setDraftStatus(null);
    setFormOpen(true);
  }

  function openEdit(item: PrivateCloudInstancePublic) {
    setEditingId(item.id);
    setActivePresetId(item.kind === "subsonic" ? "navidrome" : item.baseUrl.includes("5244") ? "alist" : "nas");
    setKind(item.kind);
    setName(item.name);
    setBaseUrl(item.baseUrl);
    setUsername(item.username);
    setPassword("");
    setShowPassword(false);
    setRootPath(item.rootPath || "/");
    setMobileTranscodeBitrate(item.mobileTranscodeBitrate ?? 192);
    setShowAdvanced(false);
    setDraftStatus(null);
    setFormOpen(true);
  }

  async function handleDraftTest() {
    if (!baseUrl.trim()) {
      setDraftStatus({ ok: false, text: "请先填写服务器地址（例如 http://192.168.1.100:4533 或 5244/dav）。" });
      return;
    }
    const cleaned = cleanPastedUrl(baseUrl, kind);
    if (cleaned) setBaseUrl(cleaned);
    setDraftTesting(true);
    setDraftStatus(null);
    try {
      const res = await api.testPrivateCloudDraft({
        ...(editingId ? { instanceId: editingId } : {}),
        kind,
        name: name.trim() || "测试实例",
        baseUrl: cleaned || baseUrl.trim(),
        username: username.trim(),
        ...(password ? { password } : {}),
        ...(kind === "webdav" ? { rootPath: rootPath.trim() || "/" } : { mobileTranscodeBitrate }),
      });
      if (res.normalizedUrl) setBaseUrl(res.normalizedUrl);
      if (res.ok) {
        const version = res.serverVersion ? `（${res.serverVersion}）` : "";
        setDraftStatus({ ok: true, text: `连接成功，延迟 ${res.latencyMs ?? 0}ms${version}` });
      } else {
        setDraftStatus({ ok: false, text: res.reason || "连接失败，请核对地址与账号密码。" });
      }
    } catch (err) {
      setDraftStatus({ ok: false, text: err instanceof Error ? err.message : "连接测试失败" });
    } finally {
      setDraftTesting(false);
    }
  }

  async function handleSave() {
    if (!baseUrl.trim()) {
      setDraftStatus({ ok: false, text: "请填写服务器地址" });
      return;
    }
    const cleaned = cleanPastedUrl(baseUrl, kind);
    setSaving(true);
    setDraftStatus(null);
    try {
      const payload: PrivateCloudUpsertPayload = {
        kind,
        name: name.trim() || (kind === "subsonic" ? "OpenSubsonic 服务器" : "WebDAV 网盘"),
        baseUrl: cleaned || baseUrl.trim(),
        username: username.trim(),
        ...(password ? { password } : {}),
        ...(kind === "webdav" ? { rootPath: rootPath.trim() || "/" } : { mobileTranscodeBitrate }),
      };
      const saved = editingId
        ? (await api.updatePrivateCloudInstance(editingId, payload)).instance
        : (await api.createPrivateCloudInstance(payload)).instance;

      setFormOpen(false);
      await onRefreshInstances();
      // Beginner-friendly one-step flow: scan/sync tracks right after saving.
      try {
        const scanRes = await api.scanPrivateCloudInstance(saved.id);
        onNotice(
          `${saved.name} 已连接并同步（发现 ${scanRes.progress.discovered} 首曲目）`,
        );
      } catch {
        onNotice(`${saved.name} 配置已保存，点击卡片「${saved.kind === "webdav" ? "增量扫库" : "同步曲库"}」即可拉取音乐`);
      }
      await onRefreshInstances();
      await onRefreshTracks();
      window.dispatchEvent(new Event("aria-sources-changed"));
    } catch (err) {
      setDraftStatus({ ok: false, text: err instanceof Error ? err.message : "保存实例失败" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(item: PrivateCloudInstancePublic) {
    setTestingId(item.id);
    try {
      const res = await api.testPrivateCloudInstance(item.id);
      if (res.ok) {
        const version = res.serverVersion ? ` · ${res.serverVersion}` : "";
        setTestBadges((prev) => ({
          ...prev,
          [item.id]: { ok: true, label: `连通正常 ${res.latencyMs ?? 0}ms${version}` },
        }));
      } else {
        setTestBadges((prev) => ({
          ...prev,
          [item.id]: { ok: false, label: res.reason || "连接失败" },
        }));
      }
    } catch (err) {
      setTestBadges((prev) => ({
        ...prev,
        [item.id]: { ok: false, label: err instanceof Error ? err.message : "连接失败" },
      }));
    } finally {
      setTestingId(null);
    }
  }

  async function handleScan(item: PrivateCloudInstancePublic) {
    setScanningId(item.id);
    try {
      const res = await api.scanPrivateCloudInstance(item.id);
      await onRefreshInstances();
      await onRefreshTracks();
      onNotice(
        `${item.name} 同步完成：发现 ${res.progress.discovered} 首（新增解析 ${res.progress.scanned}，跳过未变更 ${res.progress.skipped}）`,
      );
    } catch (err) {
      onNotice(err instanceof Error ? err.message : "扫描私有云曲库失败");
    } finally {
      setScanningId(null);
    }
  }

  async function handleDelete(item: PrivateCloudInstancePublic) {
    const ok = await confirm({
      title: `移除私有云实例“${item.name}”？`,
      description: "仅清除 Aria 内的实例配置与本地增量索引，不会删除远端 NAS 或服务器上的文件。",
      confirmLabel: "确认移除",
      tone: "danger",
    });
    if (!ok) return;
    await api.deletePrivateCloudInstance(item.id);
    await onRefreshInstances();
    await onRefreshTracks();
    window.dispatchEvent(new Event("aria-sources-changed"));
    onNotice(`已移除“${item.name}”`);
  }

  const filteredTracks = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    return tracks.filter((track) => {
      if (selectedInstanceId !== "all") {
        const instance = instances.find((item) => item.id === selectedInstanceId);
        if (instance?.kind === "subsonic" && !track.providerId?.startsWith(`${selectedInstanceId}:`)) {
          return false;
        }
        if (instance?.kind === "webdav" && track.source !== "webdav") {
          return false;
        }
      }
      if (qualityFilter === "hires" && track.quality !== "Hi-Res") return false;
      if (qualityFilter === "lossless" && track.quality !== "Hi-Res" && track.quality !== "FLAC" && track.quality !== "Lossless") {
        return false;
      }
      if (qualityFilter === "high" && track.quality === "128K") return false;
      if (!q) return true;
      return `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(q);
    });
  }, [tracks, selectedInstanceId, instances, qualityFilter, searchFilter]);

  const currentPreset = QUICK_PRESETS.find((p) => p.id === activePresetId) ?? QUICK_PRESETS[0];

  return (
    <div className="aria-page-shell flex h-full min-h-[620px] flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-7">
      <div className="aria-page-header flex shrink-0 flex-wrap items-center justify-between gap-3 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="aria-flat-well flex size-10 shrink-0 items-center justify-center rounded-xl text-teal-600 dark:text-teal-300">
            <Server className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">私有云曲库</h1>
              {headerTabs}
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              连接家里的 NAS、Alist 网盘或 Navidrome 音乐服务器，直接无损播放与搜索；密码采用本地加密保存
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="glass" size="sm" onClick={() => void onRefreshTracks()} disabled={loading}>
            <RefreshCw className={cn(loading && "animate-spin")} />
            刷新曲库
          </Button>
          <Button variant="default" size="sm" onClick={() => openCreateWithPreset(QUICK_PRESETS[0])}>
            <Plus />
            添加私有云
          </Button>
        </div>
      </div>

      {/* Quick-Start Cards (when unconfigured) OR Connected Instances Grid */}
      {instances.length === 0 ? (
        <div className="mt-4 grid shrink-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => openCreateWithPreset(preset)}
              className="aria-flat-tile group flex flex-col justify-between gap-2 rounded-2xl p-4 text-left transition hover:ring-2 hover:ring-teal-500/40"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex size-8 items-center justify-center rounded-xl bg-teal-500/12 text-teal-600 dark:text-teal-300">
                  {preset.kind === "subsonic" ? <Cloud className="size-4" /> : <HardDrive className="size-4" />}
                </div>
                <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-white/[0.07] dark:text-neutral-300">
                  {preset.kind === "subsonic" ? "OpenSubsonic" : "WebDAV"}
                </span>
              </div>
              <div>
                <p className="text-sm font-semibold group-hover:text-teal-600 dark:group-hover:text-teal-300">
                  {preset.title}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">{preset.subtitle}</p>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-600 dark:text-teal-300">
                <Sparkles className="size-3" />
                一键填表接入
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 grid shrink-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {instances.map((item) => {
            const badge = testBadges[item.id];
            const busyTest = testingId === item.id;
            const busyScan = scanningId === item.id || item.scanning;
            const isSelected = selectedInstanceId === item.id;
            return (
              <div
                key={item.id}
                className={cn(
                  "aria-flat-tile flex flex-col justify-between gap-2.5 rounded-2xl p-3.5 transition",
                  isSelected && "ring-2 ring-teal-500/45",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedInstanceId((prev) => (prev === item.id ? "all" : item.id))}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      {item.kind === "subsonic" ? (
                        <Cloud className="size-4 shrink-0 text-teal-600 dark:text-teal-300" />
                      ) : (
                        <HardDrive className="size-4 shrink-0 text-teal-600 dark:text-teal-300" />
                      )}
                      <span className="truncate text-sm font-semibold">{item.name}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-neutral-400">{item.baseUrl}</p>
                  </button>
                  <span className="rounded-full bg-teal-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-teal-700 dark:text-teal-300">
                    {item.kind === "subsonic" ? "OpenSubsonic" : "WebDAV"}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500">
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <ShieldCheck className="size-3.5 text-emerald-500" />
                    {item.kind === "webdav" ? `${item.trackCount ?? 0} 首索引` : `最近同步 ${item.trackCount ?? 0} 首`}
                  </span>
                  {badge && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        badge.ok ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" : "bg-rose-500/12 text-rose-500",
                      )}
                    >
                      {badge.ok && <CheckCircle2 className="size-3" />}
                      {badge.label}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Button variant="ghost" size="sm" onClick={() => void handleTest(item)} disabled={busyTest}>
                    {busyTest ? <LoaderCircle className="size-3.5 animate-spin" /> : <Wifi className="size-3.5" />}
                    测速
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void handleScan(item)} disabled={busyScan}>
                    {busyScan ? <LoaderCircle className="size-3.5 animate-spin" /> : <FolderSync className="size-3.5" />}
                    {item.kind === "webdav" ? "增量扫库" : "同步曲库"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                    配置
                  </Button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(item)}
                    aria-label={`删除 ${item.name}`}
                    className="ml-auto inline-flex size-7 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-rose-500/10 hover:text-rose-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Beginner-Friendly Add/Edit Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="aria-page-shell w-full max-w-lg rounded-[1.5rem] border border-white/60 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editingId ? "配置私有云实例" : "连接私有云"}</h2>
              <button type="button" onClick={() => setFormOpen(false)} aria-label="关闭" className="rounded-lg p-1.5 hover:bg-black/5">
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              {!editingId && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-neutral-500">选择你的服务类型（自动填充模板）</p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {QUICK_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className={cn(
                          "rounded-xl border px-2.5 py-2 text-center text-xs transition",
                          activePresetId === preset.id
                            ? "border-teal-500 bg-teal-500/10 font-semibold text-teal-700 dark:text-teal-300"
                            : "border-[var(--line)] opacity-75 hover:opacity-100",
                        )}
                      >
                        {preset.shortTitle}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-start gap-2 rounded-xl bg-teal-500/8 px-3 py-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
                <Info className="mt-0.5 size-3.5 shrink-0 text-teal-600 dark:text-teal-300" />
                <span>{currentPreset.helperTip}</span>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-500">显示名称</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：家里的 Alist"
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-500">服务器地址</span>
                <input
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    if (draftStatus) setDraftStatus(null);
                  }}
                  onBlur={() => {
                    const cleaned = cleanPastedUrl(baseUrl, kind);
                    if (cleaned) setBaseUrl(cleaned);
                  }}
                  placeholder={currentPreset.placeholderUrl}
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-neutral-500">账号（用户名）</span>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-neutral-500">
                    密码{editingId ? "（留空不变）" : ""}
                  </span>
                  <div className="relative flex items-center">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="本地加密保存"
                      className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] py-2 pl-3 pr-8 text-sm outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      className="absolute right-2 rounded-md p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                    >
                      {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  </div>
                </label>
              </div>

              {kind === "webdav" && (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-neutral-500">音乐文件夹路径（可选，默认根目录 /）</span>
                  <input
                    value={rootPath}
                    onChange={(e) => setRootPath(e.target.value)}
                    placeholder="/Music"
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none"
                  />
                </label>
              )}

              <div className="pt-0.5">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                >
                  <ChevronDown className={cn("size-3.5 transition-transform", showAdvanced && "rotate-180")} />
                  {kind === "subsonic" ? "高级选项（协议切换与移动端省流量转码）" : "高级选项（协议类型切换）"}
                </button>
                {showAdvanced && (
                  <div className="mt-2 space-y-2 rounded-xl border border-[var(--line)] p-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-neutral-500">底层协议</span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setKind("subsonic")}
                          className={cn("rounded-lg px-2 py-1", kind === "subsonic" ? "bg-teal-500/15 font-medium text-teal-600" : "opacity-70")}
                        >
                          OpenSubsonic
                        </button>
                        <button
                          type="button"
                          onClick={() => setKind("webdav")}
                          className={cn("rounded-lg px-2 py-1", kind === "webdav" ? "bg-teal-500/15 font-medium text-teal-600" : "opacity-70")}
                        >
                          WebDAV
                        </button>
                      </div>
                    </div>
                    {kind === "subsonic" && (
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-neutral-500">移动端标准档转码上限 (kbps)</span>
                        <input
                          type="number"
                          min={64}
                          max={320}
                          step={32}
                          value={mobileTranscodeBitrate}
                          onChange={(e) => setMobileTranscodeBitrate(Number(e.target.value) || 192)}
                          className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none"
                        />
                      </label>
                    )}
                  </div>
                )}
              </div>

              {draftStatus && (
                <p
                  role="status"
                  className={cn(
                    "rounded-xl px-3 py-2 text-xs",
                    draftStatus.ok
                      ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                      : "bg-rose-500/12 text-rose-600 dark:text-rose-300",
                  )}
                >
                  {draftStatus.text}
                </p>
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              <Button variant="subtle" size="sm" onClick={() => void handleDraftTest()} disabled={draftTesting || saving}>
                {draftTesting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Wifi className="size-3.5" />}
                {draftTesting ? "测试中…" : "测试连接"}
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
                  取消
                </Button>
                <Button variant="default" size="sm" onClick={() => void handleSave()} disabled={saving}>
                  {saving && <LoaderCircle className="size-3.5 animate-spin" />}
                  {saving ? "保存并同步中…" : "保存并同步曲库"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter & Track Browser */}
      <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["all", "全部"],
              ["hires", "Hi-Res"],
              ["lossless", "无损"],
              ["high", "高码率"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setQualityFilter(value)}
              className={cn(
                "aria-chip rounded-full px-3 py-1 text-xs font-medium",
                qualityFilter === value && "is-active",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          placeholder={`筛选曲库（共 ${filteredTracks.length} 首）`}
          className="history-search w-56 rounded-full border px-3.5 py-1.5 text-xs outline-none"
        />
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-xl bg-rose-500/10 px-4 py-2 text-xs text-rose-500">
          {error}
        </div>
      )}

      <div className="no-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        {filteredTracks.length === 0 ? (
          <EmptyState
            text={
              loading
                ? "正在加载私有云曲库…"
                : instances.length === 0
                  ? "选择上方任意一种常用网盘或 NAS 模板即可快速接入，保存后自动同步无损曲目。"
                  : "暂无曲目；请点击上方卡片的「增量扫库」或「同步曲库」拉取音乐列表。"
            }
          />
        ) : (
          <div className="grid gap-1.5">
            {filteredTracks.map((track) => {
              const active = track.id === activeTrackId;
              return (
                <div
                  key={track.id}
                  data-track-context-row="true"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    trackMenu?.open(event, track, filteredTracks);
                  }}
                  onClick={() => onPickTrack(track.id, filteredTracks)}
                  className={cn(
                    "aria-flat-tile flex cursor-pointer items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5",
                    active && "ring-2 ring-teal-500/40",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <CoverArt track={track} className="size-10 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <CopyableTrackText track={track} field="title" className="min-w-0">
                          <span className="truncate text-sm font-medium">{track.title}</span>
                        </CopyableTrackText>
                        <SourceBadge source={track.source} compact />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-neutral-500">
                        {track.artist} · {track.album}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-neutral-500">
                    <span className="hidden sm:inline">{formatAudioDetail(track)}</span>
                    <span className="tabular-nums">{track.duration}</span>
                    <div onClick={(e) => e.stopPropagation()}>
                      <AddToPlaylistButton track={track} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
