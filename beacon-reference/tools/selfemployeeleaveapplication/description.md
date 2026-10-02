# selfEmployeeLeaveApplication

**Task:** Self Employee Leave Application

**Tags:** Absent Management, Headers, phase3

**Status:** live

## Description

For self leave queries (my, self, apply leave, check my, me), first call selfEmployeeLeaveBalance to fetch available balances. When the user picks a leave type, take leaveTypeCode and leaveGroupCode from that response; never ask for or show these codes. If a covering employee is specified, allow search by name/code and resolve EmployeeNumber using getEmpDetails API. Always ask for a leave comment/reason. After identifying the leave type, check IsCommentMandatory from the selected leave type API response: if 1 a comment is required and must not be skipped; if 0 it is optional. Never hardcode this - it varies by client and leave type. Check IsAttachmentRequired too: if 1, set isAttachmentMandatory true and ask the user to attach the document - the tool uploads any file attached to the chat. The tool previews first: show that preview to the user, then call again with confirmed:true only once they agree. Show only user-friendly names and hide all internal codes throughout the flow.

## Signature

```
selfEmployeeLeaveApplication
```

## Arguments

_None._


## Advanced arguments

- `leaveTypeCode` (string, required) — To get the leave type code, use 'selfEmployeeLeaveBalance' API. User provides leave type name and corresponding leave type code will be retrieved. Example: '000001'. Do not ask the user for leave type code directly.
- `leaveGroupCode` (string, required) — To get the leave group code, use 'selfEmployeeLeaveBalance' API. Example: '000001'. Do not ask the user for group code directly.
- `fromDate` (string, required) — User provides the leave from date.
- `toDate` (string, required) — User provides the leave to date.
- `coveringEmployeeCode` (string, optional) — Optional field, call 'getEmpDetails' tool to get the empNumber. Do not take the employeeDisplayNumber. Important only take the empNumber.
- `comment` (string, optional) — Do not ask for comment upfront.Submit first.If SaveLeaveApplication API returns 'Please specify the Comment',then ask the user for comment and retry.
- `leaveReason` (string, optional) — Can be optional or required depending on the leave application configuration. Used when the Leave Application page has a Reason for Leave / Leave Classification dropdown. The user provides the displayed reason/classification name, such as 'Childbirth', 'Personal commitments', or 'Urgent family matters'. The transformer will internally map this displayed name to the corresponding ReasonCode from the page model ReasonList. Do not ask for this field unless the dropdown is mandatory or the SaveLeaveApplication API returns a validation message requiring a reason/classification.
- `year` (integer, required) — User provides the year. Example: 2025, 2024, etc.
- `isAttachmentMandatory` (boolean, required) — Set to true when the leave type requires a mandatory attachment (e.g., medical leave). Set this field to true if the user is applying for one of the following leave types: Annual Leave, Sick Leave, or Maternity Leave.
- `dayModes` (array, required) — Array containing each individual leave date and its corresponding day mode. Based on the from and to date range, the system will generate all dates in between and ask the user to specify the day mode for each date. For example, if user applies for 3-day leave, there will be 3 items in this array - each with a specific date and its day mode selection.
- `confirmed` (boolean, optional) — Set to true only after the user has seen the preview the tool returned (dates, day modes, total days, comment, attachment) and has explicitly agreed to submit. Omit or set false to preview and validate without saving anything.


## Assigned agents

- AbsenceManagementEmployee (`690dc572931a2d61ba0b1c72`)
