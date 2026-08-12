import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import type { Tag, Transaction } from "./types";

type Props = {
  transaction: Transaction;
  tags: Tag[];
  savingKey: string | null;
  setManualTag: (transactionId: number, tagId: number, assigned: boolean) => void;
  createAndAssignTag: (transactionId: number, name: string) => Promise<void>;
  createRule: (transaction: Transaction) => void;
};

export function TagPicker({ transaction, tags, savingKey, setManualTag, createAndAssignTag, createRule }: Props) {
  const [newName, setNewName] = useState("");
  const assignedById = new Map(transaction.tags.map(tag => [tag.id, tag]));

  return <div className="mt-2 flex flex-wrap items-center gap-1.5">
    {transaction.tags.map(tag => <span key={tag.id} title={tag.automatic ? "Applied automatically by a tag rule" : "Added manually"} className="rounded-full border border-sky-900 bg-sky-950/60 px-2 py-0.5 text-xs text-sky-200">{tag.name}{tag.automatic ? " · auto" : ""}</span>)}
    <Popover>
      <PopoverTrigger asChild><button className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:border-neutral-500 hover:text-neutral-200">+ Tag</button></PopoverTrigger>
      <PopoverContent className="w-72">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Transaction tags</p>
        <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {tags.map(tag => {
            const assignment = assignedById.get(tag.id);
            const automaticOnly = assignment?.automatic && !assignment.manual;
            return <button key={tag.id} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={automaticOnly || savingKey === `tag-${transaction.id}-${tag.id}`} onClick={() => setManualTag(transaction.id, tag.id, !assignment?.manual)}>
              <span>{tag.name}</span><span className="text-xs text-neutral-500">{automaticOnly ? "Rule managed" : assignment?.manual ? "Remove" : "Add"}</span>
            </button>;
          })}
          {tags.length === 0 ? <p className="px-2 py-1 text-sm text-neutral-500">No tags yet.</p> : null}
        </div>
        <form className="mt-3 flex gap-2 border-t border-neutral-800 pt-3" onSubmit={event => { event.preventDefault(); const name = newName.trim(); if (!name) return; void createAndAssignTag(transaction.id, name).then(() => setNewName("")); }}>
          <input className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" value={newName} onChange={event => setNewName(event.target.value)} placeholder="New tag" maxLength={50} />
          <button className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800" type="submit">Create</button>
        </form>
        <button className="mt-3 w-full rounded border border-neutral-700 px-2 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800" onClick={() => createRule(transaction)}>Create automatic rule</button>
      </PopoverContent>
    </Popover>
  </div>;
}
