import * as React from "react";
import * as T from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsList = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof T.List>) => (
  <T.List className={cn("flex items-center gap-1 border-b border-border", className)} {...p} />
);
export const TabsTrigger = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof T.Trigger>) => (
  <T.Trigger
    className={cn(
      "-mb-px inline-flex items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-slate-900 data-[state=active]:text-foreground",
      className,
    )}
    {...p}
  />
);
export const TabsContent = T.Content;

export function CountPill({ n, className }: { n: number; className?: string }) {
  return <span className={cn("min-w-5 rounded-full bg-slate-900 px-1.5 py-px text-center text-[11px] font-semibold leading-4 text-white", className)}>{n}</span>;
}
