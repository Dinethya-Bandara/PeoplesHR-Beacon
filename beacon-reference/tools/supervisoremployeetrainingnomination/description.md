# supervisorEmployeeTrainingNomination

**Task:** Nominating a Subordinate for a Scheduled Training (Supervisor)

**Tags:** T&D, Aloka, phase3

**Status:** live

## Description

Lets a supervisor nominate one of their subordinates for a specific scheduled training. Resolves the schedule from either scheduleId or courseName, validates the subordinate is actually one this supervisor can nominate for it — before requiring any narrative fields — then runs the real validate-then-save flow (GetAppyCourseConditions -> ValidateApplyTraining -> SaveApplyTraining). Objective, relevance to job, benefit to employee, and benefit to company are all confirmed by the live system, but only once the subordinate is confirmed eligible. This is a write tool—it submits a real training nomination on success.

## Signature

```
supervisorEmployeeTrainingNomination
```

## Arguments

_None._


## Advanced arguments

- `scheduleId` (string, optional) — The specific training schedule ID, when already known (e.g. carried over from getSelfEmployeeTrainings or getTrainingCalendarCourseDetails, or from a prior AMBIGUOUS response from this same tool). Either scheduleId or courseName must be provided - prefer courseName when the supervisor only named a course, since this tool resolves the schedule itself.
- `courseName` (string, optional) — The course name (or partial name) the supervisor mentioned, e.g. 'First Aid'. Matches case-insensitively against the open schedule catalog - do not resolve this to a scheduleId yourself first; pass the course name directly and let this tool resolve it. Either scheduleId or courseName must be provided. If more than one open schedule matches, the tool returns status AMBIGUOUS with a list of candidates (each with its own scheduleId) - ask the supervisor to pick one and retry with scheduleId.
- `subordinate` (string, required) — The subordinate's employee number or name, exactly as the supervisor said it. This tool validates it internally against the supervisor's actual direct reports for this specific schedule - do not attempt to resolve, guess, or reformat an employee number yourself, and do not ask the supervisor to confirm they are a subordinate first; the tool's response (NOT_SUBORDINATE/AMBIGUOUS/NOT_ELIGIBLE) already tells you that. This check runs before objective/relevanceToJob/benefitToEmployee/benefitToCompany are required, so it is safe to call this tool with just scheduleId/courseName + subordinate to check eligibility before collecting the narrative fields from the user.
- `objective` (string, required) — The objective of this training nomination. Required - the training system itself rejects a submission without this (confirmed live: it returns 'Please specify the objective.' when blank). Only enforced once the subordinate is confirmed eligible - do not ask the user for this before that.
- `relevanceToJob` (string, required) — How the training relates to the subordinate's job. Required - the training system itself rejects a submission without this (confirmed live: it returns 'Please specify the relevance to job.' when blank). Only enforced once the subordinate is confirmed eligible - do not ask the user for this before that.
- `benefitToEmployee` (string, required) — The benefit of this training to the subordinate. Required - the training system itself rejects a submission without this (confirmed live: it returns 'Please specify the benefit to you.' when blank). Only enforced once the subordinate is confirmed eligible - do not ask the user for this before that.
- `benefitToCompany` (string, required) — The benefit of this training to the company. Required - the training system itself rejects a submission without this (confirmed live: it returns 'Please specify the benefit to the company.' when blank). Only enforced once the subordinate is confirmed eligible - do not ask the user for this before that.
- `expectedLearning` (string, optional) — What the subordinate is expected to learn from this training. Optional - unlike objective/relevanceToJob/benefitToEmployee/benefitToCompany, this one stayed blank in a real, successful submission, so it is not required. Do not ask for this upfront; only collect it if the tool's response specifically requests it.


## Assigned agents

- Training and Development (`6955261cad06de92910e10aa`)
