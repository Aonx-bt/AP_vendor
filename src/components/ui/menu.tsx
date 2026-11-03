import * as React from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import * as P from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export function MenuContent({ className, ...p }: React.ComponentPropsWithoutRef<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content sideOffset={6} align="end" className={cn("z-50 min-w-48 rounded-xl border bg-white p-1 shadow-lg animate-in fade-in-0 zoom-in-95", className)} {...p} />
    </M.Portal>
  );
}
export const MenuItem = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof M.Item>) => (
  <M.Item className={cn("flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted", className)} {...p} />
);
export const MenuLabel = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof M.Label>) => (
  <M.Label className={cn("px-2.5 py-1.5 text-xs text-muted-foreground", className)} {...p} />
);

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export function PopoverContent({ className, ...p }: React.ComponentPropsWithoutRef<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content sideOffset={6} align="start" className={cn("z-50 w-72 rounded-xl border bg-white p-3 shadow-lg animate-in fade-in-0", className)} {...p} />
    </P.Portal>
  );
}
