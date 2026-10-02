import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Assignment, AuditLog, Batch, Classroom, Faculty, Semester, Subject, Timetable } from '../models';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { ApiError, asyncHandler } from '../middleware/errors';
import { getConfigurationDiagnostics, loadTimetableContext } from '../services/timetableContext';
import { validateTimetable } from '../services/validateTimetable';
import { assertLockedSessionsPreserved } from '../services/lockedSessions';
import { buildTimetablePdfBuffer, buildTimetableWorkbook } from '../services/exports';

const router = Router();
const idSchema = z.string().regex(/^[a-f\d]{24}$/i);
const generateSchema = z.object({
  semesterId: idSchema,
  options: z.object({
    timeLimitSeconds: z.number().int().min(1).max(300).optional(),
    preserveLockedSessions: z.boolean().optional(),
    weights: z.record(z.number().int().min(0).max(1000)).optional(),
    randomSeed: z.number().int().optional()
  }).optional()
});
const idOf = (value: any) => value == null ? undefined : String(value._id ?? value.id ?? value);

async function requestScheduler(path: string, payload: unknown) {
  const base = (process.env.SCHEDULER_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const token = process.env.SCHEDULER_API_TOKEN;
  if (!token) throw new ApiError(503, 'Scheduling service is not configured.', 'SCHEDULER_NOT_CONFIGURED');
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(310_000)
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(response.status === 503 ? 503 : 502, data.detail || 'Scheduling service returned an error.', 'SCHEDULER_ERROR');
    return data;
  } catch (error: any) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Scheduling service is unavailable. Start the Python scheduler and check SCHEDULER_URL.', 'SCHEDULER_UNAVAILABLE');
  }
}

async function audit(user: any, action: string, timetable: any, changes: unknown) {
  const entry = await AuditLog.create({ actorId: user.id, action, entityType: 'Timetable', entityId: timetable._id, changes });
  timetable.auditTrail = [...(timetable.auditTrail || []), entry._id];
  await timetable.save();
}

async function createGeneration(user: any, semesterId: string, options: any = {}, prior?: any) {
  const context = await loadTimetableContext(semesterId, user);
  const diagnostics = getConfigurationDiagnostics(context);
  const errors = diagnostics.filter(item => item.severity === 'error');
  if (errors.length) {
    return { httpStatus: 422, data: { status: 'INFEASIBLE', diagnostics, timetable: null } };
  }
  if (!context.semester.configurationVerified && !options.allowUnverifiedConfiguration) {
    return { httpStatus: 422, data: { status: 'MODEL_INVALID', diagnostics: [...diagnostics, { type: 'CONFIGURATION_VERIFICATION_REQUIRED', severity: 'error', explanation: 'Generation is disabled until the semester configuration is reviewed.', suggestion: 'Verify the working days, periods, breaks, batches, and reference-derived details.' }], timetable: null } };
  }
  const existing = prior || await Timetable.findOne({ semesterId }).sort({ version: -1 });
  const preserve = options.preserveLockedSessions !== false;
  const lockedSessions = preserve ? (existing?.schedule || []).filter((item: any) => item.locked).map((item: any) => item.toObject ? item.toObject() : item) : [];
  const otherTimetables = await Timetable.find({ semesterId: { $ne: semesterId }, published: true }).select('semesterId schedule').lean();
  const externalSessions = otherTimetables.flatMap((item: any) => item.schedule || []);
  const payload = {
    ...context,
    externalSessions,
    lockedSessions,
    options: { ...options, preserveLockedSessions: preserve }
  };
  const result = await requestScheduler('/generate', payload);
  let schedule = result.schedule || [];
  let independentErrors: any[] = [];
  const isSolution = result.status === 'FEASIBLE' || result.status === 'OPTIMAL';
  if (isSolution) {
    independentErrors = validateTimetable({ ...context, schedule });
    if (independentErrors.length) {
      result.status = 'MODEL_INVALID';
      result.diagnostics = independentErrors;
      schedule = [];
    }
  }
  const previous = await Timetable.findOne({ semesterId }).sort({ version: -1 }).select('version');
  const version = (previous?.version || 0) + 1;
  const generationStatus = result.status;
  const validationResults = isSolution && !independentErrors.length ? [] : [...(result.diagnostics || []), ...independentErrors];
  const record = await Timetable.create({
    semesterId,
    academicYearId: context.semester.academicYearId,
    version,
    generationStatus,
    generatedBy: user.id,
    schedule,
    validationResults,
    optimizationScore: isSolution && !independentErrors.length ? result.optimizationScore : undefined,
    scoreBreakdown: isSolution && !independentErrors.length ? result.scoreBreakdown : {},
    published: false,
    locked: false
  });
  await audit(user, 'generate', record, { version, generationStatus, options: { ...options, preserveLockedSessions: preserve } });
  const response = { status: generationStatus, diagnostics: validationResults, solver: result.solver, optimizationScore: record.optimizationScore, scoreBreakdown: record.scoreBreakdown, data: record };
  return { httpStatus: isSolution && !independentErrors.length ? 201 : 422, data: response };
}

router.get('/diagnostics/:semesterId', authenticate, authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
  const context = await loadTimetableContext(String(req.params.semesterId), (req as AuthRequest).user);
  const diagnostics = getConfigurationDiagnostics(context);
  res.json({ data: { canGenerate: !diagnostics.some(item => item.severity === 'error') && context.semester.configurationVerified, diagnostics } });
}));

router.post('/generate', authenticate, authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'A valid semesterId is required.', 'VALIDATION_ERROR', parsed.error.flatten());
  const result = await createGeneration((req as AuthRequest).user!, parsed.data.semesterId, parsed.data.options || {});
  res.status(result.httpStatus).json(result.data);
}));

router.get('/semester/:semesterId/compare', authenticate, authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
  await loadTimetableContext(String(req.params.semesterId), (req as AuthRequest).user);
  const versions = await Timetable.find({ semesterId: String(req.params.semesterId) }).sort({ version: -1 }).limit(20).lean();
  res.json({ data: versions.map((item: any) => ({ id: String(item._id), version: item.version, generationStatus: item.generationStatus, generatedAt: item.generationDate, optimizationScore: item.optimizationScore, published: item.published, sessionCount: item.schedule.length, validationCount: item.validationResults.length })) });
}));

router.get('/', authenticate, authorize('Admin', 'HOD', 'Faculty', 'Student'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const query: any = {};
  if (req.query.semesterId) query.semesterId = req.query.semesterId;
  if (req.query.academicYearId) query.academicYearId = req.query.academicYearId;
  if (req.query.published === 'true' || req.user?.role === 'Student') query.published = true;
  if (req.user?.role === 'HOD') {
    const semesterIds = await Semester.find({ departmentId: req.user.departmentId }).distinct('_id');
    query.semesterId = { $in: semesterIds };
  }
  const [records, total] = await Promise.all([Timetable.find(query).sort({ generationDate: -1 }).skip((page - 1) * limit).limit(limit).lean(), Timetable.countDocuments(query)]);
  const semesterDocs = await Semester.find({ _id: { $in: records.map((item: any) => item.semesterId) } }).select('semesterName semesterNumber').lean();
  const semesterMap = new Map(semesterDocs.map((item: any) => [String(item._id), item]));
  let data: any[] = records.map((record: any) => ({ ...record, semesterName: semesterMap.get(String(record.semesterId))?.semesterName, semesterNumber: semesterMap.get(String(record.semesterId))?.semesterNumber }));
  if (req.user?.role === 'Faculty') data = data.map((record: any) => ({ ...record, schedule: record.schedule.filter((item: any) => String(item.facultyId) === String(req.user?.facultyId)) })).filter((record: any) => record.schedule.length);
  res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get('/:id/validate', authenticate, authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
  const timetable = await Timetable.findById(req.params.id);
  if (!timetable) throw new ApiError(404, 'Timetable not found.', 'NOT_FOUND');
  const context = await loadTimetableContext(String(timetable.semesterId), (req as AuthRequest).user);
  const conflicts = validateTimetable({ ...context, schedule: timetable.schedule });
  res.json({ data: { valid: conflicts.length === 0, conflicts } });
}));

router.post('/:id/validate', authenticate, authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
  const timetable = await Timetable.findById(req.params.id);
  if (!timetable) throw new ApiError(404, 'Timetable not found.', 'NOT_FOUND');
  const context = await loadTimetableContext(String(timetable.semesterId), (req as AuthRequest).user);
  const conflicts = validateTimetable({ ...context, schedule: timetable.schedule });
  res.json({ data: { valid: conflicts.length === 0, conflicts } });
}));

router.put('/:id', authenticate, authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
  const timetable = await Timetable.findById(req.params.id);
  if (!timetable) throw new ApiError(404, 'Timetable not found.', 'NOT_FOUND');
  if (timetable.locked || timetable.published) throw new ApiError(409, 'Published or locked timetables cannot be edited. Create a new version or unlock it first.', 'TIMETABLE_LOCKED');
  if (!Array.isArray(req.body.schedule)) throw new ApiError(400, 'schedule must be an array.', 'VALIDATION_ERROR');
  const context = await loadTimetableContext(String(timetable.semesterId), (req as AuthRequest).user);
  assertLockedSessionsPreserved(timetable.schedule, req.body.schedule);
  const conflicts = validateTimetable({ ...context, schedule: req.body.schedule });
  if (conflicts.length && req.body.allowDraftWithConflicts !== true) throw new ApiError(422, 'The edit introduces hard timetable conflicts and was not saved.', 'TIMETABLE_CONFLICTS', conflicts);
  const before = timetable.schedule.toObject ? timetable.schedule.toObject() : [...timetable.schedule];
  timetable.schedule = req.body.schedule;
  timetable.validationResults = conflicts;
  timetable.generationStatus = conflicts.length ? 'DRAFT' : 'FEASIBLE';
  timetable.published = false;
  timetable.optimizationScore = undefined;
  await timetable.save();
  await audit((req as AuthRequest).user!, 'edit', timetable, { before, after: timetable.schedule.toObject ? timetable.schedule.toObject() : timetable.schedule });
  res.json({ data: timetable, validation: { valid: conflicts.length === 0, conflicts } });
}));

router.post('/:id/regenerate', authenticate, authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
  const source = await Timetable.findById(req.params.id);
  if (!source) throw new ApiError(404, 'Timetable not found.', 'NOT_FOUND');
  if (source.locked || source.published) throw new ApiError(409, 'A published or locked version cannot be regenerated in place. Generate a new version from the semester instead.', 'TIMETABLE_LOCKED');
  const options = z.object({ timeLimitSeconds: z.number().int().min(1).max(300).optional(), preserveLockedSessions: z.boolean().optional(), weights: z.record(z.number().int().min(0).max(1000)).optional() }).parse(req.body || {});
  const result = await createGeneration((req as AuthRequest).user!, String(source.semesterId), options, source);
  res.status(result.httpStatus).json(result.data);
}));

router.post('/:id/publish', authenticate, authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
  const timetable = await Timetable.findById(req.params.id);
  if (!timetable) throw new ApiError(404, 'Timetable not found.', 'NOT_FOUND');
  if (timetable.generationStatus !== 'OPTIMAL' && timetable.generationStatus !== 'FEASIBLE') throw new ApiError(409, 'Only a feasible or optimal timetable can be published.', 'INVALID_TIMETABLE_STATUS');
  const context = await loadTimetableContext(String(timetable.semesterId), (req as AuthRequest).user);
  const reviewDiagnostics = getConfigurationDiagnostics(context);
  const reviewBlockers = reviewDiagnostics.filter(item => item.severity === 'error');
  if (!context.semester.configurationVerified) reviewBlockers.push({ type: 'CONFIGURATION_VERIFICATION_REQUIRED', severity: 'error', explanation: 'The semester configuration has not been approved against its institutional source.', suggestion: 'Verify the period grid, breaks, and group mapping before publication.' });
  if (reviewBlockers.length) throw new ApiError(422, 'Reference data needs administrator review before this timetable can be published.', 'REFERENCE_REVIEW_REQUIRED', reviewBlockers);
  const conflicts = validateTimetable({ ...context, schedule: timetable.schedule });
  if (conflicts.length) throw new ApiError(422, 'Timetable still contains hard conflicts and cannot be published.', 'TIMETABLE_CONFLICTS', conflicts);
  timetable.validationResults = [];
  timetable.published = true;
  timetable.locked = Boolean(req.body?.locked);
  await timetable.save();
  await audit((req as AuthRequest).user!, 'publish', timetable, { published: true, locked: timetable.locked });
  res.json({ data: timetable });
}));

router.post('/:id/unlock', authenticate, authorize('Admin'), asyncHandler(async (req, res) => {
  const timetable = await Timetable.findById(req.params.id);
  if (!timetable) throw new ApiError(404, 'Timetable not found.', 'NOT_FOUND');
  timetable.locked = false;
  timetable.published = false;
  await timetable.save();
  await audit((req as AuthRequest).user!, 'unlock', timetable, { published: false, locked: false });
  res.json({ data: timetable });
}));

router.get('/:id/export/excel', authenticate, authorize('Admin', 'HOD', 'Faculty', 'Student'), asyncHandler(async (req, res) => {
  const timetable = await Timetable.findById(req.params.id).lean() as any;
  if (!timetable || (req.user?.role === 'Student' && !timetable.published)) throw new ApiError(404, 'Published timetable not found.', 'NOT_FOUND');
  const context = await loadTimetableContext(String(timetable.semesterId), req.user);
  let schedule = timetable.schedule;
  if (req.user?.role === 'Faculty') schedule = schedule.filter((item: any) => String(item.facultyId) === String(req.user?.facultyId));
  const workbook = buildTimetableWorkbook(timetable, context, schedule);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="smartslot-semester-${context.semester.semesterNumber}-v${timetable.version}.xlsx"`);
  await workbook.xlsx.write(res); res.end();
}));

router.get('/:id/export/pdf', authenticate, authorize('Admin', 'HOD', 'Faculty', 'Student'), asyncHandler(async (req, res) => {
  const timetable = await Timetable.findById(req.params.id).lean() as any;
  if (!timetable || (req.user?.role === 'Student' && !timetable.published)) throw new ApiError(404, 'Published timetable not found.', 'NOT_FOUND');
  const context = await loadTimetableContext(String(timetable.semesterId), req.user);
  let schedule = timetable.schedule;
  if (req.user?.role === 'Faculty') schedule = schedule.filter((item: any) => String(item.facultyId) === String(req.user?.facultyId));
  const pdf = await buildTimetablePdfBuffer(timetable, context, schedule);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="smartslot-timetable-v${timetable.version}.pdf"`);
  res.send(pdf);
}));

router.get('/:id/view', authenticate, authorize('Admin', 'HOD', 'Faculty', 'Student'), asyncHandler(async (req, res) => {
  const timetable: any = await Timetable.findById(req.params.id).lean();
  if (!timetable || (req.user?.role === 'Student' && !timetable.published)) throw new ApiError(404, 'Timetable not found.', 'NOT_FOUND');
  const context = await loadTimetableContext(String(timetable.semesterId), req.user);
  const subjects = new Map(context.subjects.map((item: any) => [String(item._id), item]));
  const faculty = new Map(context.faculty.map((item: any) => [String(item._id), item]));
  const batches = new Map(context.batches.map((item: any) => [String(item._id), item]));
  const rooms = new Map(context.classrooms.map((item: any) => [String(item._id), item]));
  let schedule = timetable.schedule.map((session: any) => {
    const subject: any = subjects.get(String(session.subjectId)); const teacher: any = faculty.get(String(session.facultyId));
    const batch: any = batches.get(String(session.batchId)); const room: any = rooms.get(String(session.classroomId));
    return { ...session, subjectCode: subject?.subjectCode, subjectShortName: subject?.shortName, subjectName: subject?.subjectName, facultyName: teacher?.name, facultyInitials: teacher?.name?.split(/\\s+/).map((part: string) => part[0]).join('').slice(0, 3), batchCode: batch?.batchCode || (session.batchId ? undefined : 'All batches'), classroomCode: room?.roomCode, classroomName: room?.roomName };
  });
  if (req.user?.role === 'Faculty') schedule = schedule.filter((item: any) => String(item.facultyId) === String(req.user?.facultyId));
  res.json({ data: { ...timetable, semesterName: context.semester.semesterName, semesterNumber: context.semester.semesterNumber, workingDays: context.semester.workingDays, timeSlots: context.semester.timeSlots, breakConfiguration: context.semester.breakConfiguration, configurationVerified: context.semester.configurationVerified, sourceNotes: context.semester.sourceNotes, schedule } });
}));

router.get('/:id', authenticate, authorize('Admin', 'HOD', 'Faculty', 'Student'), asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid timetable id.', 'INVALID_ID');
  const timetable: any = await Timetable.findById(req.params.id).lean();
  if (!timetable || (req.user?.role === 'Student' && !timetable.published)) throw new ApiError(404, 'Timetable not found.', 'NOT_FOUND');
  await loadTimetableContext(String(timetable.semesterId), req.user);
  if (req.user?.role === 'Faculty') timetable.schedule = timetable.schedule.filter((item: any) => String(item.facultyId) === String(req.user?.facultyId));
  res.json({ data: timetable });
}));

export default router;
