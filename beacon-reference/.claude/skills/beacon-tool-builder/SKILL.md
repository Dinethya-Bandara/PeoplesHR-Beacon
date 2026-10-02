---
name: beacon-tool-builder
description: Draft a new Beacon Agent Studio tool (fetcher/transformer/source/arguments/description), or extend an existing one, following the conventions mined from beacon-reference/. Use when the user wants to create, scaffold, draft, or modify a PeoplesHR/Beacon tool.
---

# Beacon tool builder

`beacon-reference/` (this repo) is a **read-only, auto-generated mirror**
exported from Beacon Agent Studio by `npm run beacon:export` (see the root
`README.md`). There is no known API to push a tool back into Beacon — every
new or edited tool must be authored as a local draft, reviewed with the
user, then pasted by hand into Beacon's UI tabs. Never claim to have
"created" or "saved" a tool in Beacon itself.

## Before writing anything

1. **Never hand-edit `tools/<slug>/`, `functions/<slug>/`, or
   `agents/<slug>/`.** Those folders are overwritten on the next export.
   Put new/draft work under `drafts/<slug>/` at the repo root instead
   (create it if missing), using the exact same file shape as a real
   tool folder. If the user is asking to *modify* a tool that already
   exists in Beacon, draft the change in `drafts/<slug>/` too and tell
   them which tab(s) changed — don't touch the exported copy.
2. **Find the closest existing analog before inventing anything.** Search
   `tool-index.json` (and `function-index.json`) for a tool against the
   same PeoplesHR module/screen, or the same CRUD shape (create / get-detail
   / search-list / edit-update). Read that tool's full folder — `tool.json`,
   `description.md`, `arguments.json`, `fetcher.js`, `transformer.js`,
   `source.js` — as the template. Do not improvise a different structure.
3. **Reuse existing Beacon Functions.** Check `function-index.json` for a
   function that already does what you need (e.g. `getApiList`,
   `getEIMApii`, `updateUrlParams`) and call it via
   `BeaconBar.executeFunction("name")(...)` rather than writing raw
   `fetch`/`DOMParser` scraping logic from scratch.
4. Skim `TOOL_PATTERNS.md` for the recurring idioms (permission checks,
   argument validation, date formatting, pagination) so new code matches
   house style.

## The standard tool shape

- **`fetcher.js`** — almost always the no-op stub every existing tool uses:
  ```js
  (function (args, reqOptions) {
    return {
      code: `(function(){
          return [];
        })`
    };
  })
  ```
  Only deviate if an analog tool for the same screen already does something
  different.

- **`transformer.js`** — `(async function (data, args, reqOptions) { ... })`
  is where the real work happens. Recurring shape, in order:
  1. Optional permission gate:
     `if (!BeaconBar.user.metaData.menus.includes("EIM/Screen.aspx")) return "You do not have access to <Screen> screen. Please contact HR Admin.";`
  2. Required-argument checks that **return a plain string**, not throw:
     `if (!args.someField) return "Error: someField is required";`
  3. Fetch WebForms view state via `BeaconBar.executeFunction("getApiList")("ModuleName")`.
  4. For **create**: open the "New" form (`ctl00$body$butNew: "New"`), then
     post the field values plus `ctl00$body$butSave: "Save"`.
  5. For **get/search/edit**: post a `ContentSearch` (cboCriteria/txtContent/
     butSearch), find the matching grid row (`tr[id^='ctl00_body_grdsummary_ctl00__']`),
     extract its `__doPostBack('...')` target, postback into the detail
     view, then (for edit) resubmit with updated fields and `butSave`.
  6. Parse the resulting HTML with `DOMParser` and pull fields back out with
     `doc.querySelector("#ctl00_body_txtX")?.value?.trim() || ""`.
  7. Boilerplate constants to copy verbatim unless the target screen differs:
     `scrollLeft: "0"`, `scrollTop: "0"`, `__EVENTTARGET`, `__EVENTARGUMENT`,
     `__VIEWSTATEENCRYPTED: ""`, `ctl00$hdnDateFormat: "dd/mm/yy"`.

- **`source.js`** — usually the stub every existing tool uses:
  ```js
  (function(data, args, reqOptions) {
    return [
      { url: "", title: "", subTitle: "", icon: "" }
    ];
  })
  ```
  Only customize if the chosen analog tool does.

- **`arguments.json`** / **`description.md`** / **`tool.json`** — metadata
  mirroring exactly the args referenced in `transformer.js`. Argument
  `name` fields are literal ASP.NET control IDs from the target screen
  (e.g. `ctl00$body$txtName`) — ask the user for the real control IDs if
  no existing tool already covers that screen; don't guess them. For a
  draft `tool.json`, leave `id`, `contentHash`, and timestamps out or
  clearly marked `"DRAFT"` — those are assigned by Beacon on save, not by
  us.

- **Tool description: 1024-character hard limit.** Beacon's Basic Details
  "Description" field rejects/truncates anything longer (confirmed
  2026-09-12). Always check `tool.json`'s top-level `description` (which
  `description.md`'s own "## Description" section should mirror exactly,
  since that's what gets pasted into Beacon) with a character count before
  handing a draft over — `node -e "console.log(str.length)"` or equivalent.
  If the full reasoning for *why* the tool behaves a certain way doesn't
  fit, keep the description itself short and directive (what to call and
  when), and move the fuller narrative into a separate section of
  `description.md` (e.g. "Why this change" / an evidence section) — never
  let the longer version leak into what actually gets pasted into Beacon.

## Arguments — always the bare JSON Schema shape

**Every draft tool's arguments — not just write/mutation tools — should be
authored as Advanced Arguments, in the bare JSON Schema shape below**
(confirmed 2026-09-12: even a pure read/list tool like
`getTrainingCalendarCourseDetails` was converted from Basic Arguments to
this shape on request). Default to this for every new or edited draft
unless the user says otherwise.

Write tools (apply, save, submit, nominate, cancel, ...) especially need
**advanced arguments**, not plain ones — confirmed from real, live tools
(`tools/selfemployeeleaveapplication`, `tools/employeeleaveapplication`).

**Two different shapes exist for this - do not confuse them:**

1. **`tools/<slug>/arguments.json`** (what `npm run beacon:export` writes
   back for an *already-saved* Beacon tool) uses a bookkeeping wrapper:
   `"arguments": []`, everything under `"advancedArguments"` as an array
   of `{name, type, required, defaultValue, description, advanced: true,
   raw: {...}}` objects. This is Beacon's own internal representation,
   reconstructed by the exporter - it is **not** what gets typed into the
   UI, and a *draft* should not use this shape.
2. **`drafts/<slug>/arguments.json`** (what you author before anything is
   pasted into Beacon) must instead be the **bare JSON Schema itself** -
   exactly and only what gets copied and pasted directly into Beacon
   Studio's Advanced Arguments tab as raw text:
   ```json
   { "type": "object", "properties": { "leaveTypeCode": {...}, ... }, "required": ["leaveTypeCode", ...] }
   ```
   No wrapper, no `arguments`/`advancedArguments` split, no per-field
   `name`/`required`/`defaultValue`/`advanced`/`raw` bookkeeping duplicating
   the same description twice - just `type`/`properties`/`required` at the
   top level, with each property a flat JSON-Schema fragment (`type`,
   `description`, and optionally `enum`/`pattern`/nested
   `array`/`object` with their own `properties`/`required`). This was a
   real, confirmed correction (2026-09-08) - an earlier draft used the
   wrapper shape and had to be rewritten to the bare schema because it
   isn't copy-paste-ready.
3. `tool.json`'s `signature` in a draft: `"args": []`, `"isAdvanced": true`,
   `"advancedArgs"` is just `arguments.json`'s content, stringified
   (`JSON.stringify(argumentsJsonContent, null, 2)`) - no separate
   reconstruction needed since `arguments.json` already *is* the schema.

- The **`description` text on every property is agent-facing instruction,
  not documentation** — it tells the LLM how to obtain or when to ask for
  the value. Recurring patterns worth copying:
  - *Resolve, don't ask*: `"To get the leave type code, use 'selfEmployeeLeaveBalance' API... Do not ask the user for leave type code directly."`
  - *Submit first, retry only if the live API demands it*: `"Do not ask for comment upfront. Submit first. If SaveLeaveApplication API returns 'Please specify the Comment', then ask the user for comment and retry."` — only use this pattern for a field that is genuinely *conditionally* required; if a field is unconditionally required (confirmed by testing it blank and getting a rejection), put it in `required` and collect it upfront instead - don't defer something that's always mandatory.
  - *Which numeric/enum value maps to which user-facing label*, spelled out explicitly so the agent never surfaces raw codes to the user.
- `advanced-arguments-template.json` in this skill folder is the full
  reference example (from a real, live tool's *exported* `advancedArgs`
  content) - it's already in the bare-schema shape, so treat it as the
  direct template for a draft's `arguments.json`.
- Every field's actual requiredness must come from real evidence (a
  blank-value test causing a specific rejection message), never assumed -
  see how `drafts/supervisoremployeetrainingnomination`'s `description.md`
  documents exactly which of its narrative fields were confirmed
  mandatory one at a time.

## After drafting

Write the draft folder, then tell the user plainly which content goes into
which Beacon Agent Studio tab (Basic Details, Arguments, Fetcher,
Transformer, Source, Test) so they can paste it in by hand. Suggest they
run `npm run beacon:export -- --tool "<name>"` afterward to pull the
real, Beacon-assigned copy into `tools/<slug>/` once it's saved there.
