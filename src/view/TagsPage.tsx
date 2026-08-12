import { useEffect, useState } from "react";
import { matchModeOptions, titleCase } from "./formatters";
import type { Account, Tag, TagRule, TagRuleDraft } from "./types";

type Props = {
  tags: Tag[];
  rules: TagRule[];
  accounts: Account[];
  loading: boolean;
  savingKey: string | null;
  ruleDraft: TagRuleDraft;
  setRuleDraft: (draft: TagRuleDraft) => void;
  createTag: (name: string) => Promise<void>;
  renameTag: (tagId: number, name: string) => Promise<void>;
  deleteTag: (tag: Tag) => void;
  saveRule: (draft: TagRuleDraft) => void;
  deleteRule: (rule: TagRule) => void;
};

const emptyDraft: TagRuleDraft = { tagId: "", sourceId: "", description: "", matchMode: "exact", direction: "outflow" };

export function TagsPage({ tags, rules, accounts, loading, savingKey, ruleDraft, setRuleDraft, createTag, renameTag, deleteTag, saveRule, deleteRule }: Props) {
  const [newTagName, setNewTagName] = useState("");
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});
  const sources = [...new Map(accounts.filter(account => account.sourceId !== null).map(account => [account.sourceId!, account.sourceName ?? "Unknown source"])).entries()];
  useEffect(() => setNameDrafts(Object.fromEntries(tags.map(tag => [tag.id, tag.name]))), [tags]);

  return <>
    <section className="mt-8">
      <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Tags</p>
      <h2 className="mt-2 text-xl font-semibold">Reusable transaction labels</h2>
      <p className="mt-2 text-sm text-neutral-400">Tags organise transactions without changing their economic type or cash-flow treatment.</p>
      <form className="mt-5 flex max-w-md gap-2" onSubmit={event => { event.preventDefault(); const name = newTagName.trim(); if (!name) return; void createTag(name).then(() => setNewTagName("")); }}>
        <input className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm" value={newTagName} onChange={event => setNewTagName(event.target.value)} maxLength={50} placeholder="New tag name" />
        <button className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800" type="submit">Create tag</button>
      </form>
      {!loading && tags.length === 0 ? <p className="mt-5 text-sm text-neutral-500">No tags created yet.</p> : null}
      <div className="mt-5 space-y-2">{tags.map(tag => <div key={tag.id} className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 sm:flex-row sm:items-center">
        <input className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" value={nameDrafts[tag.id] ?? tag.name} onChange={event => setNameDrafts(current => ({ ...current, [tag.id]: event.target.value }))} maxLength={50} />
        <span className="text-xs text-neutral-500">{tag.transactionCount} transaction{tag.transactionCount === 1 ? "" : "s"}</span>
        <button className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50" disabled={savingKey === `rename-tag-${tag.id}` || (nameDrafts[tag.id] ?? tag.name).trim() === tag.name} onClick={() => void renameTag(tag.id, nameDrafts[tag.id] ?? tag.name)}>Rename</button>
        <button className="rounded px-2 py-1 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50" disabled={savingKey === `delete-tag-${tag.id}`} onClick={() => deleteTag(tag)}>Delete</button>
      </div>)}</div>
    </section>

    <section className="mt-10">
      <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Automatic rules</p>
      <h2 className="mt-2 text-xl font-semibold">Apply tags to matching transactions</h2>
      <div className="mt-5 grid gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs text-neutral-400">Tag<select className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" value={ruleDraft.tagId} onChange={event => setRuleDraft({ ...ruleDraft, tagId: event.target.value })}><option value="">Select tag</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
        <label className="text-xs text-neutral-400">Provider<select className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" value={ruleDraft.sourceId} onChange={event => setRuleDraft({ ...ruleDraft, sourceId: event.target.value })}><option value="">Select provider</option>{sources.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs text-neutral-400">Direction<select className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" value={ruleDraft.direction} onChange={event => setRuleDraft({ ...ruleDraft, direction: event.target.value as TagRuleDraft["direction"] })}><option value="outflow">Outflow</option><option value="inflow">Inflow</option></select></label>
        <label className="text-xs text-neutral-400">Match mode<select className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" value={ruleDraft.matchMode} onChange={event => setRuleDraft({ ...ruleDraft, matchMode: event.target.value as TagRuleDraft["matchMode"] })}>{matchModeOptions.map(mode => <option key={mode} value={mode}>{titleCase(mode)}</option>)}</select></label>
        <label className="text-xs text-neutral-400 sm:col-span-2">Description match<input className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm disabled:opacity-50" disabled={ruleDraft.matchMode === "all"} value={ruleDraft.matchMode === "all" ? "*" : ruleDraft.description} onChange={event => setRuleDraft({ ...ruleDraft, description: event.target.value })} maxLength={200} /></label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:opacity-50" disabled={!ruleDraft.tagId || !ruleDraft.sourceId || (ruleDraft.matchMode !== "all" && !ruleDraft.description.trim()) || savingKey === "save-tag-rule"} onClick={() => saveRule(ruleDraft)}>{ruleDraft.ruleId ? "Update rule" : "Create rule"}</button>{ruleDraft.ruleId ? <button className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800" onClick={() => setRuleDraft(emptyDraft)}>Cancel edit</button> : null}</div>
      </div>
      {!loading && rules.length === 0 ? <p className="mt-5 text-sm text-neutral-500">No automatic tag rules yet.</p> : null}
      {rules.length > 0 ? <div className="mt-5 overflow-x-auto rounded-2xl border border-neutral-800"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500"><tr><th className="px-4 py-3">Tag</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Direction</th><th className="px-4 py-3">Match</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-neutral-800">{rules.map(rule => <tr key={rule.id}><td className="px-4 py-3 text-sky-200">{rule.tagName}</td><td className="px-4 py-3 text-neutral-400">{rule.sourceName}</td><td className="px-4 py-3 text-neutral-400">{titleCase(rule.direction)}</td><td className="px-4 py-3">{titleCase(rule.matchMode)}: {rule.normalizedDescription}</td><td className="px-4 py-3 text-right"><button className="mr-2 text-neutral-300 hover:text-white" onClick={() => setRuleDraft({ ruleId: rule.id, tagId: String(rule.tagId), sourceId: String(rule.sourceId), description: rule.matchMode === "all" ? "" : rule.normalizedDescription, matchMode: rule.matchMode, direction: rule.direction })}>Edit</button><button className="text-red-300 hover:text-red-200" onClick={() => deleteRule(rule)}>Delete</button></td></tr>)}</tbody></table></div> : null}
    </section>
  </>;
}
