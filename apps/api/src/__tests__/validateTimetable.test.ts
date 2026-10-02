import { validateTimetable } from '../services/validateTimetable';

const base = (): any => ({
  semester: { _id: 'sem1', workingDays: ['Monday'], timeSlots: [
    { periodIndex: 1, startTime: '09:15', endTime: '10:15', kind: 'class' },
    { periodIndex: 2, startTime: '10:15', endTime: '11:15', kind: 'class' },
    { periodIndex: 3, startTime: '11:30', endTime: '12:30', kind: 'class' }
  ], breakConfiguration: [{ name: 'Short break', startTime: '11:15', endTime: '11:30' }] },
  assignments: [{ _id: 'a1', semesterId: 'sem1', subjectId: 's1', facultyId: 'f1', batchId: 'b1', weeklyPeriods: 1, sessionDuration: 1, courseType: 'Theory', active: true }],
  subjects: [{ _id: 's1', subjectCode: 'CS1', semesterId: 'sem1', weeklyPeriods: 1, courseType: 'Theory', active: true }],
  batches: [{ _id: 'b1', batchCode: 'B1', semesterId: 'sem1', studentCount: 20, active: true }],
  faculty: [{ _id: 'f1', name: 'Faculty One', maxDailyPeriods: 6, maxWeeklyPeriods: 24, availability: [], unavailableSlots: [], active: true }],
  classrooms: [{ _id: 'r1', roomCode: 'R1', roomName: 'Room 1', roomType: 'Lecture', capacity: 50, availability: [], active: true }],
  schedule: [{ _id: 'session1', assignmentId: 'a1', subjectId: 's1', facultyId: 'f1', batchId: 'b1', classroomId: 'r1', sessionType: 'Theory', duration: 1, day: 'Monday', startTime: '09:15', endTime: '10:15' }]
});

function addSecond(data: any, changes: any = {}) {
  data.assignments.push({ _id: 'a2', semesterId: 'sem1', subjectId: 's2', facultyId: 'f2', batchId: 'b2', weeklyPeriods: 1, sessionDuration: 1, courseType: 'Theory', active: true, ...changes.assignment });
  data.subjects.push({ _id: 's2', subjectCode: 'CS2', semesterId: 'sem1', weeklyPeriods: 1, courseType: 'Theory', active: true, ...changes.subject });
  data.batches.push({ _id: 'b2', batchCode: 'B2', semesterId: 'sem1', studentCount: 20, active: true, ...changes.batch });
  data.faculty.push({ _id: 'f2', name: 'Faculty Two', maxDailyPeriods: 6, maxWeeklyPeriods: 24, availability: [], unavailableSlots: [], active: true, ...changes.faculty });
  data.classrooms.push({ _id: 'r2', roomCode: 'R2', roomName: 'Room 2', roomType: 'Lecture', capacity: 50, availability: [], active: true, ...changes.classroom });
  data.schedule.push({ _id: 'session2', assignmentId: 'a2', subjectId: 's2', facultyId: 'f2', batchId: 'b2', classroomId: 'r2', sessionType: 'Theory', duration: 1, day: 'Monday', startTime: '09:15', endTime: '10:15', ...changes.session });
}

test('detects overlapping faculty, batch, and classroom assignments independently', () => {
  const data = base();
  addSecond(data, { assignment: { facultyId: 'f1', batchId: 'b1' }, session: { facultyId: 'f1', batchId: 'b1', classroomId: 'r1' } });
  const types = validateTimetable(data).map(item => item.type);
  expect(types).toContain('FACULTY_CONFLICT');
  expect(types).toContain('BATCH_CONFLICT');
  expect(types).toContain('CLASSROOM_CONFLICT');
});

test('checks exact weekly hours, continuous durations, and invalid batch/session edits', () => {
  const data = base();
  data.assignments[0].weeklyPeriods = 2;
  data.subjects[0].weeklyPeriods = 2;
  data.schedule[0].duration = 1;
  data.schedule[0].endTime = '11:15';
  data.assignments[0].sessionDuration = 2;
  const types = validateTimetable(data).map(item => item.type);
  expect(types).toContain('WEEKLY_HOURS');
  expect(types).toContain('INVALID_TIME_SLOT');
  expect(types).toContain('SESSION_DURATION');
});

test('rejects break overlaps and faculty availability violations', () => {
  const data = base();
  data.schedule[0].startTime = '11:15'; data.schedule[0].endTime = '12:15';
  data.faculty[0].availability = [{ day: 'Monday', startTime: '09:15', endTime: '10:15', available: true }];
  const types = validateTimetable(data).map(item => item.type);
  expect(types).toContain('BREAK_CONFLICT');
  expect(types).toContain('FACULTY_AVAILABILITY');
  expect(types).toContain('INVALID_TIME_SLOT');
});

test('manual edits are revalidated and fixed rooms cannot be bypassed', () => {
  const data = base();
  data.assignments[0].classroomId = 'r1';
  data.schedule[0].classroomId = 'r2';
  const types = validateTimetable(data).map(item => item.type);
  expect(types).toContain('CLASSROOM_MISMATCH');
  expect(types).toContain('INVALID_CLASSROOM');
});
