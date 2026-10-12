# submitSelfOffShifts (DRAFT — new tool)

**Task:** Submit Off Shift Manual In and Out

**Tags:** Attendance, manual-in-out, off-shift, add, Headers

**Status:** DRAFT — create as a new tool in Beacon Agent Studio and assign it to the Attendance agent

## Description

Submits a Manual In and Out for the logged-in employee (self) on an OFF SHIFT day (off day / rest day / holiday shift) - the Off Shifts tab of My Manual In and Out. Call it for such a day, or when another Manual In and Out tool returns useTool submitSelfOffShifts.

1. Run dateFormat first and pass every date in that format. To show one tab's dates (Regularize, Pending, Valid Swipes, Off Shifts), call with showTab.
2. Ask the user for the date and call with it alone. Show the returned shiftDetails to the user.
3. Ask for the In (date+time), the Out (date+time) or both - one is enough - and the reason. Breaks optional (breaks list).
4. validationError: show it, ask for missingFields - not a failure. pending: relay and stop. wrongTab: call useTool with the same date.
5. Call without confirmed first; show the preview. On yes: confirmed:true + previewToken. Several days: others in otherEntries, preview all first. On success no status.

## Validation, tabs and the four fields (2026-10-06)

- **Validation never fails the tool.** A bad date or time, a date outside the range or not in
  the grid, a roster that does not exist, a locked day, an Out before the In, a break outside
  the In/Out, and the server refusing the submit (a 4xx, or `Status` false with a message) all
  return `validationError: true` with the message and `missingFields`. `error: true` is kept for
  real breakages only: no access to the screen, the employee cannot be identified, the screen's
  tabs cannot be read, or the server does not answer / answers 5xx.
- **Any date on any tab gets an answer.** The tool places the day on the tab(s) it sits on.
  Pending → nothing more is loaded or sent; the answer is `pending: true` with "<date> is in the
  pending process, so you cannot edit or submit a manual In and Out for this date." (a pending
  off shift day is on Off Shifts too; Pending wins). Any other tab is opened as the screen does
  it (fixed → rejected with the tab's page holding the day).
  Regularize / Valid Swipes → `wrongTab: true` with `useTool` (was `notOffShift`); Off Shifts →
  carries on. Every answer carries `day`.
- **No tab is hard-coded.** Off Shifts membership is no longer `IsShiftOffShift` alone and
  "disabled" is no longer `RecordStatus !== 0`: tabs come from the page HTML and scripts (or the
  grid counts), and a row is disabled when it is locked or on the Pending tab.
- **In Date, In Time, Out Date and Out Time are always asked for**, with any recorded values
  under `suggested`; a recorded half is no longer refused when the user gives a different time.
- Not yet replayed against the captures with a mocked `fetch` - the "Verified" notes below cover
  the earlier version only.

## Shift details first, then In/Out and optional breaks (2026-10-06)

- **Flow:** date -> the tool answers with `shiftDetails` (shift, shift time, allowed swipe window,
  day type, whether it can end next day, tab(s), status, recorded In/Out, and the recorded breaks
  numbered `breakNo` 1..n from `GetEmployeeBreaksByDate`) and a message that leads with them ->
  the user gives In Date, In Time, Out Date, Out Time, the reason, and optionally breaks.
- **Breaks:** `breaks` is a list - none, one or many (the single `breakInTime`/`breakOutTime`
  pair still works). A break with `breakNo` changes that recorded break in place; any other is
  appended with the next `SeqNo`. The recorded breaks are always carried on the submit. Every
  touched break goes out as `ActionType` 1 - the captured Off Shifts submit carries two new
  breaks, `SeqNo` 1 and 2, both `ActionType` 1.
- **Break validation**, each answered as `validationError` with `missingFields`: both times
  given; HH:mm; `breakNo` must name a recorded break and be used once; start inside the
  In -> Out span (placed on the In date or a later date up to the Out date, so a break after
  midnight on an overnight shift lands on the right day); end after start and no later than the
  Out; inside the shift's allowed window from `ShiftToolTip`; no overlap with any other break of
  the day (the new ones and the recorded ones that stay).
- Not yet replayed against the captures with a mocked `fetch`.

## Off Shifts tab rule corrected (2026-10-06)

- The Off Shifts tab is now "the off shift days, whatever their record type" whenever its count
  matches the number of off shift days - not "type 0 rows plus off shift days". The team capture
  showed why: 52 type 0 rows, of which only 22 are off shift (`OffShiftSwipeCount` 22) - the other
  30 are REST days that sit on no tab but View All. The old rule dropped the Off Shifts tab there.
  The self capture (9 open + 1 pending off shift = 10) gives the same answer under both rules.

## Signature

```
submitSelfOffShifts
```

## Arguments

_None._ All arguments are Advanced Arguments — paste `arguments.json` as-is.

## Network call sequence (from `beacon-reference/Off Shifts/` captures)

| Step | Calls, in order |
|---|---|
| Page load | `TNAV9/ManualInOut/ManualInOut/2?mvc=1` (filterModel / model) → `api/securityapi/pagehit?pageUrl=…` → `Common/GetRostersByGroupId` |
| Search button | `GetGridDataByCriteria` (full search payload) → `GetManuallyTimeFixedData` → `GetManualRejectedData` (both: page 1 of Regularize / type 1 rows) → `GetDynamicEmployeeSummary` (rows' EmpNumber token) |
| Off Shifts tab | `GetManuallyTimeFixedData` → `GetManualRejectedData`, both with the tab's page: every `IsShiftOffShift` row in grid order, open (type 0) and pending (type 2) alike |
| Filling the record | `GetEmployeeBreaksByDate` → `GetCommentHistoryByDate` (row's EmpNumber token and date) |
| Submit (`confirmed: true`) | `SubmitManualAdjustment` `{PageMode, ManualInOutDetailList: Off Shifts page}` → `GetGridDataByCriteria` `{FilterMode: 1, FromDateText, ToDateText, EmpNumber}` → `GetManuallyTimeFixedData` → `GetManualRejectedData` (page 1 of Regularize rows) → `GetDynamicEmployeeSummary` |

`pageload3` in the capture folder (`edge.beacon.li/.../sessions`) is Beacon's own chat-session
list, not a PeoplesHR call, so the tool does not replay it.

## Behaviour

- Preview first: without `confirmed: true` nothing is written; the tool returns
  `needsConfirmation` with the dates, times, breaks, reason, existing breaks and comment history.
- The confirmation after submitting is the server's own message for the day, e.g.
  "Your off shift manual In and Out for 09/11/2024 has been submitted. Record submitted for approval."
- A day that is not on Off Shifts returns `wrongTab` with `useTool`
  (`submitSelfManualInAndOut` or `editSelfManualInAndOut`); the other two tools hand Off Shifts
  days here the same way (`wrongTab`, `useTool: submitSelfOffShifts`).
- A Pending-tab day returns `pending` with the "in the pending process" message and nothing else is done; locked rows return `validationError` with
  the reason.
- Multiple breaks are supported (`breaks` array). The screen's rule "Break Start/End Dates should
  be within In/Out Dates" is enforced up front: every break must sit within In → Out and end after
  it starts.
- Rows going out disabled (`IsEnabled`/`IsAdjustmentEnabled` false) are exactly the locked rows and
  the Pending-tab rows — the rule every captured payload follows. Rows listed by the
  fixed-data response carry `ManualTime_Highlight`; the added cells carry `ChangeCell_Highlight`.
- Nothing is hard-coded from one tenant: roster group / code, Group By Employee, `IsClientUoc`,
  `PageMode`, the empty reason code and the grid page size all come from the page.

## Verified

Replayed the captures through the transformer with a mocked `fetch`: the search grid payload, the
search and Off Shifts tab fixed/rejected payloads, the `SubmitManualAdjustment` payload, the
post-submit grid payload and post-submit fixed/rejected payloads match the captured requests field
for field (only the per-response encrypted `EmpNumber` tokens differ). The one intended difference:
the captured selected row's `Message` holds the screen's leftover validation text
"Break Start/End Dates should be within In/Out Dates"; the tool sends `""` and enforces that rule
itself instead.

## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`) — add it to this agent's tool list when saving.
