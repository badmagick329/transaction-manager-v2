# AGENT.md

## Scope

- Do **only** what I explicitly ask. No extra refactors, cleanups, drive-by fixes, or “while I’m here” changes.
- If something is ambiguous, ask a single clarifying question. Otherwise, proceed.

## Package Manager

- If the project uses **Bun**, use **Bun** commands only.
- Do **not** use npm.
- Prefer `bun add`, `bun install`, `bun run <script>`, `bun test`.

## Dev Servers

- Do **not** start dev servers (`bun dev`, `npm run dev`, `next dev`, etc.).
- Assume I already have servers running.
- If you need to validate something, prefer unit tests, typecheck, lint, or reasoning from code.

## Statement Imports

- When asked to parse a financial statement, follow `notes/project_notes/statement_import_workflow.md`.

## Response Discipline

Keep answers tightly scoped to the user's actual question.

- Do not add extra framing, justification, or side commentary unless it directly answers the request.
- Do not introduce cautions, alternatives, or edge-case advice unless the user asked for them or they are necessary to avoid a meaningful mistake.
- Prefer short prose over bullets when the question is simple.
- Do not pad responses with reasons why something is good, bad, or sensible unless the user explicitly asks for evaluation.
- Optimize for directness: answer first, stop when the user's question has been satisfied.


## Output Rules

- When proposing commands, give the exact command(s) only.
- When editing files, state:
  - which files changed
  - what changed (1–3 bullets)
- Avoid large rewrites unless requested.

## Safety Checks

- If a change could break runtime behavior or public API, warn me before doing it. But don't be afraid of making breaking changes. Just make sure you notify me.
- Don’t make irreversible changes (migrations, lockfile regen, formatting sweep) unless asked.

## Plan Mode

- Make the plan extremely concise. Sacrifice grammar for the sake of concision.
- At the end of each plan, give me a list of unresolved questions to answer, if any.
