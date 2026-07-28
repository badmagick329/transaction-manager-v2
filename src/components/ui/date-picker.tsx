import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

type Props = { value: string; onChange: (value: string) => void; placeholder?: string };
export function DatePicker({ value, onChange, placeholder = "Select date" }: Props) {
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  return <Popover><PopoverTrigger asChild><button className="mt-1 flex h-11 w-full items-center justify-between rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-left text-sm text-neutral-100 transition hover:border-neutral-500"><span className={value ? "" : "text-neutral-500"}>{selected ? format(selected, "dd/MM/yyyy") : placeholder}</span><CalendarIcon className="size-4 text-neutral-400" /></button></PopoverTrigger><PopoverContent className="w-auto border-neutral-700 bg-neutral-900 p-3"><DayPicker mode="single" navLayout="around" selected={selected} onSelect={date => { if (date) onChange(format(date, "yyyy-MM-dd")); }} classNames={{ root: "text-sm text-neutral-100", months: "flex", month: "space-y-3", caption: "flex h-8 items-center justify-center", caption_label: "text-sm font-medium", nav: "flex items-center gap-16", button_previous: "rounded p-1 text-neutral-300 hover:bg-neutral-800 hover:text-white", button_next: "rounded p-1 text-neutral-300 hover:bg-neutral-800 hover:text-white", month_grid: "w-full border-collapse", weekdays: "text-neutral-500", weekday: "w-9 py-1 text-center text-xs", week: "", day: "h-9 w-9 text-center", day_button: "size-8 rounded text-neutral-200 hover:bg-neutral-800", selected: "[&>button]:bg-emerald-400 [&>button]:text-neutral-950 [&>button]:hover:bg-emerald-300", today: "[&>button]:border [&>button]:border-neutral-500", outside: "text-neutral-700", disabled: "opacity-40" }} /></PopoverContent></Popover>;
}
