export type Conflict = {
  type: string; day?: string; time?: string; assignmentId?: string; subjectId?: string;
  facultyId?: string; batchId?: string | null; classroomId?: string; explanation: string; suggestion: string;
};
const idOf = (value: any): string | undefined => value == null ? undefined : String(value._id ?? value.id ?? value);
const toMinutes = (value: string) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return NaN;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;
const timeText = (start: string, end: string) => `${start}–${end}`;
const applies = (entry: any, day: string) => !entry.day || entry.day.toLowerCase() === day.toLowerCase();

export interface ValidationInput {
  semester: any;
  assignments: any[];
  subjects: any[];
  batches: any[];
  faculty: any[];
  classrooms: any[];
  schedule: any[];
}

export function validateTimetable(input: ValidationInput): Conflict[] {
  const { semester, assignments = [], subjects = [], batches = [], faculty = [], classrooms = [], schedule = [] } = input;
  const conflicts: Conflict[] = [];
  const assignmentMap = new Map(assignments.map(item => [idOf(item), item]));
  const subjectMap = new Map(subjects.map(item => [idOf(item), item]));
  const batchMap = new Map(batches.map(item => [idOf(item), item]));
  const facultyMap = new Map(faculty.map(item => [idOf(item), item]));
  const roomMap = new Map(classrooms.map(item => [idOf(item), item]));
  const hours = new Map<string, number>();
  const facultyPeriods = new Map<string, number>();
  const facultyDayPeriods = new Map<string, number>();

  const push = (type: string, session: any, explanation: string, suggestion: string) => conflicts.push({
    type, day: session?.day, time: session?.startTime && session?.endTime ? timeText(session.startTime, session.endTime) : undefined,
    assignmentId: idOf(session?.assignmentId), subjectId: idOf(session?.subjectId), facultyId: idOf(session?.facultyId),
    batchId: idOf(session?.batchId) ?? null, classroomId: idOf(session?.classroomId), explanation, suggestion
  });

  const days: string[] = semester?.workingDays || [];
  const slots: any[] = semester?.timeSlots || [];
  const breaks: any[] = semester?.breakConfiguration || [];
  const validIntervals = (day: string) => slots.filter(slot => (!slot.day || slot.day.toLowerCase() === day.toLowerCase()) && (slot.kind || 'class') === 'class')
    .map(slot => ({ start: toMinutes(slot.startTime), end: toMinutes(slot.endTime), index: Number(slot.periodIndex) }))
    .filter(slot => Number.isFinite(slot.start) && Number.isFinite(slot.end));

  const prepared = schedule.map((session: any) => {
    const start = toMinutes(session.startTime), end = toMinutes(session.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      push('INVALID_TIME', session, 'Session has an invalid or reversed start/end time.', 'Choose a configured time slot with a valid end time.');
    }
    const assignment = assignmentMap.get(idOf(session.assignmentId));
    const subject = subjectMap.get(idOf(session.subjectId));
    const teacher = facultyMap.get(idOf(session.facultyId));
    const room = roomMap.get(idOf(session.classroomId));
    if (!assignment || assignment.active === false) push('MISSING_ASSIGNMENT', session, 'Session does not point to an active assignment.', 'Restore or create the assignment, then regenerate the timetable.');
    if (!subject || subject.active === false) push('INVALID_SUBJECT', session, 'Session subject is missing or inactive.', 'Select an active subject assigned to this semester.');
    if (!teacher || teacher.active === false) push('INVALID_FACULTY', session, 'Session faculty member is missing or inactive.', 'Select an active faculty member eligible to teach this subject.');
    if (!room || room.active === false) push('INVALID_CLASSROOM', session, 'Session classroom is missing or inactive.', 'Select an active suitable classroom.');
    if (!days.some((day: string) => day.toLowerCase() === String(session.day).toLowerCase())) push('INVALID_DAY', session, `${session.day} is not a configured working day.`, 'Move the session to a configured working day.');
    if (assignment && (idOf(assignment.semesterId) !== idOf(semester?._id ?? semester?.id) || idOf(assignment.subjectId) !== idOf(session.subjectId) || idOf(assignment.facultyId) !== idOf(session.facultyId))) {
      push('ASSIGNMENT_MISMATCH', session, 'Session subject, faculty, or semester does not match its assignment.', 'Use the faculty and subject from the selected assignment.');
    }
    if (assignment && session.sessionType !== assignment.courseType) push('COURSE_TYPE_MISMATCH', session, 'Session type does not match its assignment course type.', 'Restore the configured theory, lab, tutorial, or project type.');
    if (assignment && Number(session.duration) !== Number(assignment.sessionDuration)) push('SESSION_DURATION', session, `Session duration differs from the configured ${assignment.sessionDuration}-period block.`, 'Keep the session at its configured consecutive-period duration.');
    if (assignment?.classroomId && idOf(assignment.classroomId) !== idOf(session.classroomId)) push('CLASSROOM_MISMATCH', session, 'Session classroom differs from the fixed classroom configured on its assignment.', 'Use the fixed assignment classroom or remove the fixed-room constraint.');
    if (assignment?.batchId && idOf(assignment.batchId) !== idOf(session.batchId)) push('INVALID_BATCH', session, 'Session batch does not match the batch assigned to this assignment.', 'Assign the session to its configured batch.');
    if (!assignment?.batchId && session.batchId && !batchMap.has(idOf(session.batchId))) push('INVALID_BATCH', session, 'Session batch does not belong to this semester.', 'Choose a batch associated with the selected semester.');
    if (subject && idOf(subject.semesterId) !== idOf(semester?._id ?? semester?.id)) push('INVALID_SEMESTER', session, 'Subject belongs to a different semester.', 'Select a subject in this semester.');
    if (assignment && subject && Number(assignment.weeklyPeriods) !== Number(subject.weeklyPeriods)) push('WEEKLY_HOURS_CONFIG', session, `Assignment requests ${assignment.weeklyPeriods} periods but the subject requires ${subject.weeklyPeriods}.`, 'Make the subject and assignment weekly contact hours consistent.');

    const daySlots = validIntervals(String(session.day));
    const selected = daySlots.filter(slot => overlaps(start, end, slot.start, slot.end)).sort((a, b) => a.start - b.start);
    const aligns = selected.length === Number(session.duration) && selected.length > 0 && selected[0].start === start && selected[selected.length - 1].end === end && selected.every((slot, i) => i === 0 || (slot.index === selected[i - 1].index + 1 && slot.start === selected[i - 1].end));
    if (!aligns) push('INVALID_TIME_SLOT', session, 'Session does not fit the configured number of consecutive teaching periods.', 'Move it to a valid contiguous slot or adjust the semester period configuration.');
    for (const br of breaks) {
      if (br.days?.length && !br.days.some((day: string) => day.toLowerCase() === String(session.day).toLowerCase())) continue;
      const bs = toMinutes(br.startTime), be = toMinutes(br.endTime);
      if (Number.isFinite(start) && Number.isFinite(end) && overlaps(start, end, bs, be)) push('BREAK_CONFLICT', session, `Session overlaps the ${br.name || 'configured'} break.`, 'Move the session outside the configured break.');
    }
    if (assignment && teacher) {
      for (const range of teacher.unavailableSlots || []) {
        if (applies(range, session.day) && overlaps(start, end, toMinutes(range.startTime), toMinutes(range.endTime))) push('FACULTY_AVAILABILITY', session, `${teacher.name} is unavailable during this session.`, 'Choose another available slot or eligible faculty member.');
      }
      const availability = (teacher.availability || []).filter((range: any) => range.available !== false);
      if (availability.length && !availability.some((range: any) => applies(range, session.day) && toMinutes(range.startTime) <= start && toMinutes(range.endTime) >= end)) push('FACULTY_AVAILABILITY', session, `${teacher.name} is not available for the entire session.`, 'Choose a slot within the faculty member’s declared availability.');
      facultyPeriods.set(idOf(teacher)!, (facultyPeriods.get(idOf(teacher)!) || 0) + Number(session.duration || 0));
      const dayKey = `${idOf(teacher)}:${session.day}`;
      facultyDayPeriods.set(dayKey, (facultyDayPeriods.get(dayKey) || 0) + Number(session.duration || 0));
    }
    if (room) {
      const availability = (room.availability || []).filter((range: any) => range.available !== false);
      if (availability.length && !availability.some((range: any) => applies(range, session.day) && toMinutes(range.startTime) <= start && toMinutes(range.endTime) >= end)) push('CLASSROOM_AVAILABILITY', session, `${room.roomName} is not available for the entire session.`, 'Choose an available classroom and slot.');
      if (subject?.requiresLab && room.roomType !== 'Laboratory') push('LAB_ROOM_TYPE', session, 'A practical subject is assigned to a non-laboratory room.', 'Move the practical to an eligible laboratory.');
      if (subject?.eligibleClassrooms?.length && !subject.eligibleClassrooms.some((item: any) => idOf(item) === idOf(room))) push('ROOM_ELIGIBILITY', session, 'Classroom is not listed as eligible for the subject.', 'Choose an eligible room with the required equipment.');
    }
    const batch = session.batchId ? batchMap.get(idOf(session.batchId)) : null;
    if (session.batchId && !batch) push('INVALID_BATCH', session, 'Session batch is not associated with this semester.', 'Choose an active batch in this semester.');
    if (room && batch && room.capacity < (batch.studentCount || 0)) push('ROOM_CAPACITY', session, `${room.roomName} capacity is below the batch size.`, 'Choose a room with sufficient capacity.');
    else if (room && assignment && !assignment.batchId && Math.max(0, ...batches.map((item: any) => Number(item.studentCount || 0))) > Number(room.capacity || 0)) push('ROOM_CAPACITY', session, `${room.roomName} cannot fit the largest batch in this common class.`, 'Choose a room with capacity for the full cohort.');
    if (assignment) hours.set(idOf(assignment)!, (hours.get(idOf(assignment)!) || 0) + Number(session.duration || 0));
    return { session, start, end, assignment, subject, teacher, room };
  });

  for (const assignment of assignments.filter(item => item.active !== false)) {
    const actual = hours.get(idOf(assignment)!) || 0;
    if (actual !== Number(assignment.weeklyPeriods)) conflicts.push({ type: 'WEEKLY_HOURS', assignmentId: idOf(assignment), subjectId: idOf(assignment.subjectId), facultyId: idOf(assignment.facultyId), batchId: idOf(assignment.batchId) ?? null, explanation: `Assignment has ${actual} scheduled periods; ${assignment.weeklyPeriods} are required.`, suggestion: 'Add or remove sessions to meet the configured weekly contact hours.' });
    const related = prepared.filter(entry => idOf(entry.session.assignmentId) === idOf(assignment));
    if (assignment.courseType === 'Lab' && related.some(entry => Number(entry.session.duration) !== Number(assignment.sessionDuration))) {
      const session = related.find(entry => Number(entry.session.duration) !== Number(assignment.sessionDuration))?.session;
      push('LAB_DURATION', session, `Session duration does not match the configured ${assignment.sessionDuration}-period block.`, 'Keep continuous practicals at their configured duration.');
    }
  }
  for (const subject of subjects.filter(item => item.active !== false)) {
    if (!assignments.some(item => item.active !== false && idOf(item.subjectId) === idOf(subject))) conflicts.push({ type: 'MISSING_ASSIGNMENT', subjectId: idOf(subject), explanation: `${subject.subjectCode || subject.subjectName} has no active assignment.`, suggestion: 'Create a faculty/batch assignment before generating.' });
  }

  const occupiedBatchIds = (entry: any): string[] => {
    const { session, assignment } = entry;
    const current = idOf(session.batchId);
    if (!current && !assignment?.batchId) return batches.map(idOf).filter(Boolean) as string[];
    if (!current) return [];
    const ids = new Set([current]);
    const queue = [current];
    while (queue.length) {
      const parent = queue.pop()!;
      for (const child of batches) {
        if (idOf(child.parentBatchId) === parent && !ids.has(idOf(child)!)) {
          ids.add(idOf(child)!); queue.push(idOf(child)!);
        }
      }
    }
    return [...ids];
  };
  for (let i = 0; i < prepared.length; i++) {
    const a = prepared[i];
    for (let j = i + 1; j < prepared.length; j++) {
      const b = prepared[j];
      if (String(a.session.day).toLowerCase() !== String(b.session.day).toLowerCase() || !overlaps(a.start, a.end, b.start, b.end)) continue;
      if (idOf(a.session.facultyId) && idOf(a.session.facultyId) === idOf(b.session.facultyId)) push('FACULTY_CONFLICT', a.session, `Overlaps another faculty session (${b.session.startTime}–${b.session.endTime}).`, 'Move one session to a non-overlapping slot or assign another eligible faculty member.');
      const sharedBatches = occupiedBatchIds(a).filter(item => occupiedBatchIds(b).includes(item));
      if (sharedBatches.length) push('BATCH_CONFLICT', a.session, `Overlaps another session for shared batch/group ${sharedBatches[0]} (${b.session.startTime}–${b.session.endTime}).`, 'Move one session or correct the parent-batch grouping.');
      if (idOf(a.session.classroomId) && idOf(a.session.classroomId) === idOf(b.session.classroomId)) push('CLASSROOM_CONFLICT', a.session, `Overlaps another classroom session (${b.session.startTime}–${b.session.endTime}).`, 'Move one session or assign another eligible room.');
    }
  }

  for (const person of faculty) {
    const weekly = facultyPeriods.get(idOf(person)!) || 0;
    if (weekly > Number(person.maxWeeklyPeriods || Infinity)) conflicts.push({ type: 'FACULTY_WEEKLY_WORKLOAD', facultyId: idOf(person), explanation: `${person.name} is scheduled for ${weekly} periods, exceeding the ${person.maxWeeklyPeriods}-period weekly limit.`, suggestion: 'Reassign sessions or raise the limit only if approved.' });
  }
  for (const [key, count] of facultyDayPeriods) {
    const [facultyId, day] = key.split(':');
    const person = facultyMap.get(facultyId);
    if (person && count > Number(person.maxDailyPeriods || Infinity)) conflicts.push({ type: 'FACULTY_DAILY_WORKLOAD', facultyId, day, explanation: `${person.name} is scheduled for ${count} periods on ${day}, exceeding the ${person.maxDailyPeriods}-period daily limit.`, suggestion: 'Distribute the faculty member’s teaching across other days.' });
  }
  return conflicts;
}
