# getSelfTrainingNeeds

**Task:** Displaying Existing Training Needs (Self)

**Tags:** T&D, Aloka, phase3

**Status:** live

## Description

Lists the training needs already on file for the logged-in employee: the master list of company-wide existing need categories (e.g. 'DevOps & Development Practices') plus every individual need record visible in the employee's own scope, each with status/objective/relevance/benefit fields. Shown before/while logging a new training need so the user can see what's already on record instead of duplicating it. Supports an optional keyword filter - word-based PARTIAL match (e.g. 'dev' matches 'Development'), not literal substring or exact-word matching.\n\nThis is the default variant - use it for any generic 'what training needs exist/are available' question.\nDo not ask the user whether they are a Supervisor or Admin; only switch to getSupervisorTrainingNeeds or getAdminTrainingNeeds when the request itself explicitly names a broader scope (their team, or company-wide).

## Signature

```
getSelfTrainingNeeds
```

## Arguments

_None._


## Advanced arguments

- `keyword` (string, optional) — A word or phrase to narrow the results by (e.g. 'MS Excel', 'DevOps', 'backend dev'). Matched word-by-word, PARTIAL match per word (e.g. 'dev' matches 'Development', 'backend' matches 'Backend') against both the existing need category names and the individual needs. Every word must partially match somewhere in the target text, in any order. Optional - omit to list everything on file.


## Assigned agents

- Training and Development (`6955261cad06de92910e10aa`)
