import * as React from "react";
import { cn } from "@/lib/utils";
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("rounded-xl border border-border bg-white", className)} {...p} />;
export const SectionTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn("text-sm font-semibold text-slate-900", className)} {...p} />;
