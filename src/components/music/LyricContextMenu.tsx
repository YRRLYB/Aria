import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, FileText, Languages } from "lucide-react";
import type { LyricLine } from "@/data/music";
import { copyTextToClipboard } from "@/lib/clipboard";
import { formatFullLyrics, formatSingleLyricLine } from "@/lib/lyricCopy";
import { cn } from "@/lib/utils";

export type LyricContextMenuTarget = {
  x: number;
  y: number;
  line: LyricLine;
  lines: LyricLine[];
  mode: "original" | "bilingual";
};

export function LyricContextMenu({
  target,
  tone = "light",
  onClose,
  onCopied,
}: {
  target: LyricContextMenuTarget | null;
  tone?: "light" | "dark";
  onClose: () => void;
  onCopied?: (message: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, target]);

  if (typeof document === "undefined") return null;

  const hasTranslation = Boolean(target?.line.translation?.trim());
  const pos = target
    ? {
        x: Math.max(12, Math.min(target.x, (typeof window !== "undefined" ? window.innerWidth : 1280) - 188 - 12)),
        y: Math.max(12, Math.min(target.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 140 - 12)),
      }
    : null;

  return createPortal(
    <AnimatePresence>
      {target && pos && (
        <motion.div
          ref={menuRef}
          role="menu"
          aria-label="歌词右键菜单"
          initial={{ opacity: 0, scale: 0.96, y: -3 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -2 }}
          transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
          style={{ left: pos.x, top: pos.y }}
          className={cn(
            "aria-context-menu fixed z-[115] w-[188px] origin-top-left rounded-2xl p-1.5",
            tone === "dark" && "is-dark",
          )}
        >
          <button
            type="button"
            role="menuitem"
            className="aria-context-menu-item"
            onClick={() => {
              const text = formatSingleLyricLine(target.line, false);
              if (text) {
                void copyTextToClipboard(text);
                onCopied?.("已复制本句歌词");
              }
              onClose();
            }}
          >
            <Copy className="size-3.5 shrink-0 opacity-75" />
            <span>复制本句歌词</span>
          </button>
          {hasTranslation && (
            <button
              type="button"
              role="menuitem"
              className="aria-context-menu-item"
              onClick={() => {
                const text = formatSingleLyricLine(target.line, true);
                if (text) {
                  void copyTextToClipboard(text);
                  onCopied?.("已复制双语歌词");
                }
                onClose();
              }}
            >
              <Languages className="size-3.5 shrink-0 opacity-75" />
              <span>复制双语歌词</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="aria-context-menu-item"
            onClick={() => {
              const text = formatFullLyrics(target.lines, target.mode);
              if (text) {
                void copyTextToClipboard(text);
                onCopied?.("已复制整首歌词");
              }
              onClose();
            }}
          >
            <FileText className="size-3.5 shrink-0 opacity-75" />
            <span>复制整首歌词</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
