# submitSubordinatesOffShifts (DRAFT — new tool)

**Task:** Submit Subordinates' Off Shift Manual In And Out by Supervisor

**Tags:** Attendance, manual-in-out, off-shift, Headers, SupervisoryOperations

**Status:** DRAFT — create as a new tool in Beacon Agent Studio and assign it to the Attendance agent

## Description

Submits a Manual In and Out for a team member (subordinate) on an OFF SHIFT day - the Off Shifts tab of My Team Manual In and Out. Call it for such a day, or when another Manual In and Out tool returns useTool submitSubordinatesOffShifts.

1. Run dateFormat first. To list the team members, call with listSubordinates:true. To show one tab's dates (Regularize, Pending, Valid Swipes, Off Shifts), call with showTab. Ask which one and the date, then call with only those; if several match, ask which.
2. Show the returned shiftDetails to the user.
3. Ask for the In (date+time), the Out (date+time) or both - one is enough - and the reason. Breaks optional (breaks list).
4. validationError: show it, ask for missingFields - not a failure. pending: show it and stop. wrongTab: call useTool with the same employee and date.
5. Call without confirmed first; show the preview. On yes: confirmed:true + previewToken. Several days: others in otherEntries, preview all first. On success no status.

## Network call sequence

Page load, subordinate selection and the Search button are the same as
`submitSubordinatesManualInAndOut` (`beacon-reference/Subordinate Manual in and Out/`). The Off Shifts
part comes from `.../Off Shifts Subordinates/`:

| Step | Calls, in order |
|---|---|
| Page load | `ManualInOut/ManualInOut/1?mvc=1` → `Common/GetRostersByGroupId` → `Search/Search` (`EmployeeSearchURL`) → `Search/Search` (`EmployeeSearchModalUrl`) |
| Subordinate selected | `GetPaginatedTypeaheadList` → `GetEmpNumberFromTypeahead` (keyed by the typeahead's `data-empnumber` / `data-key`) |
| Search button | `GetGridDataByCriteria` → `GetDynamicEmployeeSummary` → `GetLocalizedMessage` (`CommonSelectAllBtn`) → `GetManuallyTimeFixedData` → `GetManualRejectedData` (first 20 Regularize rows) |
| Day on Pending | Pending tab opened (fixed → rejected), then "<date> is in the pending process for <name>, so you cannot edit or submit a manual In and Out for this date." |
| Day on Regularize / Valid Swipes | that tab's fixed → rejected, then `wrongTab` with `useTool` (`submitSubordinatesManualInAndOut` / `editSubordinatesManualInAndOut`) |
| **Off Shifts tab clicked** | `GetManuallyTimeFixedData` → `GetManualRejectedData`, both with the Off Shifts page holding the day (captured: the first 20 of the 22 off shift days, the 6 locked ones disabled) |
| Breaks set | `GetEmployeeBreaksByDate` (rows' token, the day) - when breaks are given or the day already has some |
| **Submit** (`confirmed: true`) | `SubmitManualAdjustment` `{PageMode: 1, ManualInOutDetailList: <the Off Shifts page>}` → `GetGridDataByCriteria` `{FilterMode: 1, FromDateText, ToDateText, EmpNumber}` → `GetManuallyTimeFixedData` → `GetManualRejectedData` (first 20 Regularize rows) → `GetDynamicEmployeeSummary` |

The captured submit: 17/11/2024 (off shift, nothing recorded) → In 17/11 06:00, Out 18/11 00:00
(`"06.00"`, `"00.00"`, both cells `ChangeCell_Highlight`), two new breaks 10:00-11:00 and 15:00-16:00
(`SeqNo` 1, 2, `ActionType` 1), reason as `Comment`, `ReasonCode` `-1`. The server answered "Record
submitted. Time will be adjusted with the Time Fix process." and the day moved to Pending (type 2,
still an off shift day - Off Shifts still counts 22). `GetCommentHistoryByDate` is not in the Off
Shifts sequence and the tool does not call it.

## Behaviour

- **Day gate as soon as the date is known** (Off Shifts, Valid Swipes, Regularize, Pending): only an
  Off Shifts day carries on here; Pending stops with the message; the others hand off by `useTool`;
  a REST day on no tab gets a plain answer.
- **Shift details first** (shift, shift time, allowed swipe window, day type, next-day end,
  recorded In/Out and numbered breaks), then In Date, In Time, Out Date, Out Time and the reason -
  the In, the Out or both (one side is enough) - with optional breaks (a list; a `breakNo` changes a recorded break).
- **Validations come from the API.** The tool checks only what it needs to build the request (a
  readable date, HH:mm times, both times on a break, a `breakNo` that exists); locked / pending /
  tab state come from the grid row; breaks must sit within the In/Out and the day's window (the
  screen's own rule). An Out before the In or outside the window is a warning in the preview. The
  server's answer is shown as is, as `validationError` - the tool only fails (`error`) for no
  access, the screen or search not opening, or the server not answering.
- **Nothing hard-coded:** roster group / roster, `PageMode`, `callBackId`, `IsClientUoc`, the empty
  reason code and the page size come from the page; tabs from the page's tab links and the grid
  counts (Off Shifts = the off shift days). Search range 01/01/<year-3> → today, as captured.
- Not yet replayed against the captures with a mocked `fetch`.

## Signature

```
submitSubordinatesOffShifts
```

## Arguments

_None._ All arguments are Advanced Arguments — paste `arguments.json` as-is.

## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`) — add it to this agent's tool list when saving.
