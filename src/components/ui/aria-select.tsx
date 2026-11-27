import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
  const [highlightedIndex, setHighlightedIndex] = useState(() =>
    Math.max(0, options.findIndex((option) => option.value === value)),
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
    setHighlightedIndex(selectedIndex);
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
        triggerRef.current?.focus();
        return;
      }
      if (!options.length) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((current) => (current + 1) % options.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((current) => (current - 1 + options.length) % options.length);
      } else if (event.key === "Home") {
        event.preventDefault();
        setHighlightedIndex(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setHighlightedIndex(options.length - 1);
      } else if (event.key === "Enter" || event.key === " ") {
        const option = options[highlightedIndex];
        if (option) {
          event.preventDefault();
          onChange(option.value);
          setOpen(false);
          triggerRef.current?.focus();
        }
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
  }, [highlightedIndex, onChange, open, options, value]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  return (
    <div ref={rootRef} className={cn("relative inline-block max-w-full", className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 border text-left font-medium outline-none transition-[transform,color,background-color,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-45",
          size === "sm" ? "h-8 rounded-full px-3 text-xs" : "h-10 rounded-xl px-3.5 text-sm",
          variant === "dark"
            ? "border-white/20 bg-white/14 text-white hover:bg-white/22"
            : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-primary)] shadow-[0_1px_3px_rgba(37,42,37,0.04)] hover:bg-[var(--surface-muted)]",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? ""}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 opacity-65 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={ariaLabel}
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -3 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            className={cn(
              "aria-select-menu scrollbar-thin absolute top-full z-[70] mt-1.5 max-h-64 min-w-full w-max max-w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border p-1.5 shadow-[0_18px_48px_rgba(23,23,23,0.18)] backdrop-blur-2xl",
              align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
              variant === "dark"
                ? "border-white/18 bg-neutral-900/95 text-white"
                : "border-white/80 bg-white/95 text-neutral-800",
            )}
          >
            {options.map((option, index) => {
              const active = option.value === value;
              const highlighted = index === highlightedIndex;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs font-medium transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] sm:text-sm",
                    variant === "dark"
                      ? active
                        ? "bg-white/16 font-semibold text-white"
                        : highlighted
                          ? "bg-white/10 text-white"
                          : "text-white/78 hover:bg-white/10 hover:text-white"
                      : active
                        ? "bg-violet-50 font-semibold text-violet-700"
                        : highlighted
                          ? "bg-violet-50 text-neutral-950"
                          : "text-neutral-700 hover:bg-violet-50 hover:text-neutral-950",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {active && <Check className="size-3.5 shrink-0" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
