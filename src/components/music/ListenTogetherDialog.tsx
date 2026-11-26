import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Disc3,
  Headphones,
  Link2,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  Send,
  UserPlus,
  X,
} from "lucide-react";
import type { Track } from "@/data/music";
import {
  api,
  type ListenTogetherContact,
  type ListenTogetherInvite,
  type ListenTogetherRoom,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArtworkImage } from "./ArtworkImage";
import { CoverArt } from "./shared";
import { SourceBadge } from "./SourceLogos";

function formatRelativeTime(timestamp: number) {
  if (!timestamp) return "";
  const diffMin = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  return `${Math.floor(diffHr / 24)} 天前`;
}

function ListenerAvatar({
  nickname,
  avatarUrl,
  size = "md",
}: {
  nickname: string;
  avatarUrl: string | null;
  size?: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "size-5 text-[10px]" : "size-11 text-sm";
  if (avatarUrl) {
    return (
      <ArtworkImage
        src={api.getNeteaseCoverUrl(avatarUrl)}
        cacheSize={size === "sm" ? 64 : 128}
        alt={nickname}
        className={cn(sizeClass, "shrink-0 rounded-full object-cover ring-2 ring-[var(--surface)]")}
      />
    );
  }
  return (
    <span
      className={cn(
        sizeClass,
        "flex shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] font-semibold text-[var(--accent)] ring-2 ring-[var(--surface)]",
      )}
    >
      {nickname.slice(0, 1)}
    </span>
  );
}

export function ListenTogetherView({
  connected,
  room,
  recoverableRoom,
  activeTrack,
  playing,
  invites,
  contacts,
  sharedTracks,
  loading,
  actionError,
  lastDriftMs,
  onBack,
  onRequireLogin,
  onCreateRoom,
  onJoinRoom,
  onResumeRecoverable,
  onDismissRecoverable,
  onLeaveRoom,
  onSyncNow,
  onRefreshInvites,
  onSendInviteMessage,
  onPickSharedTrack,
  onOpenPlayer,
  embedded = false,
  compactLobbyCard = false,
}: {
  connected: boolean;
  room: ListenTogetherRoom | null;
  recoverableRoom: ListenTogetherRoom | null;
  activeTrack: Track;
  playing: boolean;
  invites: ListenTogetherInvite[];
  contacts: ListenTogetherContact[];
  sharedTracks: Track[];
  loading: boolean;
  actionError: string | null;
  lastDriftMs: number | null;
  onBack: () => void;
  onRequireLogin: () => void;
  onCreateRoom: () => Promise<void>;
  onJoinRoom: (payload: { input?: string; roomId?: string; inviterId?: string }) => Promise<void>;
  onResumeRecoverable: () => Promise<void>;
  onDismissRecoverable: (roomId: string) => Promise<void>;
  onLeaveRoom: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  onRefreshInvites: () => Promise<void>;
  onSendInviteMessage: (userId: string, mode?: "song_card" | "short_link") => Promise<void>;
  onPickSharedTrack: (track: Track) => void;
  onOpenPlayer?: () => void;
  embedded?: boolean;
  compactLobbyCard?: boolean;
}) {
  const [joinInput, setJoinInput] = useState("");
  const [inviterOverride, setInviterOverride] = useState("");
  const [copied, setCopied] = useState(false);
  const [sendingUserId, setSendingUserId] = useState<string | null>(null);
  const [invitedUserIds, setInvitedUserIds] = useState<Record<string, true>>({});
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [contactFilter, setContactFilter] = useState<"all" | "mutual" | "recent">("all");
  const [inviteMode, setInviteMode] = useState<"song_card" | "short_link">("song_card");
  const [queueQuery, setQueueQuery] = useState("");

  const isSynced = (room?.roomUsers.length ?? 0) >= 2;
  const needsInviterField =
    joinInput.trim().length > 0 && !/(?:inviterId|inviterUid)[=:]|163cn\.tv\//i.test(joinInput);
  const currentNeteaseTrack = activeTrack.source === "netease" ? activeTrack : null;

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (contactFilter === "mutual" && contact.relation !== "mutual") return false;
      if (contactFilter === "recent" && contact.relation !== "recent" && !contact.lastMsgTime) return false;
      if (!q) return true;
      return contact.nickname.toLowerCase().includes(q) || contact.userId.includes(q);
    });
  }, [contacts, contactFilter, contactQuery]);

  const filteredQueueTracks = useMemo(() => {
    const q = queueQuery.trim().toLowerCase();
    if (!q) return sharedTracks;
    return sharedTracks.filter(
      (track) =>
        track.title.toLowerCase().includes(q) ||
        track.artist.toLowerCase().includes(q) ||
        (track.album ?? "").toLowerCase().includes(q),
    );
  }, [sharedTracks, queueQuery]);

  async function copyShareUrl() {
    if (!room?.shareUrl) return;
    try {
      await navigator.clipboard?.writeText(room.shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback unavailable.
    }
  }

  if (compactLobbyCard && !room) {
    return (
      <div className="glass flex h-full flex-col overflow-hidden rounded-[26px]">
        <div className="relative flex flex-col justify-between gap-5 bg-[linear-gradient(135deg,#3d1723_0%,#7b253a_55%,#23131d_100%)] p-5 text-white sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md">
              <span className="size-1.5 rounded-full bg-rose-300 shadow-[0_0_8px_#fda4af]" />
              网易云官方
            </span>
            <span className="rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[11px] font-medium text-white/85 backdrop-blur-md">
              双端互通
            </span>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold tracking-tight text-white">
                网易云一起听
              </h2>
              <p className="mt-1.5 text-xs text-white/80">
                与网易云官方手机 / 桌面端实时同步切歌与进度
              </p>
            </div>

            {connected ? (
              <Button
                size="default"
                disabled={loading}
                onClick={() => void onCreateRoom()}
                className="shrink-0 bg-white/95 text-[#2b1019] shadow-lg hover:bg-white"
              >
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : <Headphones className="size-4" />}
                开启一起听房间
              </Button>
            ) : (
              <Button
                size="default"
                onClick={onRequireLogin}
                className="shrink-0 bg-white/95 text-[#2b1019] shadow-lg hover:bg-white"
              >
                前往设置登录
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col justify-between bg-[var(--surface)]/65">
          {recoverableRoom && (
            <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 sm:mx-5">
              <span className="min-w-0 truncate text-xs text-[var(--text-primary)]">
                检测到旧房间 {recoverableRoom.roomId}
              </span>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loading}
                  onClick={() => void onDismissRecoverable(recoverableRoom.roomId)}
                >
                  结束
                </Button>
                <Button size="sm" disabled={loading} onClick={() => void onResumeRecoverable()}>
                  恢复同听
                </Button>
              </div>
            </div>
          )}

          {connected ? (
            <>
              <form
                className="p-4 sm:px-5 sm:py-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!joinInput.trim() || loading) return;
                  void onJoinRoom({
                    input: joinInput.trim(),
                    inviterId: inviterOverride.trim() || undefined,
                  });
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="listen-together-compact-join-input"
                    className="text-sm font-semibold text-[var(--text-primary)]"
                  >
                    加入好友房间
                  </label>
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    支持分享链接或 roomId
                  </span>
                </div>
                <div className="mt-2.5 space-y-2">
                  <div className="flex gap-2">
                    <input
                      id="listen-together-compact-join-input"
                      value={joinInput}
                      onChange={(event) => setJoinInput(event.target.value)}
                      placeholder="粘贴一起听分享链接或 roomId"
                      className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]/65 focus:border-[var(--accent)]"
                    />
                    <Button type="submit" variant="subtle" disabled={!joinInput.trim() || loading}>
                      {loading ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                      加入
                    </Button>
                  </div>
                  {needsInviterField && (
                    <input
                      value={inviterOverride}
                      onChange={(event) => setInviterOverride(event.target.value)}
                      placeholder="邀请人 UID（链接未含 inviterId 时填写）"
                      className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 py-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]/65 focus:border-[var(--accent)]"
                    />
                  )}
                </div>
              </form>

              <div className="border-t border-[var(--line)] p-4 sm:px-5 sm:py-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[var(--text-secondary)]">
                    收到的私信邀请{invites.length > 0 ? ` (${invites.length})` : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    {invites.length === 0 && (
                      <span className="text-[11px] text-[var(--text-secondary)]/75">
                        暂无待加入邀请
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label="刷新私信邀请"
                      disabled={loading}
                      onClick={() => void onRefreshInvites()}
                      className="rounded-lg p-1 text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
                    >
                      <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
                    </button>
                  </div>
                </div>

                {invites.length > 0 && (
                  <div className="mt-2.5 max-h-[120px] space-y-1.5 overflow-y-auto pr-0.5">
                    {invites.map((inv) => (
                      <div
                        key={inv.roomId}
                        className="flex items-center justify-between gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)]/75 px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <ListenerAvatar
                            nickname={inv.fromUser.nickname}
                            avatarUrl={inv.fromUser.avatarUrl}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                              {inv.fromUser.nickname}
                              <span className="ml-1.5 text-[10px] font-normal text-[var(--text-secondary)]">
                                {formatRelativeTime(inv.time)}
                              </span>
                            </p>
                            <p className="truncate text-[11px] text-[var(--text-secondary)]">
                              {inv.message}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="subtle"
                          disabled={loading}
                          onClick={() =>
                            void onJoinRoom({ roomId: inv.roomId, inviterId: inv.inviterId })
                          }
                        >
                          接受
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-between gap-3 p-4 sm:p-5">
              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                登录网易云音乐账号后，即可创建或加入「一起听」房间，与好友手机 / 桌面端实时同频。
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "mt-10 border-t border-[var(--line)] pt-8" : "lt-page"}>
      {/* Editorial Top Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 pb-6 pt-1">
        <div className="flex items-center gap-3.5">
          {!embedded && (
            <Button variant="ghost" size="icon" aria-label="返回上一页" onClick={onBack} title="返回上一页">
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <div>
            <p className="home-greeting !mb-1">
              <span className="home-greeting-mark" aria-hidden="true" />
              NETEASE LISTEN TOGETHER
            </p>
            {embedded ? (
              <h2 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
                网易云一起听
              </h2>
            ) : (
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                网易云一起听
              </h1>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {room ? (
            <>
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]">
                <span className={cn("lt-live-dot", !isSynced && "!bg-amber-400")} aria-hidden="true" />
                {isSynced ? "已同步" : "等待好友入座"}
                {isSynced && lastDriftMs !== null && (
                  <span className="text-[11px] tabular-nums text-[var(--text-secondary)]">
                    · {Math.abs(lastDriftMs)}ms
                  </span>
                )}
              </span>
              <Button variant="glass" size="sm" disabled={loading} onClick={() => void onSyncNow()}>
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
                立即对齐
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
          ) : null}
        </div>
      </header>

      {actionError && (
        <div
          role="alert"
          className="mb-5 flex items-center gap-2.5 rounded-2xl border border-rose-500/20 bg-rose-500/8 px-4 py-3 text-xs text-rose-600 dark:text-rose-300"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{actionError}</span>
        </div>
      )}

      {!connected ? (
        <section className="glass mx-auto my-10 max-w-lg rounded-[28px] p-10 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Headphones className="size-6" />
          </div>
          <h2 className="mt-5 font-serif text-2xl font-semibold text-[var(--text-primary)]">
            登录网易云，开启双端同听
          </h2>
          <p className="mt-2.5 text-sm leading-relaxed text-[var(--text-secondary)]">
            连接你的网易云音乐账号后，即可创建或加入「一起听」房间，与好友手机或桌面客户端实时同步切歌与进度。
          </p>
          <div className="mt-7 flex justify-center">
            <Button onClick={onRequireLogin}>前往设置登录</Button>
          </div>
        </section>
      ) : room ? (
        /* Active Room Studio Layout */
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
          {/* Left: Now Syncing Stage Card */}
          <section className="glass lt-room-stage relative overflow-hidden rounded-[28px] p-6 sm:p-7">
            {currentNeteaseTrack?.coverUrl && (
              <img
                src={currentNeteaseTrack.coverUrl}
                alt=""
                aria-hidden="true"
                referrerPolicy="no-referrer"
                className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-[0.12] blur-3xl dark:opacity-[0.2]"
              />
            )}

            <div className="relative z-10 flex flex-col">
              {/* Paired Listeners Bridge */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/75 px-4 py-3 backdrop-blur-md">
                {(() => {
                  const host = room.roomUsers.find((u) => u.userId === room.creatorId) ?? room.roomUsers[0];
                  const guest = room.roomUsers.find((u) => u.userId !== host?.userId);
                  return (
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <ListenerAvatar
                          nickname={host?.nickname ?? "我"}
                          avatarUrl={host?.avatarUrl ?? null}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
                              {host?.nickname ?? "发起人"}
                            </span>
                            <span className="rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                              房主
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--text-secondary)]">正在同步输出</p>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-center gap-1 px-2">
                        {isSynced ? (
                          <div className="lt-sync-wave" aria-label="双端同步波形">
                            <span />
                            <span />
                            <span />
                          </div>
                        ) : (
                          <span className="h-px w-10 border-t border-dashed border-[var(--text-secondary)]/40" />
                        )}
                        <span className="text-[10px] tracking-wider text-[var(--text-secondary)]">
                          {isSynced ? "IN SYNC" : "WAITING"}
                        </span>
                      </div>

                      {guest ? (
                        <div className="flex min-w-0 items-center gap-2.5 text-right">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                              {guest.nickname}
                            </p>
                            <p className="text-[11px] text-[var(--text-secondary)]">
                              {room.roomUsers.length > 2 ? `等 ${room.roomUsers.length - 1} 位好友` : "已进入房间"}
                            </p>
                          </div>
                          <ListenerAvatar nickname={guest.nickname} avatarUrl={guest.avatarUrl} />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-right">
                          <div>
                            <p className="text-xs font-medium text-[var(--text-secondary)]">虚位以待</p>
                            <p className="text-[11px] text-[var(--text-secondary)]/75">等待好友入座</p>
                          </div>
                          <span className="flex size-11 items-center justify-center rounded-full border border-dashed border-[var(--line)] bg-[var(--surface)]/70 text-[var(--text-secondary)]">
                            <UserPlus className="size-4" />
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Compact Sync Status Strip (controlled via Aria's main Player) */}
              <div className="my-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/60 p-4">
                <div className="flex min-w-0 flex-1 items-center gap-3.5">
                  {currentNeteaseTrack ? (
                    <CoverArt
                      track={currentNeteaseTrack}
                      className="size-12 shrink-0 rounded-xl shadow-sm"
                    />
                  ) : (
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                      <Disc3 className="size-5 opacity-80" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold tracking-[0.12em] text-[var(--accent)]">
                      当前与播放器同步
                    </p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-[var(--text-primary)]">
                      {currentNeteaseTrack ? currentNeteaseTrack.title : "等待选择同步曲目"}
                    </p>
                    <p className="truncate text-xs text-[var(--text-secondary)]">
                      {currentNeteaseTrack
                        ? `${currentNeteaseTrack.artist} · ${playing ? "播放中" : "已暂停"}`
                        : "在右侧共享队列或曲库选歌后，主播放器将自动同步"}
                    </p>
                  </div>
                </div>
                {onOpenPlayer && (
                  <Button
                    variant="glass"
                    size="sm"
                    onClick={onOpenPlayer}
                    className="shrink-0"
                  >
                    前往播放器
                    <ArrowRight className="size-3.5" />
                  </Button>
                )}
              </div>

              {/* Clean Share Dock */}
              <div className="border-t border-[var(--line)] pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[var(--text-primary)]">
                      房间 ID：{room.roomId}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                      发给好友或在手机网易云打开链接即可同听；切歌、暂停与进度均直接与 Aria 播放器双向同步。
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="subtle" onClick={() => void copyShareUrl()}>
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied ? "已复制链接" : "复制邀请链接"}
                    </Button>
                    {contacts.length > 0 && (
                      <Button
                        size="sm"
                        variant="glass"
                        onClick={() => setContactsOpen((v) => !v)}
                      >
                        <Send className="size-3.5" />
                        邀请好友（{contacts.length}）
                      </Button>
                    )}
                  </div>
                </div>

                {contactsOpen && contacts.length > 0 && (
                  <div className="mt-3.5 space-y-3 border-t border-[var(--line)] pt-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-secondary)]" />
                        <input
                          value={contactQuery}
                          onChange={(event) => setContactQuery(event.target.value)}
                          placeholder="搜索好友或网易云关注…"
                          className="w-full rounded-full border border-[var(--line)] bg-[var(--surface-muted)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]/65 focus:border-[var(--accent)]"
                        />
                      </div>
                      <div className="flex items-center gap-1 rounded-full bg-[var(--surface-muted)] p-0.5 text-[11px]">
                        {(
                          [
                            { id: "all", label: "全部" },
                            { id: "mutual", label: "互关" },
                            { id: "recent", label: "最近" },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setContactFilter(tab.id)}
                            className={cn(
                              "rounded-full px-2.5 py-1 font-medium transition",
                              contactFilter === tab.id
                                ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm"
                                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                            )}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">发送样式</span>
                      <div className="flex items-center gap-1 rounded-full bg-[var(--surface-muted)] p-0.5 text-[11px]" role="group" aria-label="邀请私信样式">
                        {(
                          [
                            { id: "song_card", label: "音乐卡片" },
                            { id: "short_link", label: "精简短链" },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setInviteMode(opt.id)}
                            className={cn(
                              "rounded-full px-2.5 py-1 font-medium transition",
                              inviteMode === opt.id
                                ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm"
                                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                      网易云原版「加入一起听」头像小卡片由官方服务端内部 RPC 下发，第三方无法直接伪造；默认发送「当前歌曲音乐卡片 + 精简短链」，若从官方 App 发起则 Aria 可实时弹窗一键加入。
                    </p>

                    <div className="no-scrollbar max-h-60 space-y-1.5 overflow-y-auto pr-1">
                      {filteredContacts.length ? (
                        filteredContacts.map((contact) => {
                          const isSending = sendingUserId === contact.userId;
                          const isInvited = Boolean(invitedUserIds[contact.userId]);
                          return (
                            <div
                              key={contact.userId}
                              className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/60 px-3 py-2"
                            >
                              <div className="flex min-w-0 items-center gap-2.5">
                                <ListenerAvatar
                                  nickname={contact.nickname}
                                  avatarUrl={contact.avatarUrl}
                                  size="sm"
                                />
                                <span className="truncate text-xs font-medium text-[var(--text-primary)]">
                                  {contact.nickname}
                                </span>
                                {contact.relation === "mutual" && (
                                  <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                                    互关
                                  </span>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant={isInvited ? "ghost" : "subtle"}
                                disabled={isSending}
                                onClick={async () => {
                                  setSendingUserId(contact.userId);
                                  try {
                                    await onSendInviteMessage(contact.userId, inviteMode);
                                    setInvitedUserIds((prev) => ({ ...prev, [contact.userId]: true }));
                                  } catch {
                                    // Error surface is handled by parent caller.
                                  } finally {
                                    setSendingUserId(null);
                                  }
                                }}
                                className="h-7 shrink-0 px-3 text-[11px]"
                              >
                                {isSending ? (
                                  <LoaderCircle className="size-3 animate-spin" />
                                ) : isInvited ? (
                                  <Check className="size-3 text-emerald-500" />
                                ) : null}
                                {isInvited ? "已发送" : "邀请"}
                              </Button>
                            </div>
                          );
                        })
                      ) : (
                        <p className="py-4 text-center text-xs text-[var(--text-secondary)]">
                          没有匹配的好友
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Right: Shared Queue Card */}
          <aside className="glass flex max-h-[620px] flex-col rounded-[28px] p-5 sm:p-6">
            <div className="flex shrink-0 items-baseline justify-between gap-2 pb-3">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.14em] text-[var(--text-secondary)]">
                  SHARED QUEUE
                </p>
                <h2 className="mt-0.5 text-base font-semibold text-[var(--text-primary)]">
                  共享歌单队列
                </h2>
              </div>
              <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">
                {queueQuery.trim()
                  ? `${filteredQueueTracks.length} / ${sharedTracks.length} 首`
                  : `${sharedTracks.length} 首`}
              </span>
            </div>

            {sharedTracks.length > 20 && (
              <div className="relative mb-3 shrink-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  value={queueQuery}
                  onChange={(event) => setQueueQuery(event.target.value)}
                  placeholder="搜索共享队列歌曲或歌手…"
                  className="w-full rounded-full border border-[var(--line)] bg-[var(--surface-muted)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]/65 focus:border-[var(--accent)]"
                />
              </div>
            )}

            {filteredQueueTracks.length > 0 ? (
              <div className="no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {filteredQueueTracks.map((track, idx) => {
                  const isCurrent =
                    activeTrack.source === "netease" && activeTrack.providerId === track.providerId;
                  return (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => onPickSharedTrack(track)}
                      style={{ contentVisibility: "auto", containIntrinsicSize: "0 56px" }}
                      className={cn(
                        "lt-queue-row flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left",
                        isCurrent && "is-current",
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
                          {track.title}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--text-secondary)]">
                          {track.artist}
                        </span>
                      </span>
                      {isCurrent && (
                        <Play className="size-3.5 shrink-0 fill-current text-[var(--accent)]" />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : sharedTracks.length > 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line)] px-4 py-10 text-center">
                <p className="text-xs font-medium text-[var(--text-secondary)]">没有找到匹配的歌曲</p>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line)] px-4 py-12 text-center">
                <Disc3 className="size-7 text-[var(--text-secondary)]/60" />
                <p className="mt-3 text-xs font-medium text-[var(--text-primary)]">共享队列暂无歌曲</p>
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  从搜索或歌单页点击任一网易云歌曲即可同步加入并播放。
                </p>
              </div>
            )}
          </aside>
        </div>
      ) : (
        /* Connected Lobby Studio Layout */
        <div className="space-y-6">
          {recoverableRoom && (
            <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="size-2.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    检测到你有一个进行中的一起听房间
                  </p>
                  <p className="truncate text-xs text-[var(--text-secondary)]">
                    房间 ID：{recoverableRoom.roomId} · 当前成员 {recoverableRoom.roomUsers.length || 1} 人
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loading}
                  onClick={() => void onDismissRecoverable(recoverableRoom.roomId)}
                >
                  结束旧房间
                </Button>
                <Button size="sm" disabled={loading} onClick={() => void onResumeRecoverable()}>
                  {loading && <LoaderCircle className="size-3.5 animate-spin" />}
                  恢复同听
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.85fr)]">
            {/* Left Editorial Create Hero */}
            <div className="space-y-5">
              <div className="pt-1">
                <h2 className="lt-hero-title">
                  与此刻同频，<span>一起听见一首歌</span>
                </h2>
                <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-secondary)] sm:text-sm">
                  实时同步切歌、播控与共享歌单队列，与网易云官方手机/桌面端互通。
                </p>
              </div>

              <div className="lt-poster-card bg-[linear-gradient(135deg,#3d1723_0%,#7b253a_55%,#23131d_100%)]">
                <div className="relative z-10 flex items-center justify-between gap-3 pb-10">
                  <span className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-white/85">
                    <span className="size-1.5 rounded-full bg-rose-300 shadow-[0_0_10px_#fda4af]" />
                    NETEASE LISTEN TOGETHER
                  </span>
                  <span className="text-[11px] text-white/65">支持实时互邀</span>
                </div>

                <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-3.5">
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-white/12 text-white backdrop-blur-md ring-1 ring-white/20">
                      <Headphones className="size-6" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-white">
                        网易云一起听
                      </p>
                      <p className="mt-0.5 truncate text-xs text-white/75">
                        创建房间后，点击任意网易云歌曲即可同步给好友
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Button
                      size="default"
                      disabled={loading}
                      onClick={() => void onCreateRoom()}
                      className="bg-white/95 text-[#2b1019] shadow-lg hover:bg-white"
                    >
                      {loading ? <LoaderCircle className="size-4 animate-spin" /> : <Headphones className="size-4" />}
                      开启一起听房间
                    </Button>
                    <span className="text-[11px] text-white/65">创建后自动复制邀请链接</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Stack: Join + Inbox Invites */}
            <div className="space-y-5">
              <form
                className="glass rounded-[24px] p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!joinInput.trim() || loading) return;
                  void onJoinRoom({
                    input: joinInput.trim(),
                    inviterId: inviterOverride.trim() || undefined,
                  });
                }}
              >
                <p className="text-[10px] font-semibold tracking-[0.14em] text-[var(--text-secondary)]">
                  JOIN ROOM
                </p>
                <label
                  htmlFor="listen-together-join-input"
                  className="mt-1 block text-base font-semibold text-[var(--text-primary)]"
                >
                  加入好友房间
                </label>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  粘贴好友分享的网易云链接（`st.music.163.com/...`）或房间号：
                </p>
                <div className="mt-3.5 space-y-2.5">
                  <div className="flex gap-2">
                    <input
                      id="listen-together-join-input"
                      value={joinInput}
                      onChange={(event) => setJoinInput(event.target.value)}
                      placeholder="粘贴一起听分享链接或 roomId"
                      className="min-w-0 flex-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]/65 focus:border-[var(--accent)]"
                    />
                    <Button type="submit" disabled={!joinInput.trim() || loading}>
                      {loading ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                      加入
                    </Button>
                  </div>
                  {needsInviterField && (
                    <input
                      value={inviterOverride}
                      onChange={(event) => setInviterOverride(event.target.value)}
                      placeholder="邀请人 UID（链接未含 inviterId 时填写）"
                      className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 py-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]/65 focus:border-[var(--accent)]"
                    />
                  )}
                </div>
              </form>

              <section className="glass rounded-[24px] p-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold tracking-[0.14em] text-[var(--text-secondary)]">
                      INBOX INVITES
                    </p>
                    <h3 className="mt-0.5 text-base font-semibold text-[var(--text-primary)]">
                      收到的私信邀请
                    </h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="刷新私信邀请"
                    disabled={loading}
                    onClick={() => void onRefreshInvites()}
                  >
                    <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                  </Button>
                </div>

                {invites.length ? (
                  <div className="mt-3.5 space-y-2.5">
                    {invites.map((inv) => (
                      <div
                        key={inv.roomId}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/75 px-3.5 py-2.5"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <ListenerAvatar
                            nickname={inv.fromUser.nickname}
                            avatarUrl={inv.fromUser.avatarUrl}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                              {inv.fromUser.nickname}
                              <span className="ml-2 text-[11px] font-normal text-[var(--text-secondary)]">
                                {formatRelativeTime(inv.time)}
                              </span>
                            </p>
                            <p className="truncate text-xs text-[var(--text-secondary)]">
                              {inv.message}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="subtle"
                          disabled={loading}
                          onClick={() =>
                            void onJoinRoom({ roomId: inv.roomId, inviterId: inv.inviterId })
                          }
                        >
                          接受
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                    暂无待加入的一起听私信邀请。收到好友邀请时会自动弹出提醒，也可点右上角图标手动刷新。
                  </p>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ListenTogetherInviteToast({
  invite,
  loading,
  onAccept,
  onDismiss,
}: {
  invite: ListenTogetherInvite | null;
  loading?: boolean;
  onAccept: (invite: ListenTogetherInvite) => Promise<void> | void;
  onDismiss: (roomId: string) => void;
}) {
  if (!invite) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label="收到网易云一起听邀请"
      className="fixed right-5 top-[88px] z-[85] w-[min(368px,calc(100vw-2.5rem))]"
    >
      <div className="glass relative overflow-hidden rounded-[24px] p-4 shadow-[0_24px_60px_rgba(32,26,64,0.18)]">
        <div className="flex items-center justify-between gap-2 pb-2.5">
          <span className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.14em] text-[var(--accent)]">
            <span className="lt-live-dot" aria-hidden="true" />
            LISTEN TOGETHER INVITE
          </span>
          <button
            type="button"
            aria-label="关闭邀请提示"
            disabled={loading}
            onClick={() => onDismiss(invite.roomId)}
            className="flex size-6 items-center justify-center rounded-full text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <ListenerAvatar nickname={invite.fromUser.nickname} avatarUrl={invite.fromUser.avatarUrl} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {invite.fromUser.nickname} 邀请你加入一起听
            </p>
            <div className="mt-1 flex items-center gap-2">
              {invite.songCoverUrl && (
                <ArtworkImage
                  src={api.getNeteaseCoverUrl(invite.songCoverUrl)}
                  cacheSize={64}
                  alt=""
                  className="size-5 shrink-0 rounded-md object-cover"
                />
              )}
              <p className="truncate text-xs text-[var(--text-secondary)]">
                {invite.songTitle ? `正在听「${invite.songTitle}」` : invite.message}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3.5 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => onDismiss(invite.roomId)}
          >
            暂不加入
          </Button>
          <Button
            size="sm"
            disabled={loading}
            onClick={() => void onAccept(invite)}
          >
            {loading && <LoaderCircle className="size-3.5 animate-spin" />}
            立即加入
          </Button>
        </div>
      </div>
    </aside>
  );
}

export function ListenTogetherExitPromptDialog({
  pendingTrack,
  onContinueTogether,
  onConfirmExitAndPlay,
}: {
  pendingTrack: Track | null;
  onContinueTogether: () => void;
  onConfirmExitAndPlay: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pendingTrack && !dialog.open) dialog.showModal();
    if (!pendingTrack && dialog.open) dialog.close();
  }, [pendingTrack]);

  if (!pendingTrack) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="listen-together-exit-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onContinueTogether();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onContinueTogether();
      }}
      className="fixed inset-0 m-auto flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/35 p-4 backdrop-blur-sm backdrop:bg-transparent"
    >
      <section className="glass w-full max-w-md rounded-3xl p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <AlertTriangle className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h2
                id="listen-together-exit-title"
                className="text-lg font-semibold text-[var(--text-primary)]"
              >
                切换到其他音源将退出「一起听」
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="取消"
                disabled={busy}
                onClick={onContinueTogether}
              >
                <X className="size-4" />
              </Button>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              当前正在网易云「一起听」房间中，一起听仅支持同步网易云音乐曲目。继续播放下方歌曲将结束同步并离开当前房间：
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] p-3">
          <CoverArt track={pendingTrack} className="size-12 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {pendingTrack.title}
            </p>
            <p className="truncate text-xs text-[var(--text-secondary)]">{pendingTrack.artist}</p>
          </div>
          <SourceBadge source={pendingTrack.source} compact />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onContinueTogether}>
            继续一起听
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirmExitAndPlay();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <LoaderCircle className="size-3.5 animate-spin" />}
            退出一起听并播放
          </Button>
        </div>
      </section>
    </dialog>
  );
}
