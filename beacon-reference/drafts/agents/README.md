# Agent prompt drafts - benefit attachments (2026-10-11)

Paste each `prompt.md` over the agent's **Prompt** in Beacon Agent Studio:

- `benefitmanagement/prompt.md` -> BenefitManagement agent
- `mao/prompt.md` -> MAO agent

Base: the prompts as exported from Beacon on 2026-10-11 (last edited there
2026-09-30). Only attachment handling changed; everything else is word for word.

## Why "add this attachment as well" with a file got "please upload it"

1. **MAO answered by itself.** MAO has no tools and no rule sending a benefit
   follow-up that carries a file to BenefitManagement. Its leave-attachment rule
   ("Please attach it ... front-end upload component") was applied instead. Its
   "Benefit Management Note" also told it to call benefit tools it doesn't have.
2. **BenefitManagement contradicted itself.** "add this attachment" was a
   *replacement* trigger, "uploaded a new document" meant `replaceAttachments:
   true`, a new application meant `replaceAttachments: false`, removing files
   was never covered, and one section was copied from the leave agent.

## What changed

**MAO**
- Leave attachment rule is scoped to leave applications only.
- New rule 5: once a benefit application has started, every follow-up (a file,
  "add this as well", replace, remove, field changes, "yes"/"submit") goes
  straight to `callBenefitManagementAgent` with the message unchanged.
- The "Benefit Management Note" now says to route, not to call benefit tools.

**BenefitManagement**
- `collectChatAttachment` steps kept as in the live prompt (call it first, then
  the application tool).
- One attachment table used everywhere: add = no flag, replace =
  `replaceAttachments: true`, replace one named file / remove =
  `removeAttachments`, kept on every later call.
- Sticky context now includes `removeAttachments`, `totalRequest` and the team
  member.
- Leave wording is replaced with benefit wording.

## MAO sub-agent description (MAO settings, BenefitManagement entry)

MAO routes partly on each sub-agent's description. The BenefitManagement entry is
just "Hit this agent for any queries related to benefit management". Replace it
with:

> Hit this agent for any queries related to benefit management, including every
> follow-up during a benefit application: adding, replacing or removing an
> attachment (with or without a file), changing a field, the date or the Total
> Request, and confirming or submitting.

## Why replacement worked but adding did not

MAO's "Benefit Management Note" listed only replacement phrases ("Change the
attachment", "Replace the uploaded document" ...). MAO has no tools, so acting on
them meant handing the message to BenefitManagement, whose tool then read the
file with `getUploadedBaoFiles()`. "Add this attachment as well" matched no rule
and no module, so MAO answered itself, with no tool call and no Agent Trace. The
note now uses the same structure for adding, replacing and removing.

## collectChatAttachment (kept in the BenefitManagement prompt)

The BenefitManagement draft keeps every `collectChatAttachment` step exactly as
in the live prompt: "1. Call `collectChatAttachment` (fileSelection: 0 or
latest) — ALWAYS", then the application tool. It checks the files the user has
just added to the chat and saves them in shared data
(`peoplesHRChatAttachments`, `peoplesHRSelectedAttachment`). The benefit tools
read that data, count those files as attached in the current message, and
upload them.

It stays unassigned to any agent, as it is in Beacon today; only the two
benefit tools use what it saves. No change is needed for it.

## Why Lexi asked "confirm by saying proceed or yes" before adding a file

Both live prompts carry a rule written for leave applications: "Ask once: ...
Please attach it, then confirm to proceed" and "Once the user responds with
proceed / yes ... call the tool". With no rule for *adding* a benefit file, the
agent followed that pattern: it said the file "may have been uploaded via the
front-end upload component", waited for "yes", and only then called the tool,
which is why the upload happened on "yes".

Added to the drafts:
- BenefitManagement, ABSOLUTE RULE: **No confirmation before uploading.** The
  tool uploads every file in the message in that same call (UploadAttachment ->
  GetAttachments per file, as on the screen). "Yes" is only for submitting.
  The reply from the screenshot is listed as forbidden.
- BenefitManagement, section 3 ("Strict Turn-by-Turn"): applies only when the
  tool reports a required attachment is missing, never to a message carrying a
  file.
- MAO, Benefit Management Note, point 5: never ask for "proceed"/"yes" before
  a file is added.
