# myTeamBenefitApplication

**Task:** Apply for a Team Member's Benefit Application

**Tags:** Benefits, phase3

**Status:** DRAFT (edit of the live tool, pulled from Beacon 2026-10-11)

## Description

Applies for a benefit on behalf of one of the signed-in supervisor's direct subordinates. FIRST ACTION for any request to apply or claim a benefit for someone else ("apply benefit for Liam", "apply a benefit for my subordinate"): call this tool at once, passing just the name or number given, or nothing - write nothing, ask nothing and call no other tool before it (not getGlobalEmployeeSearch, getBenefitEmployeeInformation, getAdminInformationDetails, getApplicationStructure, employeeBenefitApplication or dateFormat). With no name it lists the team; never ask for an employee number. Then call with benefitType omitted to get that employee's own types (show only those), then with fieldValues omitted for the real fields and entitlement - ask only for those. The application date is always required. Always previews first, naming who it is for, and submits only with confirmed:true plus that preview's previewDigest. Each message adding, replacing or removing a chat file is another call to this tool.

## Signature

```
myTeamBenefitApplication
```

## Arguments

_None._


## Advanced arguments

- `employeeNumber` (string, optional) — The team member's employee number, used ONLY when the user volunteers a number themselves. Never ask the user for an employee number, employee ID or staff number, and never look one up with another tool: a name alone is enough, because this tool resolves it against the supervisor's own subordinate list, which already carries every number. If the user gives a name, send employeeName and leave this out. Call with both omitted to get the subordinate list rather than guessing. Anyone who is not a direct subordinate is refused and the team list returned. For the signed-in employee's own benefit application, use selfEmployeeBenefitApllication instead.
- `employeeName` (string, optional) — The team member's name as the user said it - a first name alone (e.g. 'Liam') is fine and is the normal case. As soon as the user names someone, call this tool with that name: do not ask for their employee number, and do not ask any other question first. Never resolve the name with getGlobalEmployeeSearch or any other employee-lookup tool, because those search the whole company while this application may only ever be for one of this supervisor's own direct subordinates. This tool matches the name against that subordinate list itself and, once matched, has everything it needs to identify the employee. If several subordinates match, it returns just those candidates - show the user only those and ask which one, never a wider list of people with that name.
- `benefitType` (string, optional) — The benefit type to apply for, named as the user says it (e.g. 'Medical Claims'). Never ask the user to name a benefit type before you have called this tool, and NEVER offer types from your own knowledge (Health Insurance, Life Insurance, Cash Benefit and the like are not real options here) - the types differ per employee and per company. When the user has not named one, call this tool with benefitType omitted and it returns that employee's own live availableBenefitTypes; show the user exactly that list and ask which one. If the name they give is not on it, or matches more than one, the tool returns the candidates to choose from. Never ask for a code.
- `fieldValues` (object, optional) — For benefit types built from plain fields: the values, keyed by each field's exact displayName from this tool's own discovery response. Call with benefitType set and fieldValues omitted first to get that list with each field's mandatory flag, input type and options, then ask the user only for those fields. Never ask for fields you have imagined (benefit plan, policy number and so on): they differ per benefit type and per employee, and only the discovery response is real. The application date is always required even when it says not-mandatory, because entitlement, utilized amount and the total are all calculated for that date - ask which date rather than assuming today. Entitlement figures belong to the date they were fetched for and to no other: to answer 'what is the entitlement on 2 September', or whenever the user names or changes the date, call this tool again with fieldValues containing just that application date and report the figures it returns. Never carry an entitlement figure across from an earlier date, and never state one without a tool call behind it. Use a dropdown option's text, never a code; dates in the format the discovery response states; amounts as plain numbers; yes/no fields as 'yes' or 'no'. 'Total Request' is the amount Benefit History records; PeoplesHR calculates it from the amount field(s), so leave it out unless the supervisor explicitly wants a different total. Entitlement, Utilized Amount and Balance are never inputs. The Total Request field is one of these: it is editable on the screen, so when the supervisor asks for a particular Total Request, put that figure here under the Total Request field name and leave the amount field(s) exactly as they gave them. It does not have to match the amount, and it must never be refused as "calculated" unless this tool itself says PeoplesHR locks it.
- `rows` (array, optional) — For benefit types claimed as rows (the discovery response sets rowsRequired and lists gridColumns instead of fields): one object per claim row, each keyed by the exact column displayName from that response. Ask the user for one row per claim - e.g. one per bill - and never invent columns. Read-only columns (Department, Entitlement, Utilized Amount and the like) are filled in by PeoplesHR and must not be sent. Each row is validated by PeoplesHR as it is added, and a rejected row stops the application with the reason given.
- `comment` (string, optional) — The applicant comment for this application. Only required when the discovery response's commentMandatory is true - check that rather than always asking. If showComment is false for the resolved benefit type, omit this entirely.
- `confirmed` (boolean, optional) — Set true only after the supervisor has seen the preview this tool returns (the employee it is for, benefit type, every resolved value, entitlement/utilized/balance, the Total Request amount, any balanceWarning, the comment, and any confirmMessage from PeoplesHR) and has explicitly agreed to submit on that employee's behalf. Must be sent together with previewDigest. Omit or set false to preview without submitting - safe to call repeatedly while they are still deciding.
- `previewDigest` (string, optional) — The previewDigest value from the preview response the supervisor actually saw, copied verbatim and sent alongside confirmed:true. It binds the confirmation to those exact figures: if the employee's entitlement or utilized amount has moved since, the tool returns a fresh preview instead of submitting. Never invent or reuse an older value - always copy the one from the most recent preview response.
- `removeAttachments` (array, optional) — File names to leave out of this application, exactly as shown in the preview's attachments list or as attached in the chat. Attachments are never passed as arguments: files the supervisor attaches in the chat are picked up automatically, checked against the benefit type's own allowed file types, maximum size and count, and uploaded when the preview is built. Use this when the supervisor asks to remove an attachment before confirming (it is deleted from the application), or to continue without a file the tool rejected. Keep passing the same list on every later call for this application, including the confirmation - otherwise a removed file still attached in the chat is uploaded again. Attachments cannot be removed after submission.
- `attachmentSessionKey` (string, optional) — The attachmentSessionKey value from this tool's most recent response for this application, copied verbatim. Attachments are staged on PeoplesHR under this key before submission, so it must be sent on every later call for the same application - including the one with confirmed:true - or the staged files will not be found. Leave it out on the first call, and leave it out again if the employee or the benefit type changes.
- `replaceAttachments` (boolean, optional) — Set true when the supervisor wants the file(s) they have just attached in the chat to REPLACE the document(s) already on this application - "change the document to this", "use this one instead", "replace the attachment". The tool then deletes whatever is attached but not re-attached in the chat, uploads the new file(s), and lists what the application ends up with. It is ignored when no usable file is attached, so it can never leave the application with nothing. Leave it out to simply add a file alongside the existing ones.
- `totalRequest` (number, optional) — The Total Request figure, when the supervisor asks for a particular one ("change the total request to 150", "keep the amount as 200 and the total as 150"). The Benefit Application screen lets this figure be typed over: PeoplesHR fills it in from the amount field(s), but whatever it holds at submission is what Benefit History records, and it does NOT have to match the amount. Pass the figure here and leave the amount field(s) in fieldValues exactly as the supervisor gave them - never change an amount to match it, never offer to change the amount instead, and never answer that the two are linked or that the total cannot be changed. Leave this out unless a particular total was asked for. If PeoplesHR locks the figure for that benefit type, this tool says so itself.


## Assigned agents

- BenefitManagement (`690dc571931a2d61ba0b1be9`)

## Changes in this draft (2026-10-11) - multiple attachments

Base: the live tool as pulled from Beacon on 2026-10-11 (full export). The
existing attachment logic in `syncAttachments` is kept and extended in place;
nothing outside attachment handling changed.

Tabs that changed: **Transformer** and **Arguments** (`replaceAttachments` and
`removeAttachments` descriptions only). Basic Details, Fetcher and Source are
unchanged.

Evidence: `Benefit management/New benefit type/Self Benefit Application/Multiple attachments/`
- Adding: `UploadAttachment` then `GetAttachments`, per file, under one key;
  the list grows 1 -> 2 -> 3 (`BetAttachmentId` 0, 1, 2).
- Removing: `DeleteAttachment {fileCode, empNumber, key}`, which answers with
  the files still attached (`BmAppAttachments`).
- Replacing: no call of its own; it's that delete, then an upload.
- Saving: `SaveApplication` has no attachment fields and picks up every staged
  file through `KeyValue` (reference 234: all three).

Seen live: the chat hands a file's contents over only on the call for the
message it was attached to (later calls see `{name, key}`), and PeoplesHR did
not keep files staged by an earlier call.

### What changed

- **Copies.** Every readable file is copied into the page
  (`window.__peoplesHRBenefitAttachments`), per employee + benefit type, and
  the application is re-staged from those copies on every call, the final "yes"
  included. A file attached before the benefit type is chosen is kept too.
- **Add (default).** Every file attached in the conversation is part of the
  application. A file already staged isn't uploaded again.
- **Replace.** Kept as before: a file re-attached under the same name (its
  contents in this message) replaces that one file. `replaceAttachments: true`
  now works across messages: the files of this message replace every earlier
  one, and those stay out.
- **Remove.** `removeAttachments` deletes the file and is remembered, so it
  stays out even if the agent doesn't resend it. Attaching it again brings it
  back.
- `DeleteAttachment`'s returned list confirms each removal, and
  `GetAttachments` runs after every upload, as on the screen.
- Preview adds `attachmentCount` and `attachmentsLeftOut`.
- After a successful submit the copies are dropped and the files marked used,
  so a later application in the same conversation doesn't pick them up.
- If a copy is gone (page reloaded between messages), the file is named and
  the user is asked to attach it again.

### collectChatAttachment (2026-10-11)

The tool reads chat files from two sources: `getUploadedBaoFiles()` and the
files `collectChatAttachment` saves in shared data (`peoplesHRChatAttachments`,
`peoplesHRSelectedAttachment`). Files from `collectChatAttachment` now count
as attached in the current message, the same as `getUploadedBaoFiles()` files.
So they're added, a re-attached same-name file replaces that one file, and
`replaceAttachments: true` replaces the earlier files. Before, a replacement
that arrived only through `collectChatAttachment` was added alongside the old
files instead. Each saved file object is treated as new only the first time
the tool sees it, so a file left in shared data from an earlier message isn't
taken as a new attachment. A file sent before the benefit type (or team member)
is chosen is claimed by the application even after `collectChatAttachment` has
cleared it.

The shared data is now read with `await BeaconBar.getSharedData(...)`.
`collectChatAttachment` writes it with `await setSharedData(...)`, and every
other tool awaits `getSharedData("sl")`. Without the `await`, a Promise-returning
`getSharedData` would hand back no files, so files collected through
`collectChatAttachment` would be ignored silently. Awaiting a plain value is
harmless, so this is safe either way.
