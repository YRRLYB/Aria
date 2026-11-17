import { useEffect, useMemo, useRef, useState } from "react";

export type VirtualRow = {
  index: number;
  offsetTop: number;
};

export function calculateVirtualRange({
  count,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = 6,
}: {
  count: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}) {
  if (count <= 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: 0, totalHeight: 0 };
  }

  const safeViewportHeight = Math.max(0, viewportHeight);
  // A search can shrink the list while the browser still reports its old
  // scroll position. Clamp to the new extent so results remain visible.
  const safeScrollTop = Math.min(Math.max(0, scrollTop), Math.max(0, count * rowHeight - safeViewportHeight));
  const startIndex = Math.max(0, Math.floor(safeScrollTop / rowHeight) - overscan);
  const endIndex = Math.min(count, Math.ceil((safeScrollTop + safeViewportHeight) / rowHeight) + overscan);

  return {
    startIndex,
    endIndex: Math.max(startIndex, endIndex),
    totalHeight: count * rowHeight,
  };
}

export function useVirtualRows({
  count,
  rowHeight,
  overscan = 6,
}: {
  count: number;
  rowHeight: number;
  overscan?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [metrics, setMetrics] = useState({ scrollTop: 0, viewportHeight: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      frameRef.current = null;
      const scrollTop = container.scrollTop;
      const viewportHeight = container.clientHeight;
      setMetrics((current) => current.scrollTop === scrollTop && current.viewportHeight === viewportHeight
        ? current
        : { scrollTop, viewportHeight });
    };

    const requestUpdate = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(update);
    };

    update();
    container.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(requestUpdate);
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      container.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [count, rowHeight]);

  const range = calculateVirtualRange({
    count,
    rowHeight,
    overscan,
    scrollTop: metrics.scrollTop,
    viewportHeight: metrics.viewportHeight,
  });

  const rows = useMemo<VirtualRow[]>(
    () =>
      Array.from({ length: range.endIndex - range.startIndex }, (_, offset) => {
        const index = range.startIndex + offset;
        return { index, offsetTop: index * rowHeight };
      }),
    [range.endIndex, range.startIndex, rowHeight],
  );

  return {
    containerRef,
    rows,
    totalHeight: range.totalHeight,
  };
}
