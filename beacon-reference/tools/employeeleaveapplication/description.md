# employeeLeaveApplication

**Task:** Save Leave Application

**Tags:** Absence Management, Headers, phase 3

**Status:** live

## Description

Follow this exact sequence: execute EmployeeDetails for the basic employee information, then EmployeeLogKey for the login key, then GetEmployeeLeaveBalance for the available balances.
When the user selects a leave type (e.g., "Annual Leave"), internally retrieve the corresponding leaveTypeCode and leaveGroupCode — never ask the user to input or view any codes. Then execute this tool to fetch the approver's details.
After identifying the leave type, check IsCommentMandatory from the selected leave type response: if 1, a comment is required and submission must not proceed without it; if 0, don't mention as comment required. This rule may vary by client and leave type, so never hardcode it.
If the user specifies a covering employee, allow search by name or code and use getEmpDetails to resolve the coveringEmployeeCode.
This tool previews first: show that preview to the user, then call again with confirmed:true only once they agree.
Never display group codes, leave type codes, or employee keys to the user.

## Signature

```
employeeLeaveApplication
```

## Arguments

_None._


## Advanced arguments

- `leaveTypeCode` (string, required) — To get the leave type code, use 'getEmployeeLeaveBalance' API. User provides leave type name and corresponding leave type code will be retrieved. Example: '000001'. Do not ask the user for leave type code directly.
- `leaveGroupCode` (string, required) — To get the leave group code, use 'getEmployeeLeaveBalance' API. Example: '000001'. Do not ask the user for group code directly.
- `fromDate` (string, required) — must be calling dateFormat api response format using,User provides the leave start date. Example: '08-10-2025'.
- `toDate` (string, required) — must be calling dateFormat api response format using,User provides the leave end date. Example: '12-10-2025'.
- `comment` (string, optional) — Do not ask for comment upfront.Submit first.If SaveLeaveApplication API returns 'Please specify the Comment',then ask the user for comment and retry.
- `coveringEmployeeCode` (string, optional) — Optional field, call 'getEmpDetails' tool to get the empNumber. Do not take the employeeDisplayNumber. Important only take the empNumber.
- `year` (integer, required) — User provides the year. Example: 2025, 2024, etc.
- `isAttachmentMandatory` (boolean, required) — Set to true when the leave type requires a mandatory attachment (e.g., medical leave). When true, Set this field to true if the user is applying for one of the following leave types: Annual Leave, Sick Leave, or Maternity Leave.
- `dayModes` (array, required) — Array containing each individual leave date and its corresponding day mode. Based on the from and to date range, the system will generate all dates in between and ask the user to specify the day mode for each date. For example, if user applies for 3-day leave, there will be 3 items in this array - each with a specific date and its day mode selection.
- `confirmed` (boolean, optional) — Set to true only after the user has seen the preview the tool returned (dates, day modes, total days, comment) and has explicitly agreed to submit. Omit or set false to preview and validate without saving anything.


## Assigned agents

- AbsenceManagement (`690dc571931a2d61ba0b1be3`)
