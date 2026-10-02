# getTrainingForNeed

**Task:** Finding Training Related to a Described Need

**Tags:** T&D, Aloka, phase3

**Status:** live

## Description

Finds training needs matching a user-described requirement (e.g. 'MS Excel', 'DevOps'), grouped by the merged need category an Admin gives them (e.g. 'MS Office'). If any raw request under that category has already had a course created from it, recommends that course by name; otherwise reports the category's conversion status (Convertible/NotConvertible) so the user knows no course exists yet. Falls back to a name-based match against the course catalog when no official course link is recorded.\n

## Signature

```
getTrainingForNeed
```

## Arguments

_None._


## Advanced arguments

- `keyword` (string, required) — The core topic of what the user described their training requirement as - e.g. 'MS Excel', 'DevOps', 'git version control'. Pass just the topic/phrase itself, not the user's full sentence (e.g. pass 'git version control', not 'I want a course to learn about version control with git'). Matched word-by-word, PARTIAL match per word (e.g. 'dev' matches 'Development') against both the merged need category name and each individual raw request's own text.


## Assigned agents

- Training and Development (`6955261cad06de92910e10aa`)
