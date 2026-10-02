# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is **not a codebase to build or run** — it's an auto-generated,
read-only mirror of PeoplesHR "Beacon Agent Studio" agents/tools/functions,
produced by the sibling `beacon-exporter` project (one level up) via
`npm run beacon:export`. There is no package.json, build step, linter, or
test suite *in this repo*; all tooling lives in the parent `beacon-exporter/`
project (`src/discovery`, `src/beacon`, `src/export`, `src/security`,
`src/cli`, tested with `vitest` / `npm test` from there).

To refresh this data (only needed if it's gone stale), run from the parent
`beacon-exporter/` directory:

```bash
npm run beacon:discover                    # one-time / when Beacon's UI or auth changes
npm run beacon:export                      # full sync
npm run beacon:export -- --changed-only    # fast incremental sync
npm run beacon:export -- --tool "<name>"   # sync one tool
npm run beacon:export -- --agent "<name>"  # sync tools for one agent
npm run beacon:validate                    # verify completeness -> validation-report.json
```

**Never hand-edit anything under `tools/`, `agents/`, or `functions/`** —
the next export overwrites it silently. Durable notes belong in this file
or `README.md`; `TOOL_PATTERNS.md` is also regenerated on every export.

## Layout

- `tool-index.json` / `function-index.json` — flat, low-token indexes
  (name, short description, tags, `peoplesHrModule`, argument names, path,
  content hash) for finding a tool/function without opening its folder.
  **Always start here** before reading full implementations.
- `manifest.json` — sync state per tool/agent/function (content hash,
  timestamps, `active`/`missing`/`archived`).
- `TOOL_PATTERNS.md` — recurring implementation idioms auto-mined from the
  export (permission checks, auth headers, request construction, argument
  validation, date formatting, pagination, error handling, response shaping).
- `last-export-report.json` / `validation-report.json` — counts from the
  most recent export/validate run (discovered vs. exported vs. failed vs.
  missing sections).
- `agents/<agent-slug>/` — `agent.json` (id, name, description, the
  agent's full system `prompt`) + `tools.json`, a **reference list**
  (`toolId`, `toolName`, `path`) of tools assigned to that agent. Tool code
  is never duplicated here.
- `tools/<tool-slug>/` — one folder per Beacon tool:
  - `tool.json` — full metadata, including `raw.signature.args` and the raw
    `fetcher`/`transformer`/`sourceConstructor` strings as Beacon stores them.
  - `description.md` — human-readable name/task/description/signature/arguments.
  - `arguments.json` — arguments + advanced arguments (types/required/defaults).
  - `fetcher.js`, `transformer.js`, `source.js` — code exactly as returned by Beacon.
  - `test.json` — test configuration (secrets redacted).
- `functions/<function-slug>/` — a named JS snippet invoked from tool code
  via `BeaconBar.executeFunction("name")(...)`:
  - `function.json` — id, name, status, timestamps, content hash.
  - `code.js` — code exactly as returned by Beacon.

## The Beacon tool architecture (why tools look the way they do)

Every tool is a small ASP.NET WebForms automation, not a REST client. The
architecture only makes sense once you've read `transformer.js` +
`fetcher.js` + `source.js` together for one tool:

- **`fetcher.js`** is almost always an inert stub returning
  `{ code: "(function(){ return []; })" }` — it exists in Beacon's schema
  but does no real work in this org's tools.
- **`transformer.js`** — `(async function (data, args, reqOptions) {...})`
  — does the actual work by driving a PeoplesHR EIM screen exactly like a
  browser would: fetch the screen's `__VIEWSTATE`/`__EVENTVALIDATION`, POST
  form fields keyed by literal ASP.NET control IDs (e.g.
  `ctl00$body$txtName`), and scrape the HTML response back out with
  `DOMParser`. Common flows: **create** = open "New" form → POST fields +
  `butSave`; **get/search** = POST a `ContentSearch` → find the matching
  `<tr>` in the results grid → follow its `__doPostBack` target into the
  detail view; **edit** = same search-and-postback, then resubmit with
  changed fields.
- **`source.js`** builds the search-result card (`url`/`title`/`subTitle`/`icon`)
  shown in Beacon's UI; usually a stub with empty strings.
- Cross-tool shared logic (session/view-state fetching, generic API list
  calls, employee/EIM lookups, etc.) lives in `functions/` and is called
  from a tool's `transformer.js` via `BeaconBar.executeFunction("name")(...)`
  rather than being duplicated per tool — check `function-index.json` before
  assuming a tool re-implements something from scratch.
- Agents (`agents/<slug>/agent.json`) are just a system prompt + a curated
  list of tool references; they contain no code of their own.

See `TOOL_PATTERNS.md` for a concrete, auto-updated catalogue of these
idioms with file:line-style examples pulled straight from the export.

## Permission gate (every tool that drives a screen)

Check access to the screen the tool drives before any request, always in
this form:

```js
if (
  !BeaconBar.user?.metaData?.menus?.some(menu =>
    menu.includes("Benefitv9/Application/Application/?mode=0&mvc=1")
  )
) {
  return { error: true, message: "You do not have access to apply for Benefit - Team screen. Please contact HR Admin." };
}
```

- **Spell the menu path exactly as PeoplesHR spells it, capitals included.**
  `menu.includes(...)` is case-sensitive: the menu entry reads
  `../Benefitv9/Application/Application/?mode=0&mvc=1&bs=4&digest=...`, so a
  lowercased needle matches nothing and refuses every user. This is not
  hypothetical - `myTeamBenefitApplication` shipped with
  `"benefitv9/application/application/?mode=0&mvc=1"` and denied everyone.
- **Match the part that identifies the screen, and nothing more.** Include the
  query parameters that separate one screen from its neighbours (`?mode=0`
  for the team benefit screen against `?mvc=1` for the self one); never
  include `digest`, which changes per session.
- **Name the screen in the message**, in the tool's own module - "Benefit -
  Team screen", "Benefit Application screen". A message copied from another
  module ("apply for grievance" in the benefit tools) tells the user nothing
  and hides which tool refused.
- Return `{ error: true, message }` and nothing else from the gate - no
  network call has been made at that point.
## Authoring new/changed Beacon tools

There is no known write-API back into Beacon — a new or edited tool must be
drafted locally, reviewed, and pasted by hand into Beacon Agent Studio's UI
tabs (Basic Details / Arguments / Fetcher / Transformer / Source / Test).
Use the `beacon-tool-builder` skill (`.claude/skills/beacon-tool-builder/`)
for this: it finds the closest existing analog tool/function to copy
conventions from and writes drafts to `drafts/<slug>/`, never into the
auto-generated `tools/`, `agents/`, or `functions/` trees.

Two hard constraints confirmed against the live Beacon UI (full detail and
reasoning in the skill file, not repeated here):

- **Tool description ≤ 1024 characters.** Check `tool.json`'s top-level
  `description` with a character count before handing a draft over — Beacon
  rejects/truncates anything longer.
- **`arguments.json` in a draft is always the bare JSON Schema** (`{"type":
  "object", "properties": {...}, "required": [...]}`), pasted directly into
  Beacon's Advanced Arguments tab — for every draft, not only write/mutation
  tools. Never the exporter's `{arguments: [], advancedArguments: [...]}`
  bookkeeping wrapper seen in `tools/<slug>/arguments.json` — that shape is
  Beacon's own internal representation, not something you type into the UI.
