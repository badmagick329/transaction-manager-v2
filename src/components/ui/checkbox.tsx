import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import type { ComponentProps } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root className={cn("peer size-5 shrink-0 rounded border border-neutral-600 bg-neutral-900 shadow-sm transition focus-visible:ring-2 focus-visible:ring-neutral-400 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500", className)} {...props}><CheckboxPrimitive.Indicator className="flex items-center justify-center text-neutral-950"><Check className="size-3.5 stroke-[3]" /></CheckboxPrimitive.Indicator></CheckboxPrimitive.Root>;
}
