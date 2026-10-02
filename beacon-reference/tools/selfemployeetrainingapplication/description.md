# selfEmployeeTrainingApplication

**Task:** Applying for a Scheduled Training (Self)

**Tags:** T&D, Aloka, phase3

**Status:** live

## Description

Lets an Employee apply for a specific scheduled training for themselves. Resolves the schedule from either scheduleId or courseName, then probes eligibility via ValidateApplyTraining (safe - it does not write anything) before requiring any narrative fields, surfacing leave-date clashes for the selected schedule along the way. Only once eligibility is confirmed does it report which of objective/relevanceToJob/benefitToEmployee/benefitToCompany are still needed; once all are supplied it runs the same validate-then-save flow (ValidateApplyTraining -> SaveApplyTraining) with AppType 000001 and an empty NomiList (self-application does not select an employee in an outgoing list - the applicant is resolved from session identity). This is a write tool - it submits a real training application on success.

## Signature

```
selfEmployeeTrainingApplication
```

## Arguments

_None._


## Advanced arguments

- `scheduleId` (string, optional) — The specific training schedule ID, when already known (e.g. carried over from getSelfEmployeeTrainings or getTrainingCalendarCourseDetails, or from a prior AMBIGUOUS response from this same tool). Either scheduleId or courseName must be provided - prefer courseName when the employee only named a course, since this tool resolves the schedule itself. Eligibility (NOT_ELIGIBLE, including already-applied) is checked as soon as the schedule is resolved, before objective/relevanceToJob/benefitToEmployee/benefitToCompany are required - so it is safe, and preferred, to call this tool first with just scheduleId/courseName to check eligibility before collecting those fields from the user. If eligible, the response has status VALIDATION_ERROR with a missingFields list - collect exactly those fields from the user, then call again with scheduleId (or courseName) plus the fields.
- `courseName` (string, optional) — The course name (or partial name) the employee mentioned, e.g. 'First Aid'. Matches case-insensitively against the open schedule catalog - do not resolve this to a scheduleId yourself first; pass the course name directly and let this tool resolve it. Either scheduleId or courseName must be provided. If more than one open schedule matches, the tool returns status AMBIGUOUS with a list of candidates (each with its own scheduleId) - ask the employee to pick one and retry with scheduleId.
- `objective` (string, required) — The objective of this training application. Required - the training system itself rejects a submission without this (confirmed live: it returns 'Please specify the objective.' when blank). Do not ask the user for this upfront - call this tool first with just scheduleId/courseName; only if the response is VALIDATION_ERROR with this field listed under missingFields should you ask the user for it and retry.
- `relevanceToJob` (string, required) — How the training relates to the employee's job. Required - the training system itself rejects a submission without this (confirmed live: it returns 'Please specify the relevance to job.' when blank). Do not ask the user for this upfront - call this tool first with just scheduleId/courseName; only if the response is VALIDATION_ERROR with this field listed under missingFields should you ask the user for it and retry.
- `benefitToEmployee` (string, required) — The benefit of this training to the employee. Required - the training system itself rejects a submission without this (confirmed live: it returns 'Please specify the benefit to you.' when blank). Do not ask the user for this upfront - call this tool first with just scheduleId/courseName; only if the response is VALIDATION_ERROR with this field listed under missingFields should you ask the user for it and retry.
- `benefitToCompany` (string, required) — The benefit of this training to the company. Required - the training system itself rejects a submission without this (confirmed live: it returns 'Please specify the benefit to the company.' when blank). Do not ask the user for this upfront - call this tool first with just scheduleId/courseName; only if the response is VALIDATION_ERROR with this field listed under missingFields should you ask the user for it and retry.
- `expectedLearning` (string, optional) — What the employee is expected to learn from this training. Optional - stayed blank in the real successful application capture seen so far. Do not ask for this upfront; only collect it if the tool's response specifically requests it.


## Assigned agents

- Training and Development (`6955261cad06de92910e10aa`)
