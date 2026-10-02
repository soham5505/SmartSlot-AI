from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from typing import Any


def _id(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, dict):
        value = value.get("_id", value.get("id"))
    return None if value is None else str(value)


def _minutes(value: str | None) -> int | None:
    try:
        hour, minute = (int(part) for part in str(value).split(":"))
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            return None
        return hour * 60 + minute
    except (ValueError, TypeError):
        return None


def _overlaps(a_start: int | None, a_end: int | None, b_start: int | None, b_end: int | None) -> bool:
    return None not in (a_start, a_end, b_start, b_end) and a_start < b_end and b_start < a_end


def _day_matches(item: dict, day: str) -> bool:
    return not item.get("day") or str(item["day"]).lower() == day.lower()


def _conflict(kind: str, session: dict | None, explanation: str, suggestion: str) -> dict:
    session = session or {}
    return {
        "type": kind,
        "day": session.get("day"),
        "time": f"{session.get('startTime', '')}–{session.get('endTime', '')}" if session.get("startTime") else None,
        "assignmentId": _id(session.get("assignmentId")),
        "subjectId": _id(session.get("subjectId")),
        "facultyId": _id(session.get("facultyId")),
        "batchId": _id(session.get("batchId")),
        "classroomId": _id(session.get("classroomId")),
        "explanation": explanation,
        "suggestion": suggestion,
    }


def validate_schedule(data: dict, schedule: list[dict]) -> list[dict]:
    """Independently validate a schedule against the semester's hard constraints."""
    conflicts: list[dict] = []
    semester = data.get("semester", {})
    assignments = { _id(x.get("_id", x.get("id"))): x for x in data.get("assignments", []) if _id(x.get("_id", x.get("id"))) }
    subjects = { _id(x.get("_id", x.get("id"))): x for x in data.get("subjects", []) if _id(x.get("_id", x.get("id"))) }
    batches = { _id(x.get("_id", x.get("id"))): x for x in data.get("batches", []) if _id(x.get("_id", x.get("id"))) }
    faculty = { _id(x.get("_id", x.get("id"))): x for x in data.get("faculty", []) if _id(x.get("_id", x.get("id"))) }
    rooms = { _id(x.get("_id", x.get("id"))): x for x in data.get("classrooms", []) if _id(x.get("_id", x.get("id"))) }
    working_days = [str(day) for day in semester.get("workingDays", [])]
    configured_slots = semester.get("timeSlots", [])
    breaks = semester.get("breakConfiguration", [])
    hours: Counter[str] = Counter()
    faculty_week: Counter[str] = Counter()
    faculty_day: Counter[tuple[str, str]] = Counter()
    prepared: list[dict] = []

    def day_slots(day: str) -> list[dict]:
        candidates = [slot for slot in configured_slots if _day_matches(slot, day) and slot.get("kind", "class") == "class"]
        # Day-specific settings override common settings with the same period index.
        by_index: dict[int, dict] = {}
        for slot in candidates:
            index = int(slot.get("periodIndex", 0))
            if index not in by_index or slot.get("day"):
                by_index[index] = slot
        return sorted(by_index.values(), key=lambda x: (_minutes(x.get("startTime")) or -1, int(x.get("periodIndex", 0))))

    for session in schedule:
        start, end = _minutes(session.get("startTime")), _minutes(session.get("endTime"))
        if start is None or end is None or start >= end:
            conflicts.append(_conflict("INVALID_TIME", session, "Session has an invalid or reversed time range.", "Choose a valid configured period."))
        aid = _id(session.get("assignmentId"))
        assignment = assignments.get(aid)
        sid = _id(session.get("subjectId"))
        subject = subjects.get(sid)
        fid = _id(session.get("facultyId"))
        teacher = faculty.get(fid)
        rid = _id(session.get("classroomId"))
        room = rooms.get(rid)
        bid = _id(session.get("batchId"))
        batch = batches.get(bid)

        if not assignment or assignment.get("active") is False:
            conflicts.append(_conflict("MISSING_ASSIGNMENT", session, "Session does not reference an active assignment.", "Restore or create the assignment, then regenerate."))
        if not subject or subject.get("active") is False:
            conflicts.append(_conflict("INVALID_SUBJECT", session, "Subject is missing or inactive.", "Use an active subject configured for this semester."))
        if not teacher or teacher.get("active") is False:
            conflicts.append(_conflict("INVALID_FACULTY", session, "Faculty member is missing or inactive.", "Assign an active, eligible faculty member."))
        if not room or room.get("active") is False:
            conflicts.append(_conflict("INVALID_CLASSROOM", session, "Classroom is missing or inactive.", "Assign an active, suitable room."))
        if not any(day.lower() == str(session.get("day", "")).lower() for day in working_days):
            conflicts.append(_conflict("INVALID_DAY", session, f"{session.get('day')} is not a configured working day.", "Move the session to a configured working day."))
        if assignment:
            if _id(assignment.get("semesterId")) != _id(semester.get("_id", semester.get("id"))) or _id(assignment.get("subjectId")) != sid or _id(assignment.get("facultyId")) != fid:
                conflicts.append(_conflict("ASSIGNMENT_MISMATCH", session, "Session does not match the semester, subject, and faculty on its assignment.", "Use the resources configured on the selected assignment."))
            if session.get("sessionType") != assignment.get("courseType"):
                conflicts.append(_conflict("COURSE_TYPE_MISMATCH", session, "Session type differs from its assignment.", "Restore the configured course type."))
            if int(session.get("duration", 0) or 0) != int(assignment.get("sessionDuration", 0) or 0):
                conflicts.append(_conflict("SESSION_DURATION", session, "Session duration differs from its configured continuous block.", "Use the assignment's configured session duration."))
            if assignment.get("classroomId") and _id(assignment.get("classroomId")) != rid:
                conflicts.append(_conflict("CLASSROOM_MISMATCH", session, "Session does not use the fixed classroom in its assignment.", "Use the fixed room or clear the assignment's room constraint."))
            assigned_batch = _id(assignment.get("batchId"))
            if assigned_batch and assigned_batch != bid:
                conflicts.append(_conflict("INVALID_BATCH", session, "Session batch differs from its assignment batch.", "Use the batch assigned to this session."))
            if not assigned_batch and bid and bid not in batches:
                conflicts.append(_conflict("INVALID_BATCH", session, "Session batch does not belong to this semester.", "Choose an active batch in this semester."))
            if _id(assignment.get("subjectId")) == sid:
                hours[aid] += int(session.get("duration", 0) or 0)
        if subject and _id(subject.get("semesterId")) != _id(semester.get("_id", semester.get("id"))):
            conflicts.append(_conflict("INVALID_SEMESTER", session, "Subject belongs to a different semester.", "Select a subject in this semester."))
        if assignment and subject and int(assignment.get("weeklyPeriods", 0) or 0) != int(subject.get("weeklyPeriods", 0) or 0):
            conflicts.append(_conflict("WEEKLY_HOURS_CONFIG", session, "Assignment periods do not match the subject's configured weekly hours.", "Make the subject and assignment hour configuration consistent."))
        if bid and not batch:
            conflicts.append(_conflict("INVALID_BATCH", session, "Batch is missing or not associated with this semester.", "Choose an active semester batch."))
        if room and batch and room.get("capacity", 0) < batch.get("studentCount", 0):
            conflicts.append(_conflict("ROOM_CAPACITY", session, f"{room.get('roomName', 'Room')} does not have capacity for this batch.", "Choose a room with sufficient capacity."))
        elif room and assignment and not assignment.get("batchId"):
            cohort_size = max((int(item.get("studentCount", 0) or 0) for item in batches.values()), default=0)
            if room.get("capacity", 0) < cohort_size:
                conflicts.append(_conflict("ROOM_CAPACITY", session, "The classroom cannot fit the largest batch participating in this common class.", "Choose a room with capacity for the full cohort."))
        if room and subject and (subject.get("requiresLab") or session.get("sessionType") == "Lab") and room.get("roomType") != "Laboratory":
            conflicts.append(_conflict("LAB_ROOM_TYPE", session, "Practical session is assigned to a non-laboratory room.", "Choose an eligible laboratory."))
        if room and subject and subject.get("eligibleClassrooms") and rid not in {_id(x) for x in subject["eligibleClassrooms"]}:
            conflicts.append(_conflict("ROOM_ELIGIBILITY", session, "Room is not eligible for this subject.", "Select a configured eligible room."))

        slots = day_slots(str(session.get("day", "")))
        selected = [slot for slot in slots if _overlaps(start, end, _minutes(slot.get("startTime")), _minutes(slot.get("endTime")))]
        selected.sort(key=lambda item: _minutes(item.get("startTime")) or -1)
        duration = int(session.get("duration", 0) or 0)
        aligned = (
            duration > 0 and len(selected) == duration and bool(selected)
            and _minutes(selected[0].get("startTime")) == start
            and _minutes(selected[-1].get("endTime")) == end
            and all(
                int(selected[index].get("periodIndex", 0)) == int(selected[index - 1].get("periodIndex", 0)) + 1
                and _minutes(selected[index - 1].get("endTime")) == _minutes(selected[index].get("startTime"))
                for index in range(1, len(selected))
            )
        )
        if not aligned:
            conflicts.append(_conflict("INVALID_TIME_SLOT", session, "Session does not fit the configured number of consecutive teaching periods.", "Move it to a valid contiguous slot or update the semester configuration."))
        for blocked in breaks:
            if blocked.get("days") and str(session.get("day", "")).lower() not in {str(day).lower() for day in blocked["days"]}:
                continue
            if _overlaps(start, end, _minutes(blocked.get("startTime")), _minutes(blocked.get("endTime"))):
                conflicts.append(_conflict("BREAK_CONFLICT", session, f"Session overlaps the {blocked.get('name', 'configured')} break.", "Move the class outside the blocked break."))

        for person, kind in ((teacher, "FACULTY_AVAILABILITY"), (room, "CLASSROOM_AVAILABILITY")):
            if not person:
                continue
            for blocked in person.get("unavailableSlots", []):
                if _day_matches(blocked, str(session.get("day", ""))) and _overlaps(start, end, _minutes(blocked.get("startTime")), _minutes(blocked.get("endTime"))):
                    conflicts.append(_conflict(kind, session, f"{person.get('name', person.get('roomName', 'Resource'))} is unavailable during this session.", "Choose another available time or resource."))
            avail = [item for item in person.get("availability", []) if item.get("available", True)]
            if avail and not any(
                _day_matches(item, str(session.get("day", "")))
                and (_minutes(item.get("startTime")) or 0) <= (start or 0)
                and (_minutes(item.get("endTime")) or 0) >= (end or 0)
                for item in avail
            ):
                conflicts.append(_conflict(kind, session, f"{person.get('name', person.get('roomName', 'Resource'))} is not available for the full session.", "Choose a time inside the declared availability."))
        if teacher:
            faculty_week[fid] += duration
            faculty_day[(fid, str(session.get("day", "")))] += duration
        prepared.append({"session": session, "assignment": assignment, "start": start, "end": end})

    for aid, assignment in assignments.items():
        if assignment.get("active") is False:
            continue
        required = int(assignment.get("weeklyPeriods", 0) or 0)
        actual = hours[aid]
        if actual != required:
            conflicts.append(_conflict("WEEKLY_HOURS", {"assignmentId": aid, "subjectId": assignment.get("subjectId"), "facultyId": assignment.get("facultyId"), "batchId": assignment.get("batchId")}, f"Assignment has {actual} scheduled periods; {required} are required.", "Adjust the sessions to meet the configured weekly contact hours."))
        for item in prepared:
            if _id(item["session"].get("assignmentId")) == aid and int(item["session"].get("duration", 0) or 0) != int(assignment.get("sessionDuration", 0) or 0):
                conflicts.append(_conflict("LAB_DURATION", item["session"], f"Session duration differs from the configured {assignment.get('sessionDuration')}-period block.", "Keep continuous practicals at the configured duration."))

    for subject in data.get("subjects", []):
        if subject.get("active") is False:
            continue
        if not any(a.get("active") is not False and _id(a.get("subjectId")) == _id(subject.get("_id", subject.get("id"))) for a in data.get("assignments", [])):
            conflicts.append(_conflict("MISSING_ASSIGNMENT", {"subjectId": _id(subject.get("_id", subject.get("id")))}, f"{subject.get('subjectCode', 'Subject')} has no active assignment.", "Create an assignment before generating the timetable."))

    def occupied_batches(entry: dict) -> set[str]:
        session, assignment = entry["session"], entry["assignment"]
        batch_id = _id(session.get("batchId"))
        if batch_id:
            # A parent-batch session occupies all of its child groups; separate child groups may run together.
            ids = {batch_id}
            frontier = [batch_id]
            while frontier:
                parent = frontier.pop()
                for child_id, child in batches.items():
                    if _id(child.get("parentBatchId")) == parent and child_id not in ids:
                        ids.add(child_id)
                        frontier.append(child_id)
            return ids
        if assignment and not assignment.get("batchId"):
            return set(batches)
        return set()

    for index, first in enumerate(prepared):
        for second in prepared[index + 1:]:
            a, b = first["session"], second["session"]
            if str(a.get("day", "")).lower() != str(b.get("day", "")).lower() or not _overlaps(first["start"], first["end"], second["start"], second["end"]):
                continue
            pairs = []
            if _id(a.get("facultyId")) and _id(a.get("facultyId")) == _id(b.get("facultyId")):
                pairs.append(("FACULTY_CONFLICT", "faculty member"))
            if occupied_batches(first) & occupied_batches(second):
                pairs.append(("BATCH_CONFLICT", "batch"))
            if _id(a.get("classroomId")) and _id(a.get("classroomId")) == _id(b.get("classroomId")):
                pairs.append(("CLASSROOM_CONFLICT", "classroom"))
            for kind, resource in pairs:
                conflicts.append(_conflict(kind, a, f"Overlaps another session for the same {resource} ({b.get('startTime')}–{b.get('endTime')}).", "Move one session or choose another eligible resource."))

    for fid, teacher in faculty.items():
        if faculty_week[fid] > int(teacher.get("maxWeeklyPeriods", 10**9)):
            conflicts.append(_conflict("FACULTY_WEEKLY_WORKLOAD", {"facultyId": fid}, f"{teacher.get('name', 'Faculty')} exceeds the weekly teaching limit.", "Reassign sessions or adjust the approved workload limit."))
    for (fid, day), periods in faculty_day.items():
        teacher = faculty.get(fid)
        if teacher and periods > int(teacher.get("maxDailyPeriods", 10**9)):
            conflicts.append(_conflict("FACULTY_DAILY_WORKLOAD", {"facultyId": fid, "day": day}, f"{teacher.get('name', 'Faculty')} exceeds the daily teaching limit on {day}.", "Distribute teaching across other days."))

    return conflicts
