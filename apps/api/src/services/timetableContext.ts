import mongoose from 'mongoose';
import { Assignment, Batch, Classroom, Faculty, Semester, Subject } from '../models';
import { ApiError } from '../middleware/errors';
import type { AuthUser } from '../middleware/auth';

export async function loadTimetableContext(semesterId: string, user?: AuthUser) {
  if (!mongoose.isValidObjectId(semesterId)) throw new ApiError(400, 'Invalid semester id.', 'INVALID_ID');
  const semesterDoc = await Semester.findOne({ _id: semesterId, active: true });
  if (!semesterDoc) throw new ApiError(404, 'Active semester not found.', 'SEMESTER_NOT_FOUND');
  if (user?.role === 'HOD' && String(semesterDoc.departmentId) !== String(user.departmentId || '')) throw new ApiError(403, 'You can only manage timetables for your department.', 'FORBIDDEN');
  const semester = semesterDoc.toObject();
  const [assignments, subjects, batches, faculty, classrooms] = await Promise.all([
    Assignment.find({ semesterId, active: true }).lean(),
    Subject.find({ semesterId, active: true }).lean(),
    Batch.find({ semesterId, active: true }).lean(),
    Faculty.find({ departmentId: semester.departmentId, active: true }).lean(),
    Classroom.find({ $or: [{ departmentId: semester.departmentId }, { departmentId: { $exists: false } }], active: true }).lean()
  ]);
  return { semester, assignments, subjects, batches, faculty, classrooms };
}

export function getConfigurationDiagnostics(context: any) {
  const { semester, assignments, subjects, batches, faculty, classrooms } = context;
  const diagnostics: Array<{ type: string; severity: string; explanation: string; suggestion: string; assignmentId?: string }> = [];
  const add = (type: string, explanation: string, suggestion: string, assignmentId?: string) => diagnostics.push({ type, severity: 'error', explanation, suggestion, ...(assignmentId ? { assignmentId } : {}) });
  if (!semester.configurationVerified) diagnostics.push({ type: 'CONFIGURATION_UNVERIFIED', severity: 'warning', explanation: 'This semester configuration has not been verified against the college reference timetable.', suggestion: 'Review working days, period boundaries, breaks and batches before generation.' });
  if (!semester.workingDays?.length) add('MISSING_WORKING_DAYS', 'No working days are configured.', 'Configure one or more working days.');
  if (!semester.timeSlots?.some((slot: any) => !slot.kind || slot.kind === 'class')) add('MISSING_TIME_SLOTS', 'No teaching time slots are configured.', 'Add period start/end times and consecutive period indices.');
  if (!batches.length) add('MISSING_BATCHES', 'No active batches are configured for this semester.', 'Add the correct section and practical groups.');
  if (!assignments.length) add('MISSING_ASSIGNMENTS', 'No active assignments are configured for this semester.', 'Create subject, faculty and batch assignments.');
  if (!faculty.length) add('MISSING_FACULTY', 'No active department faculty are available.', 'Add active faculty and link them to assignments.');
  if (!classrooms.length) add('MISSING_CLASSROOMS', 'No active classrooms or laboratories are available.', 'Add suitable active rooms and capacities.');
  const activeAssignmentSubjects = new Set(assignments.map((item: any) => String(item.subjectId)));
  for (const subject of subjects) {
    if (!activeAssignmentSubjects.has(String(subject._id))) add('MISSING_ASSIGNMENT', `${subject.subjectCode} has no active assignment.`, 'Assign faculty, batch and a session duration.');
    if (subject.needsVerification) add('SUBJECT_NEEDS_VERIFICATION', `${subject.subjectCode} is flagged for administrator review.`, 'Verify the source subject details and clear needs_verification before generation.');
  }
  const subjectMap = new Map(subjects.map((item: any) => [String(item._id), item]));
  const batchMap = new Map<string, any>(batches.map((item: any) => [String(item._id), item]));
  for (const batch of batches) if (batch.needsVerification) add('BATCH_NEEDS_VERIFICATION', `${batch.batchCode} is flagged for administrator review.`, 'Verify the source batch/group mapping and clear needs_verification before generation.');
  for (const assignment of assignments) if (assignment.needsVerification) {
    const subject: any = subjectMap.get(String(assignment.subjectId));
    add('ASSIGNMENT_NEEDS_VERIFICATION', `${subject?.subjectCode || assignment.subjectId} assignment is flagged for administrator review.`, 'Verify the source faculty, group, weekly-period and duration details before generation.', String(assignment._id));
  }
  const facultyIds = new Set(faculty.map((item: any) => String(item._id)));
  for (const assignment of assignments) {
    const subject: any = subjectMap.get(String(assignment.subjectId));
    const id = String(assignment._id);
    if (!subject) { add('INVALID_SUBJECT', 'Assignment subject is missing or belongs to another semester.', 'Choose an active subject in this semester.', id); continue; }
    if (!facultyIds.has(String(assignment.facultyId))) add('INVALID_FACULTY', `${subject.subjectCode} assignment has no active department faculty member.`, 'Assign an active faculty member from the department.', id);
    if (assignment.batchId && !batchMap.has(String(assignment.batchId))) add('INVALID_BATCH', `${subject.subjectCode} assignment references a batch outside this semester.`, 'Choose an active batch in this semester.', id);
    if (assignment.weeklyPeriods <= 0 || assignment.sessionDuration <= 0 || assignment.weeklyPeriods % assignment.sessionDuration !== 0) add('INVALID_WEEKLY_HOURS', `${subject.subjectCode} weekly periods must be divisible by its continuous session duration.`, 'Correct the hours or session duration.', id);
    if (assignment.courseType === 'Lab' && assignment.sessionDuration !== Number(subject.labDuration || 1)) add('INVALID_LAB_DURATION', `${subject.subjectCode} lab sessions must use ${subject.labDuration} consecutive periods.`, 'Match assignment duration to the configured lab duration.', id);
    if (assignment.courseType !== subject.courseType) add('INVALID_COURSE_TYPE', `${subject.subjectCode} assignment type differs from the subject type.`, 'Make the course types consistent.', id);
    const suitableRooms = classrooms.filter((room: any) => {
      const allowed = !subject.eligibleClassrooms?.length || subject.eligibleClassrooms.some((item: any) => String(item) === String(room._id));
      const needsLab = subject.requiresLab || assignment.courseType === 'Lab';
      const batch = assignment.batchId ? batchMap.get(String(assignment.batchId)) : null;
      const capacity = batch ? Number(room.capacity) >= Number(batch.studentCount || 0) : true;
      return allowed && capacity && (needsLab ? room.roomType === 'Laboratory' : room.roomType !== 'Laboratory');
    });
    if (!suitableRooms.length) add('NO_ELIGIBLE_ROOM', `${subject.subjectCode} has no active eligible room with sufficient capacity.`, 'Add a matching room, capacity, or subject room eligibility.', id);
  }
  return diagnostics;
}
