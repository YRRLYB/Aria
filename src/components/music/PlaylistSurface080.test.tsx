import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { tracks } from "@/data/music";
import { createLocalPlaylist } from "@/lib/localPlaylists";
import { PlaylistSurface } from "./CollectionSurfaces";

const noopAsync = async () => {};
const noopPlaylistAsync = async () => ({ id: "created", name: "created", trackCount: 0, subscribed: false, coverColor: "#7c5ce6" });

function localBundle() {
  const referenced = createLocalPlaylist(
    "别人的夜歌单",
    ["bilibili:BV1abc"],
    10,
    undefined,
    { source: "bilibili", url: "https://space.bilibili.com/1/favlist?fid=2", kind: "folder", syncedAt: 10 },
  );
  return {
    playlists: [referenced],
    allTracks: tracks,
    selectedPlaylist: null,
    selectedTracks: [],
    storageError: false,
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onSyncReference: vi.fn(),
    onPickTrack: vi.fn(),
  };
}

describe("Aria v0.8.0 Bilibili playlist tab", () => {
  it("renders the Bilibili tab with own favlists, referenced mirrors and a link-import entry", () => {
    const markup = renderToStaticMarkup(
      <PlaylistSurface
        playlists={[]}
        local={localBundle()}
        selectedPlaylist={null}
        tracks={[]}
        playCounts={{}}
        loading={false}
        canCreatePlaylist={false}
        onCreatePlaylist={noopPlaylistAsync}
        onRequireLogin={vi.fn()}
        onOpenPlaylist={vi.fn()}
        onClosePlaylist={vi.fn()}
        onPickTrack={vi.fn()}
        error={null}
        onUpdatePlaylist={noopAsync}
        onUploadCover={noopAsync}
        onRemoveTracks={noopAsync}
        onReorderTracks={noopAsync}
        onSubscribe={noopAsync}
        onDeletePlaylist={noopAsync}
        qq={{
          connected: false,
          playlists: [],
          selectedPlaylist: null,
          tracks: [],
          loading: false,
          error: null,
          onOpen: vi.fn(),
          onClose: vi.fn(),
          onPickTrack: vi.fn(),
        }}
        bilibili={{
          connected: true,
          playlists: [
            {
              id: "folder:456",
              name: "夜行歌单",
              source: "bilibili",
              trackCount: 12,
              subscribed: false,
              owned: true,
              canEdit: false,
              coverColor: "#00AEEC",
              description: "B站收藏夹 · 登录账号实时读取",
              creatorName: "测试用户",
            },
          ],
          loading: false,
          error: null,
          selectedPlaylist: null,
          tracks: [],
          tracksLoading: false,
          tracksError: null,
          playCounts: {},
          referencedPlaylists: localBundle().playlists,
          onOpen: vi.fn(),
          onClose: vi.fn(),
          onRefresh: vi.fn(),
          onPickTrack: vi.fn(),
          onRequireLogin: vi.fn(),
          onCreateReference: vi.fn(),
          onSyncReference: vi.fn(),
          onOpenReferenced: vi.fn(),
        }}
        youtube={{
          connected: false,
          playlists: [],
          loading: false,
          error: null,
          selectedPlaylist: null,
          tracks: [],
          tracksLoading: false,
          tracksError: null,
          onOpen: vi.fn(),
          onClose: vi.fn(),
          onRefresh: vi.fn(),
          onPickTrack: vi.fn(),
          onRequireLogin: vi.fn(),
        }}
        initialSource="bilibili"
      />,
    );

    expect(markup).toContain("B站歌单");
    expect(markup).toContain("我的收藏夹");
    expect(markup).toContain("夜行歌单");
    expect(markup).toContain("B站收藏夹");
    expect(markup).toContain("引入的B站歌单");
    expect(markup).toContain("B站收藏夹镜像");
    expect(markup).toContain("别人的夜歌单");
    expect(markup).toContain("引入B站歌单");
    expect(markup).toContain("同步收藏夹");
    // 四来源切换胶囊包含 B站选项。
    expect(markup).toContain("歌单来源");
  });

  it("renders the unified YouTube playlist tab with liked music pinned first", () => {
    const markup = renderToStaticMarkup(
      <PlaylistSurface
        playlists={[]}
        local={localBundle()}
        selectedPlaylist={null}
        tracks={[]}
        playCounts={{}}
        loading={false}
        canCreatePlaylist={false}
        onCreatePlaylist={noopPlaylistAsync}
        onRequireLogin={vi.fn()}
        onOpenPlaylist={vi.fn()}
        onClosePlaylist={vi.fn()}
        onPickTrack={vi.fn()}
        error={null}
        onUpdatePlaylist={noopAsync}
        onUploadCover={noopAsync}
        onRemoveTracks={noopAsync}
        onReorderTracks={noopAsync}
        onSubscribe={noopAsync}
        onDeletePlaylist={noopAsync}
        qq={{
          connected: false,
          playlists: [],
          selectedPlaylist: null,
          tracks: [],
          loading: false,
          error: null,
          onOpen: vi.fn(),
          onClose: vi.fn(),
          onPickTrack: vi.fn(),
        }}
        bilibili={{
          connected: false,
          playlists: [],
          loading: false,
          error: null,
          selectedPlaylist: null,
          tracks: [],
          tracksLoading: false,
          tracksError: null,
          playCounts: {},
          referencedPlaylists: [],
          onOpen: vi.fn(),
          onClose: vi.fn(),
          onRefresh: vi.fn(),
          onPickTrack: vi.fn(),
          onRequireLogin: vi.fn(),
          onCreateReference: vi.fn(),
          onSyncReference: vi.fn(),
          onOpenReferenced: vi.fn(),
        }}
        youtube={{
          connected: true,
          playlists: [
            {
              id: "FEmusic_liked_songs",
              name: "喜欢的音乐",
              source: "youtube",
              trackCount: 0,
              subscribed: false,
              owned: true,
              canEdit: false,
              coverColor: "#FF0033",
              description: "YouTube Music 喜欢的音乐",
            },
            {
              id: "PLabc1234567890",
              name: "深夜编码",
              source: "youtube",
              trackCount: 12,
              subscribed: false,
              owned: true,
              canEdit: false,
              coverColor: "#FF0033",
              description: "YouTube Music 播放列表",
            },
          ],
          loading: false,
          error: null,
          selectedPlaylist: null,
          tracks: [],
          tracksLoading: false,
          tracksError: null,
          onOpen: vi.fn(),
          onClose: vi.fn(),
          onRefresh: vi.fn(),
          onPickTrack: vi.fn(),
          onRequireLogin: vi.fn(),
        }}
        initialSource="youtube"
      />,
    );

    expect(markup).toContain("YouTube 歌单");
    expect(markup).toContain("喜欢的音乐");
    expect(markup).toContain("深夜编码");
    expect(markup).toContain("12 首");
    expect(markup).toContain("同步歌单");
    // 未打开详情时不渲染 PlaylistDetail 的「返回歌单」。
    expect(markup).not.toContain("返回歌单");
  });
});
