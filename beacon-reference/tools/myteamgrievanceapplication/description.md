# myTeamGrievanceApplication

**Task:** Submit a New Grievance for a subordinate

**Tags:** Grievance, Aloka, phase3

**Status:** live

## Description

Lets a supervisor submit a grievance on behalf of one of their direct subordinates. Resolution order: team member (by name only - never ask for an employee number), template, ground, then summary/description (max 200 characters incl. spaces)/mood, then optional attachments. If no team member is given, or the named person is not a subordinate, the tool returns the team list to choose from; if several match (e.g. two Liams) it returns the matching names to pick from. Channel members for the template are returned in every response once known. Always previews first and only submits when called again with confirmed:true. Attachment size/type limits come from the module and are relayed if a file is rejected.

## Signature

```
myTeamGrievanceApplication
```

## Arguments

_None._


## Advanced arguments

- `employeeName` (string, optional) — Name of the team member (direct subordinate) the grievance is being submitted for, exactly as the supervisor says it - a first name, last name or full name is enough. Never ask the supervisor for an employee number. Resolved first, only against the supervisor's own subordinates. If omitted, or if the person is not one of their subordinates, the tool returns the list of team members to choose from - show it and ask the supervisor to pick by name. If several team members match (e.g. 'Liam' matches Liam Taylor and Liam Hill) the tool returns the matching names - ask which one, then call again with the full name. Call with just this field omitted to discover the team list.
- `employeeDesignation` (string, optional) — Only needed when two team members have the identical name: the designation shown next to each name in the tool's reply (e.g. 'Senior Software Engineer'). Never ask for an employee number.
- `templateName` (string, optional) — The grievance template to submit under, as the supervisor names it. Resolved after the employee. Optional - if only one template is available for that employee it is used automatically; if several are available and none is given, the tool lists them and asks to pick one. Once a template is resolved the tool returns its channel members in every later response.
- `ground` (string, optional) — The grievance ground/category, exactly as the supervisor names it. Resolved after the template. Grounds are single-select and nested one level: a main ground with sublevel grounds is never itself submittable - the supervisor must pick one of its sublevel grounds; qualify as "MainGround.SubGround" if the same sublevel name exists under several main grounds. Do not ask for a code. If unknown or the supervisor asks what grounds exist, call with ground omitted - the tool returns the real list. Never invent example grounds.
- `summary` (string, optional) — A short summary of the grievance. Required to actually submit; omit it (with description and moodRating) when only discovering team members, templates, channel members or grounds.
- `description` (string, optional) — The full description/details of the grievance. Required to actually submit; always ask the supervisor for it before calling with confirmed:true. Maximum 200 characters including spaces - the tool refuses anything longer with a clear message and never truncates, so keep it within 200 characters.
- `hideIdentity` (boolean, optional) — Set true if the identity should be hidden from the channel members who will handle the grievance. Optional, defaults to false.
- `moodRating` (integer, optional) — The employee's current mood/emoji rating, 1 (very unhappy) to 5 (very happy). Required to actually submit; always ask the supervisor for it before calling with confirmed:true.
- `attachmentTitles` (object, optional) — Only needed when files are attached in the chat: a title for each attached file, keyed by its exact file name (e.g. {"certificate.pdf": "Medical certificate"}). Always ask explicitly for a title per file - there is no default, and a blank title is rejected. No size or file-type limit is checked by the tool because both are configured per client: files are uploaded after the supervisor confirms, and if the module rejects a file (size, type or otherwise) the tool relays its exact message and does not submit - tell the supervisor and ask for a different file or to continue without it.
- `bypassChannelMembers` (array, optional) — Names of channel members the supervisor wants to bypass for this grievance, matched against the template's channel member list. Optional. Show the channel member list before they ask to bypass anyone. At least one member must always remain - bypassing everyone is rejected. A name that is not a channel member is rejected with the list to choose from.
- `confirmed` (boolean, optional) — Set true only after the supervisor has seen the preview (employee, template, channel members and bypassed ones, ground, summary, description, hide-identity, mood, attachments) and explicitly agreed to submit. Omit or false to preview without submitting anything.
- `isAudioRecorded` (boolean, required) (default: `false`) — Controls whether audio recording is requested. Send true only when the supervisor explicitly asks to record, capture or save audio. Otherwise always send false. Always include this field.


## Assigned agents

- Grievance Handling (`6aa374ef10cb7243bb13e6ab`)
