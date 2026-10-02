import { ApiError } from '../middleware/errors';
import { assertLockedSessionsPreserved } from '../services/lockedSessions';

const locked = { _id: 'session-1', day: 'Monday', startTime: '09:15', endTime: '10:15', subjectId: 's1', facultyId: 'f1', batchId: 'b1', classroomId: 'r1', sessionType: 'Theory', duration: 1, assignmentId: 'a1', locked: true };

test('allows unchanged locked sessions during edits', () => {
  expect(() => assertLockedSessionsPreserved([locked], [{ ...locked }])).not.toThrow();
});

test.each([
  ['move', { day: 'Tuesday' }], ['change faculty', { facultyId: 'f2' }], ['change room', { classroomId: 'r2' }], ['unlock', { locked: false }]
])('rejects a locked session edit: %s', (_label, change) => {
  try {
    assertLockedSessionsPreserved([locked], [{ ...locked, ...change }]);
    throw new Error('Expected a lock violation.');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('LOCKED_SESSION_CHANGE');
  }
});

test('rejects deletion of a locked session', () => {
  expect(() => assertLockedSessionsPreserved([locked], [])).toThrow(ApiError);
});
