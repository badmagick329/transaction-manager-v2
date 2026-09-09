import { useId, useState } from 'react';
import { Button } from './button';
import { Input } from './input';
import { format, parse, isValid } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

type Props = { value: string; onChange: (value: string) => void; placeholder?: string };
export function DatePicker({ value, onChange, placeholder = 'Select date' }: Props) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  const commit = (date: Date | undefined) => { onChange(date ? format(date, 'yyyy-MM-dd') : ''); setOpen(false); };
  const applyDraft = () => {
    const date = parse(draft, 'dd/MM/yyyy', new Date());
    if (!isValid(date) || format(date, 'dd/MM/yyyy') !== draft) { setInvalid(true); return; }
    commit(date);
  };
  const year = new Date().getFullYear();
  return <Popover open={open} onOpenChange={next => { setOpen(next); setDraft(selected ? format(selected, 'dd/MM/yyyy') : ''); setInvalid(false); }}>
    <PopoverTrigger asChild><Button type="button" variant="outline" className="mt-1 flex h-9 w-full items-center justify-between rounded-lg border-neutral-700 bg-neutral-900 px-3 text-left text-sm"><span className={value ? '' : 'text-neutral-500'}>{selected ? format(selected, 'dd/MM/yyyy') : placeholder}</span><CalendarIcon className="size-4 text-neutral-400" /></Button></PopoverTrigger>
    <PopoverContent collisionPadding={12} className="w-80 max-w-[calc(100vw-24px)] border-neutral-700 bg-neutral-900 p-3">
      <DayPicker mode="single" selected={selected} defaultMonth={selected} onSelect={commit} fixedWeeks showOutsideDays captionLayout="dropdown" navLayout="around" startMonth={new Date(Math.min(year - 100, selected?.getFullYear() ?? year), 0)} endMonth={new Date(Math.max(year + 10, selected?.getFullYear() ?? year), 11)} classNames={{
        root: 'text-sm text-neutral-200', months: 'w-full', month: 'relative w-full',
        month_caption: 'mx-9 flex h-10 items-center justify-center', caption_label: 'hidden',
        dropdowns: 'flex items-center gap-1', dropdown_root: 'relative', dropdown: 'max-w-28 rounded border border-neutral-700 bg-neutral-900 py-1 text-sm text-neutral-100',
        month_grid: 'w-full table-fixed border-collapse', weekday: 'h-8 text-center text-xs font-normal text-neutral-500',
        day: 'h-9 p-0 text-center', day_button: 'mx-auto block size-9 rounded hover:bg-neutral-800',
        selected: '[&>button]:bg-emerald-400 [&>button]:text-neutral-950', today: '[&>button]:border [&>button]:border-neutral-500', outside: 'text-neutral-500', disabled: 'opacity-40',
        button_previous: 'absolute left-0 top-1 flex size-8 items-center justify-center rounded hover:bg-neutral-800',
        button_next: 'absolute right-0 top-1 flex size-8 items-center justify-center rounded hover:bg-neutral-800', chevron: 'size-5 fill-current',
      }} />
      <div className="mt-3 border-t border-neutral-700 pt-3">
        <label htmlFor={inputId} className="block text-xs text-neutral-400">Type a date (DD/MM/YYYY)</label><div className="mt-1 flex gap-2"><Input id={inputId} aria-invalid={invalid} placeholder="DD/MM/YYYY" value={draft} onChange={event => { setDraft(event.target.value); setInvalid(false); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyDraft(); } }} /><Button type="button" variant="outline" onClick={applyDraft}>Apply</Button></div>
        <p role="status" className="h-6 pt-1 text-xs text-red-300">{invalid ? 'Enter a valid date as DD/MM/YYYY.' : ''}</p>
        <div className="flex justify-between"><Button type="button" variant="ghost" disabled={!value} onClick={() => commit(undefined)}>Clear</Button><Button type="button" variant="ghost" onClick={() => commit(new Date())}>Today</Button></div>
      </div>
    </PopoverContent>
  </Popover>;
}
