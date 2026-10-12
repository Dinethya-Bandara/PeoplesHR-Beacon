# submitManualInAndOutByAdmin (DRAFT)

**Task:** Submit Manual In and Out entries by an Admin on behalf of an employee.

**Tags:** Attendance, manual-in-out, Admin, phase 3

**Status:** DRAFT — paste into Beacon Agent Studio by hand

## Description

Submits a Manual In and Out for any employee the admin can access on a Regularize day. Call it AS SOON AS the user says e.g. "Submit manual in and out for <employee name>" or asks to add check-in/check-out for an employee. Valid Swipes days: editManualInAndOutByAdmin; Off Shifts days: submitAdminOffShifts.

1. Run dateFormat first. To show one tab's dates (Regularize, Pending, Valid Swipes, Off Shifts), call with showTab. Ask which employee and the date, then call with only those; if several match, ask which.
2. Show the returned shiftDetails to the user.
3. Ask for the In (date+time), the Out (date+time) or both - one is enough - and the reason. Breaks optional (breaks list).
4. validationError: show it, ask for missingFields - not a failure. pending: show it and stop. wrongTab: call useTool with the same employee and date.
5. Call without confirmed first; show the preview. On yes: confirmed:true + previewToken. Several days: others in otherEntries, preview all first. On success no status.

## Network call sequence (from `beacon-reference/Manual in and out Admin/`)

| Step | Calls, in order |
|---|---|
| Page load | `ManualInOut/ManualInOut/0?mvc=1` (pageload1: `filterModel` / `model`) → `api/securityapi/pagehit` (pageLoad2) → `CommonComponents/Search/Search` from `filterModel.EmployeeSearchURL` (api1) → `Common/GetRostersByGroupId` (first group of `filterModel.RosterGroupList`) |
| Employee selected | `GetPaginatedTypeaheadList?empNumber=<data-empnumber>&key=<data-key>` (selectEmployee; later pages `&page=N` while `pagination.more`) → `GetEmpNumberFromTypeahead?loggedEmpNumber=<data-empnumber>&empNumber=<id>&key=<data-key>` (selectEmployee2) |
| Search button | `GetGridDataByCriteria` (typeahead token, first roster, 01/01/<year-3> → today) → `GetManuallyTimeFixedData` → `GetManualRejectedData` (both: the first 20 Regularize rows) → `GetLocalizedMessage` (`CommonSelectAllBtn`) → `GetDynamicEmployeeSummary` (rows' token) |
| Day on Pending | `GetManuallyTimeFixedData` → `GetManualRejectedData` with the Pending page (Pending tab capture: the 6 P/A rows, disabled), then "<date> is in the pending process for <name>, so you cannot edit or submit a manual In and Out for this date." - nothing asked, nothing sent |
| Day on Valid Swipes / Off Shifts | that tab's fixed → rejected, then `wrongTab` with `useTool` (`editManualInAndOutByAdmin` / `submitAdminOffShifts`) |
| Breaks set | `GetEmployeeBreaksByDate` (rows' token, the day) - when breaks are given or the day already has some |
| Submit (`confirmed: true`) | `GetLocalizedMessage` (`lblCommentHistory` / `TNA`) → `SubmitManualAdjustment` `{PageMode: 0, ManualInOutDetailList: <the tab page holding the day>}` → `GetGridDataByCriteria` `{FilterMode: 1, FromDateText, ToDateText, EmpNumber}` → `GetManuallyTimeFixedData` → `GetManualRejectedData` → `GetDynamicEmployeeSummary` |

`pageLoad3` is Beacon's own chat-session list (`edge.beacon.li`), not a PeoplesHR call - not replayed.
`GetCommentHistoryByDate` is not in the admin captures and is not called.

The captured submit: Liam Taylor (000006), 16/01/2024 (Flex, window 16/01 00:00 → 17/01 10:00) →
In 16/01 06:00, Out 17/01 10:00, two new breaks (10:00-11:00, 17:00-18:00), posted with the 20
Regularize rows of that page.

## The In / Out fix (why)

- **All four are asked for.** The live tool asked only In Time and Out Time and kept the grid's
  pre-filled dates, so an Out that belongs to the next day went out on the In date. In Date and
  Out Date are now the user's answers like the times - the UI accepts In and Out on different dates.
- **"In before Out" only where the shift says so.** The rule is taken from the row's own
  `ShiftToolTip` (the window the API returns): when the allowed window lies within one day the Out
  must be after the In; when it runs past midnight (both captured shifts: 00:00 → next day 10:00)
  no ordering is applied and the server decides. Nothing about any shift is hard-coded.
- In/Out outside the window are warnings in the preview; breaks must sit within the In/Out and the
  window (the screen's own rule). The break-overlap rule is gone - it is not one the API states.

## Other changes against the live tool

- Day gate as soon as the date is known (Regularize, Off Shifts, Pending, Valid Swipes): Pending stops
  with the message; Valid Swipes hands off to the edit tool, Off Shifts to submitAdminOffShifts. Shift details shown before asking.
- The search token is the typeahead element's `data-empnumber` / `data-key` (api1), as captured.
- Search range 01/01/<year-3> → today, as captured; roster group / roster, `PageMode`, `callBackId`,
  `IsClientUoc`, the empty reason code and the page size come from the page; tabs from the page's
  tab links and the grid counts.
- Breaks are a list (one or more), as captured.
- Validation never fails the tool - `validationError` with the message; `error` only for no access,
  the screen or search not opening, or the server not answering.
- Not yet replayed against the captures with a mocked `fetch`.

## Signature

```
submitManualInAndOutByAdmin
```

## Arguments

_None._ All arguments are Advanced Arguments — paste `arguments.json` as-is.

## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`)
