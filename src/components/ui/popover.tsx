import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, align = "start", ...props }: ComponentProps<typeof PopoverPrimitive.Content>) { return <PopoverPrimitive.Portal><PopoverPrimitive.Content align={align} className={cn("z-50 rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-neutral-100 shadow-xl", className)} {...props} /></PopoverPrimitive.Portal>; }
