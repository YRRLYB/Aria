import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "bg-neutral-950 text-white shadow-sm hover:bg-neutral-800",
        ghost: "hover:bg-white/70 hover:text-neutral-950",
        glass:
          "border border-white/70 bg-white/45 text-neutral-900 shadow-[0_12px_30px_rgba(40,48,64,0.08)] backdrop-blur-xl hover:bg-white/70",
        subtle: "bg-neutral-100 text-neutral-900 hover:bg-neutral-200",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 px-3 text-xs",
        icon: "size-10 p-0",
        iconLg: "size-14 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
