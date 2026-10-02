import { getConfigurationDiagnostics } from '../services/timetableContext';

const baseContext = () => ({
  semester: {
    configurationVerified: true,
    workingDays: ['Monday'],
    timeSlots: [{ periodIndex: 1, startTime: '09:00', endTime: '10:00', kind: 'class' }]
  },
  assignments: [{
    _id: 'assignment-1', subjectId: 'subject-1', facultyId: 'faculty-1', batchId: 'batch-1',
    weeklyPeriods: 1, sessionDuration: 1, courseType: 'Theory', needsVerification: true
  }],
  subjects: [{
    _id: 'subject-1', subjectCode: 'IT301', courseType: 'Theory', weeklyPeriods: 1,
    labDuration: 2, requiresLab: false, eligibleClassrooms: [], needsVerification: true
  }],
  batches: [{ _id: 'batch-1', batchCode: 'B1', studentCount: 20, needsVerification: true }],
  faculty: [{ _id: 'faculty-1' }],
  classrooms: [{ _id: 'room-1', roomType: 'Lecture', capacity: 30 }]
});

test('unverified subject, batch, and assignment records block timetable generation diagnostics', () => {
  const diagnostics = getConfigurationDiagnostics(baseContext());
  expect(diagnostics.filter(item => item.severity === 'error').map(item => item.type)).toEqual(expect.arrayContaining([
    'SUBJECT_NEEDS_VERIFICATION', 'BATCH_NEEDS_VERIFICATION', 'ASSIGNMENT_NEEDS_VERIFICATION'
  ]));
});

test('cleared verification flags do not leave stale needs-review diagnostics', () => {
  const context = baseContext();
  context.subjects[0].needsVerification = false;
  context.batches[0].needsVerification = false;
  context.assignments[0].needsVerification = false;
  const diagnostics = getConfigurationDiagnostics(context);
  expect(diagnostics.some(item => item.type.endsWith('_NEEDS_VERIFICATION'))).toBe(false);
});
