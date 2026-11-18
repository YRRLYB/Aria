import { AriaIcon, type AriaIconName } from "@/components/icons/aria";
import { navItems, type ViewId } from "@/data/music";
import { cn } from "@/lib/utils";

// 浮球里的每个图标都是独立 SVG（aria-icons/nav-*.svg），不再复用
// lucide 的通用图标，避免“探索/每日推荐”这种入口撞图。
const navIconNames: Partial<Record<ViewId, AriaIconName>> = {
  player: "nav-player",
  cloud: "nav-cloud",
  artists: "nav-artists",
  explore: "nav-explore",
  daily: "nav-daily",
  radar: "nav-radar",
  stats: "nav-stats",
};
export function FloatingNav({
  activeView,
  open,
  raised,
  onOpenChange,
  onRequestClose,
  onPick,
}: {
  activeView: ViewId;
  open: boolean;
  raised?: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestClose: () => void;
  onPick: (id: ViewId) => void;
}) {
  const nodes = (["player", "cloud", "artists", "explore", "daily", "radar", "stats"] as ViewId[])
    .map((id) => navItems.find((item) => item.id === id))
    .filter((item): item is (typeof navItems)[number] => Boolean(item));
  const nodePositions = [
    { x: 120, y: 28 },
    { x: 120, y: 84 },
    { x: 120, y: 140 },
    { x: 120, y: 196 },
    { x: 120, y: 252 },
    { x: 120, y: 308 },
    { x: 120, y: 364 },
  ];
  const center = { x: 42, y: 428 };

  return (
    <div
      className={cn(
        "absolute bottom-8 left-7 z-40 h-[468px] w-[188px]",
        open ? "pointer-events-auto" : "pointer-events-none",
        raised && "bottom-24",
      )}
      onMouseEnter={() => {
        if (open) onOpenChange(true);
      }}
      onMouseLeave={onRequestClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onOpenChange(false);
      }}
    >
      <button
        type="button"
        className="pointer-events-auto absolute z-30 flex size-[4.5rem] items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-950 shadow-[0_18px_50px_rgba(47,55,76,0.16)] [&_*]:pointer-events-none"
        style={{ left: center.x - 36, top: center.y - 36 }}
        aria-label="副导航"
        aria-expanded={open}
        aria-controls="floating-nav-nodes"
        onMouseEnter={() => onOpenChange(true)}
        onClick={() => onOpenChange(!open)}
      >
        <AriaIcon
          name="nav-orb"
          className={cn(
            "size-9 text-neutral-950 transition duration-200",
            open && "rotate-45 scale-[0.9]",
          )}
        />
      </button>

      <svg
        className={cn(
          "pointer-events-none absolute inset-0 h-full w-full overflow-visible transition duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
        aria-hidden="true"
      >
        {nodePositions.map((pos, index) => {
          const midX = center.x + (pos.x - center.x) * 0.48;
          const midY = center.y + (pos.y - center.y) * 0.58;
          const wave = index % 2 === 0 ? 10 : -10;
          const path = `M ${center.x} ${center.y} C ${midX - 8} ${midY + 10}, ${midX + wave} ${midY - 10}, ${pos.x} ${pos.y}`;

          return (
            <g key={`${pos.x}-${pos.y}`}>
              <path
                d={path}
                className="nav-wave-base"
                style={{ transitionDelay: open ? `${index * 25}ms` : "0ms" }}
              />
              {open && (
                <path
                  d={path}
                  className="nav-wave-flow"
                  style={{ animationDelay: `${index * 120}ms` }}
                />
              )}
            </g>
          );
        })}
      </svg>

      <div id="floating-nav-nodes" className="pointer-events-none absolute inset-0" aria-hidden={!open}>
        {nodes.map((item, index) => {
          const pos = nodePositions[index];
          const iconName = navIconNames[item.id] ?? "nav-player";
          const active = activeView === item.id;

          return (
            <button
              key={item.id}
              type="button"
              className={cn(
                "group absolute z-20 flex size-12 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-950 shadow-[0_14px_34px_rgba(47,55,76,0.13)] transition duration-200 hover:border-neutral-300 hover:bg-neutral-50 [&_*]:pointer-events-none",
                open ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-50 opacity-0",
                active && "!bg-neutral-950 !text-white [--aria-glint:#171717] hover:!bg-neutral-900",
              )}
              style={{
                left: pos.x - 24,
                top: pos.y - 24,
                transitionDelay: open ? `${index * 25}ms` : "0ms",
              }}
              aria-label={item.label}
              tabIndex={open ? 0 : -1}
              onClick={() => onPick(item.id)}
            >
              {item.id === "artists" ? (
                <span className="relative flex size-9 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#7bd9c7] via-[#f5f7ff] to-[#f0a0c9] text-neutral-950">
                  <AriaIcon name={iconName} className="size-6" />
                </span>
              ) : (
                <AriaIcon name={iconName} className={cn("size-6", active && "size-[1.65rem]")} />
              )}
              <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-full bg-neutral-950 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-sm transition group-hover:opacity-100 group-focus-visible:opacity-100">
                {item.label}
                {item.id === "artists" ? (
                  <span className="ml-1.5 text-white/55">多源</span>
                ) : (item.id === "cloud" || item.id === "explore") ? (
                  <span className="ml-1.5 text-white/55">网易云</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

