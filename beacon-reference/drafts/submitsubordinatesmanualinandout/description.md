# submitSubordinatesManualInAndOut (DRAFT)

**Task:** Submit Subordinates' Manual In And Out by Supervisor

**Tags:** Attendance, manual-in-out, Headers, SupervisoryOperations, phase 3

**Status:** DRAFT — paste into Beacon Agent Studio by hand

## Description

Submits a Manual In and Out for a team member (subordinate) on a Regularize day. Call it AS SOON AS the user asks to add manual In and Out or check-in/out FOR SOMEONE ELSE. Valid Swipes days: editSubordinatesManualInAndOut; Off Shifts days: submitSubordinatesOffShifts.

1. Run dateFormat first. To list the team members, call with listSubordinates:true. To show one tab's dates (Regularize, Pending, Valid Swipes, Off Shifts), call with showTab. Ask which one and the date, then call with only those.
2. Show the returned shiftDetails to the user.
3. Ask for the In (date+time), the Out (date+time) or both - one is enough - and the reason. Breaks optional (breaks list).
4. validationError: show it, ask for missingFields - not a failure. pending: show it and stop. wrongTab: call useTool with the same employee and date.
5. Call without confirmed first; show the preview. On yes: confirmed:true + previewToken. Several days: others in otherEntries, preview all first. On success no status.

## Network call sequence (from `beacon-reference/Subordinate Manual in and Out/`)

| Step | Calls, in order |
|---|---|
| Page load | `ManualInOut/ManualInOut/1?mvc=1` (pageload1: `filterModel` / `model`) → `Common/GetRostersByGroupId` (first group of `filterModel.RosterGroupList`) → `CommonComponents/Search/Search` from `filterModel.EmployeeSearchURL` (networkCall2) → the same from `EmployeeSearchModalUrl` (networkCall3) |
| Subordinate selected | `GetPaginatedTypeaheadList?empNumber=<data-empnumber>&key=<data-key>` → `GetEmpNumberFromTypeahead?loggedEmpNumber=<data-empnumber>&empNumber=<id>&key=<data-key>` (subordinateSelect2, subordinateSelect1 - the `_` stamps show the list goes first) |
| Search button | `GetGridDataByCriteria` (typeahead token, first roster of the group, 01/01/<year-3> → today) → `GetDynamicEmployeeSummary` (the rows' token) → `GetLocalizedMessage` (`CommonSelectAllBtn`) → `GetManuallyTimeFixedData` → `GetManualRejectedData` (both: the first 20 Regularize rows) |
| Day on Pending | `GetManuallyTimeFixedData` → `GetManualRejectedData` with the Pending page (Pending Tab capture), then the "in the pending process" answer - nothing asked, nothing sent |
| Day on another tab | that tab's fixed → rejected, then `wrongTab` with `useTool` |
| Filling the row | `GetEmployeeBreaksByDate` (when the day has or gets breaks) → `GetCommentHistoryByDate` (rows' token, the day) |
| Submit (`confirmed: true`) | `SubmitManualAdjustment` `{PageMode: 1, ManualInOutDetailList: <the tab page holding the day>}` → `GetGridDataByCriteria` `{FilterMode: 1, FromDateText, ToDateText, EmpNumber}` → `GetDynamicEmployeeSummary` → `GetManuallyTimeFixedData` → `GetManualRejectedData` |

Notes on the captures:
- `subordinateSelect3` is Beacon's own chat-session list (`edge.beacon.li`), not a PeoplesHR call - not replayed.
- The captured order lists `GetDynamicEmployeeSummary` before `GetGridDataByCriteria`, but its `empNumber` is the token the grid rows come back with (`t9C1…` / `zlPj…`), so it can only follow the grid. Likewise `SubmitManualAdjustment` is listed last but the four calls before it are its refresh.
- `GetCommentHistoryByDate` was captured twice (21/11 and 19/11 - two rows clicked) and `GetEmployeeBreaksByDate` for 20/11; the tool loads them for the day being submitted.
- The submitted rows' token (`ue7z…`) appears in no other capture, so that submit came from a separate search; the tool sends the tokens its own search returned.
- The post-submit refresh token (`ERQW…`) appears nowhere else either; the tool uses the subordinate's typeahead token, the one its own search used.

## What changed against the live tool (and why)

- **Search token:** the subordinate calls are keyed by the typeahead element's `data-empnumber` and
  `data-key` (both in the networkCall2 response - the captured selection used exactly those).
  The live tool tried the URL's `empNumber` and `LoginEmpNumber`, neither of which the capture uses.
- **Nothing hard-coded:** roster group `"1"` and roster `"000017"` fallbacks are gone - group and
  roster come from `filterModel.RosterGroupList` and `GetRostersByGroupId` (captured 6 → 000058);
  `PageMode`, `callBackId`, `IsClientUoc`, Group By Employee, the empty reason code (`-1`) and the
  page size (20) come from the page. Tabs come from the page's tab links and the grid counts.
- **Search range:** 01/01/<year-3> → today, as captured (01/01/2023 - 06/10/2026), not end of month.
- **Only the page holding the day is posted** (20 rows), not the whole tab.
- **Day gate as soon as the date is known:** Pending → message, Valid Swipes → editSubordinates,
  Regularize → this tool, Off Shifts → submitSubordinatesOffShifts, REST days that
  sit on no tab → plain answer. Pending rows go out disabled.
- **Shift details first, then the In, the Out or both** (one side is enough); breaks are a list (captured submit:
  two new breaks, `SeqNo` 1 and 2, `ActionType` 1), validated for format, order, In→Out span,
  shift window and overlap.
- **Validation never fails the tool** - `validationError` with the message; `error` only for no
  access, the screen or search not opening, or the server not answering.
- The two WorkflowV5 notification GETs after submit are not in the captured sequence - dropped.
- Not yet replayed against the captures with a mocked `fetch`.

## Signature

```
submitSubordinatesManualInAndOut
```

## Arguments

_None._ All arguments are Advanced Arguments — paste `arguments.json` as-is.

## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`)
