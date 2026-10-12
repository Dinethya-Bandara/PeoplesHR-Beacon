# editManualInAndOutByAdmin (DRAFT)

**Task:** Edit Manual In and Out entries by an Admin on behalf of an employee.

**Tags:** Attendance, manual-in-out, Admin, phase 3

**Status:** DRAFT — paste into Beacon Agent Studio by hand

## Description

Edits a recorded Manual In and Out of any employee the admin can access, on the Valid Swipes tab. Call it when the user asks to change an employee's manual In and Out or check-in/out, or on useTool editManualInAndOutByAdmin.

1. Run dateFormat first. To list one tab's dates, call with showTab. Ask which employee (number or name) and the date, then call with only those; if several match, ask which.
2. Show the returned shiftDetails and the recorded In/Out and breaks.
3. Ask which to change: the In (date+time), the Out or both - one is enough (fieldsToEdit) - then the new values and reason. Breaks optional; breakNo changes one. Remove a time: clearInTime/clearOutTime; delete breaks: deleteBreaks.
4. validationError: show it, ask for missingFields - not a failure. pending: show it and stop. wrongTab: call useTool with the same employee and date.
5. Call without confirmed first; show the preview. On yes: confirmed:true + previewToken. Several days: others in otherEntries, preview all first. On success no status.

## Network call sequence

Page load, employee selection and the Search button are the same as `submitManualInAndOutByAdmin`
(`beacon-reference/Manual in and out Admin/`). The edit comes from `.../Valid Swipes/`:

| Step | Calls, in order |
|---|---|
| Day on Pending | Pending tab opened (fixed → rejected), then "<date> is in the pending process for <name>, so you cannot edit or submit a manual In and Out for this date." |
| Day on Regularize / Off Shifts | that tab's fixed → rejected, then `wrongTab` with `useTool` (`submitManualInAndOutByAdmin` / `submitAdminOffShifts`) |
| **Valid Swipes tab clicked** | `GetManuallyTimeFixedData` → `GetManualRejectedData`, both with the Valid Swipes page holding the day (captured: 20 type 3 rows, the 10 locked ones disabled) |
| Breaks set | `GetEmployeeBreaksByDate` (rows' token, the day) |
| **Submit** (`confirmed: true`) | `SubmitManualAdjustment` `{PageMode: 0, ManualInOutDetailList: <the Valid Swipes page>}` → `GetGridDataByCriteria` `{FilterMode: 1, FromDateText, ToDateText, EmpNumber}` → `GetManuallyTimeFixedData` → `GetManualRejectedData` (first 20 Regularize rows) → `GetDynamicEmployeeSummary` |

The captured edit: Liam Taylor, 20/01/2025 (Flex, window 20/01 00:00 → 21/01 10:00), recorded
08:00 - 17:00 → In 20/01 09:00, Out **21/01 06:00** (Out earlier on the clock than In, on the next
date - accepted), breaks 12:00-13:00 on 20/01 and 00:00-01:00 on **21/01**.

## The In / Out fix (why)

- **All four are asked for, every time**, with the recorded values offered: a shift's In and Out
  can sit on different dates, so the dates are the user's answers like the times.
- **"In before Out" only where the shift says so** - from the row's `ShiftToolTip`: enforced when the
  allowed window lies within one day; when it runs past midnight (the captured shift) no ordering
  is applied and the server decides. Nothing about any shift is hard-coded.
- In/Out outside the window are warnings; breaks must sit within the In/Out and the window, and are
  placed on the right date (a break after midnight lands on the Out date, as captured).
- Validation never fails the tool - `validationError` with the message; `error` only for no access,
  the screen or search not opening, or the server not answering.
- Not yet replayed against the captures with a mocked `fetch`.

## Signature

```
editManualInAndOutByAdmin
```

## Arguments

_None._ All arguments are Advanced Arguments — paste `arguments.json` as-is.

## Assigned agents

- Attendance (`690dc571931a2d61ba0b1bcd`)
