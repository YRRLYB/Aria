import { navItems, type ViewId } from "@/data/music";
import { cn } from "@/lib/utils";

// These are the six places a listener visits most often. Advanced tools live
// in the floating secondary navigation so the header remains a single row.
const primaryIds: ViewId[] = ["home", "player", "local", "liked", "history", "playlists"];

export function AppNavigation({ activeView, onPick }: { activeView: ViewId; onPick: (id: ViewId) => void }) {
  const links = primaryIds
    .map((id) => navItems.find((item) => item.id === id))
    .filter((item): item is (typeof navItems)[number] => Boolean(item));

  return (
    <nav className="app-navigation" aria-label="主导航">
      <div className="app-nav-scroll no-scrollbar">
        <div className="app-nav-group">
          {links.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={cn("app-nav-link", active && "is-active")}
                aria-current={active ? "page" : undefined}
                onClick={() => onPick(item.id)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
