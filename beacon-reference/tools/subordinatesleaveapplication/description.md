# subordinatesLeaveapplication

**Task:** Applying Leave for a Subordinate (Team Leave Management)

**Tags:** Absence Management, Headers, phase 3

**Status:** live

## Description

Run dateFormat first and use that format for every date; it is the only prerequisite. This tool resolves the supervisor's session, the subordinate list, the leave types and their balances itself — no separate balance or employee list tool. 
Identify the member by name; call with no arguments to list them. If more than one matches, show them and ask — never pick.
Leave balance is checked: the tool returns every type that subordinate may apply for with entitlement, used, pending and remaining days, and refuses one over the balance unless that type allows a negative one. Show balances when asking which type, and before/after in the preview.
Take every requirement from the leave type response, not hardcoded: reason, comment, covering employee and extra fields are asked only when flagged. If a comment is not mandatory don't mention it. Ask for an attachment when mandatory, offer it when optional.
Show the preview, then call again with confirmed:true.
Never display group codes, leave type codes or keys.

## Signature

```
subordinatesLeaveapplication
```

## Arguments

_None._


## Advanced arguments

- `employeeNumber` (string, optional) — The team member's employee number, e.g. 000013. Either employeeNumber or employeeName must be provided.
- `employeeName` (string, optional) — The team member's name (full or partial). Either employeeNumber or employeeName must be provided. If it matches more than one person the tool asks which one - never pick for the user.
- `leaveType` (string, optional) — Name of the leave type to apply for, e.g. 'Annual Leave', 'Casual Leave', 'Sick Leave'. Must be one of the types the tool returns as available for this employee. Ask the user if not given.
- `year` (string, required) — Leave year, e.g. 2026. Defaults to the current calendar year if it is an entitled leave year for this employee, otherwise the first available year.
- `fromDate` (string, required) — Leave start date. Use the format returned by the dateFormat tool (MM/DD/YYYY for en-US, otherwise DD/MM/YYYY). Ask the user for this if not provided.
- `toDate` (string, required) — Leave end date, in the same format as fromDate. Omit for a single-day leave application.
- `reason` (string, optional) — Reason for the leave, matched against the reasons the tool returns for this leave type. Required only when the leave type shows a Reason dropdown.
- `comment` (string, optional) — Free-text comment for the application. Required only when the leave type marks a comment as mandatory.
- `coveringEmployeeNumber` (string, optional) — Covering employee's number. Required only when the chosen leave type requires a covering employee. Checked first against the employee's recently-used covering employees, then searched.
- `coveringEmployeeName` (string, optional) — Covering employee's name, used the same way as coveringEmployeeNumber if the number is not known.
- `approverNumber` (string, optional) — Approver's employee number, from the approvers the tool lists. Only needed when more than one approver is available; otherwise the single available approver is used automatically.
- `isAttachmentMandatory` (boolean, required) — Set to true when the leave type requires a mandatory attachment (e.g., medical leave). When true, Set this field to true if the user is applying for one of the following leave types: Annual Leave, Sick Leave, or Maternity Leave.
- `additionalFields` (object, optional) — Extra per-leave-type fields, only when the tool asks for them. Keys are the exact labels the tool returns in additionalFieldsExpected (e.g. {"Sick Reason": "15/09/2026"}). Do not send this unless the tool has asked.
- `dayModes` (array, required) — Optional per-day leave mode. Omit for whole days - the system works the breakdown out itself.
- `confirmed` (boolean, optional) — Set to true only after the user has reviewed the preview (days, balance, clashes, warnings) and explicitly confirmed. Set to false (or omit) to just preview/validate.


## Assigned agents

- AbsenceManagement (`690dc571931a2d61ba0b1be3`)
- AbsenceManagementEmployee (`690dc572931a2d61ba0b1c72`)
