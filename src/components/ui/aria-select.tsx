import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type AriaSelectOption<T extends string = string> = {
  value: T;
  label: string;
};

export function AriaSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  id,
  disabled = false,
  size = "md",
  align = "left",
  variant = "glass",
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<AriaSelectOption<T>>;
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  align?: "left" | "right";
  variant?: "glass" | "dark";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  return (
    <div ref={rootRef} className={cn("relative inline-block max-w-full", className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 border text-left font-medium outline-none transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-45",
          size === "sm" ? "h-8 rounded-full px-3 text-xs" : "h-10 rounded-xl px-3.5 text-sm",
          variant === "dark"
            ? "border-white/20 bg-white/14 text-white hover:bg-white/22"
            : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-primary)] shadow-[0_1px_3px_rgba(37,42,37,0.04)] hover:bg-[var(--surface-muted)]",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? ""}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 opacity-65 transition-transform duration-150", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            "scrollbar-thin absolute top-full z-[70] mt-1.5 max-h-64 min-w-full w-max max-w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border p-1.5 shadow-[0_18px_48px_rgba(23,23,23,0.18)] backdrop-blur-2xl",
            align === "right" ? "right-0" : "left-0",
            variant === "dark"
              ? "border-white/18 bg-neutral-900/95 text-white"
              : "border-white/80 bg-white/95 text-neutral-800",
          )}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs font-medium transition sm:text-sm",
                  variant === "dark"
                    ? active
                      ? "bg-white/16 font-semibold text-white"
                      : "text-white/78 hover:bg-white/10 hover:text-white"
                    : active
                      ? "bg-violet-50 font-semibold text-violet-700"
                      : "text-neutral-700 hover:bg-violet-50 hover:text-neutral-950",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {active && <Check className="size-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
