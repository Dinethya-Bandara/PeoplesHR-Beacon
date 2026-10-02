# getTrainingCalendarCourseDetails

**Task:** Fetching Training Calendar Course Details

**Tags:** T&D, Aloka, phase3

**Status:** live

## Description

IMPORTANT: for full/more details on a training the user names or picked from the calendar, give date directly, or give courseCode/courseName alone and let the tool resolve the date - never answer from an earlier call that omitted date, since that leaves seat counts and cut-off dates as 0/blank placeholders.\n\nRetrieves scheduled training entries from the Training Calendar: course name, dates, seat availability, cut-off date, and approval status. Filter by course (courseCode or courseName - never ask for a code), status (Approved/Pending), or date. When a course and/or date is identified, fetches full details via GetCurrentDateCourseDetails - auto-resolving to the one scheduled date if the course has only one, or asking which date if it has several. With neither identified, browses the whole calendar via GetCourseDetails - use only for \"what is scheduled\" questions, not \"tell me more about this one.\"

## Signature

```
getTrainingCalendarCourseDetails
```

## Arguments

_None._


## Advanced arguments

- `courseCode` (string, optional) — The course code to filter the training calendar by (e.g. "000070"). Use "-1" to retrieve all courses, or omit and use courseName instead if the user names the course rather than a code. Combine with date to get FULL details (real seat counts, cut-off date, etc.) of one specific scheduled training instance the user picked from the calendar - courseCode alone (without date) only browses the calendar, where those fields are placeholders (though if that course only has one scheduled session, the tool resolves straight through to full details for it automatically).
- `courseName` (string, optional) — The course name (or partial name) the user mentioned, e.g. 'First Aid'. Matches case-insensitively against every returned schedule's course name (a substring match) - applied client-side after fetching, since the underlying calendar service only filters server-side by courseCode/status. Do not resolve this to a courseCode yourself first; pass the name directly and let this tool filter by it. Combines with date when both are given. Do not ask the user for a course code - this is resolved against the live course list automatically. If the name matches more than one course, the tool asks which one - never guess. Use this whenever the user names a course by name instead of picking one from an earlier list result.
- `status` (string, optional) — Approval status filter for the schedules.
- `date` (string, optional) — Specific date in YYYY-MM-DD format. When provided, the tool switches from browsing the calendar to fetching FULL details for the scheduled training instance(s) on that exact date - start date, end date, application cut-off date, and participation date, and REAL maxParticipants/filledSeats/availableSeats numbers. If the user asks for more/full details on a specific training they already picked from a calendar listing, you MUST call this tool AGAIN with date set (plus courseCode/courseName if they picked a specific course) - never answer using field values from an earlier browse-the-calendar result. If the user only names the course (via courseCode or courseName) and doesn't know the date, you can omit date entirely - the tool looks up that course's own scheduled date(s) itself and resolves straight through to full details when there's exactly one, or asks which date when there's more than one.


## Assigned agents

- Training and Development (`6955261cad06de92910e10aa`)
