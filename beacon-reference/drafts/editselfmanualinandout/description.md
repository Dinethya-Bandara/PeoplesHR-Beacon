# editSelfManualInAndOut (DRAFT)

**Task:** Edit Manual In Time and Out Time already submitted

**Tags:** Attendance, manual-in-out, Headers, phase 3

**Status:** DRAFT — paste into Beacon Agent Studio by hand

## Description

Edits the logged-in employee's own recorded Manual In and Out (Valid Swipes tab of My Manual In and Out). Regularize days belong to submitSelfManualInAndOut, Off Shifts days to submitSelfOffShifts.

1. Run dateFormat first and pass every date in that format. To show one tab's dates (Regularize, Pending, Valid Swipes, Off Shifts), call with showTab.
2. Ask the user for the date and call with it alone. Show the returned shiftDetails.
3. Ask what to change: the In (date+time), the Out or both - one is enough - then the values and reason. Breaks optional; breakNo changes one. To remove a recorded time use clearInTime/clearOutTime; to delete recorded breaks, deleteBreaks.
4. validationError: show it, ask for missingFields - not a failure. pending: relay and stop. wrongTab: call useTool with the same date. noChanges: ask what should change.
5. Call without confirmed first; show the preview. On yes: confirmed:true + previewToken. Several days: others in otherEntries, preview all first. On success no status.

## Validation, tabs and the four fields (2026-10-06)

- **Validation never fails the tool.** A bad date or time, a date outside the range or not in
  the grid, a roster that does not exist, a locked day, an Out before the In, a break outside
  the window, and the server refusing the submit (a 4xx, or `Status` false with a message) all
  return `validationError: true` with the message and `missingFields`. `error: true` is kept for
  real breakages only: no access to the screen, the employee cannot be identified, the screen's
  tabs cannot be read, or the server does not answer / answers 5xx.
- **Any date on any tab gets an answer.** The tool places the day on the tab(s) it sits on.
  Pending → nothing more is loaded or sent (the screen disables Pending days entirely); the
  answer is `pending: true` with "<date> is in the pending process, so you cannot edit or submit
  a manual In and Out for this date." Any other tab is opened as the screen does it
  (`GetManuallyTimeFixedData` → `GetManualRejectedData` with the tab's page holding the day).
  Regularize / Off Shifts → `wrongTab: true` with `useTool` (previously an error);
  Valid Swipes → carries on. Every answer carries `day` (tabs, status, In/Out, shift,
  fixed / rejected).
- **No tab is hard-coded.** Tab labels and count fields come from the tab links in the page HTML;
  each `InOutRecordType` number from the enum in the page's own scripts, otherwise inferred from
  the grid response's counts. The post-submit refresh opens the grid's first tab the same way.
- **In Date, In Time, Out Date and Out Time are always asked for**, with the recorded values
  under `suggested` - including for a break-only change. The Out Date is never resolved by the
  tool any more (`resolveOutDate` removed); it is the user's answer.
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
editSelfManualInAndOut
```

## Arguments

_None._ All arguments are Advanced Arguments — paste `arguments.json` as-is.

## Network call sequence (from `beacon-reference/Manual In and Out/Edit Self Manual IO/` captures)

| Step | Calls, in order |
|---|---|
| Page + search | `ManualInOut/ManualInOut/2?mvc=1` (filterModel / model) → `Common/GetRostersByGroupId` → `GetGridDataByCriteria` |
| Valid Swipes tab opened | `GetManuallyTimeFixedData` → `GetManualRejectedData`, both posted the same array: the tab's on-screen page of `InOutRecordType 3` rows |
| User adds a break (or the day already has breaks) | `GetEmployeeBreaksByDate` |
| User gives the reason / comment | `GetCommentHistoryByDate` |
| Submit (`confirmed: true`) | `SubmitManualAdjustment` → `GetGridDataByCriteria` (short refresh form) → `GetManuallyTimeFixedData` → `GetManualRejectedData` → `GetDynamicEmployeeSummary` |

## What changed against the live tool (and why)

- **Built from the newer edit logic.** The captured edit is an overnight change (In 05/11 10:00,
  Out 06/11 02:00), which the live edit tool cannot produce - it kept the row's own dates and
  sent numeric times. The edit code that had been pasted into the live submit tool already asks
  for In Date / Out Date separately and resolves overnight Out dates, so this draft starts from
  that and applies the captured flow on top.
- **Valid Swipes tab parity.** Fixed and rejected both get the same Valid Swipes page (the old
  tool sent rejected a `{FilterMode, ...}` search).
- **Submit posts only the Valid Swipes page** - `{PageMode, ManualInOutDetailList}` and nothing
  else (the old tool posted all 54 grid rows merged into the page model). The selected row moves
  ISO `InDate`/`OutDate` with the texts, sends changed times as `"HH.MM"` strings, keeps
  `InOldTime`/`OutOldTime` as the grid gave them, and marks changed cells `ChangeCell_Highlight`.
  Other rows listed by the fixed-data response carry `ManualTime_Highlight`; locked rows go with
  `IsEnabled`/`IsAdjustmentEnabled` false.
- **Breaks** are sent as `"HH.MM"` strings with dates resolved against the shift window.
  `GetEmployeeBreaksByDate` is only called when the user adds a break, or when the day already
  has breaks (`BreakCount > 0`) so they are shown and carried rather than dropped.
- **Comment history** (`GetCommentHistoryByDate`) is loaded once the reason is given, and
  returned in the preview.
- **Post-submit refresh** uses the short `{FilterMode: 1, FromDateText, ToDateText, EmpNumber}`
  grid search, then fixed / rejected with page 1 of the Regularize (type 1) rows, then the
  summary keyed by the rows' `EmpNumber` token. The two WorkflowV5 notification GETs are not in
  the captured sequence and were dropped.
- **Nothing hard-coded from one tenant.** Roster group / roster code, Group By Employee,
  `IsClientUoc`, `PageMode`, the empty reason code and the grid page size all come from the page's
  `filterModel` / `model` and `GetRostersByGroupId`, not from `"1"` / `"000017"`.
- **Server validation is relayed.** A submit fails when `Status` is not `true` or
  `failCount > 0`; the user sees the `DataList` message for the day.

## Verified

Replayed the captures through the transformer with a mocked `fetch`: the tab-click fixed and
rejected payloads, the `SubmitManualAdjustment` payload, and the post-submit fixed and rejected
payloads all match the captured requests field for field (only the per-response encrypted
`EmpNumber` tokens differ), and the summary call uses the same token as the capture.

## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`)
