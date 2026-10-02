from __future__ import annotations

from copy import deepcopy

from services.scheduler.app.solver import generate_timetable
from services.scheduler.app.validation import validate_schedule


def base_data(days=None, slots=None):
    days = days or ["Monday", "Tuesday"]
    slots = slots or [
        {"periodIndex": 1, "startTime": "09:15", "endTime": "10:15", "kind": "class"},
        {"periodIndex": 2, "startTime": "10:15", "endTime": "11:15", "kind": "class"},
        {"periodIndex": 3, "startTime": "11:30", "endTime": "12:30", "kind": "class"},
    ]
    return {
        "semester": {
            "_id": "sem-1", "semesterNumber": 3, "workingDays": days, "timeSlots": slots,
            "breakConfiguration": [{"name": "Short break", "startTime": "11:15", "endTime": "11:30"}],
        },
        "assignments": [], "subjects": [], "batches": [], "faculty": [], "classrooms": [],
        "options": {"timeLimitSeconds": 3, "randomSeed": 42}, "lockedSessions": [], "externalSessions": [],
    }


def add_resources(data, *, batch_ids=("b1",), faculty_ids=("f1",), room_ids=("r1",), subject_ids=("s1",), room_type="Lecture", batch_size=30):
    data["batches"] = [{"_id": bid, "batchCode": bid.upper(), "semesterId": "sem-1", "studentCount": batch_size, "batchType": "standard", "active": True} for bid in batch_ids]
    data["faculty"] = [{"_id": fid, "name": fid.upper(), "maxDailyPeriods": 8, "maxWeeklyPeriods": 40, "availability": [], "unavailableSlots": [], "active": True} for fid in faculty_ids]
    data["classrooms"] = [{"_id": rid, "roomCode": rid.upper(), "roomName": rid.upper(), "roomType": room_type, "capacity": 60, "availability": [], "unavailableSlots": [], "equipment": [], "active": True} for rid in room_ids]
    data["subjects"] = [{"_id": sid, "subjectCode": sid.upper(), "subjectName": sid.upper(), "shortName": sid.upper(), "semesterId": "sem-1", "courseType": "Theory", "weeklyPeriods": 1, "lectureDuration": 1, "labDuration": 2, "requiresLab": False, "active": True} for sid in subject_ids]
    return data


def add_assignment(data, aid, sid, fid, bid, rid=None, *, weekly=1, duration=1, course_type="Theory"):
    data["assignments"].append({"_id": aid, "semesterId": "sem-1", "subjectId": sid, "facultyId": fid, "batchId": bid, "classroomId": rid, "weeklyPeriods": weekly, "sessionDuration": duration, "courseType": course_type, "active": True})


def overlaps(first, second):
    return first["day"] == second["day"] and first["startTime"] < second["endTime"] and second["startTime"] < first["endTime"]


def test_faculty_conflict_prevention():
    data = add_resources(base_data(), batch_ids=("b1", "b2"), faculty_ids=("f1",), room_ids=("r1", "r2"), subject_ids=("s1", "s2"))
    add_assignment(data, "a1", "s1", "f1", "b1", "r1")
    add_assignment(data, "a2", "s2", "f1", "b2", "r2")
    result = generate_timetable(data)
    assert result["status"] in ("OPTIMAL", "FEASIBLE")
    sessions = result["schedule"]
    assert not overlaps(sessions[0], sessions[1])
    assert not any(item["type"] == "FACULTY_CONFLICT" for item in validate_schedule(data, sessions))


def test_batch_conflict_prevention():
    data = add_resources(base_data(), batch_ids=("b1",), faculty_ids=("f1", "f2"), room_ids=("r1", "r2"), subject_ids=("s1", "s2"))
    add_assignment(data, "a1", "s1", "f1", "b1", "r1")
    add_assignment(data, "a2", "s2", "f2", "b1", "r2")
    result = generate_timetable(data)
    assert result["status"] in ("OPTIMAL", "FEASIBLE")
    assert not overlaps(*result["schedule"])
    assert not any(item["type"] == "BATCH_CONFLICT" for item in validate_schedule(data, result["schedule"]))


def test_classroom_conflict_prevention():
    data = add_resources(base_data(), batch_ids=("b1", "b2"), faculty_ids=("f1", "f2"), room_ids=("r1",), subject_ids=("s1", "s2"))
    add_assignment(data, "a1", "s1", "f1", "b1", "r1")
    add_assignment(data, "a2", "s2", "f2", "b2", "r1")
    result = generate_timetable(data)
    assert result["status"] in ("OPTIMAL", "FEASIBLE")
    assert not overlaps(*result["schedule"])
    assert not any(item["type"] == "CLASSROOM_CONFLICT" for item in validate_schedule(data, result["schedule"]))


def test_weekly_periods_are_fully_scheduled_and_mismatch_is_detected():
    data = add_resources(base_data(), subject_ids=("s1",))
    data["subjects"][0]["weeklyPeriods"] = 2
    add_assignment(data, "a1", "s1", "f1", "b1", "r1", weekly=2, duration=1)
    result = generate_timetable(data)
    assert result["status"] in ("OPTIMAL", "FEASIBLE")
    assert sum(item["duration"] for item in result["schedule"]) == 2
    assert not any(item["type"] == "WEEKLY_HOURS" for item in validate_schedule(data, result["schedule"]))
    invalid = validate_schedule(data, result["schedule"][:1])
    assert any(item["type"] == "WEEKLY_HOURS" for item in invalid)


def test_lab_duration_is_contiguous_and_enforced():
    slots = [
        {"periodIndex": 1, "startTime": "09:15", "endTime": "10:15", "kind": "class"},
        {"periodIndex": 2, "startTime": "10:15", "endTime": "11:15", "kind": "class"},
        {"periodIndex": 3, "startTime": "11:30", "endTime": "12:30", "kind": "class"},
    ]
    data = add_resources(base_data(days=["Monday"], slots=slots), room_type="Laboratory", subject_ids=("s1",))
    subject = data["subjects"][0]; subject["courseType"] = "Lab"; subject["requiresLab"] = True; subject["weeklyPeriods"] = 2
    add_assignment(data, "a1", "s1", "f1", "b1", "r1", weekly=2, duration=2, course_type="Lab")
    result = generate_timetable(data)
    assert result["status"] in ("OPTIMAL", "FEASIBLE")
    session = result["schedule"][0]
    assert session["duration"] == 2
    assert (session["startTime"], session["endTime"]) == ("09:15", "11:15")
    assert not any(item["type"] in ("INVALID_TIME_SLOT", "LAB_DURATION") for item in validate_schedule(data, result["schedule"]))
    broken = deepcopy(result["schedule"]); broken[0]["duration"] = 1; broken[0]["endTime"] = "10:15"
    assert any(item["type"] in ("LAB_DURATION", "WEEKLY_HOURS") for item in validate_schedule(data, broken))


def test_breaks_and_faculty_availability_are_respected():
    data = add_resources(base_data(days=["Monday"], slots=[
        {"periodIndex": 1, "startTime": "09:15", "endTime": "10:15", "kind": "class"},
        {"periodIndex": 2, "startTime": "10:15", "endTime": "11:15", "kind": "class"},
        {"periodIndex": 3, "startTime": "11:15", "endTime": "11:30", "kind": "class"},
        {"periodIndex": 4, "startTime": "11:30", "endTime": "12:30", "kind": "class"},
    ]), subject_ids=("s1",))
    data["faculty"][0]["availability"] = [{"day": "Monday", "startTime": "11:30", "endTime": "12:30", "available": True}]
    data["faculty"][0]["unavailableSlots"] = [{"day": "Monday", "startTime": "11:15", "endTime": "11:30"}]
    add_assignment(data, "a1", "s1", "f1", "b1", "r1")
    result = generate_timetable(data)
    assert result["status"] in ("OPTIMAL", "FEASIBLE")
    assert result["schedule"][0]["startTime"] == "11:30"
    assert not any(item["type"] in ("BREAK_CONFLICT", "FACULTY_AVAILABILITY") for item in validate_schedule(data, result["schedule"]))


def test_parallel_practicals_for_distinct_batches_can_share_a_slot():
    slots = [
        {"periodIndex": 1, "startTime": "09:15", "endTime": "10:15", "kind": "class"},
        {"periodIndex": 2, "startTime": "10:15", "endTime": "11:15", "kind": "class"},
    ]
    data = add_resources(base_data(days=["Monday"], slots=slots), batch_ids=("b1", "b2"), faculty_ids=("f1", "f2"), room_ids=("r1", "r2"), subject_ids=("s1", "s2"), room_type="Laboratory")
    for subject in data["subjects"]:
        subject.update({"courseType": "Lab", "requiresLab": True, "weeklyPeriods": 2, "labDuration": 2})
    add_assignment(data, "a1", "s1", "f1", "b1", "r1", weekly=2, duration=2, course_type="Lab")
    add_assignment(data, "a2", "s2", "f2", "b2", "r2", weekly=2, duration=2, course_type="Lab")
    result = generate_timetable(data)
    assert result["status"] in ("OPTIMAL", "FEASIBLE")
    assert len(result["schedule"]) == 2
    assert result["schedule"][0]["startTime"] == result["schedule"][1]["startTime"] == "09:15"
    assert not validate_schedule(data, result["schedule"])


def test_locked_session_is_preserved_during_regeneration():
    data = add_resources(base_data(), subject_ids=("s1",))
    add_assignment(data, "a1", "s1", "f1", "b1", "r1")
    first = generate_timetable(data)
    locked = {**first["schedule"][0], "locked": True}
    regenerated = deepcopy(data)
    regenerated["lockedSessions"] = [locked]
    regenerated["options"]["preserveLockedSessions"] = True
    second = generate_timetable(regenerated)
    assert second["status"] in ("OPTIMAL", "FEASIBLE")
    preserved = next(item for item in second["schedule"] if item["assignmentId"] == "a1")
    for field in ("day", "startTime", "endTime", "facultyId", "batchId", "classroomId"):
        assert preserved[field] == locked[field]
    assert preserved["locked"] is True


def test_infeasible_configuration_reports_diagnostic_instead_of_invalid_schedule():
    data = add_resources(base_data(days=["Monday"], slots=[{"periodIndex": 1, "startTime": "09:15", "endTime": "10:15", "kind": "class"}]), batch_ids=("b1", "b2"), faculty_ids=("f1",), room_ids=("r1", "r2"), subject_ids=("s1", "s2"))
    add_assignment(data, "a1", "s1", "f1", "b1", "r1")
    add_assignment(data, "a2", "s2", "f1", "b2", "r2")
    result = generate_timetable(data)
    assert result["status"] == "INFEASIBLE"
    assert result["schedule"] == []
    assert result["diagnostics"]


def test_separate_semesters_generate_independently():
    first_data = add_resources(base_data(), subject_ids=("s1",))
    add_assignment(first_data, "a1", "s1", "f1", "b1", "r1")
    second_data = add_resources(base_data(), subject_ids=("s2",))
    second_data["semester"]["_id"] = "sem-2"
    second_data["subjects"][0]["semesterId"] = "sem-2"
    second_data["assignments"] = []
    add_assignment(second_data, "a2", "s2", "f1", "b1", "r1")
    second_data["assignments"][0]["semesterId"] = "sem-2"
    assert generate_timetable(first_data)["status"] in ("OPTIMAL", "FEASIBLE")
    assert generate_timetable(second_data)["status"] in ("OPTIMAL", "FEASIBLE")
