# submitAdminOffShifts (DRAFT — new tool)

**Task:** Submit Off Shift Manual In and Out entries by an Admin on behalf of an employee.

**Tags:** Attendance, manual-in-out, off-shift, Admin

**Status:** DRAFT — create as a new tool in Beacon Agent Studio and assign it to the Attendance agent

## Description

Submits a Manual In and Out for any employee the admin can access on an OFF SHIFT day (off day / rest day) - the Off Shifts tab of the admin Manual In and Out screen. Call it for such a day, or when another Manual In and Out tool returns useTool submitAdminOffShifts.

1. Run dateFormat first. To show one tab's dates (Regularize, Pending, Valid Swipes, Off Shifts), call with showTab. Ask which employee (number or name) and the date, then call with only those; if several match, ask which.
2. Show the returned shiftDetails to the user.
3. Ask for the In (date+time), the Out (date+time) or both - one is enough - and the reason. Breaks optional (breaks list).
4. validationError: show it, ask for missingFields - not a failure. pending: show it and stop. wrongTab: call useTool with the same employee and date.
5. Call without confirmed first; show the preview. On yes: confirmed:true + previewToken. Several days: others in otherEntries, preview all first. On success no status.

## Network call sequence

Page load, employee selection and the Search button are the same as `submitManualInAndOutByAdmin`
(`beacon-reference/Manual in and out Admin/`). The Off Shifts part comes from `.../Off Shifts Admin/`:

| Step | Calls, in order |
|---|---|
| Page load | `ManualInOut/ManualInOut/0?mvc=1` → `api/securityapi/pagehit` → `Search/Search` (`EmployeeSearchURL`) → `Common/GetRostersByGroupId` |
| Employee selected | `GetPaginatedTypeaheadList` (page by page while `pagination.more`) → `GetEmpNumberFromTypeahead` (keyed by the typeahead's `data-empnumber` / `data-key`) |
| Search button | `GetGridDataByCriteria` → `GetManuallyTimeFixedData` → `GetManualRejectedData` (first 20 Regularize rows) → `GetLocalizedMessage` (`CommonSelectAllBtn`) → `GetDynamicEmployeeSummary` |
| Day on Pending | Pending tab opened (fixed → rejected), then "<date> is in the pending process for <name>, so you cannot edit or submit a manual In and Out for this date." |
| Day on Regularize / Valid Swipes | that tab's fixed → rejected, then `wrongTab` with `useTool` (`submitManualInAndOutByAdmin` / `editManualInAndOutByAdmin`) |
| **Off Shifts tab clicked** | `GetManuallyTimeFixedData` → `GetManualRejectedData`, both with the Off Shifts page holding the day (captured: 20 off shift days) |
| Breaks set | `GetEmployeeBreaksByDate` (rows' token, the day) - when breaks are given or the day already has some |
| **Submit** (`confirmed: true`) | `SubmitManualAdjustment` `{PageMode: 0, ManualInOutDetailList: <the Off Shifts page>}` → `GetGridDataByCriteria` `{FilterMode: 1, FromDateText, ToDateText, EmpNumber}` → `GetManuallyTimeFixedData` → `GetManualRejectedData` (first 20 Regularize rows) → `GetDynamicEmployeeSummary` |

The captured submit: Liam Taylor (000006), 21/01/2024 (DFT, window 21/01 00:00 → 22/01 00:00, nothing
recorded) → In 21/01 00:00, Out 22/01 00:00 (`"00.00"` both, `ChangeCell_Highlight`), two new breaks
10:00-11:00 and 18:00-19:00 (`SeqNo` 1, 2, `ActionType` 1). Unlike the Regularize submit, the Off
Shifts submit goes straight to `SubmitManualAdjustment` - no `lblCommentHistory` label call.
`GetCommentHistoryByDate` is not in the captures and is not called.

## Behaviour

- **Day gate as soon as the date is known** (Off Shifts, Regularize, Valid Swipes, Pending): only an
  Off Shifts day carries on here; Pending stops with the message; the others hand off by `useTool`;
  a REST day on no tab gets a plain answer.
- **Shift details first** (shift, shift time, allowed swipe window, day type, next-day end, recorded
  In/Out and numbered breaks), then the In, the Out or both (one side is enough) and the reason - with optional breaks (a list; a `breakNo` changes a recorded break).
- **Validations come from the API.** "Out after In" applies only when the day's allowed window (the
  row's `ShiftToolTip`) lies within one day; a window past midnight (the captured one) lets the Out
  sit on the next date. In/Out outside the window are warnings; breaks must sit within the In/Out
  and the window (the screen's own rule). The server's answer is shown as is, as `validationError` -
  the tool only fails (`error`) for no access, the screen or search not opening, or the server not
  answering.
- **Nothing hard-coded:** roster group / roster, `PageMode`, `callBackId`, `IsClientUoc`, the empty
  reason code and the page size come from the page; tabs from the page's tab links and the grid
  counts (Off Shifts = the off shift days). Search range 01/01/<year-3> → today, as captured.
- Not yet replayed against the captures with a mocked `fetch`.

## Signature

```
submitAdminOffShifts
```

## Arguments

_None._ All arguments are Advanced Arguments — paste `arguments.json` as-is.

## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`) — add it to this agent's tool list when saving.
