# submitSelfManualInAndOut

**Task:** Submit Manual In and Out when there is no existing value

**Tags:** Attendance, manual-in-out, phase 3, Dinethya

**Status:** live

## Description

Submits a Manual In and Out for the logged-in employee (self) on a Regularize-tab day of My Manual In and Out. Valid Swipes days belong to editSelfManualInAndOut, Off Shifts days to submitSelfOffShifts.

1. Run dateFormat first; pass every date in that format. To show one tab's dates (Regularize, Pending, Valid Swipes, Off Shifts), call with showTab. For a date range pass fromDate/toDate without date; for rosters, showRosters:true.
2. Ask the user for the date and call with it alone. Show the returned shiftDetails to the user.
3. Ask for the In (date+time), the Out (date+time) or both - one is enough - and the reason. Breaks optional (breaks list).
4. validationError: show it, ask for missingFields - not a failure. pending: relay and stop. wrongTab: call useTool with the same date.
5. Call without confirmed first; show the preview. On yes: confirmed:true + previewToken. Several days: others in otherEntries, preview all first. On success no status.

## Signature

```
submitSelfManualInAndOut
```

## Arguments

_None._


## Advanced arguments

- `showTab` (string, optional) — Set when the user asks to see the dates on one tab of the Manual In and Out screen - e.g. 'what are the dates in the pending tab'. Pass the tab name as the user says it: Regularize, Pending, Valid Swipes or Off Shifts. No date is needed (the team and admin tools still need the employee). Returns only that tab's dates and submits nothing - show the dates as returned.
- `date` (string, optional) — Date the manual In and Out is being added for. Use the format returned by the dateFormat tool (MM/DD/YYYY for en-US, otherwise DD/MM/YYYY). Ask the user for this if not provided. Leave it out only when the user just wants to see their records for a date range (pass fromDate/toDate) or the roster list (showRosters). Also call with the date when the user asks for the status of a pending request on that date - for a Pending day the tool returns the status, what was requested (old -> new In/Out and break times), the comment and who it is waiting for (pendingRequest); show that as returned.
- `inDate` (string, optional) — In date, in the format returned by the dateFormat tool. Give it with inTime when the user is giving the In. The screen submits an In on its own, an Out on its own, or both, so one side is enough - ask the user which they want to give and never insist on the other. Offer suggested.inDate as the default; never assume it.
- `inTime` (string, optional) — In time in HH:mm 24-hour format, e.g. 08:30. Give it with inDate when the user is giving the In; leave both out for an Out-only entry. Offer suggested.inTime as the default.
- `outDate` (string, optional) — Out date, in the format returned by the dateFormat tool. Give it with outTime when the user is giving the Out; leave both out for an In-only entry. An Out Date on the day AFTER the In Date is normal for shifts past midnight (shiftDetails.canEndNextDay) - never question it. Offer suggested.outDate as the default.
- `outTime` (string, optional) — Out time in HH:mm 24-hour format, e.g. 17:30. Give it with outDate when the user is giving the Out. Check it against outDate, not against inTime. Offer suggested.outTime as the default.
- `reason` (string, optional) — Reason/comment explaining why the manual In and Out is being added. Required before the record is submitted.
- `otherEntries` (array, optional) — When the user asks for several days in one request, pass on every call the OTHER days of that request that are not submitted yet, each with the values the user gave. The screen submits such days together and refuses all of them when two overlap across midnight, so the tool checks the overlap in each day's preview. Preview every day first; submit none until all previews passed.
- `confirmed` (boolean, optional) — Set to true, together with previewToken, only after the user has reviewed the preview and explicitly confirmed. Set to false (or omit) to just preview/validate without submitting anything. Never send it on the first call - the tool validates and returns the preview first.
- `previewToken` (string, optional) — The previewToken from the preview the user confirmed. Required with confirmed:true. Without it, or if any value changed since that preview, nothing is submitted and the preview is returned again - show it and ask for confirmation.
- `breaks` (array, optional) — Optional breaks - none, one or as many as the user wants. After showing the shift details, tell the user they can add breaks, but do not insist. Each break needs both times, must end after it starts, must sit within the In and Out date-times and the shift's allowed period, and must not overlap another break of the day (shiftDetails.recordedBreaks lists the ones already recorded). A break after midnight is fine on a shift whose period reaches there.
- `breakInTime` (string, optional) — Single-break shorthand: break start time in HH:mm. Prefer the breaks list. If given, breakOutTime must be given too.
- `breakOutTime` (string, optional) — Single-break shorthand: break end time in HH:mm. Prefer the breaks list. If given, breakInTime must be given too.
- `dateSelectMode` (unknown type, optional) — Search Criteria date selection mode, matching the page radio buttons: last7days (Last 7 Days), last30days (Last 30 Days), period (By Period, uses fromDate/toDate). Defaults to period with a wide range.
- `fromDate` (string, optional) — Search range start date in the format returned by the dateFormat tool. Only used when dateSelectMode is period. Pass it (with toDate) when the user asks to see their manual In and Out records for a date range. If omitted, a wide default range is used. When date is given it must fall inside the range.
- `toDate` (string, optional) — Search range end date in the format returned by the dateFormat tool. Only used when dateSelectMode is period. Pass it (with fromDate) when the user asks to see their manual In and Out records for a date range. If omitted, a wide default range is used. When date is given it must fall inside the range.
- `isGroupByEmployee` (boolean, optional) — Optional Group By Employee checkbox on the Search Criteria panel. Omit it to use the screen's own default.
- `showRosters` (boolean, optional) — Set to true when the user asks to see the roster details. Returns every roster group with its rosters (or only the group named in rosterGroup) and submits nothing. No date is needed.
- `rosterGroup` (string, optional) — Optional roster group, by id or name, exactly as listed by showRosters. Omit it to use the screen's first roster group. Do not ask the user for it unless they want a specific roster.
- `rosterCode` (string, optional) — Optional roster code, as listed by showRosters. Takes precedence over rosterName. Omit it to use the first roster of the roster group, as the screen does.
- `rosterName` (string, optional) — Optional roster name, as listed by showRosters. Resolved to a roster code within the roster group. Ignored when rosterCode is given.


## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`)
