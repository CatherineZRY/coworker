import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function ScrollArea({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("coworker-scroll relative overflow-auto", className)} {...props} />;
}

export function ScrollBar(_props: Record<string, unknown>) {
  return null;
}
