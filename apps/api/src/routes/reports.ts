import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Assignment, Batch, Classroom, Faculty, Semester, Subject, Timetable } from '../models';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { ApiError, asyncHandler } from '../middleware/errors';
import { loadTimetableContext } from '../services/timetableContext';
import { validateTimetable } from '../services/validateTimetable';

export const reportsRouter = Router();
const idOf = (value: any) => value == null ? '' : String(value._id ?? value.id ?? value);

async function reportData(type: string, semesterId?: string, user?: any) {
  if (!['workload', 'utilization', 'hours', 'conflicts', 'free-periods', 'history', 'archive', 'batch-schedule'].includes(type)) throw new ApiError(404, 'Unknown report type.', 'REPORT_NOT_FOUND');
  const semester = semesterId ? await loadTimetableContext(semesterId, user) : undefined;
  const semesterQuery: any = semesterId ? { semesterId } : {};
  if (user?.role === 'HOD' && user.departmentId && !semesterId) {
    const ids = await Semester.find({ departmentId: user.departmentId }).distinct('_id');
    semesterQuery.semesterId = { $in: ids };
  }
  const [faculty, subjects, batches, rooms, assignments, timetables] = await Promise.all([
    Faculty.find(user?.role === 'HOD' ? { departmentId: user.departmentId } : { active: true }).lean(),
    Subject.find(semesterId ? { semesterId, active: true } : { active: true }).lean(),
    Batch.find(semesterId ? { semesterId, active: true } : { active: true }).lean(),
    Classroom.find(user?.role === 'HOD' ? { departmentId: user.departmentId, active: true } : { active: true }).lean(),
    Assignment.find({ ...semesterQuery, active: true }).lean(),
    Timetable.find({ ...semesterQuery, ...(type === 'archive' ? { published: true } : {}) }).sort({ generationDate: -1 }).limit(100).lean()
  ]);
  const latest = new Map<string, any>();
  for (const timetable of timetables as any[]) if (!latest.has(String(timetable.semesterId))) latest.set(String(timetable.semesterId), timetable);
  const schedule = [...latest.values()].flatMap((item: any) => item.schedule || []);
  if (type === 'workload') return faculty.map((person: any) => {
    const items = assignments.filter((item: any) => idOf(item.facultyId) === idOf(person));
    const scheduled = items.reduce((sum: number, item: any) => sum + Number(item.weeklyPeriods || 0), 0);
    const daily = new Map<string, number>();
    for (const session of schedule.filter((entry: any) => idOf(entry.facultyId) === idOf(person))) daily.set(session.day, (daily.get(session.day) || 0) + Number(session.duration || 0));
    return { employeeId: person.employeeId, faculty: person.name, departmentId: idOf(person.departmentId), assignedWeeklyPeriods: scheduled, maxWeeklyPeriods: person.maxWeeklyPeriods, maxDailyPeriods: person.maxDailyPeriods, publishedScheduledPeriods: schedule.filter((entry: any) => idOf(entry.facultyId) === idOf(person)).reduce((sum: number, entry: any) => sum + Number(entry.duration || 0), 0), dailyPeriods: Object.fromEntries(daily) };
  });
  if (type === 'utilization') return rooms.map((room: any) => {
    const used = schedule.filter((entry: any) => idOf(entry.classroomId) === idOf(room)).reduce((sum: number, entry: any) => sum + Number(entry.duration || 0), 0);
    const configured = semester?.semester.timeSlots?.filter((slot: any) => !slot.kind || slot.kind === 'class').length || 0;
    const days = semester?.semester.workingDays?.length || 5;
    const capacityPeriods = configured * days;
    return { roomCode: room.roomCode, roomName: room.roomName, roomType: room.roomType, capacity: room.capacity, usedPeriods: used, availablePeriods: capacityPeriods, utilizationPercent: capacityPeriods ? Math.round(100 * used / capacityPeriods) : 0 };
  });
  if (type === 'hours') return subjects.map((subject: any) => {
    const related = assignments.filter((item: any) => idOf(item.subjectId) === idOf(subject));
    return { subjectCode: subject.subjectCode, subjectName: subject.subjectName, courseType: subject.courseType, configuredWeeklyPeriods: subject.weeklyPeriods, assignedWeeklyPeriods: related.reduce((sum: number, item: any) => sum + Number(item.weeklyPeriods || 0), 0), assignmentCount: related.length };
  });
  if (type === 'conflicts') {
    const result: any[] = [];
    for (const item of latest.values()) {
      const context = await loadTimetableContext(String(item.semesterId), user);
      result.push(...validateTimetable({ ...context, schedule: item.schedule }).map(conflict => ({ version: item.version, semesterId: idOf(item.semesterId), ...conflict })));
    }
    return result;
  }
  if (type === 'free-periods') {
    const selectedFaculty = semester?.faculty || faculty;
    const days = semester?.semester.workingDays || [];
    const slots = semester?.semester.timeSlots?.filter((slot: any) => !slot.kind || slot.kind === 'class') || [];
    return selectedFaculty.map((person: any) => ({ faculty: person.name, employeeId: person.employeeId, free: days.reduce((sum: number, day: string) => sum + slots.filter((slot: any) => !schedule.some((entry: any) => idOf(entry.facultyId) === idOf(person) && entry.day === day && entry.startTime < slot.endTime && entry.endTime > slot.startTime)).length, 0) }));
  }
  if (type === 'history' || type === 'archive') return timetables.map((item: any) => ({ id: idOf(item), semesterId: idOf(item.semesterId), version: item.version, generationStatus: item.generationStatus, generatedAt: item.generationDate, published: item.published, optimizationScore: item.optimizationScore, sessionCount: item.schedule?.length || 0, validationCount: item.validationResults?.length || 0 }));
  return batches.map((batch: any) => ({ batchCode: batch.batchCode, batchName: batch.batchName, semesterId: idOf(batch.semesterId), sessions: schedule.filter((entry: any) => idOf(entry.batchId) === idOf(batch)) }));
}

reportsRouter.use(authenticate);
reportsRouter.get('/:type', authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
  const data = await reportData(String(req.params.type), req.query.semesterId ? String(req.query.semesterId) : undefined, (req as AuthRequest).user);
  res.json({ data });
}));

reportsRouter.get('/export/:type', authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
  const data = await reportData(String(req.params.type), req.query.semesterId ? String(req.query.semesterId) : undefined, (req as AuthRequest).user);
  const format = String(req.query.format || 'xlsx').toLowerCase();
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="smartslot-${req.params.type}-report.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: 36, layout: 'landscape' }); doc.pipe(res);
    doc.fontSize(16).fillColor('#172554').text(`SmartSlot ${req.params.type} report`); doc.moveDown();
    for (const row of data.slice(0, 200)) {
      const text = Object.entries(row).filter(([key]) => key !== 'sessions').map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}`).join('  |  ');
      doc.fontSize(8).fillColor('#0f172a').text(text, { width: 760 }); doc.moveDown(0.25);
    }
    doc.end(); return;
  }
  if (format !== 'xlsx') throw new ApiError(400, 'format must be xlsx or pdf.', 'INVALID_FORMAT');
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet(String(req.params.type).slice(0, 31));
  if (data.length) {
    const keys = [...new Set(data.flatMap((row: any) => Object.keys(row).filter(key => key !== 'sessions')))];
    sheet.columns = keys.map(key => ({ header: key, key, width: Math.min(42, Math.max(16, key.length + 3)) }));
    for (const row of data) sheet.addRow(Object.fromEntries(keys.map(key => [key, typeof row[key] === 'object' && row[key] !== null ? JSON.stringify(row[key]) : row[key]])));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172554' } };
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="smartslot-${req.params.type}-report.xlsx"`);
  await workbook.xlsx.write(res); res.end();
}));
