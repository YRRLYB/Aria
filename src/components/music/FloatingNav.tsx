import { navItems, type ViewId } from "@/data/music";
import { cn } from "@/lib/utils";
export function FloatingNav({
  activeView,
  open,
  onOpenChange,
  onRequestClose,
  onPick,
}: {
  activeView: ViewId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestClose: () => void;
  onPick: (id: ViewId | "settings") => void;
}) {
  const nodes = (["settings", "daily", "radar", "stats"] as Array<ViewId | "settings">)
    .map((id) => navItems.find((item) => item.id === id))
    .filter((item): item is (typeof navItems)[number] => Boolean(item));
  const nodePositions = [
    { x: 120, y: 24 },
    { x: 120, y: 88 },
    { x: 120, y: 152 },
    { x: 120, y: 216 },
  ];
  const center = { x: 42, y: 358 };

  return (
    <div
      className="pointer-events-none absolute bottom-8 left-7 z-40 h-[394px] w-[188px]"
    >
      <button
        className="pointer-events-auto absolute z-30 flex size-16 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-950 shadow-[0_18px_50px_rgba(47,55,76,0.16)]"
        style={{ left: center.x - 32, top: center.y - 32 }}
        aria-label="副导航"
        onMouseEnter={() => onOpenChange(true)}
        onMouseLeave={onRequestClose}
        onClick={() => onOpenChange(!open)}
      >
        <div
          className={cn(
            "grid size-7 grid-cols-2 gap-1 transition duration-200",
            open && "rotate-45 scale-[0.85]",
          )}
        >
          {[0, 1, 2, 3].map((dot) => (
            <span key={dot} className="rounded-full bg-neutral-950" />
          ))}
        </div>
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
                style={{ transitionDelay: open ? `${index * 35}ms` : "0ms" }}
              />
              <path
                d={path}
                className="nav-wave-flow"
                style={{ animationDelay: `${index * 120}ms` }}
              />
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute inset-0">
        {nodes.map((item, index) => {
          const pos = nodePositions[index];
          const Icon = item.icon;
          const active = activeView === item.id;

          return (
            <div key={item.id} className="absolute">
              <button
                className={cn(
                  "group absolute flex size-14 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-950 shadow-[0_14px_34px_rgba(47,55,76,0.13)] transition duration-200 hover:border-neutral-300 hover:bg-neutral-50",
                  open && "pointer-events-auto",
                  open ? "scale-100 opacity-100" : "scale-50 opacity-0",
                  active && "!bg-neutral-950 !text-white hover:!bg-neutral-900",
                )}
                style={{
                  left: pos.x - 28,
                  top: pos.y - 28,
                  transitionDelay: open ? `${index * 35}ms` : "0ms",
                }}
                aria-label={item.label}
                onMouseEnter={() => onOpenChange(true)}
                onMouseLeave={onRequestClose}
                onClick={() => onPick(item.id)}
              >
                <Icon className="size-5" />
                <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-full bg-neutral-950 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-sm transition group-hover:opacity-100">
                  {item.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}


