# submitSubordinatesManualInAndOut

**Task:** Submit Subordinates' Manual In And Out by Supervisor

**Tags:** Attendance, manual-in-out, Headers, SupervisoryOperations, phase 3

**Status:** live

## Description

Submits a Manual In and Out for a subordinate. Call it AS SOON AS the user asks to submit, add, enter or record manual In and Out, check-in and check-out (checkin/checkout) or attendance FOR SOMEONE ELSE - e.g. "add checkin and checkout for <name>". Do not wait for detail; ask for what is missing after calling. To CHANGE a time use editSubordinatesManualInAndOut. Subordinates only.

1. Run dateFormat first and pass the date in that format. Ask which subordinate if not given; if several match, ask which.
2. Then ask separately for In Date, In Time, Out Date, Out Time and the reason. Offer suggested.inDate / suggested.outDate as defaults.
3. An Out Date on the day AFTER the In Date is normal - shifts can end after midnight - and the Out time is then earlier on the clock. Never question it or demand In before Out.
4. Not on the page: relay and stop. Already submitted: returns alreadyExists and useTool.
5. Breaks are optional - both times or neither.
6. Show the preview with the name and confirm first.

## Signature

```
submitSubordinatesManualInAndOut
```

## Arguments

_None._


## Advanced arguments

- `employeeNumber` (string, optional) — The subordinate's employee number, e.g. 000013. Either employeeNumber or employeeName must be provided.
- `employeeName` (string, optional) — The subordinate's name (full or partial). Either employeeNumber or employeeName must be provided.
- `date` (string, required) — Date to add/check manual in and out for, in the format returned by the dateFormat tool (DD/MM/YYYY, or MM/DD/YYYY for en-US). Ask the user for this if not provided.
- `inDate` (string, optional) — In date, in the format returned by the dateFormat tool. ALWAYS ask the user for this separately, alongside the Out Date - do not assume it. The tool returns the row's own date under suggested.inDate; offer that as the default and let the user confirm or change it.
- `inTime` (string, optional) — In time in HH:mm 24-hour format, e.g. 08:30. ALWAYS ask the user for this together with inDate, outDate and outTime - all four are collected separately and none is inferred.
- `outDate` (string, optional) — Out date, in the format returned by the dateFormat tool. ALWAYS ask the user for this separately, alongside the In Date - never decide it yourself. An Out Date on the day AFTER the In Date is normal - many shifts end after midnight - and the Out time is then earlier on the clock than the In time, which is correct and must never be questioned or rejected. The tool reports whether this shift can end on the following day as current.shiftCanEndNextDay, and returns the row's own date under suggested.outDate; offer that as the default and let the user confirm or change it.
- `outTime` (string, optional) — Out time in HH:mm 24-hour format, e.g. 17:30. ALWAYS ask the user for this together with inDate, inTime and outDate. An Out Date on the day AFTER the In Date is normal - many shifts end after midnight - and the Out time is then earlier on the clock than the In time, which is correct and must never be questioned or rejected. Check it against outDate, not against inTime.
- `reason` (string, optional) — Reason/comment explaining why the manual in and out is being added. Always required before submission. No need reason for breakInTime and breakOutTime.
- `confirmed` (boolean, optional) — Set to true only after the user has reviewed the preview and explicitly confirmed the data is correct. Set to false (or omit) to just preview/validate without submitting.
- `breakInTime` (string, optional) — Optional break in time in HH:mm 24-hour format. Break times are not mandatory - add them only if the user wants to. If given, breakOutTime must be given too. A break after midnight is fine on a shift whose period reaches there.
- `breakOutTime` (string, optional) — Optional break out time in HH:mm 24-hour format. Break times are not mandatory - add them only if the user wants to. If given, breakInTime must be given too. A break after midnight is fine on a shift whose period reaches there.
- `rosterGroup` (string, optional) — Optional roster group id for GetRostersByGroupId. Leave it out: the tool reads the group off the team page's own roster list, which varies from user to user.
- `rosterCode` (string, optional) — Optional roster code for GetGridDataByCriteria, e.g. 000058. Leave it out: the tool uses the first roster GetRostersByGroupId returns for this user's group, which is what the screen itself searches with. Takes precedence over rosterName.
- `rosterName` (string, optional) — Optional roster name, e.g. 'MAK01'. Resolved to a roster code against the roster list the API returned. Ignored when rosterCode is given.


## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`)
