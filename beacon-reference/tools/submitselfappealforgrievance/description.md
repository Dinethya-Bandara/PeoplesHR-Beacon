# submitSelfAppealForGrievance

**Task:** Submit an Appeal for an Existing Grievance

**Tags:** Grievance, Aloka, phase3

**Status:** live

## Description

Submits an appeal for a grievance the employee has already submitted. originalRecHeadCode, originalEmpNumber, and originalTempHeadCode must come from a prior getMyGrievanceHistory result - never ask the user for these. comment is required and must always be asked of the user. Attachments are optional; if any are attached in the chat, each needs an explicit title and is uploaded individually before Submit, and the whole appeal is refused if any single upload fails. The tool always previews first (channel members and any requested bypasses, comment, hide-identity, attachments) and only actually submits when called again with confirmed:true. DRAFT: the new appeal recHeadCode bootstrap and GetTemplateChannelDetails pageName are best-guess extrapolations from submitMyGrievanceApplication, not yet independently confirmed - see description.md.

## Signature

```
submitSelfAppealForGrievance
```

## Arguments

_None._


## Advanced arguments

- `originalRecHeadCode` (string, required) — The recHeadCode of the grievance being appealed, taken from a getMyGrievanceHistory (or getMyGrievanceHistoryFullDetails) result. Do not ask the user for this - resolve the grievance by name/date first if needed.
- `originalEmpNumber` (string, required) — The (encrypted) empNumber of the grievance being appealed, taken from the same getMyGrievanceHistory result as originalRecHeadCode. Do not ask the user for this.
- `originalTempHeadCode` (string, required) — The tempHeadCode of the grievance being appealed, taken from the same getMyGrievanceHistory result as originalRecHeadCode. Do not ask the user for this.
- `comment` (string, required) — The employee's comment/reason for appealing this grievance. Required - always ask the user for this before submitting.
- `hideIdentity` (boolean, optional) — Set true if the user wants to appeal anonymously, hiding their identity from the channel members handling it. Optional, defaults to false.
- `attachmentTitles` (object, optional) — Only needed when one or more files are attached in the chat: a title for each attached file, keyed by its exact file name (e.g. {"certificate.pdf": "Medical certificate"}). Always ask the user explicitly for a title per file - there is no filename-based default, since the module itself rejects a blank title ('Attachment Title cannot be empty.', confirmed live for this appeal endpoint too). Checked only after the other required fields and the channel member list are already resolved; if any attached file has no matching title here, the tool lists exactly which file(s) still need one and does not proceed to the preview. Before that, any file over 2 MB is rejected immediately - a fast-fail heuristic inherited from the confirmed grievance-side limit, not independently re-confirmed for this specific appeal endpoint. Attachments are then uploaded one file per call, before Submit; if the module rejects any single file for any reason (type, size, or otherwise) at that point, the tool relays that exact message and does not submit the appeal at all.
- `bypassChannelMembers` (array, optional) — Names (or employee numbers) of assigned channel members the user wants to bypass/skip for this appeal, matched against the channel member list this tool previews. Optional - omit to keep every channel member in the escalation chain.
- `confirmed` (boolean, optional) — Set true only after the user has seen the preview this tool returns (channel members and any bypassed ones, comment, hide-identity, attachments) and has explicitly agreed to submit. Omit or set false to preview without submitting anything - this is the default and safe to call repeatedly while the user is still deciding.


## Assigned agents

- Grievance Handling (`6aa374ef10cb7243bb13e6ab`)
