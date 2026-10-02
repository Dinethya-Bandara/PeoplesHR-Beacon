# submitSelfManualInAndOut

**Task:** Submit Manual In and Out when there is no existing value

**Tags:** Attendance, manual-in-out, add, Headers, phase 3

**Status:** live

## Description

Edits an existing Manual In and Out of the logged-in employee (self). Call this whenever the user asks to change, correct, update or edit their own manual In and Out / manual attendance / manual time. Adding a time to a day that has none belongs to submitSelfManualInAndOut.

1. Run dateFormat first and pass the date in that format.
2. When any time is changing, ask separately for the new In Date, In Time, Out Date, Out Time and the reason, and pass all four. Offer suggested.inDate / suggested.outDate as defaults.
3. An Out Date on the day AFTER the In Date is normal - shifts can end after midnight - and the Out time is then earlier on the clock than the In time. Never question that or demand In before Out.
4. Only Valid Swipes rows are editable; locked ones are refused with the reason.
5. Breaks are optional - both times or neither, and a break-only change needs no times or dates.
6. Show the preview; call again with confirmed:true only after the user confirms.

## Signature

```
submitSelfManualInAndOut
```

## Arguments

_None._


## Advanced arguments

- `date` (string, required) — Date of the existing manual in and out record to edit. Use the format returned by the dateFormat tool (MM/DD/YYYY for en-US, otherwise DD/MM/YYYY). Ask the user for this if not provided.
- `inDate` (string, optional) — In date, in the format returned by the dateFormat tool. ALWAYS ask the user for this separately, alongside the Out Date - do not assume it. The tool returns the row's own date under suggested.inDate; offer that as the default and let the user confirm or change it.
- `inTime` (string, optional) — New In time in HH:mm 24-hour format, e.g. 08:30. Whenever a time is being changed, ask the user separately for the In Date, In Time, Out Date and Out Time and pass all four. Omit them all only when the user is changing just the break.
- `outDate` (string, optional) — Out date, in the format returned by the dateFormat tool. ALWAYS ask the user for this separately, alongside the In Date - never decide it yourself. An Out Date on the day AFTER the In Date is normal - many shifts end after midnight - and the Out time is then earlier on the clock than the In time, which is correct and must never be questioned or rejected. The tool reports whether this shift can end on the following day as current.shiftCanEndNextDay, and returns the row's own date under suggested.outDate; offer that as the default and let the user confirm or change it.
- `outTime` (string, optional) — New Out time in HH:mm 24-hour format, e.g. 17:30. Ask for it together with inDate, inTime and outDate. An Out Date on the day AFTER the In Date is normal - many shifts end after midnight - and the Out time is then earlier on the clock than the In time, which is correct and must never be questioned or rejected. Check it against outDate, not against inTime.
- `reason` (string, optional) — Reason/comment explaining why the manual in and out is being changed. Required before the update is submitted. No reason is needed for the break times on their own.
- `confirmed` (boolean, optional) — Set to true only after the user has reviewed the preview of current vs new values and explicitly confirmed. Set to false (or omit) to just preview/validate without updating anything.
- `breakInTime` (string, optional) — Optional break in time in HH:mm 24-hour format. Break times are not mandatory - add them only if the user wants to. If given, breakOutTime must be given too. A break after midnight is fine on a shift whose period reaches there.
- `breakOutTime` (string, optional) — Optional break out time in HH:mm 24-hour format. Break times are not mandatory - add them only if the user wants to. If given, breakInTime must be given too. A break after midnight is fine on a shift whose period reaches there.
- `dateSelectMode` (unknown type, optional) — Search Criteria date selection mode, matching the page radio buttons: last7days (Last 7 Days), last30days (Last 30 Days), period (By Period, uses fromDate/toDate). Defaults to period with a wide range.
- `fromDate` (string, optional) — Search range start date in the format returned by the dateFormat tool. Only used when dateSelectMode is period. If omitted, a wide default range is used. The date being edited must fall inside the range.
- `toDate` (string, optional) — Search range end date in the format returned by the dateFormat tool. Only used when dateSelectMode is period. If omitted, a wide default range is used. The date being edited must fall inside the range.
- `isGroupByEmployee` (boolean, optional) — Optional Group By Employee checkbox on the Search Criteria panel. Defaults to false.
- `rosterGroup` (string, optional) — Optional roster group id used to load the roster list via GetRostersByGroupId. Defaults to 1.
- `rosterCode` (string, optional) — Optional roster code for GetGridDataByCriteria, e.g. 000017. Defaults to 000017. Takes precedence over rosterName.
- `rosterName` (string, optional) — Optional roster name, e.g. 'Roster 1'. Resolved to a roster code against the roster list. Ignored when rosterCode is given.


## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`)
