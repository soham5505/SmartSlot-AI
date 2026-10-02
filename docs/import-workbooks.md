# Excel import templates

The API builds templates at `GET /api/import/template/:type`, where `:type` is `all` or one of `departments`, `academicYears`, `semesters`, `faculty`, `subjects`, `batches`, `classrooms`, `assignments`, or `facultyAvailability`. The `all` workbook contains one named sheet per entity. The accepted workbook type is `.xlsx`.

**This generic schema is not a ready-to-import FAMT roster.** The user-provided timetable/course-table images for AY 2026–27 Odd Semester have been visually transcribed, but faculty employee IDs/emails, room identities, some course-code collisions, and lab session lengths still need administrator input. Do not invent these fields or use the demo workbook as an API import. See the [FAMT source review](institutional-reference-review.md) and `examples/FAMT_AY2026-27_Timetable_Demo.xlsx`.

## Sheets and headers

Required headers are marked **required**. Headers are matched case-insensitively after spaces and punctuation are removed, but all data columns must still be part of the supported template. Unknown headers, duplicate headers, and populated columns without a header are reported as errors rather than silently ignored.

| Sheet | Required headers | Optional headers |
| --- | --- | --- |
| `Departments` | `code`, `name` | `description` |
| `AcademicYears` | `name`, `start_date`, `end_date` | `status` (`planned`, `active`, `completed`, `archived`) |
| `Semesters` | `department_code`, `academic_year`, `semester_number`, `semester_name`, `working_days`, `time_slots_json` | `breaks_json`, `status` (`draft`, `active`, `archived`), `configuration_verified`, `source_notes` |
| `Faculty` | `employee_id`, `name`, `email`, `department_code` | `designation`, `max_daily_periods` (default 6), `max_weekly_periods` (default 24), `availability_json`, `unavailable_slots_json`, `preferred_slots_json` |
| `Subjects` | `department_code`, `academic_year`, `semester_number`, `subject_code`, `subject_name`, `short_name`, `course_type`, `weekly_periods` | `lecture_duration` (default 1), `lab_duration` (default 2), `requires_lab`, `eligible_classroom_codes`, `eligible_faculty_employee_ids`, `needs_verification` |
| `Batches` | `department_code`, `academic_year`, `semester_number`, `batch_code`, `batch_name` | `student_count` (default 0), `batch_type` (default `standard`), `parent_batch_code`, `needs_verification` |
| `Classrooms` | `room_code`, `room_name`, `room_type`, `capacity` | `equipment`, `department_code` (blank means department-global) |
| `Assignments` | `department_code`, `academic_year`, `semester_number`, `subject_code`, `faculty_employee_id`, `weekly_periods`, `session_duration`, `course_type` | `batch_code` (blank means a common class), `room_code` (blank allows solver selection), `preferred_slots_json`, `needs_verification` |
| `FacultyAvailability` | `employee_id`, `day`, `start_time`, `end_time` | `available` (default `true`; `false` adds an unavailable window) |

`course_type` is `Theory`, `Lab`, `Tutorial`, or `Project`. `room_type` is `Lecture`, `Laboratory`, or `Seminar`. `batch_type` is `standard`, `lab-group`, `elective`, or `common`. Semester numbers are 1–12. Period/workload/capacity values must be whole numbers; required period and capacity values must be positive, and student counts may be zero. Set `needs_verification` to `true` for ambiguous subjects, batches, or assignments that require administrator review; a blank field is omitted during an update (and a new record retains the model default). Flagged active records appear as generation diagnostics errors and block timetable generation until an administrator verifies the record and clears the flag. Keep a semester `configuration_verified` set to `false` until its source version, period grid, breaks, and groups are approved.

Comma-separated text is used for `working_days`, `equipment`, eligible classroom codes, and eligible faculty employee IDs. JSON columns must contain JSON arrays. Examples below show the generic accepted shape only; their times are examples, not an approved timetable.

```json
[
  {"periodIndex": 1, "label": "Period 1", "startTime": "09:00", "endTime": "10:00", "kind": "class"},
  {"periodIndex": 2, "startTime": "10:00", "endTime": "11:00", "kind": "class"}
]
```

- `time_slots_json` entries accept optional `day`, `label`, and `kind` (`class`, `break`, `blocked`); `periodIndex`, `startTime`, and `endTime` are required. A day-specific entry may override a generic slot with the same period index.
- `breaks_json` entries use `name`, `startTime`, `endTime`, and optional `days` (an array). Breaks may not overlap a teaching period.
- `availability_json` and `unavailable_slots_json` entries use `startTime`, `endTime`, and optional `day`/`available`. Ranges require valid `HH:MM` values with the end after the start.
- Preferred-slot arrays accept the preference entries understood by the scheduler (day/period or day/start-time objects, and supported strings); they are soft preferences, not hard constraints.

## Validation and confirmation workflow

1. Download the template and fill the required headers. Do not insert formulas; the import does not evaluate them.
2. Upload the `.xlsx` file to `POST /api/import/validate` as multipart field `file`. Optional multipart booleans are `updateExisting=true` and `dryRun=true`.
3. Review the response preview and every listed error. Validation checks workbook shape/limits, required fields, dates, numeric ranges, booleans/enums, clock ranges, duplicate keys, database/workbook references, batch hierarchy, and assignment-to-subject/faculty/room compatibility. A row with an error prevents the workbook from being confirmable.
4. When validation returns `confirmAllowed: true`, explicitly submit its `importId` to `POST /api/import/confirm`. Confirmation is unavailable for dry runs. Existing keys are rejected unless `updateExisting` was deliberately selected during validation.
5. Review `/api/import/history` and, if needed, download `/api/import/history/:id/errors` as an error workbook.

Limits: 5 MiB upload, 12 worksheets, 5,000 data rows and 60 columns per sheet. Blank rows are skipped; populated cells under missing headers, formulas, unrecognized sheets/columns, and malformed JSON are reported. Rows may be reordered; references can resolve against MongoDB or another row in the same workbook. Batch parents are written before staged child batches. All clean rows are applied together at confirmation; invalid rows are never silently skipped or partially imported.

The import confirmation currently uses compensating rollback rather than a cross-document transaction. For production workloads, review the deployment note in [architecture.md](architecture.md).
