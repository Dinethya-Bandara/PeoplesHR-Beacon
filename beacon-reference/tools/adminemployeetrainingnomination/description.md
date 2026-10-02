# adminEmployeeTrainingNomination

**Task:** Applying or Nominating an Employee for a Scheduled Training (Admin)

**Tags:** T&D, Aloka, phase3

**Status:** live

## Description

Lets an Admin apply or nominate one or more employees, company-wide (no reporting-line restriction), for a specific scheduled training. Resolves every named employee FIRST - before anything about the schedule is required - by replicating the real 'Select Employee' modal's own search flow (TNDV9/Common/GetEmployeeSearch -> CommonComponents/Search/Search -> GetSearchList -> GetEmpNumber -> GetSearchedEmployeeDetails). Once every employee is confirmed, resolves the schedule (scheduleId or courseName) and collects objective, relevance to job, benefit to employee, and benefit to company, then runs the real validate-then-save flow (ValidateApplyTraining -> SaveApplyTraining) with AppType 000007. This is a write tool - it submits a real training application/nomination on success. Draft - not yet live tested end-to-end (temporary debug fields included on the GetSearchedEmployeeDetails failure path).

## Signature

```
adminEmployeeTrainingNomination
```

## Arguments

_None._


## Advanced arguments

- `scheduleId` (string, optional) — The specific training schedule ID, when already known (e.g. carried over from getSelfEmployeeTrainings or getTrainingCalendarCourseDetails, or from a prior AMBIGUOUS response from this same tool). Either scheduleId or courseName must be provided - prefer courseName when the Admin only named a course, since this tool resolves the schedule itself. Only required once every named employee is already resolved - do not collect or pass this on the employees-only resolution call.
- `courseName` (string, optional) — The course name (or partial name) the Admin mentioned, e.g. 'First Aid'. Matches case-insensitively against the open schedule catalog - do not resolve this to a scheduleId yourself first; pass the course name directly and let this tool resolve it. Either scheduleId or courseName must be provided. If more than one open schedule matches, the tool returns status AMBIGUOUS with a list of candidates (each with its own scheduleId) - ask the Admin to pick one and retry with scheduleId. Only required once every named employee is already resolved - do not collect or pass this on the employees-only resolution call.
- `employees` (array, required) — The employee(s) to nominate, company-wide - not restricted to any reporting line. Pass each employee exactly as the Admin named them (a name or an employee number), e.g. ["Charlotte Taylor"] or ["000012"] - do NOT resolve these yourself with any other tool first. This tool runs the same employee search the real 'Select Employee' modal uses internally, and this is checked before anything else - the moment the Admin names who to nominate, call this tool with employees set (scheduleId/courseName and the narrative fields all omitted) to resolve them first. If a name matches more than one employee, the tool returns status AMBIGUOUS with the matching candidates (employee number, name, date joined, active status) - ask the Admin to be more specific (e.g. use the exact employee number) and retry. If a name matches no one, the tool returns status NOT_FOUND, and if none of the named employees are currently eligible for nomination it returns NOT_ELIGIBLE - resolve any of these before asking which course this is for.
- `objective` (string, required) — The objective of this training nomination. Required - the training system itself rejects a submission without this (confirmed live on the Supervisor flow: it returns 'Please specify the objective.' when blank - the same ValidateApplyTraining endpoint is used here). Only enforced once every named employee is resolved and the schedule is identified - do not ask the Admin for this before that.
- `relevanceToJob` (string, required) — How the training relates to the employee's job. Required - the training system itself rejects a submission without this (confirmed live on the Supervisor flow: it returns 'Please specify the relevance to job.' when blank). Only enforced once every named employee is resolved and the schedule is identified - do not ask the Admin for this before that.
- `benefitToEmployee` (string, required) — The benefit of this training to the employee. Required - the training system itself rejects a submission without this (confirmed live on the Supervisor flow: it returns 'Please specify the benefit to you.' when blank). Only enforced once every named employee is resolved and the schedule is identified - do not ask the Admin for this before that.
- `benefitToCompany` (string, required) — The benefit of this training to the company. Required - the training system itself rejects a submission without this (confirmed live on the Supervisor flow: it returns 'Please specify the benefit to the company.' when blank). Only enforced once every named employee is resolved and the schedule is identified - do not ask the Admin for this before that.
- `expectedLearning` (string, optional) — What the employee(s) are expected to learn from this training. Optional - stayed blank in the real successful nomination captures seen so far. Do not ask for this upfront; only collect it if the tool's response specifically requests it.


## Assigned agents

- Training and Development (`6955261cad06de92910e10aa`)
