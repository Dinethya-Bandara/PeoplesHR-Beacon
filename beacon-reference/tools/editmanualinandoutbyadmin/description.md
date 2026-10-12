# editManualInAndOutByAdmin

**Task:** Edit Manual In and Out entries by an Admin on behalf of an employee.

**Tags:** Attendance, manual-in-out, phase 3, Dinethya

**Status:** live

## Description

Edits a recorded Manual In and Out of any employee the admin can access, on the Valid Swipes tab. Call it when the user asks to change an employee's manual In and Out or check-in/out, or on useTool editManualInAndOutByAdmin.

1. Run dateFormat first. To list one tab's dates, call with showTab. Ask which employee (number or name) and the date, then call with only those; if several match, ask which.
2. Show the returned shiftDetails and the recorded In/Out and breaks.
3. Ask which to change: the In (date+time), the Out or both - one is enough (fieldsToEdit) - then the new values and reason. Breaks optional; breakNo changes one. Remove a time: clearInTime/clearOutTime; delete breaks: deleteBreaks.
4. validationError: show it, ask for missingFields - not a failure. pending: show it and stop. wrongTab: call useTool with the same employee and date.
5. Call without confirmed first; show the preview. On yes: confirmed:true + previewToken. Several days: others in otherEntries, preview all first. On success no status.

## Signature

```
editManualInAndOutByAdmin
```

## Arguments

_None._


## Advanced arguments

- `showTab` (string, optional) — Set when the user asks to see the dates on one tab of the Manual In and Out screen - e.g. 'what are the dates in the pending tab'. Pass the tab name as the user says it: Regularize, Pending, Valid Swipes or Off Shifts. No date is needed (the team and admin tools still need the employee). Returns only that tab's dates and submits nothing - show the dates as returned.
- `employeeNumber` (string, optional) — The employee's number, e.g. 000006. Leading zeros are optional. Either employeeNumber or employeeName must be given - ask the user which employee if neither is known (e.g. from "submit manual in and out for <name>").
- `employeeName` (string, optional) — The employee's name, full or partial. Either employeeNumber or employeeName must be given. If it matches more than one person the tool returns candidates - ask the user which one, never pick.
- `date` (string, optional) — The day of the recorded manual In and Out to edit, in the format returned by the dateFormat tool (MM/DD/YYYY for en-US, otherwise DD/MM/YYYY). Ask the user for it, then call the tool straight away with the employee and the date alone - the tool checks which tab the day is on and returns the shift details and what is recorded before anything else is asked. Also call with the date when the user asks for the status of a pending request on that date - for a Pending day the tool returns the status, what was requested (old -> new In/Out and break times), the comment and who it is waiting for (pendingRequest); show that as returned.
- `fieldsToEdit` (array, optional) — What the user wants to change. After showing the recorded In and Out (the tool lists them under editableFields), ask the user which they want to edit - In Date, In Time, Out Date or Out Time, one or more - and pass their choice here. The tool then asks for the new values of only those. Fields not chosen keep their recorded values.
- `inDate` (string, optional) — In date, in the format returned by the dateFormat tool. Give it with inTime when the user is giving the In. The screen submits an In on its own, an Out on its own, or both, so one side is enough - ask the user which they want to give and never insist on the other. Offer suggested.inDate as the default; never assume it.
- `inTime` (string, optional) — In time in HH:mm 24-hour format, e.g. 08:30. Give it with inDate when the user is giving the In; leave both out for an Out-only entry. Offer suggested.inTime as the default.
- `outDate` (string, optional) — Out date, in the format returned by the dateFormat tool. Give it with outTime when the user is giving the Out; leave both out for an In-only entry. An Out Date on the day AFTER the In Date is normal for shifts past midnight (shiftDetails.canEndNextDay) - never question it. Offer suggested.outDate as the default.
- `outTime` (string, optional) — Out time in HH:mm 24-hour format, e.g. 17:30. Give it with outDate when the user is giving the Out. Check it against outDate, not against inTime. Offer suggested.outTime as the default.
- `clearInTime` (boolean, optional) — Set to true when the user wants to remove (clear) the recorded In time, as the Valid Swipes grid allows - e.g. 'delete my in time for 05/11/2024'. Do not also give inTime. Needs a reason; the day is submitted with the In empty.
- `clearOutTime` (boolean, optional) — Set to true when the user wants to remove (clear) the recorded Out time. Do not also give outTime. Can be combined with clearInTime to clear both. Needs a reason.
- `deleteBreaks` (array, optional) — Numbers (breakNo, from shiftDetails.recordedBreaks) of the recorded breaks the user wants to delete - e.g. [1]. Deleting breaks alone is a valid edit; it needs a reason. Do not also change the same break in breaks.
- `reason` (string, optional) — Reason/comment explaining why the manual In and Out is being changed. Required before the update is submitted.
- `breaks` (array, optional) — Optional breaks - none, one or as many as the user wants. After showing the shift details, tell the user they can add breaks or change a recorded one (by breakNo), but do not insist. Each break needs both times and must sit within the In and Out date-times and the shift's allowed period (shiftDetails.recordedBreaks lists the ones already recorded). A break after midnight is fine on a shift whose period reaches there.
- `breakInTime` (string, optional) — Single-break shorthand: break start time in HH:mm. Prefer the breaks list. If given, breakOutTime must be given too.
- `breakOutTime` (string, optional) — Single-break shorthand: break end time in HH:mm. Prefer the breaks list. If given, breakInTime must be given too.
- `otherEntries` (array, optional) — When the user asks for several days in one request, pass on every call the OTHER days of that request that are not submitted yet, each with the values the user gave. The screen submits such days together and refuses all of them when two overlap across midnight, so the tool checks the overlap in each day's preview. Preview every day first; submit none until all previews passed.
- `confirmed` (boolean, optional) — Set to true, together with previewToken, only after the user has reviewed the preview (it names the employee) and explicitly confirmed. Set to false (or omit) to preview/validate without updating anything. Never send it on the first call - the tool validates and returns the preview first.
- `previewToken` (string, optional) — The previewToken from the preview the user confirmed. Required with confirmed:true. Without it, or if any value changed since that preview, nothing is submitted and the preview is returned again - show it and ask for confirmation.
- `isGroupByEmployee` (boolean, optional) — Optional Group By Employee checkbox on the Search Criteria panel. Omit it to use the screen's own default.
- `rosterGroup` (string, optional) — Optional roster group, by id or name. Omit it to use the screen's first roster group. Do not ask the user for it unless they want a specific roster.
- `rosterCode` (string, optional) — Optional roster code. Takes precedence over rosterName. Omit it to use the first roster of the roster group, as the screen does.
- `rosterName` (string, optional) — Optional roster name. Resolved to a roster code within the roster group. Ignored when rosterCode is given.


## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`)
