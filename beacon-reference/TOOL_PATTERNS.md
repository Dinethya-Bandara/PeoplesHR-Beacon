# Beacon tool patterns

Auto-generated from 387 exported tool(s) and 183 function(s) by `npm run beacon:export`. Regenerated on every export — do not hand-edit; add durable notes to README.md instead.

## Permission / menu-access checks

Code that gates behavior on a user permission, role, or menu-access flag before proceeding.

- `tools/getteamattendanceapprovaldetails/transformer.js`: `const hasAccess = BeaconBar.user.metaData.menus.includes("TNAV9/AttendanceApproval/AttendanceApplication/1?mvc=1");`
- `tools/getselfemployeetrainings/transformer.js`: `const hasAccess = Array.isArray(menus) && menus.some((menu) => typeof menu === "string" && menu.includes("TNDV9/ApplyTraining/Index?mvc=1&bs=4&App=000001"));`
- `tools/gettrainingcalendarcoursedetails/transformer.js`: `const hasAccess = Array.isArray(menus) && menus.some((menu) => typeof menu === "string" && menu.includes("TNDV9/TrainingCalender/Index?mvc=1&bs=4&App=000001"));`
- `tools/getselfemployeetraininghistory/transformer.js`: `const hasAccess = Array.isArray(menus) && menus.some((menu) => typeof menu === "string" && trainingProfileMenus.some((m) => menu.includes(m)));`
- `tools/supervisoremployeetrainingnomination/transformer.js`: `const hasAccess = Array.isArray(menus) && menus.some((menu) => typeof menu === "string" && menu.includes("TNDV9/ApplyTraining/Index?mvc=1&bs=4&App=000002"));`

## Authentication headers

Requests attaching an auth/bearer/session header to an outgoing call.

- `tools/getpolicydocs/transformer.js`: `myHeaders.append("x-api-key", "your_secret_key");`

## Request construction

HTTP client usage (fetch/axios/XHR) building outbound requests.

- `tools/submitsubordinatesmanualinandout/transformer.js`: `const res = await fetch(url, {`
- `tools/submitselfmanualinandout/transformer.js`: `const res = await fetch(url, {`
- `tools/submitmanualinandoutbyadmin/transformer.js`: `const res = await fetch(url, {`
- `tools/editsubordinatesmanualinandout/transformer.js`: `const res = await fetch(url, {`
- `tools/editselfmanualinandout/transformer.js`: `const res = await fetch(url, {`

## Argument validation

Explicit checks that a required argument/field is present or well-formed.

- `tools/getteamattendanceapprovaldetails/transformer.js`: `// Validate required parameters`
- `tools/getcashbenefit/transformer.js`: `// Required WebForms fields`
- `tools/createbenefitclearanceheadinformation/transformer.js`: `// Validate required fields`
- `tools/createstationinformation/transformer.js`: `// Validate required fields`
- `tools/editstationinformation/transformer.js`: `// Validate that at least one update field is provided`

## Date formatting

Date/time formatting or parsing utilities.

- `tools/getworkflowgroups/transformer.js`: `timestamp: new Date().toISOString()`
- `tools/selfemployeeleavehistory/transformer.js`: `const formatDate = (dateStr) => {`
- `tools/leavecancelation/transformer.js`: `const formatDate = (dateStr) => {`
- `tools/getviewleavehistorydetails/transformer.js`: `const formatDate = (dateStr) => {`
- `tools/changeorupdateshiftadjustment/transformer.js`: `function formatDate(inputDate) {`

## Employee / subordinate selection

Logic that selects an employee, subordinate, or reporting-line record.

- `tools/submitsubordinatesmanualinandout/transformer.js`: `// The subordinate's search token, once the search component has issued it.`
- `tools/editsubordinatesmanualinandout/transformer.js`: `// The subordinate's search token, once the search component has issued it.`
- `tools/editbenefitclearanceheadinformation/transformer.js`: `if (args.employeeId) {`
- `tools/createbenefitclearanceheadinformation/transformer.js`: `if (!args.employeeId) {`
- `tools/getpriorovertimeapplicationdetails/transformer.js`: `employeeId : entry.EmpDisplayName || "",`

## API error handling

try/catch or status-code branching around an API call.

- `tools/submitsubordinatesmanualinandout/transformer.js`: `} catch (e) {`
- `tools/submitselfmanualinandout/transformer.js`: `} catch (e) {`
- `tools/submitmanualinandoutbyadmin/transformer.js`: `} catch (e) {`
- `tools/editsubordinatesmanualinandout/transformer.js`: `} catch (e) {`
- `tools/editselfmanualinandout/transformer.js`: `} catch (e) {`

## Response transformation

Mapping/reshaping a raw API response before returning it (typical Transformer responsibility).

- `tools/submitsubordinatesmanualinandout/transformer.js`: `const changes = list.map(function (p) {`
- `tools/submitselfmanualinandout/transformer.js`: `const changes = list.map(function (p) {`
- `tools/submitmanualinandoutbyadmin/transformer.js`: `const changes = list.map(function (p) {`
- `tools/editsubordinatesmanualinandout/transformer.js`: `const changes = list.map(function (p) {`
- `tools/editselfmanualinandout/transformer.js`: `const changes = list.map(function (p) {`

## Pagination

Page/limit/offset/cursor handling for list endpoints.

- `tools/submitsubordinatesmanualinandout/transformer.js`: `* carries exactly those flags, so the submitted page is marked the same way. */`
- `tools/submitselfmanualinandout/transformer.js`: `// Wide default period, matching what the page falls back to.`
- `tools/submitmanualinandoutbyadmin/transformer.js`: `* carries exactly those flags, so the submitted page is marked the same way. */`
- `tools/editsubordinatesmanualinandout/transformer.js`: `* search component URLs, the reason dropdown, the grid page size,`
- `tools/editselfmanualinandout/transformer.js`: `// Wide default period, matching what the page falls back to.`

## Self vs subordinate vs administrator operations

Branches that distinguish acting on your own record vs a subordinate's vs an admin-level operation.

- `tools/getlocation/transformer.js`: `administrator: document.querySelector('#ctl00_body_txtAdminName')?.value || "",`
- `tools/getcompanyhierarchydetails/transformer.js`: `administrator: getValue("#ctl00_body_txtAdminName"),`
- `tools/geteimattributelist/transformer.js`: `administrator: doc.querySelector('#ctl00_body_txtAdminName')?.value || "",`
- `tools/submitmygrievanceapplication/transformer.js`: `return "No grievance grounds are currently available. Please contact your HR administrator.";`
