# editSubordinatesManualInAndOut (DRAFT)

**Task:** Edit the previously submitted Manual In and Out times of subordinates.

**Tags:** Attendance, edit-manual-in-out, Headers, phase 3

**Status:** DRAFT — paste into Beacon Agent Studio by hand

## Description

Edits a recorded Manual In and Out of a team member (subordinate) on the Valid Swipes tab. Call it when the user asks to change a manual In and Out or check-in/out FOR SOMEONE ELSE, or on useTool editSubordinatesManualInAndOut.

1. Run dateFormat first. To list the team members, call with listSubordinates:true. To list one tab's dates, call with showTab. Ask which one and the date; call with only those.
2. Show the shiftDetails and the recorded In/Out, then ask which to edit (In Date, In Time, Out Date, Out Time) as fieldsToEdit.
3. Ask only for those new values and the reason. Breaks optional - add, or change by breakNo. Remove a time: clearInTime/clearOutTime; delete breaks: deleteBreaks.
4. validationError: show it, ask for missingFields - not a failure. pending: show it and stop. wrongTab: call useTool with the same employee and date.
5. Call without confirmed first; show the preview. On yes: confirmed:true + previewToken. Several days: others in otherEntries, preview all first. On success no status.

## Network call sequence

From `beacon-reference/Subordinate Manual in and Out/` (page load, subordinate, search, Pending tab)
and `.../Valid swipes/` (the edit itself):

| Step | Calls, in order |
|---|---|
| Page load | `ManualInOut/ManualInOut/1?mvc=1` → `Common/GetRostersByGroupId` → `Search/Search` (`EmployeeSearchURL`) → `Search/Search` (`EmployeeSearchModalUrl`) |
| Subordinate selected | `GetPaginatedTypeaheadList` → `GetEmpNumberFromTypeahead` (keyed by the typeahead's `data-empnumber` / `data-key`) |
| Search button | `GetGridDataByCriteria` → `GetDynamicEmployeeSummary` → `GetLocalizedMessage` (`CommonSelectAllBtn`) → `GetManuallyTimeFixedData` → `GetManualRejectedData` (first 20 Regularize rows) |
| Day on Pending | Pending tab opened (fixed → rejected with the pending page), then "<date> is in the pending process for <name>, so you cannot edit or submit a manual In and Out for this date." |
| Day on Regularize / Off Shifts | that tab's fixed → rejected, then `wrongTab` with `useTool` (`submitSubordinatesManualInAndOut` / `submitSubordinatesOffShifts`) |
| **Valid Swipes tab clicked** | `GetManuallyTimeFixedData` → `GetManualRejectedData`, both with the Valid Swipes page holding the day (captured: all 13 type 3 rows, the 5 locked ones disabled) |
| Breaks set | `GetEmployeeBreaksByDate` (rows' token, the day) - when breaks are given or the day already has some |
| **Submit** (`confirmed: true`) | `SubmitManualAdjustment` `{PageMode: 1, ManualInOutDetailList: <the Valid Swipes page>}` → `GetGridDataByCriteria` `{FilterMode: 1, FromDateText, ToDateText, EmpNumber}` → `GetManuallyTimeFixedData` → `GetManualRejectedData` (first 20 Regularize rows) → `GetDynamicEmployeeSummary` |

The captured edit: 15/11/2024 In 09:00 / Out 15/11 18:00 → In 06:00 / Out 16/11 02:00
(`"06.00"`, `"02.00"`, both cells `ChangeCell_Highlight`, `InOldTime` 9 / `OutOldTime` 18 kept),
two new breaks 08:00-09:00 and 14:00-15:00 (`SeqNo` 1, 2, `ActionType` 1), reason as `Comment`,
`ReasonCode` `-1`. The server answered "Record submitted. Time will be adjusted with the Time Fix
process." and the day moved to Pending (`P/P`). `GetCommentHistoryByDate` is not in the Valid Swipes
sequence and the tool does not call it.

## Behaviour

- **Recorded values first, then the user's choice.** With only the employee and date the tool
  returns the shift details, the recorded In Date / In Time / Out Date / Out Time and breaks, and
  `editableFields`; the agent asks which to edit. With `fieldsToEdit` it asks for only those new
  values (and the reason). Fields not chosen keep their recorded values.
- **Validations come from the API, not from the tool.** The tool only checks what it needs to build
  the request (a readable date, an HH:mm time, a break with both times and a `breakNo` that exists).
  Locked / pending / tab state come from the grid row; the shift's allowed window comes from the
  row's `ShiftToolTip`; breaks must sit within the In/Out (the screen's own "Break Start/End Dates
  should be within In/Out Dates"). An Out before the In or outside the window is a warning in the
  preview - the server decides, and its message is shown as is. Nothing fails the tool except no
  access, the screen or search not opening, or the server not answering.
- **Nothing hard-coded:** roster group / roster, `PageMode`, `callBackId`, `IsClientUoc`, the empty
  reason code (`-1`) and the page size (20) come from the page; tabs from the page's tab links and
  the grid counts. Search range 01/01/<year-3> → today, as captured.
- Not yet replayed against the captures with a mocked `fetch`.

## Signature

```
editSubordinatesManualInAndOut
```

## Arguments

_None._ All arguments are Advanced Arguments — paste `arguments.json` as-is.

## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`)
