import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FolderSearch } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 音源标识与切换按钮。在线源用简化的品牌圆形标（网易云红 / QQ 音乐绿），
 * 本地用通用资料库图标——融合界面里点图标即切到该源，一次只显示一个源。
 */

export function NeteaseLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#C20C0C" />
      <path
        d="M12.9 5.6c.3-.4.9-.2 1 .3l.4 2.1c1.8.8 3 2.6 3 4.7 0 2.8-2.3 5.1-5.1 5.1S7 15.5 7 12.7c0-2 1.1-3.7 2.8-4.6l.2-1.2c-2.2.9-3.7 3-3.7 5.6 0 3.3 2.6 5.9 5.9 5.9s5.9-2.6 5.9-5.9c0-2.8-1.9-5.1-4.5-5.7l-.3-1.4 2.2-.5c.5-.1.6-.7.2-1-.6-.4-1.5-.6-2.3-.4-.6.1-1.2.5-1.5.9z"
        fill="#fff"
      />
      <path
        d="M12.2 9.1c.5-.1.9.2.9.7v5c0 .9-.7 1.6-1.6 1.6s-1.6-.7-1.6-1.6.7-1.6 1.6-1.6c.2 0 .4 0 .6.1v-2.6l-.8.2c-.4.1-.8-.2-.8-.6 0-.3.2-.5.5-.6l1.2-.6z"
        fill="#fff"
      />
    </svg>
  );
}

export function QqLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#31C27C" />
      <path
        d="M14.8 5.2c.4-.1.7.2.6.6l-1.2 6.5c.3.2.6.5.8.9.6 1.3.1 2.9-1.2 3.5-1.2.6-2.7.2-3.4-1-.1-.2 0-.4.2-.5.2-.1.4 0 .5.1.5.8 1.5 1.1 2.3.7.9-.4 1.3-1.5.9-2.4-.2-.4-.5-.7-.9-.9l-2.9 1.6c-.4.2-.8 0-1-.4-.1-.4 0-.8.4-1l6.9-3.8.6-3.2c.1-.4.3-.6.4-.7z"
        fill="#fff"
      />
    </svg>
  );
}

export function LocalLogo({ className }: { className?: string }) {
  return <FolderSearch className={cn("size-4", className)} aria-hidden="true" />;
}

export function BilibiliLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-hidden="true">
      <rect x="2" y="5" width="20" height="15" rx="4" fill="#00A1D6" />
      <path d="M7.2 3.2 10 6M16.8 3.2 14 6" stroke="#00A1D6" strokeWidth="2" strokeLinecap="round" />
      <rect x="5.5" y="9" width="13" height="8" rx="2" fill="#fff" />
      <circle cx="9" cy="12" r="1.1" fill="#00A1D6" />
      <circle cx="15" cy="12" r="1.1" fill="#00A1D6" />
      <path d="M9 14.4h6" stroke="#00A1D6" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export type SourceToggleOption = "local" | "netease" | "qq";
export type SourceLogoOption = SourceToggleOption | "bilibili";

const SOURCE_META: Record<SourceLogoOption, { label: string }> = {
  local: { label: "本地" },
  netease: { label: "网易云" },
  qq: { label: "QQ 音乐" },
  bilibili: { label: "B站" },
};

export function SourceLogo({ source, className }: { source: SourceLogoOption; className?: string }) {
  if (source === "netease") return <NeteaseLogo className={className} />;
  if (source === "qq") return <QqLogo className={className} />;
  if (source === "bilibili") return <BilibiliLogo className={className} />;
  return <LocalLogo className={className} />;
}

export function SourceToggle({ value, onChange, options, ariaLabel }: {
  value: SourceToggleOption;
  onChange: (source: SourceToggleOption) => void;
  options: SourceToggleOption[];
  ariaLabel: string;
}) {
  // 滑块式切换：深色滑块在 logo 选项之间平滑滑动（融合界面一次只显示一个源）。
  // 每个选项的文字宽度不同（"网易云" vs "QQ 音乐" vs "本地"），所以不能按
  // 1/n 估算滑块宽度：用真实按钮的 offsetLeft/offsetWidth 定位，滑块才不会被
  // 拖出胶囊边界。窗口缩放、字体加载或选项变化时重新量一次。
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<SourceToggleOption, HTMLButtonElement>());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const optionsKey = options.join("|");
  // Keep the selected value in a ref so switching sources only re-measures the
  // indicator instead of tearing down and re-creating the ResizeObserver.
  const valueRef = useRef(value);
  valueRef.current = value;

  const syncIndicator = useCallback(() => {
    const button = buttonRefs.current.get(valueRef.current);
    if (!button) return;
    const next = { left: button.offsetLeft, width: button.offsetWidth };
    setIndicator((current) => (
      current.left === next.left && current.width === next.width ? current : next
    ));
  }, []);

  useLayoutEffect(() => {
    syncIndicator();
  }, [syncIndicator, value, optionsKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncIndicator());
    observer.observe(container);
    for (const button of buttonRefs.current.values()) observer.observe(button);
    return () => observer.disconnect();
  }, [syncIndicator, optionsKey]);

  return (
    <div
      ref={containerRef}
      className="relative flex w-fit overflow-hidden rounded-full border border-white/70 bg-white/52 p-1 shadow-sm"
      aria-label={ariaLabel}
      role="tablist"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-1 left-0 top-1 rounded-full bg-neutral-950 shadow-sm transition-[width,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          width: indicator.width,
          transform: `translateX(${indicator.left}px)`,
          opacity: indicator.width > 0 ? 1 : 0,
        }}
      />
      {options.map((source) => {
        const active = value === source;
        return (
          <button
            key={source}
            ref={(element) => {
              if (element) buttonRefs.current.set(source, element);
              else buttonRefs.current.delete(source);
            }}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              "relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
              active ? "text-white" : "text-neutral-500 hover:text-neutral-800",
            )}
            onClick={() => onChange(source)}
          >
            <SourceLogo source={source} className="size-4 shrink-0" />
            {SOURCE_META[source].label}
          </button>
        );
      })}
    </div>
  );
}
