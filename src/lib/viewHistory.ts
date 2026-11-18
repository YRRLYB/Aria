import type { ViewId } from "@/data/music";
import type { ProviderAlbum, ProviderPlaylist, ProviderUser } from "@/lib/api";
import type { ArtistSummary } from "@/lib/artists";

export type ViewHistorySnapshot = {
  view: ViewId;
  query: string;
  artist: ArtistSummary | null;
  album: ProviderAlbum | null;
  user: ProviderUser | null;
  playlistSource: "netease" | "local" | "qq" | null;
  neteasePlaylist: ProviderPlaylist | null;
  qqPlaylist: ProviderPlaylist | null;
  localPlaylistId: string | null;
};

export type ViewHistoryState = {
  entries: ViewHistorySnapshot[];
  index: number;
};

export function sameViewSnapshot(left: ViewHistorySnapshot, right: ViewHistorySnapshot): boolean {
  return (
    left.view === right.view &&
    left.query.trim() === right.query.trim() &&
    (left.artist?.id ?? null) === (right.artist?.id ?? null) &&
    (left.album?.id ?? null) === (right.album?.id ?? null) &&
    (left.user?.id ?? null) === (right.user?.id ?? null) &&
    (left.playlistSource ?? null) === (right.playlistSource ?? null) &&
    (left.neteasePlaylist?.id ?? null) === (right.neteasePlaylist?.id ?? null) &&
    (left.qqPlaylist?.id ?? null) === (right.qqPlaylist?.id ?? null) &&
    (left.localPlaylistId ?? null) === (right.localPlaylistId ?? null)
  );
}

export function createViewHistory(initial: ViewHistorySnapshot): ViewHistoryState {
  return { entries: [initial], index: 0 };
}

export function pushViewSnapshot(
  state: ViewHistoryState,
  next: ViewHistorySnapshot,
  maxEntries = 48,
): ViewHistoryState {
  const current = state.entries[state.index];
  if (current && sameViewSnapshot(current, next)) {
    // Hydrated details (e.g. full playlist metadata) keep the same identity;
    // update the slot in place without growing the history stack.
    const entries = state.entries.slice();
    entries[state.index] = next;
    return { entries, index: state.index };
  }

  const head = state.entries.slice(0, state.index + 1);
  head.push(next);
  const trimmed = head.length > maxEntries ? head.slice(head.length - maxEntries) : head;
  return {
    entries: trimmed,
    index: trimmed.length - 1,
  };
}

export function stepViewHistory(
  state: ViewHistoryState,
  direction: -1 | 1,
): { state: ViewHistoryState; target: ViewHistorySnapshot } | null {
  const nextIndex = state.index + direction;
  if (nextIndex < 0 || nextIndex >= state.entries.length) return null;
  return {
    state: { entries: state.entries, index: nextIndex },
    target: state.entries[nextIndex],
  };
}
