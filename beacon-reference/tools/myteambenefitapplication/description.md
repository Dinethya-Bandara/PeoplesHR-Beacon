# myTeamBenefitApplication

**Task:** Apply for a Team Member's Benefit Application

**Tags:** Benefits, Aloka, phase3

**Status:** unlive

## Description

Applies for a benefit on behalf of one of the signed-in supervisor's direct subordinates. Call with employeeNumber/employeeName omitted to see the supervisor's team. Once an employee is identified, call with benefitType omitted to get that employee's own real, available benefit types. Once a type is resolved, call with fieldValues omitted to get that type's real field list. Always previews first, explicitly naming who the application is for, and only submits with confirmed:true. For the signed-in employee's own benefit application, use selfEmployeeBenefitApllication instead.

## Signature

```
myTeamBenefitApplication
```

## Arguments

_None._


## Advanced arguments

- `employeeNumber` (string, optional) — The team member's employee number, exactly as the supervisor gives it (e.g. 'M00008'). Either employeeNumber or employeeName should be provided to identify who the application is for - call with both omitted to see the supervisor's direct subordinate list instead of guessing. This tool only ever resolves against the supervisor's own direct subordinates - it cannot be used to identify anyone else. For the signed-in employee's own benefit application, use selfEmployeeBenefitApllication instead.
- `employeeName` (string, optional) — The team member's name (full or partial), used the same way as employeeNumber if the number is not known. If it matches more than one direct subordinate, the tool asks which one - never guess.
- `benefitType` (string, optional) — The benefit type to apply for, exactly as named (e.g. 'Data Reimbursement'). Do not ask for a code - the tool resolves the name against the identified employee's own live, available benefit type list. Needed to actually apply, but call with it omitted (once the employee is identified) to get that employee's real available list instead of guessing.
- `fieldValues` (object, optional) — Field values for the resolved benefitType, keyed by each field's exact displayName as returned by this tool's own discovery response (call this tool with benefitType set and fieldValues omitted first to get that list, with each field's mandatory flag, data type, and - for dropdown fields - its valid options). For a dropdown field, use the option's text, never an internal code. Dates are 'DD/MM/YYYY'. Needed to actually apply, but omit it to run discovery first.
- `comment` (string, optional) — The applicant's comment for this application. Only required for benefit types where the discovery response's commentMandatory is true - check that first rather than always asking. If showComment is false for the resolved benefit type, omit this entirely.
- `confirmed` (boolean, optional) — Set true only after the supervisor has seen the preview this tool returns (which employee it's for, benefit type, every field's resolved value, comment, and any confirmMessage from Beacon itself) and has explicitly agreed to submit on that employee's behalf. Omit or set false to preview without submitting - safe to call repeatedly while the supervisor is still deciding.


## Assigned agents

- BenefitManagement (`690dc571931a2d61ba0b1be9`)
