import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Track } from "@/data/music";
import { cn } from "@/lib/utils";

/**
 * 音源标识、徽章与切换按钮。
 * 采用网易云音乐、QQ 音乐、哔哩哔哩官方高精度矢量几何路径，并在混合列表中使用彩色 SourceBadge 让来源一目了然。
 */

export function NeteaseLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 shrink-0", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="10.2" fill="#FFFFFF" />
      <path
        fill="#E60026"
        d="M13.046 9.388a3.919 3.919 0 0 0-.66.19c-.809.312-1.447.991-1.666 1.775a2.269 2.269 0 0 0-.074.81c.048.546.333 1.05.764 1.35a1.483 1.483 0 0 0 2.01-.286c.406-.531.355-1.183.24-1.636-.098-.387-.22-.816-.345-1.249a64.76 64.76 0 0 1-.269-.954zm-.82 10.07c-3.984 0-7.224-3.24-7.224-7.223 0-.98.226-3.02 1.884-4.822A7.188 7.188 0 0 1 9.502 5.6a.792.792 0 1 1 .587 1.472 5.619 5.619 0 0 0-2.795 2.462 5.538 5.538 0 0 0-.707 2.7 5.645 5.645 0 0 0 5.638 5.638c1.844 0 3.627-.953 4.542-2.428 1.042-1.68.772-3.931-.627-5.238a3.299 3.299 0 0 0-1.437-.777c.172.589.334 1.18.494 1.772.284 1.12.1 2.181-.519 2.989-.39.51-.956.888-1.592 1.064a3.038 3.038 0 0 1-2.58-.44 3.45 3.45 0 0 1-1.44-2.514c-.04-.467.002-.93.128-1.376.35-1.256 1.356-2.339 2.622-2.826a5.5 5.5 0 0 1 .823-.246l-.134-.505c-.37-1.371.25-2.579 1.547-3.007.329-.109.68-.145 1.025-.105.792.09 1.476.592 1.709 1.023.258.507-.096 1.153-.706 1.153a.788.788 0 0 1-.54-.213c-.088-.08-.163-.174-.259-.247a.825.825 0 0 0-.632-.166.807.807 0 0 0-.634.551c-.056.191-.031.406.02.595.07.256.159.597.217.82 1.11.098 2.162.54 2.97 1.296 1.974 1.844 2.35 4.886.892 7.233-1.197 1.93-3.509 3.177-5.889 3.177zM0 12c0 6.627 5.373 12 12 12s12-5.373 12-12S18.627 0 12 0 0 5.373 0 12Z"
      />
    </svg>
  );
}

export function QqLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="-4 0 177.06 177.06" className={cn("size-4 shrink-0", className)} aria-hidden="true">
      <g transform="translate(-14.693387,-35.461841)">
        <g transform="matrix(2.519673,0,0,2.519673,-493.77296,1465.4508)">
          <circle cx="235.34128" cy="-530.80383" r="33.542732" fill="#FDCD18" />
          <path
            fill="#0DAF52"
            d="m 240.45119,-527.94916 c -0.84214,-1.1847 -1.64146,-2.29803 -2.44077,-3.39709 -3.06881,-4.2535 -6.15188,-8.50701 -9.23496,-12.74624 -1.95547,-2.69769 -3.89667,-5.39538 -5.88068,-8.06453 -0.59949,-0.79931 -0.67086,-1.64145 -0.39966,-2.55496 0.55667,-1.89837 1.8841,-3.21153 3.45419,-4.29632 2.86897,-1.98402 6.10906,-2.99744 9.50615,-3.59692 2.95462,-0.51385 5.88068,-1.14188 8.46419,-2.76906 0.6994,-0.44248 1.28461,-1.04197 1.92692,-1.57009 0.17128,-0.14273 0.32829,-0.29974 0.65658,-0.58521 0.2141,1.04197 0.42821,1.91265 0.57094,2.78333 0.42821,2.56923 0.2712,5.0671 -0.88496,7.4365 -1.57008,3.19726 -4.13931,5.19555 -7.50786,6.22324 -2.05538,0.65659 -4.18213,0.81359 -6.33743,0.79932 -0.15701,0 -0.31402,0.0428 -0.58522,0.0714 0.52812,0.92778 0.99915,1.79846 1.51299,2.6406 2.06966,3.38282 4.13932,6.76564 6.19471,10.16273 l 6.76564,11.21897 c 0.58521,0.9706 1.19897,1.9412 1.76991,2.92607 1.32744,2.28376 2.29803,4.66744 2.11248,7.40795 -0.18556,2.68342 -1.15616,5.02427 -2.82616,7.07966 -2.72623,3.35427 -6.26606,5.29547 -10.49102,6.05196 -3.98231,0.6994 -7.77906,0.25693 -11.30461,-1.75564 -3.96804,-2.25521 -6.50872,-6.35171 -5.90923,-11.23324 0.38538,-3.21154 1.98401,-5.86641 4.33914,-8.05026 2.51214,-2.31231 5.4953,-3.72538 8.82103,-4.36769 2.45504,-0.4853 4.91008,-0.45675 7.33658,0.19983 0.0714,0.0143 0.157,-0.0143 0.37111,-0.0143 z"
          />
        </g>
      </g>
    </svg>
  );
}

export function LocalLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 shrink-0", className)} aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="#6E5AD6" />
      <circle cx="12" cy="12" r="5.3" fill="none" stroke="#fff" strokeWidth="1.85" />
      <circle cx="12" cy="12" r="1.7" fill="#fff" />
    </svg>
  );
}

export function BilibiliLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 shrink-0", className)} aria-hidden="true">
      <rect x="2.6" y="7.1" width="18.8" height="12.8" rx="3" fill="#FFFFFF" />
      <path
        fill="#00AEEC"
        d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z"
      />
    </svg>
  );
}

/** YouTube Music：官方红底圆角矩形 + 白色圆孔播放键。 */
export function YoutubeLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 shrink-0", className)} aria-hidden="true">
      <rect x="1.2" y="4.4" width="21.6" height="15.2" rx="4.4" fill="#FF0033" />
      <path d="M10.05 8.35l6.4 3.65-6.4 3.65z" fill="#fff" />
    </svg>
  );
}

export function CloudLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 shrink-0", className)} aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="#4F6EF7" />
      <path
        d="M8.4 16.2h7.6a2.7 2.7 0 0 0 .4-5.37A4.1 4.1 0 0 0 8.5 9.9a3.15 3.15 0 0 0-.1 6.3z"
        fill="#fff"
      />
    </svg>
  );
}

export function PrivateCloudLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 shrink-0", className)} aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="#0F766E" />
      <path
        d="M7.8 15.8h8.3a2.6 2.6 0 0 0 .35-5.18 3.9 3.9 0 0 0-7.55-1.1 3.1 3.1 0 0 0-1.1 6.28z"
        fill="#fff"
      />
      <circle cx="12" cy="12.6" r="1.1" fill="#0F766E" />
    </svg>
  );
}

export function SuperMixLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 shrink-0", className)} aria-hidden="true">
      <defs>
        <linearGradient id="aria-supermix-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E60026" />
          <stop offset="35%" stopColor="#0DAF52" />
          <stop offset="68%" stopColor="#00AEEC" />
          <stop offset="100%" stopColor="#7C5CE6" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="url(#aria-supermix-grad)" />
      <circle cx="9.6" cy="12" r="4.1" fill="none" stroke="#fff" strokeWidth="1.65" opacity="0.95" />
      <circle cx="14.4" cy="12" r="4.1" fill="none" stroke="#fff" strokeWidth="1.65" opacity="0.95" />
      <circle cx="12" cy="12" r="1.3" fill="#fff" />
    </svg>
  );
}

export type SourceToggleOption = "local" | "netease" | "qq" | "bilibili" | "youtube" | "super-mix";
export type SourceLogoOption = Track["source"];

const SOURCE_META: Record<SourceLogoOption | "super-mix", { label: string; shortLabel: string }> = {
  local: { label: "本地", shortLabel: "本地" },
  cloud: { label: "云盘", shortLabel: "云盘" },
  netease: { label: "网易云", shortLabel: "网易云" },
  qq: { label: "QQ 音乐", shortLabel: "QQ" },
  bilibili: { label: "B站", shortLabel: "B站" },
  youtube: { label: "YouTube", shortLabel: "YT" },
  subsonic: { label: "私有云", shortLabel: "私有云" },
  webdav: { label: "WebDAV", shortLabel: "WebDAV" },
  "super-mix": { label: "Super混合", shortLabel: "Super" },
};

export function SourceLogo({ source, className }: { source: SourceLogoOption | "super-mix"; className?: string }) {
  if (source === "netease") return <NeteaseLogo className={className} />;
  if (source === "qq") return <QqLogo className={className} />;
  if (source === "bilibili") return <BilibiliLogo className={className} />;
  if (source === "youtube") return <YoutubeLogo className={className} />;
  if (source === "cloud") return <CloudLogo className={className} />;
  if (source === "subsonic" || source === "webdav") return <PrivateCloudLogo className={className} />;
  if (source === "super-mix") return <SuperMixLogo className={className} />;
  return <LocalLogo className={className} />;
}

export function SourceBadge({
  source,
  compact = false,
  className,
}: {
  source: SourceLogoOption;
  compact?: boolean;
  className?: string;
}) {
  const meta = SOURCE_META[source];
  return (
    <span
      className={cn(
        "source-badge",
        `source-badge-${source}`,
        compact && "is-compact",
        className,
      )}
      title={`音源：${meta.label}`}
    >
      <SourceLogo source={source} className={compact ? "size-3" : "size-3.5"} />
      <span>{compact ? meta.shortLabel : meta.label}</span>
    </span>
  );
}

export function SourceToggle<T extends SourceToggleOption>({ value, onChange, options, ariaLabel }: {
  value: T;
  onChange: (source: T) => void;
  options: T[];
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
