import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex h-7 items-center rounded-full border border-white/70 bg-white/55 px-3 text-xs font-medium text-neutral-700 shadow-sm backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}
