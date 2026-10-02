# benefitSelfTool

**Task:** Self Employee Benefit Application

**Tags:** BenefitManagement, renamed

**Status:** draft

## Description

the existed selfEmployeeBenefitApllication tool is renamed

## Signature

```
benefitSelfTool
```

## Arguments

_None._


## Advanced arguments

- `dataReimbursement` (object, optional) — First, execute the 'getApplicationStructure' tool to retrieve and display effective years and months. The user selects a year and month, and their corresponding values (e.g., year '2025' corresponds to '1') are taken from the 'getApplicationStructure' response and used when applying the benefit.
- `fuelReimbursements` (object, optional) — First, execute the 'getApplicationStructure' tool to retrieve related data.
- `medicalReimbursement` (object, optional) — First, execute the 'getApplicationStructure' tool to retrieve related data.
- `parkingReimbursement` (object, optional)
- `telephoneBillReimbursement` (object, optional) — First, execute the 'getApplicationStructure' tool to retrieve related data. if the user any format you convert in this format dd/mm/yyy example '27/05/2025'
- `vehicleNumberRegistration` (object, optional) — First, execute the 'getApplicationStructure' tool to retrieve related data. if the user any format you convert in this format dd/mm/yyy example '27/05/2025'
- `healthPlan` (object, optional) — First, execute the 'healthPlanDependentDetails' tool to retrieve related data.

