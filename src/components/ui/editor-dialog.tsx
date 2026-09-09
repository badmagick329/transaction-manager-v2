import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./button";

/** Keeps long editors in context and returns keyboard users to the initiating action. */
export function EditorDialog({ title, children, busy, onClose }: { title: string; children: ReactNode; busy: boolean; onClose: () => void }) {
  const origin = useRef(document.activeElement as HTMLElement | null);
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
      <Dialog.Content aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); origin.current?.focus({ preventScroll: true }); }} onPointerDownOutside={event => event.preventDefault()} className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-6 text-neutral-100 shadow-2xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Close asChild><Button variant="ghost" size="icon" disabled={busy} aria-label="Close editor"><X /></Button></Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
