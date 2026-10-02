# selfEmployeeTrainingNeedApplication

**Task:** Submitting a Training Need Application (Self)

**Tags:** T&D, Aloka, phase3

**Status:** live

## Description

Lets an Employee submit a training need application for themselves - either attaching it to an already-existing need category (existingNeedName) or describing a brand new one (newNeedName/newNeedDescription). The objective is either free text, or linked to one of the employee's ongoing performance goals via goalTitle - set enableGoalObjectives to browse the current goal list first if the exact title isn't already known. Relevance to job, benefit to employee, and benefit to company are collected only if the server demands them - mandatoriness is a per-client config, never assumed. Files uploaded via the Beacon chat attach automatically. Call with confirmed unset first for a preview and the real confirmation prompt, then again with confirmed:true, before anything is uploaded, validated, or saved. Runs the real validate-then-save flow (ValidateNeedApplication -> SaveNeedApplication). This is a write tool - it submits a real training need application on success.

## Signature

```
selfEmployeeTrainingNeedApplication
```

## Arguments

_None._


## Advanced arguments

- `existingNeedName` (string, optional) — The name (or partial name) of an already-existing training need category to attach this application to, e.g. 'Database & Data Management' - matches case-insensitively against the category list from getSelfTrainingNeeds' existingNeedCategories. Use this when the employee picks one of the categories already on file (UAC 3.2 - Training Need Type = 'Existing Need' on the real form) rather than describing something new. If more than one category matches, the tool returns status AMBIGUOUS with the candidates - ask the employee to pick one and retry with the exact name. Either existingNeedName or newNeedName must be provided, not both. Not required when calling purely to list ongoing goals (enableGoalObjectives: true, no goalTitle yet).
- `newNeedName` (string, optional) — The requested need, in the employee's own words, when what they need isn't already an existing category, e.g. 'Advanced Excel Macros' (UAC 3.3 - Training Need Type = 'New Need' on the real form, the 'Requested Need' field). Either existingNeedName or newNeedName must be provided, not both. Not required when calling purely to list ongoing goals (enableGoalObjectives: true, no goalTitle yet).
- `newNeedDescription` (string, optional) — A fuller description of the new requested need (the 'Requested Need Description' field on the real form). Optional even when newNeedName is given - only used alongside newNeedName, ignored for existingNeedName.
- `enableGoalObjectives` (boolean, optional) — Set true when the employee wants to link their training need's objective to one of their ongoing performance goals but hasn't picked which one yet (mirrors the real form's 'Enable Goal Objectives' checkbox, which loads the goal list straight into the Objectives dropdown). When true and goalTitle is not yet provided, this tool returns status GOALS_LISTED with the employee's current ongoing goals (ongoingGoals: [{goalTitle, goalCode}]) instead of submitting anything - present the titles, get the employee's choice, then call this tool again with goalTitle set to their exact choice (plus existingNeedName/newNeedName and the other required fields, since nothing is submitted on this listing call). Do not set this once goalTitle is already known - pass goalTitle directly instead. This is always safe to call on its own since it only reads the goal list, nothing is written.
- `objective` (string, optional) — The objective of this training need, in the employee's own words - OR link to one of the employee's ongoing performance goals via goalTitle instead (the real form's 'Enable Goal Objectives' checkbox switches this from free text to a goal picker - only one of the two is used). Whether objective/goalTitle is actually mandatory is a per-client Training & Development configuration setting (IsObjectiveMandatory) and can change - do not assume it's required and do not insist on it upfront if the employee doesn't have one in mind yet. Call this tool with whatever is known; if ValidateNeedApplication rejects the submission with 'Please specify the objective.', that confirms it's mandatory for this org - ask the employee for it then and call this tool again with the same arguments plus objective (or goalTitle) filled in.
- `goalTitle` (string, optional) — The title of one of the employee's ongoing performance goals to link this training need's objective to, instead of writing a free-text objective (the real form's 'Enable Goal Objectives' checkbox, switching the Objective field from a text box to a goal-picker dropdown). Matches case-insensitively against the employee's live ongoing-goals list. If you don't already know the employee's exact ongoing goal titles, first call this tool with enableGoalObjectives: true and no goalTitle to get the current list (status GOALS_LISTED) - do not guess or invent a title. If more than one ongoing goal shares that exact title (confirmed to happen in real data), the tool returns AMBIGUOUS and it's simpler to just provide the objective argument instead. Do not use this unless the employee explicitly wants to link the need to an existing goal - a plain-text objective is the default path.
- `relevanceToJob` (string, optional) — How this training need relates to the employee's job. Whether this is mandatory is a per-client Training & Development configuration setting (IsRelToJobMandatory) and can change between orgs - do not assume it's required and do not ask the employee for it upfront. Call this tool with whatever is known; if ValidateNeedApplication rejects the submission with 'Please specify the relevance to job.', that confirms it's mandatory for this org - ask for it then and call this tool again with the same arguments plus relevanceToJob filled in.
- `benefitToEmployee` (string, optional) — The benefit of this training need to the employee. Whether this is mandatory is a per-client Training & Development configuration setting (IsPotentialToYouMandatory) and can change between orgs - do not assume it's required and do not ask the employee for it upfront. Call this tool with whatever is known; if ValidateNeedApplication rejects the submission with 'Please specify the benefit to you.', that confirms it's mandatory for this org - ask for it then and call this tool again with the same arguments plus benefitToEmployee filled in.
- `benefitToCompany` (string, optional) — The benefit of this training need to the company. Whether this is mandatory is a per-client Training & Development configuration setting (IsPotentialToCompMandatory) and can change between orgs - do not assume it's required and do not ask the employee for it upfront. Call this tool with whatever is known; if ValidateNeedApplication rejects the submission with 'Please specify the benefit to the company.', that confirms it's mandatory for this org - ask for it then and call this tool again with the same arguments plus benefitToCompany filled in.
- `confirmed` (boolean, optional) — Set true only after the employee has reviewed a summary of this exact application (need, objective/goal, relevance to job, benefits, attachments) and explicitly agreed to submit it. Leave unset/false on the first call - the tool returns status CONFIRMATION_REQUIRED with a preview and the server's own confirmation prompt (mirrors the real form's 'Are you sure you want to submit this training need?' dialog, shown right before Save) instead of submitting anything. Nothing is uploaded, validated, or saved until this is true. Call this tool again with confirmed:true and the exact same arguments once the employee agrees.


## Assigned agents

- Training and Development (`6955261cad06de92910e10aa`)
