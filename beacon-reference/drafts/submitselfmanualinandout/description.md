# submitSelfManualInAndOut (DRAFT)

**Task:** Submit Manual In and Out when there is no existing value

**Tags:** Attendance, manual-in-out, add, Headers, phase 3

**Status:** DRAFT — paste into Beacon Agent Studio by hand

## Description

Submits a Manual In and Out for the logged-in employee (self) on a Regularize-tab day of My Manual In and Out. Valid Swipes days belong to editSelfManualInAndOut, Off Shifts days to submitSelfOffShifts.

1. Run dateFormat first; pass every date in that format. To show one tab's dates (Regularize, Pending, Valid Swipes, Off Shifts), call with showTab. For a date range pass fromDate/toDate without date; for rosters, showRosters:true.
2. Ask the user for the date and call with it alone. Show the returned shiftDetails to the user.
3. Ask for the In (date+time), the Out (date+time) or both - one is enough - and the reason. Breaks optional (breaks list).
4. validationError: show it, ask for missingFields - not a failure. pending: relay and stop. wrongTab: call useTool with the same date.
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
  Valid Swipes / Off Shifts → `wrongTab: true` with `useTool`; Regularize → carries on.
  Every answer carries `day` (tabs, status, In/Out dates and times, shift, fixed / rejected).
- **No tab is hard-coded.** Tab labels and count fields come from the tab links in the page HTML
  (`InOutRecordType.<Member>` / `ManualVM.<Count>`; Off Shifts only when its `ConfigData` flag is
  on). Each member's number comes from the `InOutRecordType` enum in the scripts the page loads
  (`ManualInOut.js` first), and is otherwise inferred from the counts in the grid response.
  Whether a tab also lists off shift days (Off Shifts lists the pending ones too: 9 type-0 rows
  + 1 pending off shift = `OffShiftSwipeCount` 10) is decided by the counts adding up.
  Pending rows go out with `IsEnabled`/`IsAdjustmentEnabled` false, as the Pending capture shows.
- **In Date, In Time, Out Date and Out Time are always asked for**, with the recorded values
  under `suggested`. Regularize days that already carry both times (e.g. 09/12/2025
  13:22 - 16:40) are now submitted here instead of being bounced to the edit tool, which
  refused them. A changed time goes out as `"HH.MM"` with `ChangeCell_Highlight`; an unchanged
  one keeps the grid's value.
- Not yet replayed against the captures with a mocked `fetch` - the "Verified" notes on the
  earlier version do not cover these changes.

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
submitSelfManualInAndOut
```

## Arguments

_None._ All arguments are Advanced Arguments — paste `arguments.json` as-is.

## Network call sequence (from `beacon-reference/Manual In and Out/` captures)

Page load (every call): `ManualInOut/ManualInOut/2?mvc=1` → `filterModel` + `model`, then
`Common/GetRostersByGroupId` for the selected roster group.

| Situation | Calls, in order |
|---|---|
| `showRosters: true` | `GetRostersByGroupId` per roster group (or only the named group) → return, nothing searched |
| Range has **no** records | `GetGridDataByCriteria` → `Common/GetLocalizedMessage` (`ManualSummaryNoRecordsDisplay` / `ManualInOut`) → `GetManuallyTimeFixedData([])` → `GetManualRejectedData([])` |
| Range **has** records | `GetGridDataByCriteria` → `GetGridDataByCriteria` (again) → `GetManuallyTimeFixedData` → `GetManualRejectedData` → `GetDynamicEmployeeSummary` → `GetManuallyTimeFixedData` → `GetManualRejectedData` → `GetDynamicEmployeeSummary` |
| Adding a break | `GetEmployeeBreaksByDate` → `GetCommentHistoryByDate` |
| No break | `GetCommentHistoryByDate` |
| Submit (`confirmed: true`) | `SubmitManualAdjustment` → `GetGridDataByCriteria` (short refresh form) → `GetManuallyTimeFixedData` → `GetManualRejectedData` → `GetDynamicEmployeeSummary` |

## What changed against the live tool (and why)

- **Restored the add flow.** The live tool (exported 2026-09-22) contained edit code: it only
  touched Valid Swipes (type 3) rows and pointed users with an empty day back at itself. The
  captured `SubmitManualAdjustment` fills an empty `InOutRecordType 1` row (`InTime -1` →
  `"02.00"`), so this draft is built from the original add tool (commit `8f06695`), keeping the
  live tool's later improvements: In/Out dates asked for separately with `suggested.*`
  defaults, the shift info read from `ShiftToolTip`, the date-time ordering check, break
  placement across midnight, ISO `InDate`/`OutDate` moved with the texts, `"HH.MM"` wire times
  and `ChangeCell_Highlight`.
- **Nothing hard-coded from one tenant.** Roster group no longer defaults to `"1"` and roster
  code no longer to `"000017"`: the group comes from `filterModel.RosterGroupList` (first entry
  unless the user names one) and the roster from `GetRostersByGroupId` (first entry, as the
  screen's dropdown does — the capture posted `000058`, the first roster of the first group
  `6`). Group By Employee defaults to `filterModel.IsGroupByEmployee`, `IsClientUoc` to
  `filterModel.IsClientUOC`, `PageMode` to `filterModel.PageMode`, and the empty reason code
  to `model.ReasonList[0]` (`"-1"`, "Select a reason").
- **Only the on-screen grid page is posted.** Every captured fixed / rejected / submit payload
  is exactly the first `model.GridPageData.PageSize` (20) of the 26 type-1 rows, not the whole
  tab. The submit now posts the page containing the selected day; the fixed/rejected calls post
  page 1.
- **Fixed and rejected take the same array.** `GetManualRejectedData` is posted the same
  type-1 page as `GetManuallyTimeFixedData` (both captures), not a `{FilterMode, ...}` search.
- **Summary token.** `GetDynamicEmployeeSummary` is keyed by the `EmpNumber` token on the grid
  rows (captures `_TE0W…`, `8GFC…`, `6gk1…`), not the search token.
- **Post-submit refresh** uses the captured short payload
  `{FilterMode: 1, FromDateText, ToDateText, EmpNumber}`. The two WorkflowV5 notification GETs
  are not in the captured sequence and were dropped.
- **Server validation is relayed, not re-implemented.** A submit is a failure when `Status` is
  not `true` **or** `failCount > 0`; the message shown is the `DataList` entry for the day
  (e.g. "Record submitted for approval.") or the top-level `Message`.
- **New capabilities:** `showRosters`, and a range view (no `date`, with `fromDate`/`toDate`)
  that returns the days, tab counts and the dynamic employee summary.

## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`)
