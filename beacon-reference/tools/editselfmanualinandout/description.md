# editSelfManualInAndOut

**Task:** Edit Manual In Time and Out Time already submitted

**Tags:** Attendance, manual-in-out, phase 3, Dinethya

**Status:** live

## Description

Edits the logged-in employee's own recorded Manual In and Out (Valid Swipes tab of My Manual In and Out). Regularize days belong to submitSelfManualInAndOut, Off Shifts days to submitSelfOffShifts.

1. Run dateFormat first and pass every date in that format. To show one tab's dates (Regularize, Pending, Valid Swipes, Off Shifts), call with showTab.
2. Ask the user for the date and call with it alone. Show the returned shiftDetails.
3. Ask what to change: the In (date+time), the Out or both - one is enough - then the values and reason. Breaks optional; breakNo changes one. To remove a recorded time use clearInTime/clearOutTime; to delete recorded breaks, deleteBreaks.
4. validationError: show it, ask for missingFields - not a failure. pending: relay and stop. wrongTab: call useTool with the same date. noChanges: ask what should change.
5. Call without confirmed first; show the preview. On yes: confirmed:true + previewToken. Several days: others in otherEntries, preview all first. On success no status.

## Signature

```
editSelfManualInAndOut
```

## Arguments

_None._


## Advanced arguments

- `showTab` (string, optional) — Set when the user asks to see the dates on one tab of the Manual In and Out screen - e.g. 'what are the dates in the pending tab'. Pass the tab name as the user says it: Regularize, Pending, Valid Swipes or Off Shifts. No date is needed (the team and admin tools still need the employee). Returns only that tab's dates and submits nothing - show the dates as returned.
- `date` (string, required) — Date of the existing manual In and Out record to edit. Use the format returned by the dateFormat tool (MM/DD/YYYY for en-US, otherwise DD/MM/YYYY). Ask the user for this if not provided. Also call with the date when the user asks for the status of a pending request on that date - for a Pending day the tool returns the status, what was requested (old -> new In/Out and break times), the comment and who it is waiting for (pendingRequest); show that as returned.
- `inDate` (string, optional) — In date, in the format returned by the dateFormat tool. Give it with inTime when the user is giving the In. The screen submits an In on its own, an Out on its own, or both, so one side is enough - ask the user which they want to give and never insist on the other. Offer suggested.inDate as the default; never assume it.
- `inTime` (string, optional) — In time in HH:mm 24-hour format, e.g. 08:30. Give it with inDate when the user is giving the In; leave both out for an Out-only entry. Offer suggested.inTime as the default.
- `outDate` (string, optional) — Out date, in the format returned by the dateFormat tool. Give it with outTime when the user is giving the Out; leave both out for an In-only entry. An Out Date on the day AFTER the In Date is normal for shifts past midnight (shiftDetails.canEndNextDay) - never question it. Offer suggested.outDate as the default.
- `outTime` (string, optional) — Out time in HH:mm 24-hour format, e.g. 17:30. Give it with outDate when the user is giving the Out. Check it against outDate, not against inTime. Offer suggested.outTime as the default.
- `clearInTime` (boolean, optional) — Set to true when the user wants to remove (clear) the recorded In time, as the Valid Swipes grid allows - e.g. 'delete my in time for 05/11/2024'. Do not also give inTime. Needs a reason; the day is submitted with the In empty.
- `clearOutTime` (boolean, optional) — Set to true when the user wants to remove (clear) the recorded Out time. Do not also give outTime. Can be combined with clearInTime to clear both. Needs a reason.
- `deleteBreaks` (array, optional) — Numbers (breakNo, from shiftDetails.recordedBreaks) of the recorded breaks the user wants to delete - e.g. [1]. Deleting breaks alone is a valid edit; it needs a reason. Do not also change the same break in breaks.
- `reason` (string, optional) — Reason/comment explaining why the manual In and Out is being changed. Required before the update is submitted.
- `otherEntries` (array, optional) — When the user asks for several days in one request, pass on every call the OTHER days of that request that are not submitted yet, each with the values the user gave. The screen submits such days together and refuses all of them when two overlap across midnight, so the tool checks the overlap in each day's preview. Preview every day first; submit none until all previews passed.
- `confirmed` (boolean, optional) — Set to true, together with previewToken, only after the user has reviewed the preview of current vs new values and explicitly confirmed. Set to false (or omit) to just preview/validate without updating anything. Never send it on the first call - the tool validates and returns the preview first.
- `previewToken` (string, optional) — The previewToken from the preview the user confirmed. Required with confirmed:true. Without it, or if any value changed since that preview, nothing is submitted and the preview is returned again - show it and ask for confirmation.
- `breaks` (array, optional) — Optional breaks - none, one or as many as the user wants. After showing the shift details, tell the user they can add breaks or change a recorded one, but do not insist. Each break needs both times, must end after it starts, must sit within the In and Out date-times and the shift's allowed period, and must not overlap another break of the day (shiftDetails.recordedBreaks lists the ones already recorded). A break after midnight is fine on a shift whose period reaches there.
- `breakInTime` (string, optional) — Single-break shorthand: break start time in HH:mm (adds a new break). Prefer the breaks list. If given, breakOutTime must be given too.
- `breakOutTime` (string, optional) — Single-break shorthand: break end time in HH:mm (adds a new break). Prefer the breaks list. If given, breakInTime must be given too.
- `dateSelectMode` (unknown type, optional) — Search Criteria date selection mode, matching the page radio buttons: last7days (Last 7 Days), last30days (Last 30 Days), period (By Period, uses fromDate/toDate). Defaults to period with a wide range.
- `fromDate` (string, optional) — Search range start date in the format returned by the dateFormat tool. Only used when dateSelectMode is period. If omitted, a wide default range is used. The date being edited must fall inside the range.
- `toDate` (string, optional) — Search range end date in the format returned by the dateFormat tool. Only used when dateSelectMode is period. If omitted, a wide default range is used. The date being edited must fall inside the range.
- `isGroupByEmployee` (boolean, optional) — Optional Group By Employee checkbox on the Search Criteria panel. Omit it to use the screen's own default.
- `rosterGroup` (string, optional) — Optional roster group, by id or name, as listed by submitSelfManualInAndOut with showRosters. Omit it to use the screen's first roster group. Do not ask the user for it unless they want a specific roster.
- `rosterCode` (string, optional) — Optional roster code. Takes precedence over rosterName. Omit it to use the first roster of the roster group, as the screen does.
- `rosterName` (string, optional) — Optional roster name. Resolved to a roster code within the roster group. Ignored when rosterCode is given.


## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`)
