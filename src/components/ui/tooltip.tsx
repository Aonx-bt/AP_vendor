import * as React from "react";
import * as T from "@radix-ui/react-tooltip";

export const TooltipProvider = T.Provider;
export function Tip({ label, children, side = "right" }: { label: React.ReactNode; children: React.ReactNode; side?: "right" | "top" | "bottom" | "left" }) {
  return (
    <T.Root delayDuration={150}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={8} className="z-50 rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow animate-in fade-in-0">
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
