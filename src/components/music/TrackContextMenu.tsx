import { createContext, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, Disc3, FolderOpen, ListEnd, ListPlus, Play, UserRound } from "lucide-react";
import type { Track } from "@/data/music";
import { copyTrackTextToClipboard } from "@/lib/clipboard";

type ContextMenuState = {
  x: number;
  y: number;
  track: Track;
  queue?: Track[];
} | null;

type TrackContextMenuApi = {
  open: (event: MouseEvent, track: Track, queue?: Track[]) => void;
};

const TrackContextMenuContext = createContext<TrackContextMenuApi | null>(null);

export function useTrackContextMenu() {
  return useContext(TrackContextMenuContext);
}

const UNKNOWN_ALBUMS = new Set(["未知专辑", "未分类专辑", "unknown album"]);

export function TrackContextMenuProvider({
  activeTrackId,
  onPlayTrack,
  onPlayNext,
  onAddToPlaylist,
  onOpenArtist,
  onOpenAlbum,
  onNotify,
  children,
}: {
  activeTrackId: string;
  onPlayTrack: (id: string, queue?: Track[]) => void;
  onPlayNext: (id: string) => void;
  onAddToPlaylist: (track: Track) => void;
  onOpenArtist: (track: Track) => void;
  onOpenAlbum: (track: Track) => void;
  onNotify?: (label: string, icon?: "copy" | "lyrics") => void;
  children: ReactNode;
}) {
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      setMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    const closeMenu = () => setMenu(null);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, [menu]);

  function open(event: MouseEvent, track: Track, queue?: Track[]) {
    if (track.id === "idle") return;
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 216;
    const menuHeight = 264;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const x = Math.max(12, Math.min(event.clientX, vw - menuWidth - 12));
    const y = Math.max(12, Math.min(event.clientY, vh - menuHeight - 12));
    setMenu({ x, y, track, queue });
  }

  const canRevealLocal =
    Boolean(menu?.track.source === "local" && menu.track.localPath) &&
    typeof window !== "undefined" &&
    Boolean(window.ariaDesktop?.showItemInFolder);
  const isMac = typeof window !== "undefined" && window.ariaDesktop?.platform === "darwin";
  const canOpenArtist = Boolean(menu?.track.artist?.trim());
  const albumTitle = menu?.track.album?.trim() ?? "";
  const canOpenAlbum = Boolean(albumTitle && !UNKNOWN_ALBUMS.has(albumTitle.toLowerCase()));

  const portal =
    typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            {menu && (
              <motion.div
                ref={menuRef}
                role="menu"
                aria-label="歌曲操作菜单"
                initial={{ opacity: 0, scale: 0.96, y: -3 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: -2 }}
                transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
                style={{ left: menu.x, top: menu.y }}
                className="aria-context-menu fixed z-[110] w-[216px] origin-top-left rounded-2xl p-1.5"
              >
                <div className="mb-1 border-b border-black/[0.06] px-2.5 pb-1.5 pt-1 dark:border-white/[0.08]">
                  <p className="truncate text-xs font-semibold">{menu.track.title}</p>
                  <p className="truncate text-[11px] opacity-60">{menu.track.artist}</p>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="aria-context-menu-item"
                  onClick={() => {
                    onPlayTrack(menu.track.id, menu.queue);
                    setMenu(null);
                  }}
                >
                  <Play className="size-3.5 shrink-0 opacity-75" />
                  <span>立即播放</span>
                </button>
                {menu.track.id !== activeTrackId && (
                  <button
                    type="button"
                    role="menuitem"
                    className="aria-context-menu-item"
                    onClick={() => {
                      onPlayNext(menu.track.id);
                      setMenu(null);
                    }}
                  >
                    <ListEnd className="size-3.5 shrink-0 opacity-75" />
                    <span>下一首播放</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="aria-context-menu-item"
                  onClick={() => {
                    onAddToPlaylist(menu.track);
                    setMenu(null);
                  }}
                >
                  <ListPlus className="size-3.5 shrink-0 opacity-75" />
                  <span>加入歌单</span>
                </button>

                <div className="my-1 h-px bg-black/[0.06] dark:bg-white/[0.08]" />

                {canOpenArtist && (
                  <button
                    type="button"
                    role="menuitem"
                    className="aria-context-menu-item"
                    onClick={() => {
                      onOpenArtist(menu.track);
                      setMenu(null);
                    }}
                  >
                    <UserRound className="size-3.5 shrink-0 opacity-75" />
                    <span>查看歌手</span>
                  </button>
                )}
                {canOpenAlbum && (
                  <button
                    type="button"
                    role="menuitem"
                    className="aria-context-menu-item"
                    onClick={() => {
                      onOpenAlbum(menu.track);
                      setMenu(null);
                    }}
                  >
                    <Disc3 className="size-3.5 shrink-0 opacity-75" />
                    <span>查看专辑</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="aria-context-menu-item"
                  onClick={() => {
                    void copyTrackTextToClipboard(menu.track, "summary");
                    onNotify?.("已复制歌名与歌手", "copy");
                    setMenu(null);
                  }}
                >
                  <Copy className="size-3.5 shrink-0 opacity-75" />
                  <span>复制歌名与歌手</span>
                </button>
                {canRevealLocal && (
                  <button
                    type="button"
                    role="menuitem"
                    className="aria-context-menu-item"
                    onClick={() => {
                      if (menu.track.localPath) {
                        void window.ariaDesktop?.showItemInFolder?.(menu.track.localPath);
                      }
                      setMenu(null);
                    }}
                  >
                    <FolderOpen className="size-3.5 shrink-0 opacity-75" />
                    <span>{isMac ? "在访达中显示" : "在资源管理器中显示"}</span>
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <TrackContextMenuContext.Provider value={{ open }}>
      {children}
      {portal}
    </TrackContextMenuContext.Provider>
  );
}
