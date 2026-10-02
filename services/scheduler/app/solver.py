from __future__ import annotations

from collections import defaultdict
from itertools import combinations
from time import monotonic
from typing import Any

from ortools.sat.python import cp_model

from .validation import validate_schedule


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


def _day_applies(item: dict, day: str) -> bool:
    return not item.get("day") or str(item.get("day")).lower() == day.lower()


def _time_slots_for_day(semester: dict, day: str) -> list[dict]:
    candidates = [
        slot for slot in semester.get("timeSlots", [])
        if _day_applies(slot, day) and slot.get("kind", "class") == "class"
    ]
    by_index: dict[int, dict] = {}
    for slot in candidates:
        index = int(slot.get("periodIndex", 0))
        if index not in by_index or slot.get("day"):
            by_index[index] = slot
    return sorted(by_index.values(), key=lambda slot: (_minutes(slot.get("startTime")) or -1, int(slot.get("periodIndex", 0))))


def _break_overlap(semester: dict, day: str, start: int, end: int) -> bool:
    for blocked in semester.get("breakConfiguration", []):
        days = blocked.get("days") or []
        if days and day.lower() not in {str(item).lower() for item in days}:
            continue
        if _overlaps(start, end, _minutes(blocked.get("startTime")), _minutes(blocked.get("endTime"))):
            return True
    return False


def _available_for(person: dict, day: str, start: int, end: int) -> bool:
    unavailable = person.get("unavailableSlots", [])
    for slot in unavailable:
        if _day_applies(slot, day) and _overlaps(start, end, _minutes(slot.get("startTime")), _minutes(slot.get("endTime"))):
            return False
    availability = [slot for slot in person.get("availability", []) if slot.get("available", True)]
    if availability and not any(
        _day_applies(slot, day)
        and (_minutes(slot.get("startTime")) or 0) <= start
        and (_minutes(slot.get("endTime")) or 0) >= end
        for slot in availability
    ):
        return False
    return True


def _preferred_match(preferences: list, day: str, slots: list[dict]) -> bool:
    if not preferences:
        return True
    period_ids = {int(slot.get("periodIndex", 0)) for slot in slots}
    start_times = {slot.get("startTime") for slot in slots}
    for item in preferences:
        if isinstance(item, dict):
            pref_day = item.get("day")
            pref_period = item.get("periodIndex")
            pref_start = item.get("startTime")
            if (not pref_day or str(pref_day).lower() == day.lower()) and (not pref_period or int(pref_period) in period_ids) and (not pref_start or pref_start in start_times):
                return True
        elif isinstance(item, str):
            normalized = item.lower().replace("@", ":").replace("-", ":").replace(" ", ":")
            parts = [part for part in normalized.split(":") if part]
            if parts and parts[0] == day.lower():
                if len(parts) == 1:
                    return True
                try:
                    if int(parts[1]) in period_ids:
                        return True
                except ValueError:
                    if any(str(slot.get("startTime", "")).lower() == parts[1] for slot in slots):
                        return True
    return False


def _batch_scope(assignment: dict, batches: dict[str, dict]) -> list[str]:
    assigned = _id(assignment.get("batchId"))
    if not assigned:
        return list(batches)
    result = [assigned]
    frontier = [assigned]
    while frontier:
        parent = frontier.pop()
        for child_id, child in batches.items():
            if _id(child.get("parentBatchId")) == parent and child_id not in result:
                result.append(child_id)
                frontier.append(child_id)
    return result


def _external_resource_conflict(external: list[dict], assignment: dict, day: str, start: int, end: int, room_id: str) -> bool:
    for item in external:
        if str(item.get("day", "")).lower() != day.lower():
            continue
        if not _overlaps(start, end, _minutes(item.get("startTime")), _minutes(item.get("endTime"))):
            continue
        if _id(item.get("facultyId")) == _id(assignment.get("facultyId")) or _id(item.get("classroomId")) == room_id:
            return True
    return False


def _make_candidate_list(data: dict, assignment: dict, subject: dict, faculty: dict, batch_ids: list[str], rooms: dict[str, dict], days: list[str], duration: int, external: list[dict]) -> list[dict]:
    semester = data["semester"]
    required_lab = bool(subject.get("requiresLab") or assignment.get("courseType") == "Lab")
    eligible_ids = {_id(room) for room in subject.get("eligibleClassrooms", []) if _id(room)}
    configured_room = _id(assignment.get("classroomId"))
    if configured_room:
        room_ids = [configured_room]
    elif eligible_ids:
        room_ids = [room_id for room_id in eligible_ids]
    else:
        room_ids = list(rooms)
    cohort_size = max((int(data["batchMap"].get(batch_id, {}).get("studentCount", 0) or 0) for batch_id in batch_ids), default=0)
    candidates = []
    assignment_prefs = assignment.get("preferredSlots", [])
    faculty_prefs = faculty.get("preferredSlots", [])
    period_indices = []
    for day in days:
        slots = _time_slots_for_day(semester, day)
        for start_index in range(0, len(slots) - duration + 1):
            selected = slots[start_index:start_index + duration]
            if len(selected) != duration:
                continue
            indices = [int(item.get("periodIndex", 0)) for item in selected]
            start, end = _minutes(selected[0].get("startTime")), _minutes(selected[-1].get("endTime"))
            if start is None or end is None or end <= start:
                continue
            if any(indices[i] != indices[i - 1] + 1 or _minutes(selected[i - 1].get("endTime")) != _minutes(selected[i].get("startTime")) for i in range(1, len(selected))):
                continue
            if _break_overlap(semester, day, start, end):
                continue
            if not _available_for(faculty, day, start, end):
                continue
            for room_id in room_ids:
                room = rooms.get(room_id)
                if not room or room.get("active") is False:
                    continue
                if int(room.get("capacity", 0) or 0) < cohort_size:
                    continue
                room_type = room.get("roomType")
                if required_lab and room_type != "Laboratory":
                    continue
                if not required_lab and room_type == "Laboratory":
                    continue
                if not _available_for(room, day, start, end):
                    continue
                if _external_resource_conflict(external, assignment, day, start, end, room_id):
                    continue
                if _break_overlap(semester, day, start, end):
                    continue
                pref = _preferred_match(assignment_prefs, day, selected) and _preferred_match(faculty_prefs, day, selected)
                first_or_last = indices[0] == min(int(s.get("periodIndex", 0)) for s in slots) or indices[-1] == max(int(s.get("periodIndex", 0)) for s in slots)
                candidates.append({
                    "day": day,
                    "startTime": selected[0]["startTime"],
                    "endTime": selected[-1]["endTime"],
                    "periods": indices,
                    "slotRecords": selected,
                    "roomId": room_id,
                    "preferred": pref,
                    "firstOrLast": first_or_last,
                })
                period_indices.extend(indices)
    return candidates


def _diagnostic(kind: str, explanation: str, suggestion: str, **extra: Any) -> dict:
    return {"type": kind, "explanation": explanation, "suggestion": suggestion, **extra}


def _score_breakdown(schedule: list[dict], data: dict, weights: dict, objective: float) -> dict:
    faculty_by_id = {_id(item.get("_id", item.get("id"))): item for item in data.get("faculty", [])}
    day_periods: dict[tuple[str, str], set[int]] = defaultdict(set)
    preferred_missed = 0
    first_last = 0
    gap_count = 0
    consecutive_over = 0
    for session in schedule:
        fid = _id(session.get("facultyId"))
        teacher = faculty_by_id.get(fid, {})
        slots = [slot for slot in _time_slots_for_day(data["semester"], session["day"]) if _minutes(slot.get("startTime")) >= (_minutes(session["startTime"]) or 0) and _minutes(slot.get("endTime")) <= (_minutes(session["endTime"]) or 0)]
        day_periods[(fid or "", session["day"])].update(int(slot.get("periodIndex", 0)) for slot in slots)
        assignment = next((item for item in data.get("assignments", []) if _id(item.get("_id", item.get("id"))) == _id(session.get("assignmentId"))), {})
        prefs = assignment.get("preferredSlots", []) or teacher.get("preferredSlots", [])
        if prefs and not _preferred_match(prefs, session["day"], slots):
            preferred_missed += 1
        all_slots = _time_slots_for_day(data["semester"], session["day"])
        if slots and all_slots and (int(slots[0].get("periodIndex", 0)) == min(int(s.get("periodIndex", 0)) for s in all_slots) or int(slots[-1].get("periodIndex", 0)) == max(int(s.get("periodIndex", 0)) for s in all_slots)):
            first_last += 1
    for (fid, day), periods in day_periods.items():
        ordered = sorted(periods)
        for prev, current, nxt in zip(ordered, ordered[1:], ordered[2:]):
            if current - prev == 1 and nxt - current == 1 and nxt - prev == 2:
                consecutive_over += 1
    # Count faculty gaps over configured, adjacent teaching periods.
    for fid in faculty_by_id:
        for day in data["semester"].get("workingDays", []):
            all_slots = _time_slots_for_day(data["semester"], day)
            occ = day_periods.get((fid, day), set())
            for idx in range(1, len(all_slots) - 1):
                previous, current, following = all_slots[idx - 1:idx + 2]
                if _minutes(previous.get("endTime")) == _minutes(current.get("startTime")) and _minutes(current.get("endTime")) == _minutes(following.get("startTime")):
                    if int(previous.get("periodIndex", 0)) in occ and int(following.get("periodIndex", 0)) in occ and int(current.get("periodIndex", 0)) not in occ:
                        gap_count += 1
    periods_total = sum(int(item.get("duration", 0)) for item in schedule)
    raw = max(0.0, float(objective))
    scale = max(1.0, periods_total * max(1, max(weights.values(), default=1)) * 2)
    score = max(0.0, min(100.0, round(100.0 * (1.0 - min(1.0, raw / scale)), 1)))
    return {
        "optimizationScore": score,
        "objectiveValue": raw,
        "breakdown": {
            "preferredSlotMisses": preferred_missed,
            "firstOrLastPeriodSessions": first_last,
            "facultyGaps": gap_count,
            "longConsecutiveRuns": consecutive_over,
            "weights": weights,
            "interpretation": "Hard constraints are mandatory; this weighted objective only ranks valid schedules. Lower objectiveValue is better."
        }
    }


def generate_timetable(data: dict) -> dict:
    started = monotonic()
    semester = data.get("semester") or {}
    options = data.get("options") or {}
    max_seconds = max(1, min(300, int(options.get("timeLimitSeconds", 20))))
    days = [str(day) for day in semester.get("workingDays", [])]
    raw_slots = semester.get("timeSlots", [])
    class_slots = [slot for slot in raw_slots if slot.get("kind", "class") == "class"]
    assignments = [item for item in data.get("assignments", []) if item.get("active") is not False]
    subjects = {_id(item.get("_id", item.get("id"))): item for item in data.get("subjects", []) if item.get("active") is not False}
    faculties = {_id(item.get("_id", item.get("id"))): item for item in data.get("faculty", []) if item.get("active") is not False}
    batches = {_id(item.get("_id", item.get("id"))): item for item in data.get("batches", []) if item.get("active") is not False}
    rooms = {_id(item.get("_id", item.get("id"))): item for item in data.get("classrooms", []) if item.get("active") is not False}
    data["batchMap"] = batches
    diagnostics: list[dict] = []

    if not days:
        diagnostics.append(_diagnostic("CONFIGURATION", "The semester has no configured working days.", "Choose at least one working day."))
    if not class_slots:
        diagnostics.append(_diagnostic("CONFIGURATION", "The semester has no teaching time slots.", "Add class periods and keep breaks in breakConfiguration."))
    if not assignments:
        diagnostics.append(_diagnostic("MISSING_ASSIGNMENTS", "There are no active assignments for this semester.", "Create subject, faculty, and batch assignments before generating."))
    if not rooms:
        diagnostics.append(_diagnostic("MISSING_CLASSROOMS", "There are no active classrooms available.", "Add eligible lecture rooms and laboratories."))
    if not faculties:
        diagnostics.append(_diagnostic("MISSING_FACULTY", "There are no active faculty members available.", "Add active faculty and link them to assignments."))

    tasks: list[dict] = []
    for assignment in assignments:
        aid = _id(assignment.get("_id", assignment.get("id")))
        sid = _id(assignment.get("subjectId"))
        fid = _id(assignment.get("facultyId"))
        subject = subjects.get(sid)
        teacher = faculties.get(fid)
        if not subject:
            diagnostics.append(_diagnostic("INVALID_ASSIGNMENT", f"Assignment {aid} refers to a missing or inactive subject.", "Select an active subject in the selected semester.", assignmentId=aid))
            continue
        if _id(subject.get("semesterId")) != _id(semester.get("_id", semester.get("id"))):
            diagnostics.append(_diagnostic("INVALID_SEMESTER", f"Subject {subject.get('subjectCode', sid)} belongs to a different semester.", "Use a subject from this semester.", assignmentId=aid))
            continue
        if not teacher:
            diagnostics.append(_diagnostic("INVALID_ASSIGNMENT", f"Assignment {aid} refers to a missing or inactive faculty member.", "Select an active faculty member.", assignmentId=aid))
            continue
        if subject.get("eligibleFaculty") and fid not in {_id(item) for item in subject["eligibleFaculty"]}:
            diagnostics.append(_diagnostic("FACULTY_ELIGIBILITY", f"{teacher.get('name', fid)} is not eligible for {subject.get('subjectCode', 'the subject')}.", "Select a faculty member listed as eligible for the subject.", assignmentId=aid))
            continue
        batch_id = _id(assignment.get("batchId"))
        if batch_id and batch_id not in batches:
            diagnostics.append(_diagnostic("INVALID_BATCH", f"Assignment {aid} uses a batch not associated with this semester.", "Correct the batch assignment or restore the active batch.", assignmentId=aid))
            continue
        if not batch_id and not batches:
            diagnostics.append(_diagnostic("MISSING_BATCH", f"Common assignment {aid} has no active semester batches to protect from overlap.", "Add batches or assign this subject to a specific batch.", assignmentId=aid))
            continue
        weekly = int(assignment.get("weeklyPeriods", 0) or 0)
        duration = int(assignment.get("sessionDuration", 0) or 0)
        if weekly <= 0 or duration <= 0 or weekly % duration:
            diagnostics.append(_diagnostic("INVALID_WEEKLY_HOURS", f"Assignment {aid} has {weekly} weekly periods and duration {duration}; the weekly periods must be a positive multiple of session duration.", "Correct the weekly period or continuous session duration.", assignmentId=aid))
            continue
        expected_duration = int(subject.get("labDuration", 1) if assignment.get("courseType") == "Lab" else subject.get("lectureDuration", 1) or 1)
        if assignment.get("courseType") == "Lab" and duration != expected_duration:
            diagnostics.append(_diagnostic("INVALID_LAB_DURATION", f"Lab assignment {aid} uses {duration}-period blocks; subject configuration requires {expected_duration}.", "Align the assignment session duration with the configured lab duration." , assignmentId=aid))
            continue
        if assignment.get("courseType") != subject.get("courseType"):
            diagnostics.append(_diagnostic("INVALID_COURSE_TYPE", f"Assignment {aid} type does not match its subject.", "Use the subject's configured course type.", assignmentId=aid))
            continue
        if int(subject.get("weeklyPeriods", weekly) or weekly) != weekly:
            diagnostics.append(_diagnostic("WEEKLY_HOURS_MISMATCH", f"Assignment {aid} requires {weekly} periods but the subject is configured for {subject.get('weeklyPeriods')}.", "Make subject and assignment contact hours consistent.", assignmentId=aid))
            continue
        batch_ids = _batch_scope(assignment, batches)
        candidate_list = _make_candidate_list(data, assignment, subject, teacher, batch_ids, rooms, days, duration, data.get("externalSessions", []))
        if not candidate_list:
            diagnostics.append(_diagnostic("NO_ELIGIBLE_SLOT", f"No valid slot, faculty window, or suitable room is available for {subject.get('subjectCode', sid)} ({duration}-period session).", "Review breaks, room capacity/type, faculty availability, working days, and lab duration.", assignmentId=aid))
            continue
        for sequence in range(weekly // duration):
            tasks.append({"key": f"{aid}:{sequence}", "assignment": assignment, "subject": subject, "faculty": teacher, "batchIds": batch_ids, "duration": duration, "candidates": candidate_list, "locked": False})

    if diagnostics:
        status = "INFEASIBLE" if any(item["type"] not in ("CONFIGURATION", "MISSING_ASSIGNMENTS", "MISSING_CLASSROOMS", "MISSING_FACULTY") for item in diagnostics) or tasks else "MODEL_INVALID"
        return {"status": status, "schedule": [], "diagnostics": diagnostics, "solver": {"wallTimeSeconds": round(monotonic() - started, 3)}}

    weights = {
        "preferredSlot": int((options.get("weights") or {}).get("preferredSlot", 8)),
        "avoidFirstLast": int((options.get("weights") or {}).get("avoidFirstLast", 2)),
        "facultyGap": int((options.get("weights") or {}).get("facultyGap", 4)),
        "dailyBalance": int((options.get("weights") or {}).get("dailyBalance", 1)),
        "longConsecutive": int((options.get("weights") or {}).get("longConsecutive", 2)),
        "repeatSubjectSlot": int((options.get("weights") or {}).get("repeatSubjectSlot", 1)),
    }
    weights = {key: max(0, min(1000, value)) for key, value in weights.items()}
    model = cp_model.CpModel()
    x_by_task: dict[str, list[tuple[cp_model.IntVar, dict]]] = defaultdict(list)
    all_vars: list[tuple[dict, cp_model.IntVar, dict]] = []
    objective_terms = []
    resource_occupancy: dict[tuple[str, str, int], list[cp_model.IntVar]] = defaultdict(list)
    faculty_load: dict[str, list[tuple[cp_model.IntVar, int]]] = defaultdict(list)
    faculty_day_load: dict[tuple[str, str], list[tuple[cp_model.IntVar, int]]] = defaultdict(list)
    assignment_candidates: dict[str, list[tuple[dict, cp_model.IntVar, dict]]] = defaultdict(list)

    external = data.get("externalSessions", [])
    for task in tasks:
        assignment, subject, teacher = task["assignment"], task["subject"], task["faculty"]
        aid = _id(assignment.get("_id", assignment.get("id")))
        fid = _id(assignment.get("facultyId"))
        for index, candidate in enumerate(task["candidates"]):
            variable = model.NewBoolVar(f"{task['key']}_option_{index}")
            x_by_task[task["key"]].append((variable, candidate))
            all_vars.append((task, variable, candidate))
            assignment_candidates[aid].append((task, variable, candidate))
            for period in candidate["periods"]:
                resource_occupancy[(f"faculty:{fid}", candidate["day"], period)].append(variable)
                resource_occupancy[(f"classroom:{candidate['roomId']}", candidate["day"], period)].append(variable)
                for batch_id in task["batchIds"]:
                    resource_occupancy[(f"batch:{batch_id}", candidate["day"], period)].append(variable)
            faculty_load[fid].append((variable, task["duration"]))
            faculty_day_load[(fid, candidate["day"])].append((variable, task["duration"]))
            if not candidate["preferred"]:
                objective_terms.append(weights["preferredSlot"] * variable)
            if candidate["firstOrLast"]:
                objective_terms.append(weights["avoidFirstLast"] * variable)
    for task in tasks:
        task_vars = [variable for variable, _ in x_by_task[task["key"]]]
        model.AddExactlyOne(task_vars)

    for variables in resource_occupancy.values():
        if len(variables) > 1:
            model.AddAtMostOne(variables)

    # Fixed assignments from a prior version are matched against the task's candidate list.
    if options.get("preserveLockedSessions", True):
        locked_sessions = [item for item in data.get("lockedSessions", []) if item.get("locked", True)]
        task_by_assignment: dict[str, list[dict]] = defaultdict(list)
        for task in tasks:
            task_by_assignment[_id(task["assignment"].get("_id", task["assignment"].get("id")))].append(task)
        used_tasks: set[str] = set()
        for locked in locked_sessions:
            aid = _id(locked.get("assignmentId"))
            matching_task = None
            matching_var = None
            for task in task_by_assignment.get(aid, []):
                if task["key"] in used_tasks:
                    continue
                for variable, candidate in x_by_task[task["key"]]:
                    if (candidate["day"].lower() == str(locked.get("day", "")).lower()
                        and candidate["startTime"] == locked.get("startTime")
                        and candidate["endTime"] == locked.get("endTime")
and candidate["roomId"] == _id(locked.get("classroomId"))
                            and _id(task["assignment"].get("facultyId")) == _id(locked.get("facultyId"))
                            and _id(task["assignment"].get("batchId")) == _id(locked.get("batchId"))):
                            matching_task, matching_var = task, variable
                            break
                    if matching_task is not None:
                        break
            if matching_task is None or matching_var is None:
                diagnostics.append(_diagnostic("LOCKED_SESSION_INVALID", "A locked session cannot be preserved with the current assignments and time configuration.", "Unlock it or correct its assignment, room, and period configuration.", assignmentId=aid))
            else:
                model.Add(matching_var == 1)
                matching_task["locked"] = True
                used_tasks.add(matching_task["key"])
        if diagnostics:
            return {"status": "INFEASIBLE", "schedule": [], "diagnostics": diagnostics, "solver": {"wallTimeSeconds": round(monotonic() - started, 3)}}

    for fid, loads in faculty_load.items():
        limit = int(faculties.get(fid, {}).get("maxWeeklyPeriods", 10**9) or 10**9)
        model.Add(sum(variable * periods for variable, periods in loads) <= limit)
    for fid, person in faculties.items():
        required_periods = sum(int(item.get("weeklyPeriods", 0) or 0) for item in assignments if _id(item.get("facultyId")) == fid)
        target = int(round(required_periods / max(1, len(days))))
        maximum = max(1, int(person.get("maxWeeklyPeriods", 10**9) or 10**9))
        for day in days:
            loads = faculty_day_load.get((fid, day), [])
            daily_expression = sum(variable * periods for variable, periods in loads)
            model.Add(daily_expression <= int(person.get("maxDailyPeriods", 10**9) or 10**9))
            delta = model.NewIntVar(0, maximum, f"balance_{fid}_{day}")
            model.AddAbsEquality(delta, daily_expression - target)
            objective_terms.append(weights["dailyBalance"] * delta)

    # Prefer compact faculty days by penalizing one-period gaps and very long consecutive runs.
    for fid in faculties:
        for day in days:
            slots = _time_slots_for_day(semester, day)
            occupancy: list[cp_model.IntVar] = []
            for slot in slots:
                index = int(slot.get("periodIndex", 0))
                variables = resource_occupancy.get((f"faculty:{fid}", day, index), [])
                occupied = model.NewBoolVar(f"occupied_{fid}_{day}_{index}")
                if variables:
                    model.Add(occupied == sum(variables))
                else:
                    model.Add(occupied == 0)
                occupancy.append(occupied)
            for index in range(1, len(slots) - 1):
                previous, current, following = slots[index - 1:index + 2]
                contiguous = _minutes(previous.get("endTime")) == _minutes(current.get("startTime")) and _minutes(current.get("endTime")) == _minutes(following.get("startTime"))
                if contiguous:
                    gap = model.NewBoolVar(f"gap_{fid}_{day}_{index}")
                    model.AddBoolAnd([occupancy[index - 1], occupancy[index + 1], occupancy[index].Not()]).OnlyEnforceIf(gap)
                    model.AddBoolOr([occupancy[index - 1].Not(), occupancy[index + 1].Not(), occupancy[index], gap])
                    objective_terms.append(weights["facultyGap"] * gap)
            # Four consecutive periods are a soft penalty, not a hard prohibition.
            for index in range(0, max(0, len(slots) - 3)):
                chunk = slots[index:index + 4]
                if all(_minutes(chunk[j - 1].get("endTime")) == _minutes(chunk[j].get("startTime")) for j in range(1, 4)):
                    run = model.NewBoolVar(f"run4_{fid}_{day}_{index}")
                    model.AddBoolAnd(occupancy[index:index + 4]).OnlyEnforceIf(run)
                    model.AddBoolOr([item.Not() for item in occupancy[index:index + 4]] + [run])
                    objective_terms.append(weights["longConsecutive"] * run)

    # Repeating a subject at the same period of day on multiple days is discouraged.
    subject_task_options: dict[str, list[tuple[dict, cp_model.IntVar, dict]]] = defaultdict(list)
    for task, variable, candidate in all_vars:
        subject_task_options[_id(task["assignment"].get("subjectId"))].append((task, variable, candidate))
    for options_for_subject in subject_task_options.values():
        for first, second in combinations(options_for_subject, 2):
            task_a, var_a, candidate_a = first
            task_b, var_b, candidate_b = second
            if task_a["key"] == task_b["key"] or candidate_a["day"] == candidate_b["day"]:
                continue
            shared_periods = set(candidate_a["periods"]) & set(candidate_b["periods"])
            if not shared_periods:
                continue
            repeated = model.NewBoolVar(f"repeat_{len(objective_terms)}")
            model.AddBoolAnd([var_a, var_b]).OnlyEnforceIf(repeated)
            model.AddBoolOr([var_a.Not(), var_b.Not(), repeated])
            objective_terms.append(weights["repeatSubjectSlot"] * repeated)

    model.Minimize(sum(objective_terms) if objective_terms else 0)
    validation = model.Validate()
    if validation:
        return {"status": "MODEL_INVALID", "schedule": [], "diagnostics": [_diagnostic("MODEL_INVALID", validation, "Review the semester and assignment configuration.")], "solver": {"wallTimeSeconds": round(monotonic() - started, 3)}}

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_seconds
    solver.parameters.num_search_workers = max(1, min(8, int(options.get("workers", 8))))
    solver.parameters.random_seed = int(options.get("randomSeed", 7))
    result = solver.Solve(model)
    status = solver.StatusName(result)
    if result not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        message = "No timetable satisfies the configured hard constraints within the solver's search." if result == cp_model.INFEASIBLE else "The solver stopped before finding a valid timetable."
        return {
            "status": status,
            "schedule": [],
            "diagnostics": [_diagnostic("INFEASIBLE" if status == "INFEASIBLE" else status, message, "Review diagnostics, add eligible resources or availability, and try again.")],
            "solver": {"wallTimeSeconds": round(monotonic() - started, 3), "status": status, "objectiveValue": None, "bestObjectiveBound": None},
        }

    schedule = []
    locked_keys = set()
    # Tasks marked by a lock are only used for the specific selected variable; all other copies remain movable.
    locked_assignments = [item for item in data.get("lockedSessions", []) if item.get("locked", True)] if options.get("preserveLockedSessions", True) else []
    for task, variable, candidate in all_vars:
        if solver.Value(variable) != 1:
            continue
        assignment = task["assignment"]
        aid = _id(assignment.get("_id", assignment.get("id")))
        lock_match = next((locked for locked in locked_assignments if _id(locked.get("assignmentId")) == aid and locked.get("day", "").lower() == candidate["day"].lower() and locked.get("startTime") == candidate["startTime"] and locked.get("endTime") == candidate["endTime"] and _id(locked.get("classroomId")) == candidate["roomId"] and id(locked) not in locked_keys), None)
        is_locked = bool(lock_match)
        if lock_match:
            locked_keys.add(id(lock_match))
        schedule.append({
            "day": candidate["day"], "startTime": candidate["startTime"], "endTime": candidate["endTime"],
            "subjectId": _id(assignment.get("subjectId")), "facultyId": _id(assignment.get("facultyId")),
            "batchId": _id(assignment.get("batchId")), "classroomId": candidate["roomId"],
            "sessionType": assignment.get("courseType"), "duration": task["duration"], "assignmentId": aid, "locked": is_locked,
        })
    schedule.sort(key=lambda item: (days.index(item["day"]) if item["day"] in days else 999, item["startTime"], item.get("batchId") or ""))

    validation_errors = validate_schedule(data, schedule)
    if validation_errors:
        return {
            "status": "MODEL_INVALID", "schedule": [], "diagnostics": validation_errors,
            "solver": {"wallTimeSeconds": round(monotonic() - started, 3), "status": status},
        }
    objective = solver.ObjectiveValue()
    scoring = _score_breakdown(schedule, data, weights, objective)
    return {
        "status": status,
        "schedule": schedule,
        "diagnostics": [],
        "optimizationScore": scoring["optimizationScore"],
        "scoreBreakdown": scoring["breakdown"],
        "solver": {
            "wallTimeSeconds": round(monotonic() - started, 3),
            "status": status,
            "objectiveValue": objective,
            "bestObjectiveBound": solver.BestObjectiveBound(),
            "branches": solver.NumBranches(),
            "conflicts": solver.NumConflicts(),
            "timeLimitSeconds": max_seconds,
        },
    }
