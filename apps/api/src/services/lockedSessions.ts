import { ApiError } from '../middleware/errors';

const protectedFields = ['day', 'startTime', 'endTime', 'subjectId', 'facultyId', 'batchId', 'classroomId', 'sessionType', 'duration', 'assignmentId'];

export function assertLockedSessionsPreserved(existingSchedule: any[], nextSchedule: any[]) {
  for (const locked of existingSchedule.filter(session => session.locked)) {
    const updated = nextSchedule.find(session => String(session._id || '') === String(locked._id));
    const unchanged = updated && protectedFields.every(field => (updated[field] == null ? null : String(updated[field])) === (locked[field] == null ? null : String(locked[field])));
    if (!unchanged || updated.locked !== true) throw new ApiError(422, 'A locked timetable session cannot be moved, replaced, deleted, or unlocked during editing.', 'LOCKED_SESSION_CHANGE', { sessionId: String(locked._id) });
  }
}
