import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-slate-900/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <D.Content className={cn("fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-white p-5 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95", className)} {...props}>
        {children}
        <D.Close className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
          <X className="h-4 w-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
export const DialogTitle = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof D.Title>) => <D.Title className={cn("text-base font-semibold", className)} {...p} />;
export const DialogDescription = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof D.Description>) => <D.Description className={cn("text-sm text-muted-foreground", className)} {...p} />;

/** Right slide-over built on Dialog (shadcn "Sheet"). */
export function SheetContent({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-slate-900/25 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <D.Content className={cn("fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-white shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right duration-200", className)} {...props}>
        {children}
      </D.Content>
    </D.Portal>
  );
}
