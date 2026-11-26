import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Disc3,
  Eye,
  EyeOff,
  Globe,
  Headphones,
  Info,
  Layers,
  Link2,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
  Sparkles,
  Upload,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { Track } from "@/data/music";
import type {
  AriaRoomConfigSnapshot,
  AriaRoomControlMode,
  AriaRoomNetworkMode,
  AriaRoomSnapshot,
  AriaSignalingProvider,
  CloudflareIpProbeResult,
} from "@/lib/api";
import type {
  AriaRoomProfile,
  AriaSourceAccountSummary,
  ResolvedAriaRoomIdentity,
} from "@/lib/ariaRoomProfile";
import { ariaPayloadToGuestTrack, normalizeAriaRoomCode } from "@/lib/ariaRoomSync";
import type { LocalPlaylist } from "@/lib/localPlaylists";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArtworkImage } from "./ArtworkImage";
import { CoverArt } from "./shared";
import { SourceBadge } from "./SourceLogos";

export type SuperMixQuickImportItem = {
  playlist: LocalPlaylist;
  tracks: Track[];
};

export type AriaRoomSectionProps = {
  snapshot: AriaRoomSnapshot;
  config: AriaRoomConfigSnapshot;
  probeResults: CloudflareIpProbeResult[];
  profile: AriaRoomProfile;
  identity: ResolvedAriaRoomIdentity;
  accounts?: AriaSourceAccountSummary[];
  activeTrack: Track | null;
  loading: boolean;
  probingIps: boolean;
  actionError: string | null;
  rttMs: number | null;
  lastDriftMs: number | null;
  bufferProgress: { downloadedBytes: number; totalBytes: number | null; completed: boolean } | null;
  superMixItems: SuperMixQuickImportItem[];
  onBack: () => void;
  onUpdateProfile: (patch: Partial<AriaRoomProfile>) => void;
  onToggleShareEnabled?: (enabled: boolean) => void | Promise<unknown>;
  onUploadAvatar: (file: File) => Promise<void>;
  onCreateRoom: (params: {
    networkMode: AriaRoomNetworkMode;
    controlMode: AriaRoomControlMode;
    roomId?: string;
    directPort?: number;
    publicHost?: string;
  }) => Promise<unknown>;
  onJoinRoom: (input: string) => Promise<unknown>;
  onLeaveRoom: () => Promise<void>;
  onKickMember?: (peerId: string) => Promise<void>;
  onProbeIps: (signalingUrl?: string, provider?: AriaSignalingProvider) => Promise<unknown>;
  onUpdateNetworkConfig: (patch: Partial<AriaRoomConfigSnapshot>) => Promise<unknown>;
  onSetControlMode: (mode: AriaRoomControlMode) => Promise<void>;
  onImportPlaylistTracks: (tracks: Track[]) => Promise<void>;
  onPickRoomTrack: (track: Track) => void;
  onOpenPlayer: () => void;
  lobbyCardOnly?: boolean;
  subPage?: AriaRoomSubPage;
  onSubPageChange?: (page: AriaRoomSubPage) => void;
};

export type AriaRoomSubPage = "main" | "info" | "profile" | "network";

function ToggleSwitch({
  checked,
  onToggle,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  onToggle: () => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition disabled:cursor-not-allowed disabled:opacity-45",
        checked ? "bg-[var(--accent)]" : "bg-[var(--line-strong,rgba(128,128,128,0.28))]",
      )}
    >
      <span
        className={cn(
          "size-5 rounded-full bg-white shadow-sm transition-transform",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

function AvatarMedia({
  src,
  alt,
  cacheSize = 160,
  className,
}: {
  src: string;
  alt: string;
  cacheSize?: number;
  className?: string;
}) {
  if (src.startsWith("data:")) {
    return <img src={src} alt={alt} referrerPolicy="no-referrer" className={className} />;
  }
  return (
    <ArtworkImage
      src={src}
      cacheSize={cacheSize}
      alt={alt}
      referrerPolicy="no-referrer"
      className={className}
    />
  );
}

function resolveEffectivePresence(
  online?: boolean,
  presence?: "active" | "away" | "offline",
): "active" | "away" | "offline" {
  if (online === false || presence === "offline") return "offline";
  if (presence === "away") return "away";
  return "active";
}

function presenceLabel(presence: "active" | "away" | "offline"): string {
  if (presence === "offline") return "离线";
  if (presence === "away") return "暂离";
  return "在线";
}

function MemberAvatar({
  nickname,
  avatarUrl,
  sizeClass = "size-10",
  isHost,
  online,
  presence,
  showStatusDot = false,
}: {
  nickname: string;
  avatarUrl: string | null;
  sizeClass?: string;
  isHost?: boolean;
  online?: boolean;
  presence?: "active" | "away" | "offline";
  showStatusDot?: boolean;
}) {
  const effective = resolveEffectivePresence(online, presence);
  const dimmed = effective !== "active";
  return (
    <div className={cn("relative shrink-0", sizeClass)}>
      <div
        className={cn(
          "flex size-full items-center justify-center overflow-hidden rounded-full border bg-[var(--surface)] text-xs font-semibold text-[var(--text-primary)] transition",
          isHost && !dimmed
            ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/25"
            : "border-[var(--line)]",
          effective === "offline" && "opacity-60",
          effective === "away" && "opacity-75",
        )}
      >
        {avatarUrl ? (
          <AvatarMedia
            src={avatarUrl}
            alt={nickname}
            cacheSize={128}
            className={cn("size-full object-cover transition", dimmed && "grayscale")}
          />
        ) : (
          <span className={cn(dimmed && "text-[var(--text-secondary)]")}>
            {nickname.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      {showStatusDot && (
        <span
          title={presenceLabel(effective)}
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[var(--surface)]",
            effective === "active"
              ? "bg-emerald-500"
              : effective === "away"
                ? "bg-amber-400"
                : "bg-neutral-400",
          )}
        />
      )}
    </div>
  );
}

export function AriaAvatarPill({
  nickname,
  avatarUrl,
  onClick,
}: {
  nickname: string;
  avatarUrl: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] py-1 pl-1 pr-2.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-muted)]"
      title="查看头像与昵称"
    >
      <MemberAvatar nickname={nickname} avatarUrl={avatarUrl} sizeClass="size-6" />
      <span className="max-w-[96px] truncate">{nickname}</span>
      <ChevronDown className="size-3.5 text-[var(--text-secondary)]" />
    </button>
  );
}

export function AriaRoomSection({
  snapshot,
  config,
  probeResults,
  profile,
  identity,
  accounts = [],
  activeTrack,
  loading,
  probingIps,
  actionError,
  rttMs,
  lastDriftMs,
  bufferProgress,
  superMixItems,
  onBack,
  onUpdateProfile,
  onToggleShareEnabled,
  onUploadAvatar,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onKickMember,
  onProbeIps,
  onUpdateNetworkConfig,
  onSetControlMode,
  onImportPlaylistTracks,
  onPickRoomTrack,
  onOpenPlayer,
  lobbyCardOnly = false,
  subPage: controlledSubPage,
  onSubPageChange,
}: AriaRoomSectionProps) {
  const activeConfiguredUrl =
    config.signalingProvider === "self-hosted"
      ? config.selfHostedSignalingUrl || config.signalingUrl
      : config.signalingUrl;
  const hasSignalingUrl = Boolean(activeConfiguredUrl.trim());
  const [internalSubPage, setInternalSubPage] = useState<AriaRoomSubPage>("main");
  const subPage = controlledSubPage ?? internalSubPage;
  const setSubPage = (next: AriaRoomSubPage) => {
    setInternalSubPage(next);
    onSubPageChange?.(next);
  };
  const [networkReturnPage, setNetworkReturnPage] = useState<"main" | "info">("main");
  const userTouchedNetworkModeRef = useRef(false);
  const [networkMode, setNetworkMode] = useState<AriaRoomNetworkMode>(
    hasSignalingUrl ? "cloudflare" : "direct",
  );
  const [controlMode, setControlMode] = useState<AriaRoomControlMode>("collaborative");
  const [customRoomCodeInput, setCustomRoomCodeInput] = useState("");
  const [queueQuery, setQueueQuery] = useState("");
  const [networkSaveError, setNetworkSaveError] = useState<string | null>(null);
  const [directPortInput, setDirectPortInput] = useState(String(config.directPort || 3639));
  const [publicHostInput, setPublicHostInput] = useState(config.publicHost || "");
  const [joinInput, setJoinInput] = useState("");
  const [signalingProviderInput, setSignalingProviderInput] = useState<AriaSignalingProvider>(
    config.signalingProvider,
  );
  const [signalingUrlInput, setSignalingUrlInput] = useState(config.signalingUrl);
  const [selfHostedUrlInput, setSelfHostedUrlInput] = useState(config.selfHostedSignalingUrl);
  const [customIpInput, setCustomIpInput] = useState(config.preferredIps.join(", "));
  const [turnUrlsInput, setTurnUrlsInput] = useState(config.turnUrls.join(", "));
  const [turnUsernameInput, setTurnUsernameInput] = useState(config.turnUsername);
  const [turnCredentialInput, setTurnCredentialInput] = useState(config.turnCredential);
  const [networkSaved, setNetworkSaved] = useState(false);
  const [showDirectToken, setShowDirectToken] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!userTouchedNetworkModeRef.current && hasSignalingUrl) {
      setNetworkMode("cloudflare");
    }
  }, [hasSignalingUrl]);

  useEffect(() => {
    if (!snapshot.active && subPage === "info") {
      setSubPage("main");
    }
  }, [snapshot.active, subPage]);

  useEffect(() => {
    setSignalingProviderInput(config.signalingProvider);
  }, [config.signalingProvider]);

  useEffect(() => {
    setSignalingUrlInput(config.signalingUrl);
  }, [config.signalingUrl]);

  useEffect(() => {
    setSelfHostedUrlInput(config.selfHostedSignalingUrl);
  }, [config.selfHostedSignalingUrl]);

  useEffect(() => {
    setCustomIpInput(config.preferredIps.join(", "));
  }, [config.preferredIps]);

  useEffect(() => {
    setDirectPortInput(String(config.directPort || 3639));
  }, [config.directPort]);

  useEffect(() => {
    setPublicHostInput(config.publicHost || "");
  }, [config.publicHost]);

  useEffect(() => {
    setTurnUrlsInput(config.turnUrls.join(", "));
    setTurnUsernameInput(config.turnUsername);
    setTurnCredentialInput(config.turnCredential);
  }, [config.turnUrls, config.turnUsername, config.turnCredential]);

  const isHost = snapshot.role === "host";
  const canControl = isHost || snapshot.controlMode === "collaborative";
  const activePayload = snapshot.playback.track;

  const galleryAvatars = useMemo(() => {
    const items: Array<{ url: string; kind: "uploaded" | "account"; label: string }> = [];
    const seen = new Set<string>();
    const uploadedList = profile.avatarHistory?.length
      ? profile.avatarHistory
      : profile.customAvatarDataUrl
        ? [profile.customAvatarDataUrl]
        : [];
    for (const url of uploadedList) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      items.push({ url, kind: "uploaded", label: "历史上传头像" });
    }
    const sourceLabels: Record<AriaSourceAccountSummary["source"], string> = {
      netease: "网易云头像",
      qq: "QQ 头像",
      bilibili: "B站头像",
      youtube: "YouTube 头像",
    };
    for (const acc of accounts) {
      if (!acc.connected || !acc.avatarUrl || seen.has(acc.avatarUrl)) continue;
      seen.add(acc.avatarUrl);
      items.push({ url: acc.avatarUrl, kind: "account", label: sourceLabels[acc.source] });
    }
    return items;
  }, [accounts, profile.avatarHistory, profile.customAvatarDataUrl]);

  const displayTrack = useMemo<Track | null>(() => {
    if (isHost && activeTrack && (!activePayload || activePayload.id === activeTrack.id)) {
      return activeTrack;
    }
    if (activePayload) return ariaPayloadToGuestTrack(activePayload);
    return activeTrack;
  }, [activePayload, activeTrack, isHost]);

  const queueItems = useMemo(
    () => snapshot.playback.queue.map((item) => ({ payload: item, track: ariaPayloadToGuestTrack(item) })),
    [snapshot.playback.queue],
  );

  const filteredQueueItems = useMemo(() => {
    const q = queueQuery.trim().toLowerCase();
    if (!q) return queueItems;
    return queueItems.filter(
      ({ payload }) =>
        payload.title.toLowerCase().includes(q) ||
        payload.artist.toLowerCase().includes(q) ||
        (payload.album ?? "").toLowerCase().includes(q) ||
        (payload.addedByName ?? "").toLowerCase().includes(q),
    );
  }, [queueItems, queueQuery]);

  const trimmedCustomRoomCode = customRoomCodeInput.trim();
  const normalizedCustomRoomCode = trimmedCustomRoomCode
    ? normalizeAriaRoomCode(trimmedCustomRoomCode)
    : null;
  const customRoomCodeError =
    networkMode !== "direct" && trimmedCustomRoomCode.length > 0 && !normalizedCustomRoomCode
      ? "房间号仅支持 3–24 位字母、数字、下划线或短横线"
      : null;

  async function copyText(key: string, value: string | null | undefined) {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard unavailable.
    }
  }

  const emptySeatCount = Math.max(0, snapshot.maxMembers - snapshot.members.length);
  const combinedError = actionError || snapshot.signalingError || snapshot.directServer.error;
  const isSynced = snapshot.active && snapshot.signalingState === "connected";
  const networkModeLabel =
    snapshot.networkMode === "direct"
      ? "局域网直连"
      : snapshot.networkMode === "hybrid"
        ? "混合模式"
        : "云端同步";

  const AvatarPillButton = (
    <AriaAvatarPill
      nickname={identity.nickname}
      avatarUrl={identity.avatarUrl}
      onClick={() => setSubPage("profile")}
    />
  );

  // Sub-page: 查看头像与昵称
  if (subPage === "profile") {
    const nicknameValue = profile.mode === "custom" ? profile.customNickname : identity.nickname;

    return (
      <section aria-label="查看头像" className="space-y-5">
        <header className="flex items-center justify-between gap-3 pb-1 pt-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="返回"
            onClick={() => setSubPage("main")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
            查看头像
          </h1>
          <span className="size-9 shrink-0" aria-hidden="true" />
        </header>

        <div className="mx-auto max-w-md space-y-5">
          {/* 大号方形当前头像预览（模仿 QQ 查看头像） */}
          <div className="relative mx-auto aspect-square w-full max-w-[272px] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] shadow-sm">
            {identity.avatarUrl ? (
              <AvatarMedia
                src={identity.avatarUrl}
                alt={identity.nickname}
                cacheSize={320}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center bg-[var(--accent-soft)] text-5xl font-semibold text-[var(--accent)]">
                {identity.nickname.slice(0, 1).toUpperCase()}
              </div>
            )}
            <span className="pointer-events-none absolute bottom-2.5 right-2.5 rounded-lg bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white/95 backdrop-blur-md">
              当前头像
            </span>
          </div>

          {/* 昵称直接编辑（无需区分音源渠道） */}
          <div className="glass rounded-2xl px-4 py-3.5">
            <div className="flex items-center gap-3">
              <label
                htmlFor="aria-profile-nickname-input"
                className="shrink-0 text-xs font-medium text-[var(--text-secondary)]"
              >
                昵称
              </label>
              <input
                id="aria-profile-nickname-input"
                type="text"
                maxLength={32}
                value={nicknameValue}
                onChange={(e) => onUpdateProfile({ mode: "custom", customNickname: e.target.value })}
                placeholder="输入房间内显示的昵称"
                className="h-9 min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]/65 focus:border-[var(--accent)]"
              />
            </div>
          </div>

          {/* 历史头像 4 列方格画廊 */}
          <div className="glass space-y-3 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-[var(--text-secondary)]">历史头像</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
              >
                <Upload className="size-3.5" />
                上传新头像
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setAvatarError(null);
                void onUploadAvatar(file).catch((err) => {
                  setAvatarError(err instanceof Error ? err.message : "头像上传失败");
                });
              }}
            />

            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="上传本地图片"
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface-muted)]/60 text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Plus className="size-5" />
                <span className="text-[10px] font-medium">添加</span>
              </button>

              {galleryAvatars.map((item, idx) => {
                const selected = identity.avatarUrl === item.url;
                return (
                  <div
                    key={`${item.kind}-${idx}-${item.url.slice(0, 28)}`}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-xl border bg-[var(--surface-muted)] transition",
                      selected
                        ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
                        : "border-[var(--line)] hover:border-[var(--accent)]/60",
                    )}
                  >
                    <button
                      type="button"
                      title={item.label}
                      onClick={() =>
                        onUpdateProfile({
                          mode: "custom",
                          selectedAvatarUrl: item.url,
                          ...(item.url.startsWith("data:image/") ? { customAvatarDataUrl: item.url } : {}),
                        })
                      }
                      className="block size-full overflow-hidden focus:outline-none"
                    >
                      <AvatarMedia
                        src={item.url}
                        alt={item.label}
                        cacheSize={160}
                        className="size-full object-cover transition duration-200 group-hover:scale-105"
                      />
                    </button>

                    {selected && (
                      <span
                        aria-label="当前使用"
                        className="pointer-events-none absolute bottom-1 right-1 flex size-4 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-sm"
                      >
                        <Check className="size-2.5" />
                      </span>
                    )}

                    {item.kind === "uploaded" && (
                      <button
                        type="button"
                        aria-label="移除该历史头像"
                        title="移除该历史头像"
                        onClick={(e) => {
                          e.stopPropagation();
                          const nextHistory = (profile.avatarHistory ?? []).filter((entry) => entry !== item.url);
                          const isRemovingActive =
                            profile.selectedAvatarUrl === item.url || profile.customAvatarDataUrl === item.url;
                          onUpdateProfile({
                            avatarHistory: nextHistory,
                            ...(isRemovingActive
                              ? {
                                  selectedAvatarUrl: nextHistory[0] ?? null,
                                  customAvatarDataUrl: nextHistory[0] ?? null,
                                }
                              : {}),
                          });
                        }}
                        className="absolute right-1 top-1 hidden size-5 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75 group-hover:flex"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {avatarError && <p className="text-xs text-rose-500">{avatarError}</p>}
          </div>

          <div className="glass flex items-center justify-between gap-4 rounded-2xl px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">共享曲库</p>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                同听时自动提供已登录音源的高品质音频，不共享账号
              </p>
            </div>
            <ToggleSwitch
              checked={profile.shareEnabled}
              ariaLabel="共享曲库"
              onToggle={() => {
                const next = !profile.shareEnabled;
                if (onToggleShareEnabled) void onToggleShareEnabled(next);
                else onUpdateProfile({ shareEnabled: next });
              }}
            />
          </div>
        </div>
      </section>
    );
  }

  // Sub-page: 房间信息 (active room)
  if (subPage === "info" && snapshot.active) {
    const resolvedPublic =
      snapshot.directServer.resolvedPublicEndpoint ??
      (snapshot.directServer.publicHost
        ? { host: snapshot.directServer.publicHost, port: snapshot.directServer.port }
        : null);
    const directHostAddress =
      resolvedPublic?.host ||
      snapshot.directServer.lanAddresses[0] ||
      snapshot.directServer.ipv6Addresses[0] ||
      null;
    const directShareRows: Array<{
      key: string;
      badge: string;
      target: string;
      share: string;
    }> = [];
    if (snapshot.directServer.publicShareString && resolvedPublic) {
      directShareRows.push({
        key: "infoDirectPublic",
        badge: "公网 / 自定义",
        target: `${resolvedPublic.host}:${resolvedPublic.port}`,
        share: snapshot.directServer.publicShareString,
      });
    }
    if (snapshot.directServer.ipv4ShareString && snapshot.directServer.lanAddresses[0]) {
      directShareRows.push({
        key: "infoDirectV4",
        badge: "IPv4 局域网",
        target: `${snapshot.directServer.lanAddresses[0]}:${snapshot.directServer.port}`,
        share: snapshot.directServer.ipv4ShareString,
      });
    }
    if (snapshot.directServer.ipv6ShareString && snapshot.directServer.ipv6Addresses[0]) {
      directShareRows.push({
        key: "infoDirectV6",
        badge: "IPv6",
        target: `[${snapshot.directServer.ipv6Addresses[0]}]:${snapshot.directServer.port}`,
        share: snapshot.directServer.ipv6ShareString,
      });
    }
    if (directShareRows.length === 0 && snapshot.directServer.shareString) {
      directShareRows.push({
        key: "infoDirect",
        badge: "直连口令",
        target: directHostAddress
          ? `${directHostAddress}:${snapshot.directServer.port}`
          : `端口 ${snapshot.directServer.port}`,
        share: snapshot.directServer.shareString,
      });
    }
    return (
      <section aria-label="房间信息" className="space-y-5">
        <header className="flex items-center justify-between gap-3 pb-1 pt-1">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="返回房间"
              onClick={() => setSubPage("main")}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
              房间信息
            </h1>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            className="text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
            onClick={() => void onLeaveRoom()}
          >
            退出房间
          </Button>
        </header>

        {combinedError && (
          <div
            role="alert"
            className="flex items-center gap-2.5 rounded-2xl border border-rose-500/20 bg-rose-500/8 px-4 py-3 text-xs text-rose-600 dark:text-rose-300"
          >
            <AlertTriangle className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{combinedError}</span>
          </div>
        )}

        {(snapshot.roomId || (isHost && snapshot.directServer.active)) && (
          <div className="glass space-y-3 rounded-[24px] p-5">
            <p className="text-xs font-medium text-[var(--text-secondary)]">房间邀请</p>
            {snapshot.roomId && snapshot.networkMode !== "direct" && (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">房间码</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold tracking-wider text-[var(--text-primary)]">
                    {snapshot.roomId}
                  </p>
                </div>
                <Button
                  variant="glass"
                  size="sm"
                  onClick={() => void copyText("infoRoomId", snapshot.roomId)}
                >
                  {copiedKey === "infoRoomId" ? (
                    <Check className="size-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copiedKey === "infoRoomId" ? "已复制" : "复制"}
                </Button>
              </div>
            )}

            {isHost && snapshot.directServer.active && snapshot.directServer.roomToken && (
              <div className="space-y-2.5 border-t border-[var(--line)] pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                  <span>监听端口 {snapshot.directServer.port}</span>
                  {directHostAddress && <span>默认优先：{directHostAddress}</span>}
                </div>
                <div className="space-y-2">
                  {directShareRows.map((row) => (
                    <div
                      key={row.key}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)]/60 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                            {row.badge}
                          </span>
                          <code className="truncate font-mono text-xs text-[var(--text-primary)]">
                            {row.target}
                          </code>
                        </div>
                      </div>
                      <Button
                        variant="glass"
                        size="sm"
                        onClick={() => void copyText(row.key, row.share)}
                      >
                        {copiedKey === row.key ? (
                          <Check className="size-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                        {copiedKey === row.key ? "已复制" : "复制口令"}
                      </Button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowDirectToken((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <span>令牌：</span>
                  <code className="font-mono">
                    {showDirectToken
                      ? snapshot.directServer.roomToken
                      : `${snapshot.directServer.roomToken.slice(0, 6)}••••••`}
                  </code>
                  {showDirectToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="glass space-y-3 rounded-[24px] p-5">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Users className="size-3.5" />
              房间成员
            </span>
            <span className="tabular-nums">
              {snapshot.members.length} / {snapshot.maxMembers}
            </span>
          </div>
          <div className="divide-y divide-[var(--line)]">
            {snapshot.members.map((member) => {
              const effPresence = resolveEffectivePresence(member.online, member.presence);
              return (
                <div key={member.peerId} className="flex items-center justify-between gap-3 py-2.5 first:pt-1 last:pb-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <MemberAvatar
                      nickname={member.nickname}
                      avatarUrl={member.avatarUrl}
                      sizeClass="size-9"
                      isHost={member.role === "host"}
                      online={member.online}
                      presence={member.presence}
                      showStatusDot
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "truncate text-sm font-medium",
                            effPresence === "offline"
                              ? "text-[var(--text-secondary)]"
                              : "text-[var(--text-primary)]",
                          )}
                        >
                          {member.nickname}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                            effPresence === "active"
                              ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                              : effPresence === "away"
                                ? "bg-amber-500/12 text-amber-600 dark:text-amber-400"
                                : "bg-[var(--surface-muted)] text-[var(--text-secondary)]",
                          )}
                        >
                          {presenceLabel(effPresence)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {member.role === "host" && (
                      <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                        房主
                      </span>
                    )}
                    {isHost && member.role !== "host" && onKickMember && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={loading}
                        onClick={() => void onKickMember(member.peerId)}
                        className="h-7 px-2 text-[11px] text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
                        title="将该成员移出房间"
                      >
                        <UserMinus className="size-3.5" />
                        移出
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="glass divide-y divide-[var(--line)] overflow-hidden rounded-[24px]">
          {isHost && (
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">允许成员切歌</p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  开启后房间内所有成员均可切歌与调整进度
                </p>
              </div>
              <ToggleSwitch
                checked={snapshot.controlMode === "collaborative"}
                ariaLabel="允许成员切歌"
                onToggle={() =>
                  void onSetControlMode(
                    snapshot.controlMode === "collaborative" ? "host-only" : "collaborative",
                  )
                }
              />
            </div>
          )}

          <div className="flex items-center justify-between px-5 py-3.5 text-sm">
            <span className="text-[var(--text-secondary)]">连接状态</span>
            <span className="inline-flex items-center gap-2 font-medium text-[var(--text-primary)]">
              <span
                className={cn(
                  "lt-live-dot",
                  snapshot.signalingState === "reconnecting" && "!bg-amber-400",
                  snapshot.signalingState === "error" && "!bg-rose-500",
                )}
                aria-hidden="true"
              />
              {isSynced ? "已连接" : snapshot.signalingState === "reconnecting" ? "重连中" : "连接异常"}
            </span>
          </div>

          <div className="flex items-center justify-between px-5 py-3.5 text-sm">
            <span className="text-[var(--text-secondary)]">连接方式</span>
            <span className="font-medium text-[var(--text-primary)]">{networkModeLabel}</span>
          </div>

          {rttMs !== null && (
            <div className="flex items-center justify-between px-5 py-3.5 text-sm">
              <span className="text-[var(--text-secondary)]">同步延迟</span>
              <span className="tabular-nums font-medium text-[var(--text-primary)]">{rttMs} ms</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setNetworkReturnPage("info");
              setSubPage("network");
            }}
            className="flex w-full items-center justify-between px-5 py-3.5 text-left text-sm transition hover:bg-[var(--surface-muted)]/60"
          >
            <span className="font-medium text-[var(--text-primary)]">网络设置</span>
            <ChevronRight className="size-4 text-[var(--text-secondary)]" />
          </button>
        </div>
      </section>
    );
  }

  // Sub-page: 网络设置
  if (subPage === "network") {
    return (
      <section aria-label="网络设置" className="space-y-5">
        <header className="flex items-center gap-3 pb-1 pt-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="返回"
            onClick={() => setSubPage(snapshot.active ? networkReturnPage : "main")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            网络设置
          </h1>
        </header>

        {(combinedError || networkSaveError) && (
          <div
            role="alert"
            className="flex items-center gap-2.5 rounded-2xl border border-rose-500/20 bg-rose-500/8 px-4 py-3 text-xs text-rose-600 dark:text-rose-300"
          >
            <AlertTriangle className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{networkSaveError || combinedError}</span>
          </div>
        )}

        <div className="glass space-y-4 rounded-[24px] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                云端 / 混合模式信令节点
              </h2>
              <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                Cloudflare 与自建服务器独立保存，随时切换；仅在「云端 / 混合」房间生效
              </p>
            </div>
            <div className="inline-flex rounded-full border border-[var(--line)] bg-[var(--surface-muted)] p-0.5">
              {[
                { id: "cloudflare" as const, label: "Cloudflare 节点" },
                { id: "self-hosted" as const, label: "自建信令节点" },
              ].map((item) => {
                const active = signalingProviderInput === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSignalingProviderInput(item.id)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition",
                      active
                        ? "bg-[var(--accent)] text-white shadow-sm"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className={cn(
              "space-y-3 rounded-2xl border p-3.5 transition",
              signalingProviderInput === "cloudflare"
                ? "border-[var(--accent)]/40 bg-[var(--surface-muted)]/45"
                : "border-[var(--line)] bg-[var(--surface-muted)]/20 opacity-85",
            )}
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                  Cloudflare 信令地址
                </label>
                <input
                  type="url"
                  value={signalingUrlInput}
                  onChange={(e) => setSignalingUrlInput(e.target.value)}
                  placeholder="https://signal.yourdomain.com"
                  className="h-9 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                  候选优选 IP（逗号分隔）
                </label>
                <input
                  type="text"
                  value={customIpInput}
                  onChange={(e) => setCustomIpInput(e.target.value)}
                  placeholder="104.16.132.229, 172.64.155.12"
                  className="h-9 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="glass"
                size="sm"
                disabled={probingIps || !signalingUrlInput.trim()}
                onClick={() => void onProbeIps(signalingUrlInput, "cloudflare")}
              >
                {probingIps ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                测速优选 IP
              </Button>
              {config.selectedPreferredIp && (
                <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                  当前优选：{config.selectedPreferredIp}
                </span>
              )}
            </div>
          </div>

          <div
            className={cn(
              "space-y-3 rounded-2xl border p-3.5 transition",
              signalingProviderInput === "self-hosted"
                ? "border-[var(--accent)]/40 bg-[var(--surface-muted)]/45"
                : "border-[var(--line)] bg-[var(--surface-muted)]/20 opacity-85",
            )}
          >
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                自建信令节点地址
              </label>
              <input
                type="text"
                value={selfHostedUrlInput}
                onChange={(e) => setSelfHostedUrlInput(e.target.value)}
                placeholder="http://your-server-ip:8787"
                className="h-9 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                支持直接填 IP:端口（如 1.2.3.4:8787），用于「云端 / 混合」模式 6 位房间码互通，自动跳过优选 IP
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="glass"
                size="sm"
                disabled={probingIps || !selfHostedUrlInput.trim()}
                onClick={() => void onProbeIps(selfHostedUrlInput, "self-hosted")}
              >
                {probingIps ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                测试自建节点
              </Button>
            </div>
          </div>

          {probeResults.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-3">
              {probeResults.slice(0, 6).map((item) => {
                const selected = item.ip !== null && config.selectedPreferredIp === item.ip;
                return (
                  <button
                    key={item.ip ?? item.label ?? "dns"}
                    type="button"
                    disabled={!item.ok}
                    onClick={() => {
                      if (item.ip !== null) {
                        void onUpdateNetworkConfig({ selectedPreferredIp: item.ip });
                      }
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] tabular-nums transition",
                      selected
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                        : item.ok
                          ? "border-[var(--line)] bg-[var(--surface)] text-[var(--text-primary)] hover:border-[var(--accent)]/60"
                          : "border-[var(--line)] bg-[var(--surface-muted)]/50 text-[var(--text-secondary)]/60",
                    )}
                    title={item.error || undefined}
                  >
                    {item.label} · {item.ok && item.latencyMs !== null ? `${item.latencyMs}ms` : item.error || "超时"}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="glass space-y-4 rounded-[24px] p-5">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              房主本机直连设置 &amp; TURN 中继
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
              仅「直连 / 混合」模式生效，需指向房主电脑本机直连端口（非自建信令地址）；留空默认优先使用本机 IPv4，并在房间信息中同时提供 IPv4 / IPv6 口令
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                直连端口
              </label>
              <input
                type="number"
                min={1024}
                max={65535}
                value={directPortInput}
                onChange={(e) => setDirectPortInput(e.target.value)}
                className="h-9 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-xs tabular-nums text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                房主直连公网地址（选填，支持 IPv4 / 域名 / IP:端口）
              </label>
              <input
                type="text"
                value={publicHostInput}
                onChange={(e) => setPublicHostInput(e.target.value)}
                placeholder="例如 203.0.113.10 或 home.yourdomain.com"
                className="h-9 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                TURN 中继地址（选填）
              </label>
              <input
                type="text"
                value={turnUrlsInput}
                onChange={(e) => setTurnUrlsInput(e.target.value)}
                placeholder="turn:relay.example.com:3478"
                className="h-9 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                TURN 用户名
              </label>
              <input
                type="text"
                value={turnUsernameInput}
                onChange={(e) => setTurnUsernameInput(e.target.value)}
                placeholder="选填"
                className="h-9 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                TURN 凭证
              </label>
              <input
                type="password"
                value={turnCredentialInput}
                onChange={(e) => setTurnCredentialInput(e.target.value)}
                placeholder="选填"
                className="h-9 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              onClick={() => {
                setNetworkSaveError(null);
                void onUpdateNetworkConfig({
                  signalingProvider: signalingProviderInput,
                  signalingUrl: signalingUrlInput.trim(),
                  selfHostedSignalingUrl: selfHostedUrlInput.trim(),
                  preferredIps: customIpInput
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  directPort: Number(directPortInput) || 3639,
                  publicHost: publicHostInput.trim(),
                  turnUrls: turnUrlsInput
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  turnUsername: turnUsernameInput.trim(),
                  turnCredential: turnCredentialInput.trim(),
                })
                  .then(() => {
                    setNetworkSaved(true);
                    window.setTimeout(() => setNetworkSaved(false), 1600);
                  })
                  .catch((err) => {
                    setNetworkSaveError(err instanceof Error ? err.message : "保存网络配置失败");
                  });
              }}
            >
              {networkSaved ? <Check className="size-3.5" /> : null}
              {networkSaved ? "已保存" : "保存配置"}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const bufferPct =
    bufferProgress && !bufferProgress.completed && bufferProgress.totalBytes && bufferProgress.totalBytes > 0
      ? Math.min(99, Math.max(0, Math.round((bufferProgress.downloadedBytes / bufferProgress.totalBytes) * 100)))
      : null;

  const ariaLobbyCard = (
    <div className="glass flex h-full flex-col overflow-hidden rounded-[26px]">
      <div className="relative flex flex-col justify-between gap-5 bg-[linear-gradient(135deg,#261e47_0%,#534194_55%,#1b172d_100%)] p-5 text-white sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-full border border-white/15 bg-black/25 p-0.5 backdrop-blur-md">
            {[
              { id: "direct" as const, label: "直连", icon: Server },
              { id: "cloudflare" as const, label: "云端", icon: Globe },
              { id: "hybrid" as const, label: "混合", icon: Layers },
            ].map((mode) => {
              const Icon = mode.icon;
              const active = networkMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    userTouchedNetworkModeRef.current = true;
                    setNetworkMode(mode.id);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                    active
                      ? "bg-white text-[#1f1a38] shadow-sm"
                      : "text-white/80 hover:text-white",
                  )}
                >
                  <Icon className="size-3" />
                  <span>{mode.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {networkMode !== "direct" && config.selfHostedSignalingUrl.trim() && (
              <button
                type="button"
                onClick={() =>
                  void onUpdateNetworkConfig({
                    signalingProvider:
                      config.signalingProvider === "self-hosted" ? "cloudflare" : "self-hosted",
                  })
                }
                title="一键切换云端信令节点（Cloudflare / 自建）"
                className="rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md transition hover:bg-black/40"
              >
                {config.signalingProvider === "self-hosted" ? "节点：自建" : "节点：CF"}
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                setControlMode((m) => (m === "collaborative" ? "host-only" : "collaborative"))
              }
              className="rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[11px] font-medium text-white/85 backdrop-blur-md transition hover:bg-black/40"
            >
              {controlMode === "collaborative" ? "全员可切歌" : "仅房主控场"}
            </button>
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-white">
              Aria 跨源一起听
            </h2>
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-medium text-white/90">
              最多 5 人
            </span>
          </div>
          <p className="mt-1.5 text-xs text-white/80">
            支持本地、网易云、QQ、B站与 YouTube 跨源实时同听，支持断点留存与预缓存
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-between bg-[var(--surface)]/65">
        <form
          className="space-y-2.5 p-4 sm:px-5 sm:py-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (loading || customRoomCodeError) return;
            const parsedPort = Number(directPortInput);
            void onCreateRoom({
              networkMode,
              controlMode,
              ...(networkMode !== "direct" && normalizedCustomRoomCode
                ? { roomId: normalizedCustomRoomCode }
                : {}),
              directPort: Number.isFinite(parsedPort) ? parsedPort : 3639,
              publicHost: (publicHostInput.trim() || config.publicHost.trim()) || undefined,
            });
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={networkMode !== "direct" ? "aria-room-custom-code-input" : undefined}
              className="text-sm font-semibold text-[var(--text-primary)]"
            >
              新建房间
            </label>
            <span className="text-[11px] text-[var(--text-secondary)]">
              {networkMode === "direct"
                ? `直连监听端口 ${directPortInput || config.directPort || 3639}`
                : "可指定 3–24 位固定房间号，或留空自动生成"}
            </span>
          </div>
          <div className="flex gap-2">
            {networkMode !== "direct" ? (
              <input
                id="aria-room-custom-code-input"
                type="text"
                maxLength={24}
                value={customRoomCodeInput}
                onChange={(e) => setCustomRoomCodeInput(e.target.value)}
                placeholder="自定义房间号（选填，留空随机）"
                className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 py-2 font-mono text-sm text-[var(--text-primary)] outline-none placeholder:font-sans placeholder:text-xs placeholder:text-[var(--text-secondary)]/65 focus:border-[var(--accent)]"
              />
            ) : (
              <div className="flex min-w-0 flex-1 items-center rounded-xl border border-[var(--line)] bg-[var(--surface-muted)]/65 px-3.5 py-2 text-xs text-[var(--text-secondary)]">
                局域网 / 公网端口直连（自动生成口令）
              </div>
            )}
            <Button
              type="submit"
              disabled={loading || Boolean(customRoomCodeError)}
              className="shrink-0 shadow-sm"
            >
              {loading ? <LoaderCircle className="size-4 animate-spin" /> : <Headphones className="size-4" />}
              创建房间
            </Button>
          </div>
          {customRoomCodeError && (
            <p className="text-[11px] text-rose-500">{customRoomCodeError}</p>
          )}
        </form>

        <form
          className="border-t border-[var(--line)] p-4 sm:px-5 sm:py-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!joinInput.trim() || loading) return;
            void onJoinRoom(joinInput);
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="aria-room-join-input"
              className="text-sm font-semibold text-[var(--text-primary)]"
            >
              加入房间
            </label>
            <span className="text-[11px] text-[var(--text-secondary)]">
              支持 3–24 位房间码或直连口令
            </span>
          </div>
          <div className="mt-2.5 flex gap-2">
            <input
              id="aria-room-join-input"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              placeholder="输入房间码或房主直连口令"
              className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]/65 focus:border-[var(--accent)]"
            />
            <Button type="submit" variant="subtle" disabled={!joinInput.trim() || loading}>
              {loading ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}
              加入
            </Button>
          </div>
        </form>
      </div>
    </div>
  );

  if (lobbyCardOnly && !snapshot.active) {
    return ariaLobbyCard;
  }

  // Main View (Lobby or Active Room)
  return (
    <section aria-label="Aria 官方一起听" className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 pb-1 pt-1">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="返回上一页" onClick={onBack} title="返回上一页">
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            {snapshot.active ? "Aria 一起听" : "一起听"}
          </h1>
          {snapshot.active && snapshot.roomId && snapshot.networkMode !== "direct" && (
            <button
              type="button"
              onClick={() => void copyText("roomId", snapshot.roomId)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] transition hover:border-[var(--accent)]"
              title="点击复制房间码"
            >
              <span className="font-mono tracking-wider">{snapshot.roomId}</span>
              {copiedKey === "roomId" ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : (
                <Copy className="size-3.5 text-[var(--text-secondary)]" />
              )}
            </button>
          )}
          {snapshot.active && isHost && snapshot.networkMode === "direct" && snapshot.directServer.shareString && (
            <button
              type="button"
              onClick={() => void copyText("headerDirect", snapshot.directServer.shareString)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] transition hover:border-[var(--accent)]"
              title="点击复制直连口令"
            >
              <span>{copiedKey === "headerDirect" ? "已复制直连口令" : "复制直连口令"}</span>
              {copiedKey === "headerDirect" ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : (
                <Copy className="size-3.5 text-[var(--text-secondary)]" />
              )}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {snapshot.active && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)]">
              <span
                className={cn(
                  "lt-live-dot",
                  snapshot.signalingState === "reconnecting" && "!bg-amber-400",
                  snapshot.signalingState === "error" && "!bg-rose-500",
                )}
                aria-hidden="true"
              />
              <span>
                {isSynced ? "已同步" : snapshot.signalingState === "reconnecting" ? "重连中" : "连接异常"}
              </span>
              {rttMs !== null && (
                <span className="tabular-nums text-[var(--text-secondary)]">· {rttMs}ms</span>
              )}
              {lastDriftMs !== null && (
                <span className="tabular-nums text-[var(--text-secondary)]">
                  · 偏差 ±{Math.abs(lastDriftMs)}ms
                </span>
              )}
              {bufferPct !== null && (
                <span className="tabular-nums text-[var(--accent)]">· 缓冲 {bufferPct}%</span>
              )}
            </span>
          )}

          {AvatarPillButton}

          {snapshot.active ? (
            <>
              {isHost && (
                <button
                  type="button"
                  onClick={() =>
                    void onSetControlMode(
                      snapshot.controlMode === "collaborative" ? "host-only" : "collaborative",
                    )
                  }
                  className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)]/50 hover:text-[var(--text-primary)]"
                  title="切换房间切歌权限"
                >
                  {snapshot.controlMode === "collaborative" ? "全员可切歌" : "仅房主控场"}
                </button>
              )}
              <Button
                variant="glass"
                size="sm"
                onClick={() => setSubPage("info")}
              >
                <Info className="size-3.5" />
                房间信息
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                className="text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
                onClick={() => void onLeaveRoom()}
              >
                退出房间
              </Button>
            </>
          ) : (
            <Button
              variant="glass"
              size="sm"
              onClick={() => {
                setNetworkReturnPage("main");
                setSubPage("network");
              }}
            >
              <SlidersHorizontal className="size-3.5" />
              网络设置
            </Button>
          )}
        </div>
      </header>

      {combinedError && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-2xl border border-rose-500/20 bg-rose-500/8 px-4 py-3 text-xs text-rose-600 dark:text-rose-300"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{combinedError}</span>
        </div>
      )}

      {!snapshot.active ? (
        ariaLobbyCard
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
          {/* Left: Clean Room Stage */}
          <section className="glass lt-room-stage relative overflow-hidden rounded-[28px] p-6 sm:p-7">
            {displayTrack?.coverUrl && (
              <ArtworkImage
                src={displayTrack.coverUrl}
                alt=""
                cacheSize={512}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-[0.12] blur-3xl dark:opacity-[0.2]"
              />
            )}

            <div className="relative z-10 flex flex-col gap-5">
              <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/70 p-4 backdrop-blur-md">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
                    <Users className="size-3.5" />
                    在席听友
                  </span>
                  <span className="tabular-nums text-[11px] font-medium text-[var(--text-secondary)]">
                    {snapshot.members.length} / {snapshot.maxMembers} 人在席
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {snapshot.members.map((member) => {
                    const effPresence = resolveEffectivePresence(member.online, member.presence);
                    return (
                      <div
                        key={member.peerId}
                        title={`${member.nickname}${member.role === "host" ? "（房主）" : ""} · ${presenceLabel(effPresence)}`}
                        className={cn(
                          "flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)]/85 py-1 pl-1 pr-3 transition",
                          effPresence === "offline" && "opacity-65",
                        )}
                      >
                        <MemberAvatar
                          nickname={member.nickname}
                          avatarUrl={member.avatarUrl}
                          sizeClass="size-7"
                          isHost={member.role === "host"}
                          online={member.online}
                          presence={member.presence}
                          showStatusDot
                        />
                        <span
                          className={cn(
                            "max-w-[96px] truncate text-xs font-medium",
                            effPresence === "offline"
                              ? "text-[var(--text-secondary)]"
                              : "text-[var(--text-primary)]",
                          )}
                        >
                          {member.nickname}
                        </span>
                        {member.role === "host" && (
                          <span className="rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                            房主
                          </span>
                        )}
                        {effPresence !== "active" && (
                          <span className="text-[10px] text-[var(--text-secondary)]">
                            {presenceLabel(effPresence)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {Array.from({ length: emptySeatCount }).map((_, idx) => (
                    <span
                      key={`empty-${idx}`}
                      title={`空余席位 ${snapshot.members.length + idx + 1}/${snapshot.maxMembers}`}
                      className="flex size-9 items-center justify-center rounded-full border border-dashed border-[var(--line)] bg-[var(--surface)]/55 text-[var(--text-secondary)]"
                    >
                      <UserPlus className="size-3.5 opacity-55" />
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/60 p-4">
                {displayTrack ? (
                  <>
                    <div className="flex min-w-0 flex-1 items-center gap-3.5">
                      <CoverArt
                        track={displayTrack}
                        large
                        className="size-16 shrink-0 rounded-2xl shadow-md"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-base font-semibold text-[var(--text-primary)]">
                            {displayTrack.title}
                          </h2>
                          <SourceBadge source={displayTrack.source} compact />
                        </div>
                        <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                          {displayTrack.artist}
                          {displayTrack.album ? ` · ${displayTrack.album}` : ""}
                        </p>
                      </div>
                    </div>

                    <Button variant="glass" size="sm" onClick={onOpenPlayer}>
                      <Disc3 className="size-3.5" />
                      打开播放器
                    </Button>
                  </>
                ) : (
                  <div className="flex w-full items-center justify-between gap-3 py-1">
                    <span className="text-xs text-[var(--text-secondary)]">
                      暂未选曲，可在播放器点歌或从右侧导入歌单
                    </span>
                    <Button variant="glass" size="sm" onClick={onOpenPlayer}>
                      打开播放器
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Right: Clean Queue */}
          <aside className="glass flex max-h-[560px] flex-col rounded-[28px] p-5 sm:p-6">
            <div className="flex shrink-0 items-center justify-between gap-2 pb-3">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                播放队列
              </h2>
              <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">
                {queueQuery.trim()
                  ? `${filteredQueueItems.length} / ${queueItems.length} 首`
                  : `${queueItems.length} 首`}
              </span>
            </div>

            {superMixItems.length > 0 && canControl && (
              <div className="no-scrollbar mb-3 flex shrink-0 items-center gap-1.5 overflow-x-auto pb-0.5">
                {superMixItems.map(({ playlist, tracks: mixTracks }) => (
                  <Button
                    key={playlist.id}
                    type="button"
                    variant="glass"
                    size="sm"
                    disabled={mixTracks.length === 0}
                    className="shrink-0"
                    onClick={() => void onImportPlaylistTracks(mixTracks)}
                  >
                    <Sparkles className="size-3 text-[var(--accent)]" />
                    导入「{playlist.name}」({mixTracks.length})
                  </Button>
                ))}
              </div>
            )}

            {queueItems.length > 10 && (
              <div className="relative mb-3 shrink-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  value={queueQuery}
                  onChange={(e) => setQueueQuery(e.target.value)}
                  placeholder="搜索播放队列歌曲、歌手或点歌人…"
                  className="w-full rounded-full border border-[var(--line)] bg-[var(--surface-muted)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]/65 focus:border-[var(--accent)]"
                />
              </div>
            )}

            {filteredQueueItems.length > 0 ? (
              <div className="no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {filteredQueueItems.map(({ payload, track }, idx) => {
                  const isCurrent = payload.nonce === snapshot.playback.nonce;
                  return (
                    <button
                      key={`${payload.nonce}-${idx}`}
                      type="button"
                      disabled={!canControl}
                      onClick={() => onPickRoomTrack(track)}
                      className={cn(
                        "lt-queue-row flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left",
                        isCurrent && "is-current",
                        !canControl && "cursor-default",
                      )}
                    >
                      <span
                        className={cn(
                          "w-7 shrink-0 text-center text-[11px] font-medium tabular-nums",
                          isCurrent ? "text-[var(--accent)]" : "text-[var(--text-secondary)]",
                        )}
                      >
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <CoverArt track={track} className="size-10 shrink-0 rounded-xl" />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-xs font-semibold",
                            isCurrent ? "text-[var(--accent)]" : "text-[var(--text-primary)]",
                          )}
                        >
                          {payload.title}
                        </span>
                        <span className="flex items-center gap-1.5 truncate text-[11px] text-[var(--text-secondary)]">
                          <span className="truncate">{payload.artist}</span>
                          {payload.addedByName && (
                            <span className="shrink-0 rounded-full bg-[var(--surface-muted)] px-1.5 py-0.2 text-[10px] text-[var(--text-secondary)]">
                              {payload.addedByName}
                            </span>
                          )}
                        </span>
                      </span>
                      <SourceBadge source={payload.source} compact />
                      {isCurrent && <Play className="size-3.5 shrink-0 fill-current text-[var(--accent)]" />}
                    </button>
                  );
                })}
              </div>
            ) : queueItems.length > 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line)] px-4 py-10 text-center">
                <p className="text-xs font-medium text-[var(--text-secondary)]">没有找到匹配的歌曲</p>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line)] px-4 py-12 text-center">
                <Disc3 className="size-7 text-[var(--text-secondary)]/60" />
                <p className="mt-3 text-xs font-medium text-[var(--text-primary)]">播放队列暂无歌曲</p>
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  点选歌曲或导入「Super混合」即可同步
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
