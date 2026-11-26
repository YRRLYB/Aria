import neteaseApi from "NeteaseCloudMusicApi";
import type { ProviderTrack } from "../../providers/musicProvider";
import { neteaseClient } from "../../clients/neteaseClient";
import { withNeteaseIdentity } from "../../clients/neteaseIdentity";
import { getNeteaseAccountSummary } from "../../services/neteaseService";
import { readStore } from "../../store";
import { HttpError } from "../../utils/httpError";

export type ListenTogetherUser = {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
};

export type ListenTogetherPlayInfo = {
  songId: string | null;
  playStatus: "PLAY" | "PAUSE";
  progressMs: number;
  clientSeq: number;
  serverSeq?: number;
  commandType?: string | null;
  operatorUserId?: string | null;
  commandTime?: number | null;
};

export type ListenTogetherRoom = {
  roomId: string;
  inviterId: string | null;
  creatorId: string | null;
  status: string;
  roomUsers: ListenTogetherUser[];
  playInfo: ListenTogetherPlayInfo | null;
  shareUrl: string;
  serverTime: number;
};

export type ListenTogetherInvite = {
  roomId: string;
  inviterId: string;
  songId: string | null;
  songTitle?: string | null;
  songCoverUrl?: string | null;
  fromUser: ListenTogetherUser;
  message: string;
  time: number;
};

export type ListenTogetherContact = {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  lastMsgTime: number;
  relation?: "mutual" | "recent" | "following";
};

export type ListenTogetherStatusResult = {
  inRoom: boolean;
  room: ListenTogetherRoom | null;
  roomClosed?: boolean;
};

export type ListenTogetherStateResult = ListenTogetherStatusResult & {
  selfUserId?: string | null;
  playlistVersion: number;
  displayList: string[];
  sharedTracks: ProviderTrack[];
  activeTrack?: ProviderTrack | null;
};

const hydratedTrackCache = new Map<string, { track: ProviderTrack; cachedAt: number }>();
const HYDRATED_TRACK_TTL_MS = 10 * 60_000;
const contactsCache = new Map<string, { contacts: ListenTogetherContact[]; cachedAt: number }>();
const CONTACTS_CACHE_TTL_MS = 5 * 60_000;
const shortUrlCache = new Map<string, string>();
const resolvedShortUrlCache = new Map<string, { roomId: string; inviterId: string | null; songId: string | null }>();
const roomPlaylistVersionMap = new Map<string, Array<{ userId: string; version: number }>>();
const MAX_SYNC_PLAYLIST_TRACKS = 500;

const LISTEN_TOGETHER_INVITE_COPY = "我的耳机分你一半，和我一起听歌吧~";

function trimHydratedTrackCache() {
  while (hydratedTrackCache.size > 4000) {
    const oldest = hydratedTrackCache.keys().next().value;
    if (oldest === undefined) break;
    hydratedTrackCache.delete(oldest);
  }
}

async function hydrateTrackIdsCached(ids: string[]): Promise<ProviderTrack[]> {
  const clean = [...new Set(ids.map((id) => String(id).trim()).filter((id) => /^\d+$/.test(id)))];
  if (!clean.length) return [];
  const now = Date.now();
  const missing: string[] = [];
  for (const id of clean) {
    const cached = hydratedTrackCache.get(id);
    if (!cached || now - cached.cachedAt > HYDRATED_TRACK_TTL_MS) {
      missing.push(id);
    }
  }
  if (missing.length) {
    const fetched = await neteaseClient.getTracksByIds(missing);
    for (const track of fetched) {
      hydratedTrackCache.set(track.id, { track, cachedAt: now });
    }
    trimHydratedTrackCache();
  }
  return clean
    .map((id) => hydratedTrackCache.get(id)?.track ?? null)
    .filter((track): track is ProviderTrack => Boolean(track));
}

export function buildListenTogetherShareUrl(
  roomId: string,
  inviterId?: string | null,
  songId?: string | null,
): string {
  const params = new URLSearchParams({ roomId });
  if (inviterId) params.set("inviterId", String(inviterId));
  if (songId && /^\d+$/.test(String(songId))) params.set("songId", String(songId));
  return `https://st.music.163.com/listen-together/share/?${params.toString()}`;
}

export async function shortenListenTogetherUrl(shareUrl: string, cookie: string): Promise<string> {
  const cached = shortUrlCache.get(shareUrl);
  if (cached) return cached;
  try {
    const batchFn = (neteaseApi as unknown as Record<string, NcmCallable | undefined>).batch;
    if (!batchFn) return shareUrl;
    const response = await batchFn(
      await withNeteaseIdentity({
        "/api/middle/shorturl/generate": JSON.stringify({ url: shareUrl }),
        cookie,
      }),
    );
    const body = unwrapBody(response);
    const inner = body["/api/middle/shorturl/generate"];
    if (inner && typeof inner === "object") {
      const innerData = (inner as Record<string, unknown>).data as Record<string, unknown> | undefined;
      const shortUrl = typeof innerData?.shortUrl === "string" ? innerData.shortUrl.trim() : "";
      if (shortUrl && /^https?:\/\/163cn\.tv\//i.test(shortUrl)) {
        if (shortUrlCache.size >= 120) {
          const oldest = shortUrlCache.keys().next().value;
          if (oldest !== undefined) shortUrlCache.delete(oldest);
        }
        shortUrlCache.set(shareUrl, shortUrl);
        return shortUrl;
      }
    }
  } catch {
    // Fall back to the canonical URL if NetEase's shortlink generator is unavailable.
  }
  return shareUrl;
}

function isAllowedListenTogetherRedirect(location: string): boolean {
  if (/^orpheus:\/\//i.test(location)) return true;
  try {
    const parsed = new URL(location);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "music.163.com" || host.endsWith(".music.163.com");
  } catch {
    return false;
  }
}

export async function resolveShortListenTogetherUrl(
  rawInput: string,
): Promise<{ roomId: string; inviterId: string | null; songId: string | null } | null> {
  const match = rawInput.match(/https?:\/\/163cn\.tv\/[A-Za-z0-9_-]{3,32}/i);
  if (!match) return null;
  const shortUrl = match[0].replace(/^http:/i, "https:");
  const cached = resolvedShortUrlCache.get(shortUrl);
  if (cached) return cached;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_500);
    const response = await fetch(shortUrl, { redirect: "manual", signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
    const location = response.headers.get("location")?.trim();
    if (location && isAllowedListenTogetherRedirect(location)) {
      const parsed = parseListenTogetherInvite(location);
      if (parsed?.roomId) {
        if (resolvedShortUrlCache.size >= 120) {
          const oldest = resolvedShortUrlCache.keys().next().value;
          if (oldest !== undefined) resolvedShortUrlCache.delete(oldest);
        }
        resolvedShortUrlCache.set(shortUrl, parsed);
        return parsed;
      }
    }
  } catch {
    // Ignore transient shortlink lookup errors.
  }
  return null;
}

function decodeLayers(value: string): string {
  let current = value;
  for (let i = 0; i < 4; i += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}

export function parseListenTogetherInvite(
  rawInput: string,
): { roomId: string; inviterId: string | null; songId: string | null } | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const decoded = decodeLayers(trimmed);
  const candidates = [trimmed, decoded];

  for (const text of candidates) {
    const urls = text.match(/(?:https?|orpheus):\/\/[^\s"'<>]+/gi) ?? [];
    for (const urlText of urls) {
      for (const variant of [urlText, decodeLayers(urlText)]) {
        try {
          const url = new URL(variant);
          const roomId = url.searchParams.get("roomId") ?? url.searchParams.get("roomid");
          if (roomId && roomId.trim()) {
            const inviterId =
              url.searchParams.get("inviterId") ??
              url.searchParams.get("inviterid") ??
              url.searchParams.get("inviterUid");
            const songId = url.searchParams.get("songId") ?? url.searchParams.get("songid");
            return {
              roomId: roomId.trim(),
              inviterId: inviterId?.trim() || null,
              songId: songId?.trim() || null,
            };
          }
          for (const paramKey of ["url1", "url2", "url", "webUrl"] as const) {
            const nestedUrl = url.searchParams.get(paramKey);
            if (!nestedUrl) continue;
            const inner = parseListenTogetherInvite(nestedUrl);
            if (inner?.roomId) return inner;
          }
        } catch {
          // Ignore malformed candidate URL and keep scanning.
        }
      }
    }

    const roomMatch = text.match(/(?:^|[?&\s,])roomId[=:]([A-Za-z0-9_+=/%-]{6,160})/i);
    if (roomMatch?.[1]) {
      const inviterMatch = text.match(/(?:^|[?&\s,])(?:inviterId|inviterUid)[=:](\d{3,20})/i);
      const songMatch = text.match(/(?:^|[?&\s,])songId[=:](\d{3,20})/i);
      return {
        roomId: decodeLayers(roomMatch[1].trim()),
        inviterId: inviterMatch?.[1] ?? null,
        songId: songMatch?.[1] ?? null,
      };
    }
  }

  // Raw roomId fallback (base64 / token)
  if (/^[A-Za-z0-9_+=/%-]{8,160}$/.test(trimmed)) {
    return { roomId: trimmed, inviterId: null, songId: null };
  }
  return null;
}

function normalizeUser(raw: unknown): ListenTogetherUser | null {
  if (!raw || typeof raw !== "object") return null;
  const rawObj = raw as Record<string, unknown>;
  const user = (rawObj.user && typeof rawObj.user === "object" ? rawObj.user : rawObj) as Record<string, unknown>;
  const userId = user.userId ?? user.uid ?? user.id;
  if (userId == null || !String(userId).trim()) return null;
  return {
    userId: String(userId).trim(),
    nickname: typeof user.nickname === "string" && user.nickname.trim() ? user.nickname.trim() : "云村听友",
    avatarUrl: typeof user.avatarUrl === "string" && user.avatarUrl.trim() ? user.avatarUrl.trim() : null,
  };
}

function normalizePlayStatus(raw: unknown): "PLAY" | "PAUSE" {
  if (typeof raw === "boolean") return raw ? "PLAY" : "PAUSE";
  if (typeof raw === "number") return raw === 0 || raw === 2 ? "PAUSE" : "PLAY";
  const s = String(raw ?? "").trim().toUpperCase();
  return s === "PAUSE" || s === "PAUSED" || s === "STOP" || s === "0" || s === "2" || s === "FALSE"
    ? "PAUSE"
    : "PLAY";
}

function pickPositiveNumericId(...candidates: unknown[]): string | null {
  for (const val of candidates) {
    if (val == null) continue;
    const str = String(val).trim();
    if (/^\d+$/.test(str) && str !== "0") {
      return str;
    }
  }
  return null;
}

function normalizePlayInfo(
  rawPlayInfo: Record<string, unknown> | string | null | undefined,
  fallbackContainer?: Record<string, unknown> | null,
): ListenTogetherPlayInfo | null {
  let parsedRaw: unknown = rawPlayInfo;
  if (typeof rawPlayInfo === "string" && rawPlayInfo.trim().startsWith("{")) {
    try {
      parsedRaw = JSON.parse(rawPlayInfo);
    } catch {
      parsedRaw = null;
    }
  }
  const src =
    parsedRaw && typeof parsedRaw === "object"
      ? (parsedRaw as Record<string, unknown>)
      : fallbackContainer;
  if (!src || typeof src !== "object") return null;

  const songId = pickPositiveNumericId(
    src.targetSongId,
    src.songId,
    src.currentSongId,
    src.anchorSongId,
    src.formerSongId,
    fallbackContainer?.targetSongId,
    fallbackContainer?.songId,
  );
  const rawProgress = Number(
    src.progress ?? src.position ?? src.playedTime ?? fallbackContainer?.progress ?? 0,
  );
  const progressMs = Number.isFinite(rawProgress) && rawProgress >= 0 ? Math.round(rawProgress) : 0;
  const rawClientSeq = Number(src.clientSeq ?? fallbackContainer?.clientSeq ?? 0);
  const rawServerSeq = Number(src.serverSeq ?? src.seq ?? fallbackContainer?.serverSeq ?? 0);
  const clientSeqNum = Number.isFinite(rawClientSeq) && rawClientSeq >= 0 ? Math.floor(rawClientSeq) : 0;
  const serverSeqNum = Number.isFinite(rawServerSeq) && rawServerSeq >= 0 ? Math.floor(rawServerSeq) : 0;
  const clientSeq = clientSeqNum;
  const commandTypeRaw = src.commandType ?? src.type;
  const commandType =
    typeof commandTypeRaw === "string" && commandTypeRaw.trim() ? commandTypeRaw.trim().toUpperCase() : null;
  const operatorRaw = src.userId ?? src.operatorUserId ?? src.senderId ?? src.uid;
  const operatorUserId =
    operatorRaw != null && String(operatorRaw).trim() && String(operatorRaw).trim() !== "0"
      ? String(operatorRaw).trim()
      : null;
  const rawTime = Number(src.commandTime ?? src.updateTime ?? src.clientTime ?? src.time ?? 0);
  const commandTime = Number.isFinite(rawTime) && rawTime > 0 ? Math.floor(rawTime) : null;

  const playStatus = normalizePlayStatus(
    src.playStatus ?? src.status ?? fallbackContainer?.playStatus ?? "PLAY",
  );
  if (
    !songId &&
    src.songId == null &&
    src.targetSongId == null &&
    src.playStatus == null &&
    src.status == null &&
    !commandType
  ) {
    return null;
  }
  return {
    songId,
    playStatus,
    progressMs,
    clientSeq,
    ...(serverSeqNum > 0 ? { serverSeq: serverSeqNum } : {}),
    ...(commandType ? { commandType } : {}),
    ...(operatorUserId ? { operatorUserId } : {}),
    ...(commandTime ? { commandTime } : {}),
  };
}

function unwrapBody(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  if (obj.body && typeof obj.body === "object") {
    return obj.body as Record<string, unknown>;
  }
  return obj;
}

export function normalizeListenTogetherStatus(
  rawBody: Record<string, unknown>,
  currentUserId: string | null = null,
): ListenTogetherStatusResult {
  const body = unwrapBody(rawBody);
  const outerCode = Number(body.code ?? 200);
  const data = (body.data && typeof body.data === "object" ? body.data : body) as Record<string, unknown>;
  const dataCode = Number(data.code ?? outerCode);

  if (outerCode === 488 || dataCode === 488) {
    return { inRoom: false, room: null, roomClosed: true };
  }

  const roomInfo = (
    data.roomInfo && typeof data.roomInfo === "object"
      ? data.roomInfo
      : data.room && typeof data.room === "object"
        ? data.room
        : data
  ) as Record<string, unknown>;

  const statusText = String(data.status ?? roomInfo.status ?? "").trim().toUpperCase();
  if (statusText === "END" || statusText === "CLOSED" || statusText === "EXPIRED") {
    return { inRoom: false, room: null, roomClosed: true };
  }

  const rawRoomId = roomInfo.roomId ?? data.roomId;
  const roomId = rawRoomId != null && String(rawRoomId).trim() ? String(rawRoomId).trim() : null;
  const explicitInRoom = typeof data.inRoom === "boolean" ? data.inRoom : null;

  if (!roomId || explicitInRoom === false) {
    return { inRoom: false, room: null };
  }

  const rawUsers =
    (Array.isArray(roomInfo.roomUsers) ? roomInfo.roomUsers : null) ??
    (Array.isArray(data.roomUsers) ? data.roomUsers : null) ??
    (Array.isArray(roomInfo.members) ? roomInfo.members : null) ??
    (Array.isArray(data.members) ? data.members : null) ??
    (Array.isArray(roomInfo.users) ? roomInfo.users : null) ??
    (Array.isArray(data.userList) ? data.userList : null) ??
    [];
  const roomUsers = rawUsers.map(normalizeUser).filter((u): u is ListenTogetherUser => Boolean(u));

  const creatorId =
    roomInfo.creatorId != null && String(roomInfo.creatorId).trim()
      ? String(roomInfo.creatorId).trim()
      : roomUsers[0]?.userId ?? null;
  const inviterId =
    roomInfo.inviterId != null && String(roomInfo.inviterId).trim()
      ? String(roomInfo.inviterId).trim()
      : creatorId ?? currentUserId ?? null;

  const playInfo = normalizePlayInfo(
    (data.playCommand ??
      roomInfo.playCommand ??
      data.playInfo ??
      roomInfo.playInfo ??
      data.commandInfo) as Record<string, unknown> | string | undefined,
    data,
  );
  const clientSeq = Math.max(
    Number(data.clientSeq ?? 0) || 0,
    playInfo?.clientSeq ?? 0,
  );

  return {
    inRoom: true,
    room: {
      roomId,
      inviterId,
      creatorId,
      status: statusText || "AVAILABLE",
      roomUsers,
      playInfo: playInfo ? { ...playInfo, clientSeq } : null,
      shareUrl: buildListenTogetherShareUrl(roomId, inviterId, playInfo?.songId ?? null),
      serverTime: Number(body.trp?.toString?.() ? Date.now() : data.serverTime ?? Date.now()) || Date.now(),
    },
  };
}

function extractSongIdArray(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => /^\d+$/.test(item));
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string" || typeof item === "number") return String(item).trim();
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const id = obj.songId ?? obj.id;
          return id != null ? String(id).trim() : "";
        }
        return "";
      })
      .filter((id) => /^\d+$/.test(id));
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return extractSongIdArray(obj.result ?? obj.list ?? obj.ids ?? obj.songIds ?? obj.tracks);
  }
  return [];
}

export function normalizeSyncPlaylistResponse(rawBody: Record<string, unknown>): {
  version: number;
  versionEntries: Array<{ userId: string; version: number }>;
  displayList: string[];
  randomList: string[];
  playInfo?: ListenTogetherPlayInfo;
} {
  const body = unwrapBody(rawBody);
  const data = (body.data && typeof body.data === "object" ? body.data : body) as Record<string, unknown>;
  const playlistObj = (data.playlist && typeof data.playlist === "object" && !Array.isArray(data.playlist)
    ? data.playlist
    : null) as Record<string, unknown> | null;

  let version = 0;
  const versionEntries: Array<{ userId: string; version: number }> = [];
  const rawVer = playlistObj?.version ?? data.version;
  if (Array.isArray(rawVer)) {
    version = rawVer.reduce((sum, entry) => {
      if (entry && typeof entry === "object") {
        const obj = entry as Record<string, unknown>;
        const uid = String(obj.userId ?? "").trim();
        const v = Number(obj.version ?? 0);
        const safeV = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
        if (uid) versionEntries.push({ userId: uid, version: safeV });
        return sum + safeV;
      }
      const v = Number(entry ?? 0);
      return sum + (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    }, 0);
  } else {
    version = Number(rawVer ?? 0) || 0;
  }

  const displayList = extractSongIdArray(
    playlistObj?.displayList ??
      (playlistObj?.trackIds as unknown) ??
      data.displayList ??
      data.playlist,
  );
  const randomList = extractSongIdArray(playlistObj?.randomList ?? data.randomList);

  const rawPlayCmd =
    data.playCommand ??
    playlistObj?.playCommand ??
    data.playInfo ??
    playlistObj?.playInfo ??
    data.commandInfo;
  const playInfo = rawPlayCmd
    ? normalizePlayInfo(rawPlayCmd as Record<string, unknown> | string, data)
    : null;

  return {
    version,
    versionEntries,
    displayList,
    randomList: randomList.length ? randomList : displayList,
    ...(playInfo ? { playInfo } : {}),
  };
}

type PendingShortInvite = {
  shortUrl: string;
  fromUser: ListenTogetherUser;
  message: string;
  time: number;
};

export function extractInboxListenTogetherInvites(
  rawBody: Record<string, unknown>,
  selfUserId: string | null = null,
): { invites: ListenTogetherInvite[]; contacts: ListenTogetherContact[]; pendingShortInvites?: PendingShortInvite[] } {
  const body = unwrapBody(rawBody);
  const msgs = Array.isArray(body.msgs) ? body.msgs : [];
  const invites: ListenTogetherInvite[] = [];
  const pendingShortInvites: PendingShortInvite[] = [];
  const seenRoomIds = new Set<string>();
  const contactsMap = new Map<string, ListenTogetherContact>();

  for (const item of msgs) {
    if (!item || typeof item !== "object") continue;
    const msgEntry = item as Record<string, unknown>;
    const fromUser = normalizeUser(msgEntry.fromUser);
    const toUser = normalizeUser(msgEntry.toUser);
    const lastMsgTime = Number(msgEntry.lastMsgTime ?? 0) || 0;

    for (const candidateUser of [fromUser, toUser]) {
      if (!candidateUser || candidateUser.userId === selfUserId) continue;
      const prev = contactsMap.get(candidateUser.userId);
      if (!prev || lastMsgTime > prev.lastMsgTime) {
        contactsMap.set(candidateUser.userId, {
          ...candidateUser,
          lastMsgTime,
          relation: prev?.relation ?? "recent",
        });
      }
    }

    if (!fromUser || (selfUserId && fromUser.userId === selfUserId)) continue;
    const rawLastMsg = typeof msgEntry.lastMsg === "string" ? msgEntry.lastMsg : JSON.stringify(msgEntry.lastMsg ?? "");
    let messageText = rawLastMsg;
    const candidateStrings = [rawLastMsg];
    try {
      const parsed = JSON.parse(rawLastMsg) as Record<string, unknown>;
      const generalMsg =
        parsed.generalMsg && typeof parsed.generalMsg === "object"
          ? (parsed.generalMsg as Record<string, unknown>)
          : null;
      if (typeof parsed.msg === "string") {
        messageText = parsed.msg;
        candidateStrings.push(parsed.msg);
      } else if (typeof generalMsg?.inboxBriefContent === "string" && generalMsg.inboxBriefContent.trim()) {
        messageText = generalMsg.inboxBriefContent;
      }
      for (const candidateUrl of [
        parsed.webUrl,
        parsed.url,
        parsed.nativeUrl,
        generalMsg?.nativeUrl,
        generalMsg?.webUrl,
        generalMsg?.url,
        generalMsg?.msg,
      ]) {
        if (typeof candidateUrl === "string" && candidateUrl.trim()) {
          candidateStrings.push(candidateUrl);
        }
      }
      if (!messageText || messageText === rawLastMsg) {
        const cardTitle =
          (typeof generalMsg?.title === "string" && generalMsg.title.trim()) ||
          (typeof generalMsg?.subTitle === "string" && generalMsg.subTitle.trim()) ||
          (typeof parsed.title === "string" && parsed.title.trim()) ||
          "";
        if (cardTitle) messageText = cardTitle;
      }
      if (parsed.roomId != null) {
        candidateStrings.push(`roomId=${parsed.roomId}&inviterId=${parsed.inviterId ?? fromUser.userId}`);
      }
    } catch {
      // Plain string message
    }

    let matchedDirectInvite = false;
    for (const candidate of candidateStrings) {
      if (!/listen[-_]?together|roomId/i.test(candidate)) continue;
      const parsedInvite = parseListenTogetherInvite(candidate);
      if (!parsedInvite?.roomId || seenRoomIds.has(parsedInvite.roomId)) continue;
      seenRoomIds.add(parsedInvite.roomId);
      invites.push({
        roomId: parsedInvite.roomId,
        inviterId: parsedInvite.inviterId ?? fromUser.userId,
        songId: parsedInvite.songId,
        fromUser,
        message: messageText.replace(/\s*https?:\/\/163cn\.tv\/\S+/gi, "").trim().slice(0, 120) || "邀请你一起听歌",
        time: lastMsgTime,
      });
      matchedDirectInvite = true;
      break;
    }

    if (!matchedDirectInvite && /耳机|一起听|listen[-_]?together/i.test(messageText)) {
      const shortMatch = candidateStrings.join(" ").match(/https?:\/\/163cn\.tv\/[A-Za-z0-9_-]{3,32}/i);
      if (shortMatch) {
        pendingShortInvites.push({
          shortUrl: shortMatch[0],
          fromUser,
          message: messageText.replace(/\s*https?:\/\/163cn\.tv\/\S+/gi, "").trim().slice(0, 120) || "邀请你一起听歌",
          time: lastMsgTime,
        });
      }
    }
  }

  return {
    invites,
    contacts: [...contactsMap.values()],
    ...(pendingShortInvites.length ? { pendingShortInvites } : {}),
  };
}

async function requireNeteaseSession(): Promise<{ cookie: string; userId: string; avatarUrl: string | null }> {
  const store = await readStore();
  const cookie = store.neteaseCookie?.trim();
  if (!cookie) {
    throw new HttpError(401, "请先在 设置 → 播放源 登录网易云音乐账号", "NETEASE_AUTH_REQUIRED");
  }
  const account = await getNeteaseAccountSummary();
  if (!account.connected || !account.userId) {
    throw new HttpError(401, "网易云登录状态已失效，请重新登录", "NETEASE_AUTH_REQUIRED");
  }
  return { cookie, userId: account.userId, avatarUrl: account.avatarUrl ?? null };
}

type NcmCallable = (query: Record<string, unknown>) => Promise<{ body?: Record<string, unknown> }>;

async function callNcmModule(
  name: string,
  query: Record<string, unknown>,
  options: { allowRoomClosed?: boolean } = {},
): Promise<Record<string, unknown>> {
  const fn = (neteaseApi as unknown as Record<string, NcmCallable>)[name];
  if (!fn) {
    throw new HttpError(501, `当前网易云模块不支持 ${name}`, "NETEASE_API_UNAVAILABLE");
  }
  try {
    const response = await fn(await withNeteaseIdentity(query));
    const body = unwrapBody(response);
    const code = Number(body.code ?? 200);
    const innerData = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : null;
    const innerCode = Number(innerData?.code ?? code);
    if ((code === 488 || innerCode === 488) && options.allowRoomClosed) {
      return { ...body, code: 488 };
    }
    if (code !== 200 || (innerData && innerCode !== 200 && innerCode !== 0 && !Number.isNaN(innerCode))) {
      const errCode = innerCode !== 200 ? innerCode : code;
      const msg = String(innerData?.message ?? body.message ?? body.msg ?? "");
      if (errCode === 405 || /操作频繁/.test(msg)) {
        throw new HttpError(429, "网易云一起听请求过于频繁，请稍后再试", "NETEASE_RATE_LIMITED");
      }
      if (errCode === 301 || errCode === 401) {
        throw new HttpError(401, "网易云登录已过期，请重新登录", "NETEASE_AUTH_REQUIRED");
      }
      if (errCode === 488) {
        throw new HttpError(410, "一起听房间已结束或不存在", "LISTEN_TOGETHER_ROOM_CLOSED");
      }
      throw new HttpError(400, msg || "网易云一起听操作失败", "LISTEN_TOGETHER_FAILED");
    }
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const upstream = error as { body?: Record<string, unknown>; status?: number; message?: string } | null;
    const body = unwrapBody(upstream?.body ?? {});
    const code = Number(body.code ?? upstream?.status ?? 0);
    if (code === 488 && options.allowRoomClosed) {
      return { ...body, code: 488 };
    }
    if (code === 488) {
      throw new HttpError(410, "一起听房间已结束或不存在", "LISTEN_TOGETHER_ROOM_CLOSED");
    }
    const msg = String(body.message ?? body.msg ?? upstream?.message ?? "网易云一起听请求失败");
    throw new HttpError(code === 401 ? 401 : code === 405 ? 429 : 502, msg, "LISTEN_TOGETHER_FAILED");
  }
}

export async function getListenTogetherStatus(): Promise<ListenTogetherStatusResult> {
  const { cookie, userId } = await requireNeteaseSession();
  const body = await callNcmModule("listentogether_status", { cookie }, { allowRoomClosed: true });
  return normalizeListenTogetherStatus(body, userId);
}

async function loadNeteaseFriendsCached(
  cookie: string,
  userId: string,
  forceRefresh = false,
): Promise<ListenTogetherContact[]> {
  const cached = contactsCache.get(userId);
  if (!forceRefresh && cached && Date.now() - cached.cachedAt < CONTACTS_CACHE_TTL_MS) {
    return cached.contacts;
  }

  const friendMap = new Map<string, ListenTogetherContact>();
  const upsertContact = (
    raw: unknown,
    relation: "mutual" | "recent" | "following",
    lastMsgTime = 0,
  ) => {
    const user = normalizeUser(raw);
    if (!user || user.userId === userId) return;
    const rawObj = raw as Record<string, unknown>;
    const isMutual = Boolean(rawObj.mutual) || relation === "mutual";
    const resolvedRelation: "mutual" | "recent" | "following" = isMutual ? "mutual" : relation;
    const existing = friendMap.get(user.userId);
    if (!existing) {
      friendMap.set(user.userId, { ...user, lastMsgTime, relation: resolvedRelation });
      return;
    }
    friendMap.set(user.userId, {
      ...existing,
      avatarUrl: existing.avatarUrl ?? user.avatarUrl,
      nickname: existing.nickname !== "云村听友" ? existing.nickname : user.nickname,
      lastMsgTime: Math.max(existing.lastMsgTime, lastMsgTime),
      relation:
        existing.relation === "mutual" || resolvedRelation === "mutual"
          ? "mutual"
          : existing.relation === "recent" || resolvedRelation === "recent"
            ? "recent"
            : "following",
    });
  };

  try {
    const recentBody = await callNcmModule("msg_recentcontact", { cookie });
    const data = (recentBody.data && typeof recentBody.data === "object"
      ? recentBody.data
      : recentBody) as Record<string, unknown>;
    const entries =
      (Array.isArray(data.follow) ? data.follow : null) ??
      (Array.isArray(data.contacts) ? data.contacts : null) ??
      (Array.isArray(data.list) ? data.list : null) ??
      [];
    for (const item of entries) {
      upsertContact(item, "recent", Number((item as Record<string, unknown>)?.time ?? 0) || 0);
    }
  } catch {
    // Recent contacts lookup is best-effort.
  }

  for (let page = 0; page < 3; page += 1) {
    try {
      const followBody = await callNcmModule("user_follows", {
        uid: userId,
        offset: page * 100,
        limit: 100,
        cookie,
      });
      const list = Array.isArray(followBody.follow) ? followBody.follow : [];
      for (const item of list) {
        upsertContact(item, Boolean((item as Record<string, unknown>)?.mutual) ? "mutual" : "following");
      }
      if (list.length < 100 || followBody.more === false) break;
    } catch {
      break;
    }
  }

  const contacts = [...friendMap.values()];
  contactsCache.set(userId, { contacts, cachedAt: Date.now() });
  return contacts;
}

export async function getListenTogetherInvites(options: { forceRefreshContacts?: boolean } = {}) {
  const { cookie, userId } = await requireNeteaseSession();
  const [privateRes, friendsList] = await Promise.all([
    callNcmModule("msg_private", { offset: 0, limit: 50, cookie }),
    loadNeteaseFriendsCached(cookie, userId, Boolean(options.forceRefreshContacts)),
  ]);
  const extracted = extractInboxListenTogetherInvites(privateRes, userId);

  const allInvites = [...extracted.invites];
  if (extracted.pendingShortInvites?.length) {
    const seenRooms = new Set(allInvites.map((inv) => inv.roomId));
    const resolvedShort = await Promise.all(
      extracted.pendingShortInvites.slice(0, 6).map(async (pending) => {
        const resolved = await resolveShortListenTogetherUrl(pending.shortUrl);
        if (!resolved?.roomId) return null;
        return {
          roomId: resolved.roomId,
          inviterId: resolved.inviterId ?? pending.fromUser.userId,
          songId: resolved.songId,
          fromUser: pending.fromUser,
          message: pending.message,
          time: pending.time,
        } satisfies ListenTogetherInvite;
      }),
    );
    for (const inv of resolvedShort) {
      if (!inv || seenRooms.has(inv.roomId)) continue;
      seenRooms.add(inv.roomId);
      allInvites.push(inv);
    }
    allInvites.sort((a, b) => (b.time || 0) - (a.time || 0));
  }

  const inviteSongIds = [...new Set(allInvites.map((inv) => inv.songId).filter((id): id is string => Boolean(id)))];
  let songMap = new Map<string, ProviderTrack>();
  if (inviteSongIds.length) {
    try {
      const hydratedSongs = await hydrateTrackIdsCached(inviteSongIds);
      songMap = new Map(hydratedSongs.map((track) => [track.id, track]));
    } catch {
      // Song enrichment for invite cards is best-effort.
    }
  }

  const enrichedInvites: ListenTogetherInvite[] = allInvites.map((inv) => {
    const song = inv.songId ? songMap.get(inv.songId) : undefined;
    return song
      ? { ...inv, songTitle: song.title, songCoverUrl: song.coverUrl ?? null }
      : inv;
  });

  const mergedContacts = new Map<string, ListenTogetherContact>();
  for (const contact of [...friendsList, ...extracted.contacts]) {
    if (!contact.userId || contact.userId === userId) continue;
    const prev = mergedContacts.get(contact.userId);
    if (!prev) {
      mergedContacts.set(contact.userId, contact);
    } else {
      const relation: "mutual" | "recent" | "following" =
        prev.relation === "mutual" || contact.relation === "mutual"
          ? "mutual"
          : prev.relation === "recent" || contact.relation === "recent"
            ? "recent"
            : "following";
      mergedContacts.set(contact.userId, {
        ...prev,
        nickname: prev.nickname !== "云村听友" ? prev.nickname : contact.nickname,
        avatarUrl: prev.avatarUrl ?? contact.avatarUrl,
        lastMsgTime: Math.max(prev.lastMsgTime, contact.lastMsgTime),
        relation,
      });
    }
  }

  const rank = (c: ListenTogetherContact) => {
    if (c.relation === "mutual" && c.lastMsgTime > 0) return 0;
    if (c.relation === "mutual") return 1;
    if (c.relation === "recent" || c.lastMsgTime > 0) return 2;
    return 3;
  };
  const contacts = [...mergedContacts.values()].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (b.lastMsgTime !== a.lastMsgTime) return b.lastMsgTime - a.lastMsgTime;
    return a.nickname.localeCompare(b.nickname, "zh-CN");
  });

  return { invites: enrichedInvites, contacts };
}

export async function createListenTogetherRoom(options: {
  songId?: string;
  trackIds?: string[];
  progressMs?: number;
  playStatus?: "PLAY" | "PAUSE";
}): Promise<ListenTogetherStateResult> {
  const { cookie, userId } = await requireNeteaseSession();
  const createBody = await callNcmModule("listentogether_room_create", {
    refer: "songplay_more",
    cookie,
  });
  const created = normalizeListenTogetherStatus(createBody, userId);
  if (!created.room?.roomId) {
    throw new HttpError(502, "未能获取新建一起听房间号，请重试", "LISTEN_TOGETHER_CREATE_FAILED");
  }

  const roomId = created.room.roomId;
  const cleanTrackIds = [...new Set((options.trackIds ?? []).filter((id) => /^\d+$/.test(id)))].slice(
    0,
    MAX_SYNC_PLAYLIST_TRACKS,
  );
  if (options.songId && /^\d+$/.test(options.songId) && !cleanTrackIds.includes(options.songId)) {
    cleanTrackIds.unshift(options.songId);
    if (cleanTrackIds.length > MAX_SYNC_PLAYLIST_TRACKS) cleanTrackIds.length = MAX_SYNC_PLAYLIST_TRACKS;
  }
  const initialProgressMs = Math.max(0, Math.round(options.progressMs ?? 0));
  const initialPlayStatus: "PLAY" | "PAUSE" = options.playStatus === "PAUSE" ? "PAUSE" : "PLAY";

  roomPlaylistVersionMap.set(roomId, [{ userId, version: cleanTrackIds.length ? 1 : 0 }]);
  if (cleanTrackIds.length) {
    const joined = cleanTrackIds.join(",");
    await callNcmModule("listentogether_sync_list_command", {
      roomId,
      commandType: "REPLACE",
      userId,
      version: 1,
      randomList: joined,
      displayList: joined,
      cookie,
    }).catch(() => undefined);
  }

  if (options.songId && /^\d+$/.test(options.songId)) {
    await callNcmModule("listentogether_play_command", {
      roomId,
      commandType: "GOTO",
      progress: initialProgressMs,
      playStatus: initialPlayStatus,
      formerSongId: "-1",
      targetSongId: options.songId,
      clientSeq: 1,
      cookie,
    }).catch(() => undefined);
  }

  const sharedTracks = cleanTrackIds.length ? await hydrateTrackIdsCached(cleanTrackIds) : [];
  const activeTrack = options.songId
    ? sharedTracks.find((t) => t.id === options.songId) ?? null
    : null;
  return {
    inRoom: true,
    selfUserId: userId,
    room: {
      ...created.room,
      playInfo: options.songId
        ? { songId: options.songId, playStatus: initialPlayStatus, progressMs: initialProgressMs, clientSeq: 1 }
        : created.room.playInfo,
      shareUrl: buildListenTogetherShareUrl(roomId, created.room.inviterId ?? userId, options.songId ?? null),
    },
    playlistVersion: cleanTrackIds.length ? 1 : 0,
    displayList: cleanTrackIds,
    sharedTracks,
    activeTrack,
  };
}

function pickFresherPlayInfo(
  playlistPlayInfo: ListenTogetherPlayInfo | null | undefined,
  statusPlayInfo: ListenTogetherPlayInfo | null | undefined,
): ListenTogetherPlayInfo | null {
  if (!playlistPlayInfo) return statusPlayInfo ?? null;
  if (!statusPlayInfo) return playlistPlayInfo;
  const playlistSeq = Math.max(playlistPlayInfo.serverSeq ?? 0, playlistPlayInfo.clientSeq);
  const statusSeq = Math.max(statusPlayInfo.serverSeq ?? 0, statusPlayInfo.clientSeq);
  if (statusSeq > playlistSeq && statusPlayInfo.songId) return statusPlayInfo;
  if (
    statusSeq === playlistSeq &&
    statusPlayInfo.songId &&
    (statusPlayInfo.commandTime ?? 0) > (playlistPlayInfo.commandTime ?? 0)
  ) {
    return statusPlayInfo;
  }
  return playlistPlayInfo;
}

export async function getListenTogetherRoomState(
  roomId: string,
  includePlaylist = false,
): Promise<ListenTogetherStateResult> {
  const { cookie, userId } = await requireNeteaseSession();
  const [statusRes, playlistRes] = await Promise.allSettled([
    callNcmModule("listentogether_status", { cookie }, { allowRoomClosed: true }),
    callNcmModule("listentogether_sync_playlist_get", { roomId, cookie }, { allowRoomClosed: true }),
  ]);

  const statusNorm =
    statusRes.status === "fulfilled" ? normalizeListenTogetherStatus(statusRes.value, userId) : null;
  const playlistBody = playlistRes.status === "fulfilled" ? unwrapBody(playlistRes.value) : null;
  const playlistCode = playlistBody ? Number(playlistBody.code ?? 200) : 200;

  if (statusNorm?.roomClosed || playlistCode === 488) {
    return {
      inRoom: false,
      roomClosed: true,
      selfUserId: userId,
      room: null,
      playlistVersion: 0,
      displayList: [],
      sharedTracks: [],
      activeTrack: null,
    };
  }

  const activeRoom =
    statusNorm?.inRoom && statusNorm.room?.roomId === roomId
      ? statusNorm.room
      : statusNorm?.inRoom && statusNorm.room
        ? statusNorm.room
        : null;

  if (!activeRoom) {
    return {
      inRoom: false,
      selfUserId: userId,
      room: null,
      playlistVersion: 0,
      displayList: [],
      sharedTracks: [],
      activeTrack: null,
    };
  }

  const playlistParsed =
    playlistRes.status === "fulfilled" && playlistCode !== 488
      ? normalizeSyncPlaylistResponse(playlistRes.value)
      : null;
  const playlistVersion = playlistParsed?.version ?? 0;
  if (playlistParsed?.versionEntries.length) {
    roomPlaylistVersionMap.set(activeRoom.roomId, playlistParsed.versionEntries);
  }
  const displayList = playlistParsed?.displayList ?? [];
  const livePlayInfo = pickFresherPlayInfo(playlistParsed?.playInfo, activeRoom.playInfo);

  const mergedRoom: ListenTogetherRoom = {
    ...activeRoom,
    playInfo: livePlayInfo,
    shareUrl: buildListenTogetherShareUrl(
      activeRoom.roomId,
      activeRoom.inviterId ?? userId,
      livePlayInfo?.songId ?? null,
    ),
  };

  const activeSongId = livePlayInfo?.songId ?? null;
  let sharedTracks: ProviderTrack[] = [];
  let activeTrack: ProviderTrack | null = null;

  if (includePlaylist) {
    // Never synthesize a single-track [activeSongId] shared queue when NetEase
    // returns an empty displayList; that would collapse the user's queue to 1 song.
    sharedTracks = displayList.length ? await hydrateTrackIdsCached(displayList) : [];
    if (activeSongId) {
      activeTrack =
        sharedTracks.find((t) => t.id === activeSongId) ??
        (await hydrateTrackIdsCached([activeSongId]))[0] ??
        null;
    }
  } else if (activeSongId) {
    const hydratedActive = await hydrateTrackIdsCached([activeSongId]);
    activeTrack = hydratedActive[0] ?? null;
  }

  return {
    inRoom: true,
    selfUserId: userId,
    room: mergedRoom,
    playlistVersion,
    displayList,
    sharedTracks,
    activeTrack,
  };
}

export async function joinListenTogetherRoom(options: {
  input?: string;
  roomId?: string;
  inviterId?: string;
}): Promise<ListenTogetherStateResult> {
  const { cookie, userId } = await requireNeteaseSession();
  let parsed = options.input ? parseListenTogetherInvite(options.input) : null;
  if ((!parsed || !parsed.roomId) && options.input && /163cn\.tv\//i.test(options.input)) {
    parsed = (await resolveShortListenTogetherUrl(options.input)) ?? parsed;
  }
  const roomId = options.roomId?.trim() || parsed?.roomId || "";
  if (!roomId) {
    throw new HttpError(400, "请输入有效的网易云一起听房间号或分享链接", "LISTEN_TOGETHER_INVALID_ROOM");
  }

  let inviterId = options.inviterId?.trim() || parsed?.inviterId || "";
  if (!inviterId) {
    try {
      const checkBody = await callNcmModule("listentogether_room_check", { roomId, cookie }, { allowRoomClosed: true });
      const checkNorm = normalizeListenTogetherStatus(checkBody, userId);
      if (checkNorm.roomClosed) {
        throw new HttpError(410, "该一起听房间已结束或失效", "LISTEN_TOGETHER_ROOM_CLOSED");
      }
      inviterId = checkNorm.room?.inviterId ?? checkNorm.room?.creatorId ?? "";
    } catch (error) {
      if (error instanceof HttpError && error.status === 410) throw error;
    }
  }
  if (!inviterId) {
    try {
      const inbox = await getListenTogetherInvites();
      inviterId = inbox.invites.find((inv) => inv.roomId === roomId)?.inviterId ?? "";
    } catch {
      // Ignore inbox fallback failures
    }
  }
  if (!inviterId) {
    throw new HttpError(400, "缺少邀请人 ID，请粘贴完整的一起听分享链接或手动填写邀请人 ID", "LISTEN_TOGETHER_INVITER_REQUIRED");
  }

  await callNcmModule("listentogether_accept", {
    refer: "inbox_invite",
    roomId,
    inviterId,
    cookie,
  });

  return getListenTogetherRoomState(roomId, true);
}

export async function sendListenTogetherHeartbeat(options: {
  roomId: string;
  songId: string;
  playStatus: "PLAY" | "PAUSE";
  progressMs: number;
}): Promise<{ ok: boolean; roomClosed?: boolean; playInfo?: ListenTogetherPlayInfo | null }> {
  const { cookie } = await requireNeteaseSession();
  const body = await callNcmModule(
    "listentogether_heatbeat",
    {
      roomId: options.roomId,
      songId: options.songId,
      playStatus: options.playStatus,
      progress: Math.max(0, Math.round(options.progressMs)),
      cookie,
    },
    { allowRoomClosed: true },
  );
  if (Number(body.code ?? 200) === 488) {
    return { ok: false, roomClosed: true };
  }
  const hbData = (body.data && typeof body.data === "object" ? body.data : body) as Record<string, unknown>;
  const rawCmd = hbData.playCommand ?? hbData.playInfo;
  const playInfo = rawCmd ? normalizePlayInfo(rawCmd as Record<string, unknown> | string) : null;
  return { ok: true, ...(playInfo ? { playInfo } : {}) };
}

export async function sendListenTogetherPlayCommand(options: {
  roomId: string;
  commandType: "PLAY" | "PAUSE" | "SEEK" | "GOTO";
  progressMs: number;
  playStatus: "PLAY" | "PAUSE";
  formerSongId?: string;
  targetSongId: string;
  clientSeq: number;
}): Promise<{ ok: boolean }> {
  const { cookie } = await requireNeteaseSession();
  await callNcmModule("listentogether_play_command", {
    roomId: options.roomId,
    commandType: options.commandType,
    progress: Math.max(0, Math.round(options.progressMs)),
    playStatus: options.playStatus,
    formerSongId: options.formerSongId ?? "-1",
    targetSongId: options.targetSongId,
    clientSeq: options.clientSeq,
    cookie,
  });
  return { ok: true };
}

export async function syncListenTogetherPlaylist(options: {
  roomId: string;
  commandType?: "REPLACE" | "PLAYMODE_CHANGE";
  version: number;
  displayList: string[];
  randomList?: string[];
}): Promise<{ ok: boolean; version: number; displayList: string[] }> {
  const { cookie, userId } = await requireNeteaseSession();
  const cleanDisplay = [...new Set(options.displayList.filter((id) => /^\d+$/.test(id)))].slice(
    0,
    MAX_SYNC_PLAYLIST_TRACKS,
  );
  const cleanRandom = (options.randomList?.length ? options.randomList : cleanDisplay)
    .filter((id) => /^\d+$/.test(id))
    .slice(0, MAX_SYNC_PLAYLIST_TRACKS);

  const prevEntries = roomPlaylistVersionMap.get(options.roomId) ?? [];
  const prevMine = prevEntries.find((entry) => entry.userId === userId)?.version ?? 0;
  const nextUserVersion = prevMine > 0 ? prevMine + 1 : Math.max(1, Math.floor(options.version));

  await callNcmModule("listentogether_sync_list_command", {
    roomId: options.roomId,
    commandType: options.commandType ?? "REPLACE",
    userId,
    version: nextUserVersion,
    displayList: cleanDisplay.join(","),
    randomList: cleanRandom.join(","),
    cookie,
  });

  const nextEntries = prevEntries.filter((entry) => entry.userId !== userId);
  nextEntries.push({ userId, version: nextUserVersion });
  roomPlaylistVersionMap.set(options.roomId, nextEntries);
  const totalVersion = nextEntries.reduce((sum, entry) => sum + entry.version, 0);

  return { ok: true, version: totalVersion || nextUserVersion, displayList: cleanDisplay };
}

export type ListenTogetherInviteMode = "song_card" | "short_link";

export async function sendListenTogetherInviteMessage(options: {
  targetUserId: string;
  roomId: string;
  shareUrl?: string;
  songId?: string;
  songTitle?: string;
  mode?: ListenTogetherInviteMode;
}): Promise<{ ok: boolean; modeUsed: ListenTogetherInviteMode }> {
  const { cookie, userId } = await requireNeteaseSession();
  const shareUrl = options.shareUrl || buildListenTogetherShareUrl(options.roomId, userId, options.songId ?? null);
  const compactUrl = await shortenListenTogetherUrl(shareUrl, cookie);
  const msg = `${LISTEN_TOGETHER_INVITE_COPY} ${compactUrl}`;
  const validSongId = options.songId && /^\d+$/.test(options.songId) ? options.songId : undefined;
  const requestedMode: ListenTogetherInviteMode = options.mode ?? (validSongId ? "song_card" : "short_link");

  if (requestedMode === "song_card" && validSongId) {
    try {
      await callNcmModule("send_song", {
        id: validSongId,
        user_ids: options.targetUserId,
        msg,
        cookie,
      });
      return { ok: true, modeUsed: "song_card" };
    } catch {
      // Fallback to crisp short-link text DM if send_song is rejected.
    }
  }

  await callNcmModule("send_text", {
    user_ids: options.targetUserId,
    msg,
    cookie,
  });
  return { ok: true, modeUsed: "short_link" };
}

export async function endListenTogetherRoom(roomId: string): Promise<{ ok: boolean }> {
  const { cookie } = await requireNeteaseSession();
  await callNcmModule("listentogether_end", { roomId, cookie }, { allowRoomClosed: true });
  return { ok: true };
}
