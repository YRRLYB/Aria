import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex h-7 items-center rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-xs font-medium text-[var(--text-secondary)]",
        className,
      )}
      {...props}
    />
  );
}
