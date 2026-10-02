import { Router } from 'express';
import mongoose from 'mongoose';
import { AcademicYear, Assignment, AuditLog, Batch, Classroom, Department, Faculty, RESOURCE_MODELS, Semester, Subject, Timetable, type ResourceName } from '../models';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { ApiError, asyncHandler } from '../middleware/errors';
import { validateResourceInput } from '../validation/resourceSchemas';

const filterFields: Record<ResourceName, string[]> = {
  departments: ['code', 'active'],
  academicYears: ['status', 'active'],
  semesters: ['departmentId', 'academicYearId', 'semesterNumber', 'status', 'active'],
  faculty: ['departmentId', 'active'],
  subjects: ['departmentId', 'semesterId', 'courseType', 'active'],
  batches: ['semesterId', 'batchType', 'active'],
  classrooms: ['departmentId', 'roomType', 'active'],
  assignments: ['semesterId', 'subjectId', 'facultyId', 'batchId', 'active']
};
const searchFields: Record<ResourceName, string[]> = {
  departments: ['name', 'code'], academicYears: ['name'], semesters: ['semesterName'],
  faculty: ['name', 'email', 'employeeId'], subjects: ['subjectName', 'subjectCode', 'shortName'],
  batches: ['batchName', 'batchCode'], classrooms: ['roomName', 'roomCode'], assignments: []
};
const modelFor = (name: ResourceName) => RESOURCE_MODELS[name] as any;

async function scopeHod(name: ResourceName, query: Record<string, any>, req: AuthRequest) {
  if (req.user?.role !== 'HOD') return query;
  const departmentId = req.user.departmentId;
  if (!departmentId) throw new ApiError(403, 'Your HOD account is not assigned to a department.', 'FORBIDDEN');
  if (name === 'departments') query._id = departmentId;
  else if (['semesters', 'faculty', 'subjects', 'classrooms'].includes(name)) query.departmentId = departmentId;
  else if (['batches', 'assignments'].includes(name)) {
    const semesterIds = await Semester.find({ departmentId }).distinct('_id');
    query.semesterId = { $in: semesterIds };
  }
  return query;
}

async function validateReferences(name: ResourceName, data: any) {
  if (name === 'semesters') {
    const [department, year] = await Promise.all([Department.findById(data.departmentId), AcademicYear.findById(data.academicYearId)]);
    if (!department?.active || !year?.active) throw new ApiError(422, 'Semester references an inactive or missing department or academic year.', 'INVALID_REFERENCE');
  }
  if (name === 'subjects') {
    const semester = await Semester.findById(data.semesterId);
    if (!semester || String(semester.departmentId) !== String(data.departmentId)) throw new ApiError(422, 'Subject department must match its semester department.', 'INVALID_REFERENCE');
  }
  if (name === 'batches') {
    if (!(await Semester.exists({ _id: data.semesterId, active: true }))) throw new ApiError(422, 'Batch semester was not found or is inactive.', 'INVALID_REFERENCE');
  }
  if (name === 'faculty' && !(await Department.exists({ _id: data.departmentId, active: true }))) throw new ApiError(422, 'Faculty department was not found or is inactive.', 'INVALID_REFERENCE');
  if (name === 'assignments') {
    if (data.weeklyPeriods % data.sessionDuration !== 0) throw new ApiError(422, 'Weekly periods must be divisible by session duration.', 'INVALID_SESSION_HOURS');
    const [semester, subject, faculty, batch, room] = await Promise.all([
      Semester.findOne({ _id: data.semesterId, active: true }), Subject.findOne({ _id: data.subjectId, active: true }),
      Faculty.findOne({ _id: data.facultyId, active: true }), data.batchId ? Batch.findOne({ _id: data.batchId, semesterId: data.semesterId, active: true }) : Promise.resolve(null),
      data.classroomId ? Classroom.findOne({ _id: data.classroomId, active: true }) : Promise.resolve(null)
    ]);
    if (!semester || !subject || String(subject.semesterId) !== String(data.semesterId) || !faculty) throw new ApiError(422, 'Assignment must reference an active subject in this semester and an active faculty member.', 'INVALID_REFERENCE');
    if (data.batchId && !batch) throw new ApiError(422, 'Assignment batch must belong to the selected semester.', 'INVALID_REFERENCE');
    if (data.classroomId && !room) throw new ApiError(422, 'Assignment classroom was not found or is inactive.', 'INVALID_REFERENCE');
    if (data.courseType !== subject.courseType) throw new ApiError(422, 'Assignment course type must match its subject.', 'INVALID_COURSE_TYPE');
    if (data.courseType === 'Lab' && data.sessionDuration < (subject.labDuration || 1)) throw new ApiError(422, 'Lab session duration is shorter than the subject lab duration.', 'INVALID_LAB_DURATION');
  }
}

async function assertWriteScope(name: ResourceName, data: any, req: AuthRequest) {
  if (req.user?.role !== 'HOD') return;
  const departmentId = req.user.departmentId;
  if (!departmentId) throw new ApiError(403, 'Your HOD account is not assigned to a department.', 'FORBIDDEN');
  if (name === 'departments' || name === 'academicYears') throw new ApiError(403, 'Only administrators can manage global department and academic-year records.', 'FORBIDDEN');
  if (name === 'semesters' || name === 'faculty' || name === 'subjects' || name === 'classrooms') {
    if (String(data.departmentId || '') !== String(departmentId)) throw new ApiError(403, 'You can only manage records in your department.', 'FORBIDDEN');
    return;
  }
  const semesterId = data.semesterId;
  const semester = semesterId ? await Semester.findById(semesterId).select('departmentId') : null;
  if (!semester || String(semester.departmentId) !== String(departmentId)) throw new ApiError(403, 'You can only manage records for semesters in your department.', 'FORBIDDEN');
}

async function logChange(req: AuthRequest, action: string, entityType: string, entityId: mongoose.Types.ObjectId, changes: unknown) {
  if (!req.user) return;
  await AuditLog.create({ actorId: req.user.id, action, entityType, entityId, changes, requestId: req.header('x-request-id') });
}

export function createResourceRouter(name: ResourceName) {
  const router = Router();
  const Model = modelFor(name);
  router.use(authenticate);

  router.get('/', authorize('Admin', 'HOD', 'Faculty', 'Student'), asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const query: Record<string, any> = {};
    for (const field of filterFields[name]) {
      const value = req.query[field];
      if (value !== undefined && value !== '') query[field] = value;
    }
    if (req.query.search && searchFields[name].length) {
      const term = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
      query.$or = searchFields[name].map(field => ({ [field]: { $regex: term, $options: 'i' } }));
    }
    if (req.user?.role === 'Student') {
      if (!['semesters', 'subjects', 'batches'].includes(name)) throw new ApiError(403, 'Student accounts can only access published timetable study groups and subjects.', 'FORBIDDEN');
      const semesterIds = await Timetable.find({ published: true }).distinct('semesterId');
      if (name === 'semesters') query._id = { $in: semesterIds };
      else query.semesterId = { $in: semesterIds };
      query.active = true;
    }
    if (req.user?.role === 'Faculty') {
      if (name === 'faculty') query._id = req.user.facultyId || '000000000000000000000000';
      else if (name === 'assignments') query.facultyId = req.user.facultyId || '000000000000000000000000';
      else if (name !== 'subjects' && name !== 'semesters' && name !== 'batches' && name !== 'classrooms') throw new ApiError(403, 'This account cannot access that resource.', 'FORBIDDEN');
    }
    await scopeHod(name, query, req as AuthRequest);
    const [data, total] = await Promise.all([
      Model.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Model.countDocuments(query)
    ]);
    res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  }));

  router.get('/:id', authorize('Admin', 'HOD', 'Faculty'), asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid record id.', 'INVALID_ID');
    const query: Record<string, any> = { _id: req.params.id };
    if (req.user?.role === 'Faculty' && name === 'faculty') query._id = req.user.facultyId;
    await scopeHod(name, query, req as AuthRequest);
    const record = await Model.findOne(query).lean();
    if (!record) throw new ApiError(404, 'Record not found.', 'NOT_FOUND');
    res.json({ data: record });
  }));

  router.post('/', ['departments', 'academicYears'].includes(name) ? authorize('Admin') : authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
    const parsed = validateResourceInput(name, req.body);
    if (!parsed.success) throw new ApiError(400, 'Check the record fields and try again.', 'VALIDATION_ERROR', parsed.error.flatten());
    await assertWriteScope(name, parsed.data, req as AuthRequest);
    await validateReferences(name, parsed.data);
    const created = await Model.create(parsed.data);
    await logChange(req as AuthRequest, 'create', name, created._id, { after: created.toObject() });
    res.status(201).json({ data: created });
  }));

  router.put('/:id', ['departments', 'academicYears'].includes(name) ? authorize('Admin') : authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid record id.', 'INVALID_ID');
    const parsed = validateResourceInput(name, req.body, true);
    if (!parsed.success) throw new ApiError(400, 'Check the record fields and try again.', 'VALIDATION_ERROR', parsed.error.flatten());
    const query: Record<string, any> = { _id: req.params.id };
    await scopeHod(name, query, req as AuthRequest);
    const before = await Model.findOne(query).lean();
    if (!before) throw new ApiError(404, 'Record not found.', 'NOT_FOUND');
    const merged = { ...before, ...parsed.data };
    await assertWriteScope(name, merged, req as AuthRequest);
    await validateReferences(name, merged);
    const updated = await Model.findOneAndUpdate(query, { $set: parsed.data }, { new: true, runValidators: true });
    await logChange(req as AuthRequest, 'update', name, updated._id, { before, after: updated.toObject() });
    res.json({ data: updated });
  }));

  router.delete('/:id', authorize('Admin'), asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid record id.', 'INVALID_ID');
    const record = await Model.findById(req.params.id);
    if (!record) throw new ApiError(404, 'Record not found.', 'NOT_FOUND');
    const before = record.toObject();
    if ('status' in record && name === 'academicYears') record.status = 'archived';
    else if ('status' in record && name === 'semesters') record.status = 'archived';
    else record.active = false;
    await record.save();
    await logChange(req as AuthRequest, 'deactivate', name, record._id, { before, after: record.toObject() });
    res.json({ data: { id: String(record._id), archived: true } });
  }));

  return router;
}
