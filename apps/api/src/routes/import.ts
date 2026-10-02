import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import { AcademicYear, Assignment, AuditLog, Batch, Classroom, Department, Faculty, ImportHistory, Semester, Subject } from '../models';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { ApiError, asyncHandler } from '../middleware/errors';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (_req, file, callback) => {
    const valid = file.originalname.toLowerCase().endsWith('.xlsx') && (file.mimetype.includes('spreadsheetml') || file.mimetype === 'application/octet-stream');
    (callback as any)(valid ? null : new Error('Upload a valid .xlsx workbook only.'), valid);
  }
});

type Entity = 'departments' | 'academicYears' | 'semesters' | 'faculty' | 'subjects' | 'batches' | 'classrooms' | 'assignments' | 'facultyAvailability';
type StagedRow = { entity: Entity; sheet: string; row: number; record: any; refs: any; key: string; existingId?: string };
type FieldSpec = { field: string; header: string; required?: boolean };
const specs: Record<Entity, { sheet: string; fields: FieldSpec[] }> = {
  departments: { sheet: 'Departments', fields: [{ field: 'code', header: 'code', required: true }, { field: 'name', header: 'name', required: true }, { field: 'description', header: 'description' }] },
  academicYears: { sheet: 'AcademicYears', fields: [{ field: 'name', header: 'name', required: true }, { field: 'startDate', header: 'start_date', required: true }, { field: 'endDate', header: 'end_date', required: true }, { field: 'status', header: 'status' }] },
  semesters: { sheet: 'Semesters', fields: [{ field: 'departmentCode', header: 'department_code', required: true }, { field: 'academicYearName', header: 'academic_year', required: true }, { field: 'semesterNumber', header: 'semester_number', required: true }, { field: 'semesterName', header: 'semester_name', required: true }, { field: 'workingDays', header: 'working_days', required: true }, { field: 'timeSlotsJson', header: 'time_slots_json', required: true }, { field: 'breaksJson', header: 'breaks_json' }, { field: 'status', header: 'status' }, { field: 'configurationVerified', header: 'configuration_verified' }, { field: 'sourceNotes', header: 'source_notes' }] },
  faculty: { sheet: 'Faculty', fields: [{ field: 'employeeId', header: 'employee_id', required: true }, { field: 'name', header: 'name', required: true }, { field: 'email', header: 'email', required: true }, { field: 'departmentCode', header: 'department_code', required: true }, { field: 'designation', header: 'designation' }, { field: 'maxDailyPeriods', header: 'max_daily_periods' }, { field: 'maxWeeklyPeriods', header: 'max_weekly_periods' }, { field: 'availabilityJson', header: 'availability_json' }, { field: 'unavailableSlotsJson', header: 'unavailable_slots_json' }, { field: 'preferredSlotsJson', header: 'preferred_slots_json' }] },
  subjects: { sheet: 'Subjects', fields: [{ field: 'departmentCode', header: 'department_code', required: true }, { field: 'academicYearName', header: 'academic_year', required: true }, { field: 'semesterNumber', header: 'semester_number', required: true }, { field: 'subjectCode', header: 'subject_code', required: true }, { field: 'subjectName', header: 'subject_name', required: true }, { field: 'shortName', header: 'short_name', required: true }, { field: 'courseType', header: 'course_type', required: true }, { field: 'weeklyPeriods', header: 'weekly_periods', required: true }, { field: 'lectureDuration', header: 'lecture_duration' }, { field: 'labDuration', header: 'lab_duration' }, { field: 'requiresLab', header: 'requires_lab' }, { field: 'eligibleClassroomCodes', header: 'eligible_classroom_codes' }, { field: 'eligibleFacultyEmployeeIds', header: 'eligible_faculty_employee_ids' }, { field: 'needsVerification', header: 'needs_verification' }] },
  batches: { sheet: 'Batches', fields: [{ field: 'departmentCode', header: 'department_code', required: true }, { field: 'academicYearName', header: 'academic_year', required: true }, { field: 'semesterNumber', header: 'semester_number', required: true }, { field: 'batchCode', header: 'batch_code', required: true }, { field: 'batchName', header: 'batch_name', required: true }, { field: 'studentCount', header: 'student_count' }, { field: 'batchType', header: 'batch_type' }, { field: 'parentBatchCode', header: 'parent_batch_code' }, { field: 'needsVerification', header: 'needs_verification' }] },
  classrooms: { sheet: 'Classrooms', fields: [{ field: 'roomCode', header: 'room_code', required: true }, { field: 'roomName', header: 'room_name', required: true }, { field: 'roomType', header: 'room_type', required: true }, { field: 'capacity', header: 'capacity', required: true }, { field: 'equipment', header: 'equipment' }, { field: 'departmentCode', header: 'department_code' }] },
  assignments: { sheet: 'Assignments', fields: [{ field: 'departmentCode', header: 'department_code', required: true }, { field: 'academicYearName', header: 'academic_year', required: true }, { field: 'semesterNumber', header: 'semester_number', required: true }, { field: 'subjectCode', header: 'subject_code', required: true }, { field: 'facultyEmployeeId', header: 'faculty_employee_id', required: true }, { field: 'batchCode', header: 'batch_code' }, { field: 'roomCode', header: 'room_code' }, { field: 'weeklyPeriods', header: 'weekly_periods', required: true }, { field: 'sessionDuration', header: 'session_duration', required: true }, { field: 'courseType', header: 'course_type', required: true }, { field: 'preferredSlotsJson', header: 'preferred_slots_json' }, { field: 'needsVerification', header: 'needs_verification' }] },
  facultyAvailability: { sheet: 'FacultyAvailability', fields: [{ field: 'employeeId', header: 'employee_id', required: true }, { field: 'day', header: 'day', required: true }, { field: 'startTime', header: 'start_time', required: true }, { field: 'endTime', header: 'end_time', required: true }, { field: 'available', header: 'available' }] }
};
const importOrder: Entity[] = ['departments', 'academicYears', 'semesters', 'faculty', 'classrooms', 'subjects', 'batches', 'assignments', 'facultyAvailability'];
const modelMap: Partial<Record<Entity, any>> = { departments: Department, academicYears: AcademicYear, semesters: Semester, faculty: Faculty, subjects: Subject, batches: Batch, classrooms: Classroom, assignments: Assignment };
const headerKey = (value: any) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (value: any) => {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && value.text) return String(value.text).trim();
  if (typeof value === 'object' && Array.isArray(value.richText)) return value.richText.map((part: any) => part.text).join('').trim();
  return String(value).trim();
};
const list = (value: any) => text(value).split(',').map(item => item.trim()).filter(Boolean);
function numberValue(value: any, label: string, errors: any[], sheet: string, row: number, optional = false, minimum?: number) {
  if (optional && (value == null || (typeof value === 'string' && value.trim() === ''))) return undefined;
  const isNumberInput = typeof value === 'number' || typeof value === 'string' && value.trim() !== '';
  const number = isNumberInput ? Number(value) : Number.NaN;
  if (!Number.isFinite(number) || !Number.isInteger(number)) errors.push({ sheet, row, field: label, code: 'INVALID_NUMBER', message: `${label} must be a whole number.` });
  else if (minimum !== undefined && number < minimum) errors.push({ sheet, row, field: label, code: 'OUT_OF_RANGE', message: `${label} must be at least ${minimum}.` });
  return Number.isFinite(number) && Number.isInteger(number) ? number : undefined;
}
function booleanValue(value: any, fallback = false, errors?: any[], sheet = '', row = 0, label = 'value') {
  const normalized = text(value).toLowerCase();
  if (value == null || normalized === '') return fallback;
  if (['true', 'yes', '1', 'y'].includes(normalized)) return true;
  if (['false', 'no', '0', 'n'].includes(normalized)) return false;
  errors?.push({ sheet, row, field: label, code: 'INVALID_BOOLEAN', message: `${label} must be true/false, yes/no, or 1/0.` });
  return fallback;
}
function optionalBooleanValue(value: any, errors: any[], sheet: string, row: number, label: string): boolean | undefined {
  if (value == null || text(value) === '') return undefined;
  return booleanValue(value, false, errors, sheet, row, label);
}
function jsonValue(value: any, label: string, errors: any[], sheet: string, row: number, fallback: any = []) {
  const serialized = text(value);
  if (value == null || serialized === '') return fallback;
  try { return JSON.parse(serialized); }
  catch { errors.push({ sheet, row, field: label, code: 'INVALID_JSON', message: `${label} must contain valid JSON.` }); return fallback; }
}
function arrayJson(value: any, label: string, errors: any[], sheet: string, row: number) {
  const parsed = jsonValue(value, label, errors, sheet, row, []);
  if (!Array.isArray(parsed)) { errors.push({ sheet, row, field: label, code: 'INVALID_ARRAY', message: `${label} must be a JSON array.` }); return []; }
  return parsed;
}
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeMinutes = (value: string) => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; };
function validTimeRange(start: string, end: string) { return timePattern.test(start || '') && timePattern.test(end || '') && timeMinutes(end) > timeMinutes(start); }
function validateAvailabilityRanges(ranges: any[], label: string, errors: any[], sheet: string, row: number) {
  const allowed = new Set(['day', 'startTime', 'endTime', 'available']);
  for (const [index, range] of ranges.entries()) {
    if (!range || typeof range !== 'object' || Array.isArray(range)) { errors.push({ sheet, row, field: label, code: 'INVALID_RANGE', message: `${label}[${index}] must be an object.` }); continue; }
    for (const key of Object.keys(range)) if (!allowed.has(key)) errors.push({ sheet, row, field: label, code: 'UNKNOWN_RANGE_FIELD', message: `${label}[${index}] contains unsupported field "${key}".` });
    if (!validTimeRange(range.startTime, range.endTime)) errors.push({ sheet, row, field: label, code: 'INVALID_TIME', message: `${label}[${index}] needs a valid HH:MM range with end_time after start_time.` });
    if (range.day != null && (typeof range.day !== 'string' || !range.day.trim())) errors.push({ sheet, row, field: label, code: 'INVALID_DAY', message: `${label}[${index}].day must be a non-empty string when provided.` });
    if (range.available != null && typeof range.available !== 'boolean') errors.push({ sheet, row, field: label, code: 'INVALID_BOOLEAN', message: `${label}[${index}].available must be a JSON boolean.` });
  }
}
function dateValue(value: any, label: string, errors: any[], sheet: string, row: number) {
  const parsed = value instanceof Date ? value : new Date(text(value));
  if (Number.isNaN(parsed.getTime())) { errors.push({ sheet, row, field: label, code: 'INVALID_DATE', message: `${label} must be a valid date.` }); return undefined; }
  return parsed;
}
function uniqueKey(entity: Entity, record: any, refs: any): string {
  switch (entity) {
    case 'departments': return record.code.toUpperCase();
    case 'academicYears': return record.name.toLowerCase();
    case 'semesters': return `${refs.departmentCode}|${refs.academicYearName}|${record.semesterNumber}`.toLowerCase();
    case 'faculty': return record.employeeId.toUpperCase();
    case 'subjects': return `${refs.semesterKey}|${record.subjectCode.toUpperCase()}`;
    case 'batches': return `${refs.semesterKey}|${record.batchCode.toUpperCase()}`;
    case 'classrooms': return record.roomCode.toUpperCase();
    case 'assignments': return `${refs.semesterKey}|${refs.subjectCode.toUpperCase()}|${refs.facultyEmployeeId.toUpperCase()}|${(refs.batchCode || 'COMMON').toUpperCase()}`;
    case 'facultyAvailability': return `${record.employeeId.toUpperCase()}|${record.day.toLowerCase()}|${record.startTime}|${record.endTime}`;
  }
}
function semesterKey(departmentCode: string, academicYearName: string, semesterNumber: number) { return `${departmentCode.toUpperCase()}|${academicYearName.toLowerCase()}|${semesterNumber}`; }

async function existingMaps() {
  const [departments, years, semesters, faculty, subjects, batches, classrooms, assignments] = await Promise.all([
    Department.find({}).lean(), AcademicYear.find({}).lean(), Semester.find({}).lean(), Faculty.find({}).lean(), Subject.find({}).lean(), Batch.find({}).lean(), Classroom.find({}).lean(), Assignment.find({}).lean()
  ]);
  const deptById = new Map(departments.map((item: any) => [String(item._id), item]));
  const yearById = new Map(years.map((item: any) => [String(item._id), item]));
  const semesterById = new Map<string, any>();
  const semesterNatural = new Map<string, any>();
  for (const item of semesters as any[]) {
    const dept: any = deptById.get(String(item.departmentId)); const year: any = yearById.get(String(item.academicYearId));
    const key = semesterKey(dept?.code || '', year?.name || '', item.semesterNumber);
    semesterById.set(String(item._id), { ...item, naturalKey: key }); semesterNatural.set(key, item);
  }
  const facultyById = new Map(faculty.map((item: any) => [String(item._id), item]));
  const subjectNatural = new Map<string, any>();
  for (const item of subjects as any[]) subjectNatural.set(`${semesterById.get(String(item.semesterId))?.naturalKey}|${String(item.subjectCode).toUpperCase()}`, item);
  const batchNatural = new Map<string, any>();
  for (const item of batches as any[]) batchNatural.set(`${semesterById.get(String(item.semesterId))?.naturalKey}|${String(item.batchCode).toUpperCase()}`, item);
  const assignmentNatural = new Map<string, any>();
  for (const item of assignments as any[]) {
    const semester = semesterById.get(String(item.semesterId));
    const subject: any = (subjects as any[]).find((candidate: any) => String(candidate._id) === String(item.subjectId));
    const teacher: any = facultyById.get(String(item.facultyId));
    const batch: any = (batches as any[]).find((candidate: any) => String(candidate._id) === String(item.batchId));
    assignmentNatural.set(`${semester?.naturalKey}|${String(subject?.subjectCode).toUpperCase()}|${String(teacher?.employeeId).toUpperCase()}|${String(batch?.batchCode || 'COMMON').toUpperCase()}`, item);
  }
  return {
    departments, years, semesters, faculty, subjects, batches, classrooms, assignments,
    departmentByCode: new Map(departments.map((item: any) => [String(item.code).toUpperCase(), item])),
    yearByName: new Map(years.map((item: any) => [String(item.name).toLowerCase(), item])),
    semesterById, semesterNatural, facultyByEmployee: new Map(faculty.map((item: any) => [String(item.employeeId).toUpperCase(), item])),
    facultyByEmail: new Map(faculty.map((item: any) => [String(item.email).toLowerCase(), item])),
    classroomByCode: new Map(classrooms.map((item: any) => [String(item.roomCode).toUpperCase(), item])),
    subjectNatural, batchNatural, assignmentNatural
  };
}

function parseEntity(entity: Entity, raw: Record<string, any>, sheet: string, row: number, errors: any[]): StagedRow | undefined {
  const missing = specs[entity].fields.filter(field => field.required && text(raw[field.field]) === '');
  for (const field of missing) errors.push({ sheet, row, field: field.header, code: 'REQUIRED', message: `${field.header} is required.` });
  if (missing.length) return undefined;
  let record: any = {}; let refs: any = {};
  switch (entity) {
    case 'departments': record = { code: text(raw.code).toUpperCase(), name: text(raw.name), description: text(raw.description) }; break;
    case 'academicYears': record = { name: text(raw.name), startDate: dateValue(raw.startDate, 'start_date', errors, sheet, row), endDate: dateValue(raw.endDate, 'end_date', errors, sheet, row), status: text(raw.status) || 'planned' }; if (record.startDate && record.endDate && record.endDate <= record.startDate) errors.push({ sheet, row, field: 'end_date', code: 'INVALID_RANGE', message: 'end_date must be after start_date.' }); if (!['planned', 'active', 'completed', 'archived'].includes(record.status)) errors.push({ sheet, row, field: 'status', code: 'INVALID_ENUM', message: 'academic year status must be planned, active, completed, or archived.' }); break;
    case 'semesters': {
      refs = { departmentCode: text(raw.departmentCode).toUpperCase(), academicYearName: text(raw.academicYearName) };
      const semesterNumber = numberValue(raw.semesterNumber, 'semester_number', errors, sheet, row, false, 1);
      const timeSlots = arrayJson(raw.timeSlotsJson, 'time_slots_json', errors, sheet, row).filter((slot: any, index: number) => {
        if (!slot || typeof slot !== 'object' || Array.isArray(slot)) { errors.push({ sheet, row, field: 'time_slots_json', code: 'INVALID_TIME_SLOT', message: `Period at index ${index + 1} must be an object.` }); return false; }
        return true;
      });
      const breaks = arrayJson(raw.breaksJson, 'breaks_json', errors, sheet, row).filter((blocked: any, index: number) => {
        if (!blocked || typeof blocked !== 'object' || Array.isArray(blocked)) { errors.push({ sheet, row, field: 'breaks_json', code: 'INVALID_BREAK', message: `Break at index ${index + 1} must be an object.` }); return false; }
        return true;
      });
      record = { semesterNumber, semesterName: text(raw.semesterName), workingDays: list(raw.workingDays), timeSlots, breakConfiguration: breaks, status: text(raw.status) || 'draft', configurationVerified: booleanValue(raw.configurationVerified, false, errors, sheet, row, 'configuration_verified'), sourceNotes: text(raw.sourceNotes) };
      refs.semesterKey = semesterKey(refs.departmentCode, refs.academicYearName, semesterNumber ?? 0);
      if (semesterNumber && semesterNumber > 12) errors.push({ sheet, row, field: 'semester_number', code: 'OUT_OF_RANGE', message: 'semester_number must be between 1 and 12.' });
      if (!record.workingDays.length) errors.push({ sheet, row, field: 'working_days', code: 'MISSING_WORKING_DAYS', message: 'working_days must list at least one day.' });
      if (new Set(record.workingDays.map((day: string) => day.toLowerCase())).size !== record.workingDays.length) errors.push({ sheet, row, field: 'working_days', code: 'DUPLICATE_DAY', message: 'working_days must not contain duplicate days.' });
      if (!timeSlots.length) errors.push({ sheet, row, field: 'time_slots_json', code: 'MISSING_TIME_SLOTS', message: 'time_slots_json must contain at least one teaching period.' });
      if (!['draft', 'active', 'archived'].includes(record.status)) errors.push({ sheet, row, field: 'status', code: 'INVALID_ENUM', message: 'semester status must be draft, active, or archived.' });
      const workingDayKeys = new Set(record.workingDays.map((day: string) => day.toLowerCase()));
      const slotKeys = new Set<string>();
      const slotFields = new Set(['day', 'periodIndex', 'label', 'startTime', 'endTime', 'kind']);
      for (const [index, slot] of timeSlots.entries()) {
        for (const key of Object.keys(slot)) if (!slotFields.has(key)) errors.push({ sheet, row, field: 'time_slots_json', code: 'UNKNOWN_TIME_SLOT_FIELD', message: `Period at index ${index + 1} contains unsupported field "${key}".` });
        if (!Number.isInteger(slot.periodIndex) || slot.periodIndex < 1 || !validTimeRange(slot.startTime, slot.endTime) || !['class', 'break', 'blocked', undefined].includes(slot.kind)) {
          errors.push({ sheet, row, field: 'time_slots_json', code: 'INVALID_TIME_SLOT', message: `Period at index ${index + 1} needs a positive integer periodIndex, valid start/end times, and a supported kind.` });
          continue;
        }
        if (slot.day != null && (typeof slot.day !== 'string' || !workingDayKeys.has(slot.day.toLowerCase()))) errors.push({ sheet, row, field: 'time_slots_json', code: 'INVALID_DAY', message: `Period ${slot.periodIndex} uses a day that is not in working_days.` });
        const slotKey = `${String(slot.day || '*').toLowerCase()}:${slot.periodIndex}`;
        if (slotKeys.has(slotKey)) errors.push({ sheet, row, field: 'time_slots_json', code: 'DUPLICATE_PERIOD', message: `Period index ${slot.periodIndex} is repeated for ${slot.day || 'all working days'}.` });
        slotKeys.add(slotKey);
      }
      const breakFields = new Set(['name', 'startTime', 'endTime', 'days']);
      for (const [index, blocked] of breaks.entries()) {
        for (const key of Object.keys(blocked)) if (!breakFields.has(key)) errors.push({ sheet, row, field: 'breaks_json', code: 'UNKNOWN_BREAK_FIELD', message: `Break at index ${index + 1} contains unsupported field "${key}".` });
        if (!text(blocked.name) || !validTimeRange(blocked.startTime, blocked.endTime)) errors.push({ sheet, row, field: 'breaks_json', code: 'INVALID_BREAK', message: `Break at index ${index + 1} needs a name and a valid start/end time.` });
        if (blocked.days != null && !Array.isArray(blocked.days)) errors.push({ sheet, row, field: 'breaks_json', code: 'INVALID_BREAK_DAYS', message: `Break at index ${index + 1} days must be an array.` });
        if (Array.isArray(blocked.days)) for (const day of blocked.days) if (typeof day !== 'string' || !workingDayKeys.has(day.toLowerCase())) errors.push({ sheet, row, field: 'breaks_json', code: 'INVALID_BREAK_DAY', message: `Break at index ${index + 1} references a day outside working_days.` });
      }
      for (const slot of timeSlots) for (const blocked of breaks) {
        const blockedDays = Array.isArray(blocked.days) ? blocked.days : [];
        const dayApplies = !slot.day || !blockedDays.length || blockedDays.some((day: any) => String(day).toLowerCase() === String(slot.day).toLowerCase());
        if ((slot.kind || 'class') === 'class' && dayApplies && validTimeRange(slot.startTime, slot.endTime) && validTimeRange(blocked.startTime, blocked.endTime) && timeMinutes(slot.startTime) < timeMinutes(blocked.endTime) && timeMinutes(blocked.startTime) < timeMinutes(slot.endTime)) errors.push({ sheet, row, field: 'time_slots_json', code: 'PERIOD_OVERLAPS_BREAK', message: `Period ${slot.periodIndex} overlaps the configured ${blocked.name} break.` });
      }
      for (let left = 0; left < timeSlots.length; left++) for (let right = left + 1; right < timeSlots.length; right++) {
        const a = timeSlots[left], b = timeSlots[right];
        const sameDay = !a.day || !b.day || String(a.day).toLowerCase() === String(b.day).toLowerCase();
        const dayOverride = (!a.day && b.day && a.periodIndex === b.periodIndex) || (!b.day && a.day && a.periodIndex === b.periodIndex);
        if (sameDay && !dayOverride && validTimeRange(a.startTime, a.endTime) && validTimeRange(b.startTime, b.endTime) && timeMinutes(a.startTime) < timeMinutes(b.endTime) && timeMinutes(b.startTime) < timeMinutes(a.endTime)) errors.push({ sheet, row, field: 'time_slots_json', code: 'OVERLAPPING_PERIODS', message: `Periods ${a.periodIndex} and ${b.periodIndex} overlap in clock time.` });
      }
      break;
    }
    case 'faculty': {
      refs = { departmentCode: text(raw.departmentCode).toUpperCase() };
      record = { employeeId: text(raw.employeeId).toUpperCase(), name: text(raw.name), email: text(raw.email).toLowerCase(), designation: text(raw.designation), maxDailyPeriods: numberValue(raw.maxDailyPeriods, 'max_daily_periods', errors, sheet, row, true, 1) ?? 6, maxWeeklyPeriods: numberValue(raw.maxWeeklyPeriods, 'max_weekly_periods', errors, sheet, row, true, 1) ?? 24, availability: arrayJson(raw.availabilityJson, 'availability_json', errors, sheet, row), unavailableSlots: arrayJson(raw.unavailableSlotsJson, 'unavailable_slots_json', errors, sheet, row), preferredSlots: arrayJson(raw.preferredSlotsJson, 'preferred_slots_json', errors, sheet, row) };
      validateAvailabilityRanges(record.availability, 'availability_json', errors, sheet, row);
      validateAvailabilityRanges(record.unavailableSlots, 'unavailable_slots_json', errors, sheet, row);
      if (!/^\S+@\S+\.\S+$/.test(record.email)) errors.push({ sheet, row, field: 'email', code: 'INVALID_EMAIL', message: 'email must be a valid address.' });
      break;
    }
    case 'subjects': {
      refs = { departmentCode: text(raw.departmentCode).toUpperCase(), academicYearName: text(raw.academicYearName) };
      refs.semesterKey = semesterKey(refs.departmentCode, refs.academicYearName, numberValue(raw.semesterNumber, 'semester_number', errors, sheet, row, false, 1) ?? 0);
      const eligibleClassroomCodes = list(raw.eligibleClassroomCodes).map((item: string) => item.toUpperCase());
      const eligibleFacultyEmployeeIds = list(raw.eligibleFacultyEmployeeIds).map((item: string) => item.toUpperCase());
      record = { subjectCode: text(raw.subjectCode).toUpperCase(), subjectName: text(raw.subjectName), shortName: text(raw.shortName), courseType: text(raw.courseType), weeklyPeriods: numberValue(raw.weeklyPeriods, 'weekly_periods', errors, sheet, row, false, 1), lectureDuration: numberValue(raw.lectureDuration, 'lecture_duration', errors, sheet, row, true, 1) ?? 1, labDuration: numberValue(raw.labDuration, 'lab_duration', errors, sheet, row, true, 1) ?? 2, requiresLab: booleanValue(raw.requiresLab, text(raw.courseType).toLowerCase() === 'lab', errors, sheet, row, 'requires_lab'), eligibleClassroomCodes, eligibleFacultyEmployeeIds };
      const needsVerification = optionalBooleanValue(raw.needsVerification, errors, sheet, row, 'needs_verification');
      if (needsVerification !== undefined) record.needsVerification = needsVerification;
      if (!['Theory', 'Lab', 'Tutorial', 'Project'].includes(record.courseType)) errors.push({ sheet, row, field: 'course_type', code: 'INVALID_ENUM', message: 'course_type must be Theory, Lab, Tutorial, or Project.' });
      refs.eligibleClassroomCodes = eligibleClassroomCodes; refs.eligibleFacultyEmployeeIds = eligibleFacultyEmployeeIds;
      break;
    }
    case 'batches': {
      refs = { departmentCode: text(raw.departmentCode).toUpperCase(), academicYearName: text(raw.academicYearName) };
      refs.semesterKey = semesterKey(refs.departmentCode, refs.academicYearName, numberValue(raw.semesterNumber, 'semester_number', errors, sheet, row, false, 1) ?? 0);
      refs.parentBatchCode = text(raw.parentBatchCode).toUpperCase();
      record = { batchCode: text(raw.batchCode).toUpperCase(), batchName: text(raw.batchName), studentCount: numberValue(raw.studentCount, 'student_count', errors, sheet, row, true, 0) ?? 0, batchType: text(raw.batchType) || 'standard' };
      const needsVerification = optionalBooleanValue(raw.needsVerification, errors, sheet, row, 'needs_verification');
      if (needsVerification !== undefined) record.needsVerification = needsVerification;
      if (refs.parentBatchCode && refs.parentBatchCode === record.batchCode) errors.push({ sheet, row, field: 'parent_batch_code', code: 'BATCH_HIERARCHY_CYCLE', message: 'A batch cannot be its own parent.' });
      if (!['standard', 'lab-group', 'elective', 'common'].includes(record.batchType)) errors.push({ sheet, row, field: 'batch_type', code: 'INVALID_ENUM', message: 'batch_type must be standard, lab-group, elective, or common.' });
      break;
    }
    case 'classrooms': {
      refs = { departmentCode: text(raw.departmentCode).toUpperCase() };
      record = { roomCode: text(raw.roomCode).toUpperCase(), roomName: text(raw.roomName), roomType: text(raw.roomType), capacity: numberValue(raw.capacity, 'capacity', errors, sheet, row, false, 1), equipment: list(raw.equipment) };
      if (!['Lecture', 'Laboratory', 'Seminar'].includes(record.roomType)) errors.push({ sheet, row, field: 'room_type', code: 'INVALID_ENUM', message: 'room_type must be Lecture, Laboratory, or Seminar.' });
      break;
    }
    case 'assignments': {
      refs = { departmentCode: text(raw.departmentCode).toUpperCase(), academicYearName: text(raw.academicYearName) };
      refs.semesterKey = semesterKey(refs.departmentCode, refs.academicYearName, numberValue(raw.semesterNumber, 'semester_number', errors, sheet, row, false, 1) ?? 0);
      refs.subjectCode = text(raw.subjectCode).toUpperCase(); refs.facultyEmployeeId = text(raw.facultyEmployeeId).toUpperCase(); refs.batchCode = text(raw.batchCode).toUpperCase(); refs.roomCode = text(raw.roomCode).toUpperCase();
      const weeklyPeriods = numberValue(raw.weeklyPeriods, 'weekly_periods', errors, sheet, row, false, 1); const sessionDuration = numberValue(raw.sessionDuration, 'session_duration', errors, sheet, row, false, 1);
      record = { weeklyPeriods, sessionDuration, courseType: text(raw.courseType), preferredSlots: arrayJson(raw.preferredSlotsJson, 'preferred_slots_json', errors, sheet, row) };
      const needsVerification = optionalBooleanValue(raw.needsVerification, errors, sheet, row, 'needs_verification');
      if (needsVerification !== undefined) record.needsVerification = needsVerification;
      if (weeklyPeriods && sessionDuration && weeklyPeriods % sessionDuration !== 0) errors.push({ sheet, row, field: 'session_duration', code: 'INVALID_HOURS', message: 'weekly_periods must be divisible by session_duration.' });
      if (!['Theory', 'Lab', 'Tutorial', 'Project'].includes(record.courseType)) errors.push({ sheet, row, field: 'course_type', code: 'INVALID_ENUM', message: 'course_type must be Theory, Lab, Tutorial, or Project.' });
      break;
    }
    case 'facultyAvailability': {
      refs = { employeeId: text(raw.employeeId).toUpperCase() };
      record = { day: text(raw.day), startTime: text(raw.startTime), endTime: text(raw.endTime), available: booleanValue(raw.available, true, errors, sheet, row, 'available') };
      if (!validTimeRange(record.startTime, record.endTime)) errors.push({ sheet, row, field: 'start_time/end_time', code: 'INVALID_TIME', message: 'Availability requires a valid HH:MM range with end_time after start_time.' });
      break;
    }
  }
  const key = uniqueKey(entity, record, refs);
  return { entity, sheet, row, record, refs, key };
}

function dependencyChecks(item: StagedRow, maps: any, stagedKeys: Map<Entity, Set<string>>, errors: any[]) {
  const need = (entity: Entity, key: string, label: string) => {
    const exists = stagedKeys.get(entity)?.has(key) || false;
    if (!exists) errors.push({ sheet: item.sheet, row: item.row, field: label, code: 'MISSING_REFERENCE', message: `Referenced ${label} "${key}" was not found in MongoDB or this workbook.` });
  };
  const refs = item.refs;
  if (item.entity === 'semesters' || item.entity === 'faculty' || item.entity === 'subjects' || item.entity === 'batches' || item.entity === 'assignments') {
    if (!maps.departmentByCode.has(refs.departmentCode)) need('departments', refs.departmentCode, 'department_code');
  }
  if (item.entity === 'semesters' || item.entity === 'subjects' || item.entity === 'batches' || item.entity === 'assignments') {
    if (!maps.yearByName.has(refs.academicYearName.toLowerCase())) need('academicYears', refs.academicYearName.toLowerCase(), 'academic_year');
    if (!maps.semesterNatural.has(refs.semesterKey)) need('semesters', refs.semesterKey, 'semester');
  }
  if (item.entity === 'facultyAvailability' && !maps.facultyByEmployee.has(refs.employeeId)) need('faculty', refs.employeeId, 'employee_id');
  if (item.entity === 'classrooms' && refs.departmentCode && !maps.departmentByCode.has(refs.departmentCode) && !stagedKeys.get('departments')?.has(refs.departmentCode)) need('departments', refs.departmentCode, 'department_code');
  if (item.entity === 'subjects') {
    for (const code of refs.eligibleClassroomCodes) if (!maps.classroomByCode.has(code) && ![...(stagedKeys.get('classrooms') || [])].some(key => key === code)) need('classrooms', code, 'eligible_classroom_code');
    for (const employee of refs.eligibleFacultyEmployeeIds) if (!maps.facultyByEmployee.has(employee) && ![...(stagedKeys.get('faculty') || [])].some(key => key === employee)) need('faculty', employee, 'eligible_faculty_employee_id');
  }
  if (item.entity === 'batches' && refs.parentBatchCode) {
    const key = `${refs.semesterKey}|${refs.parentBatchCode}`;
    if (!maps.batchNatural.has(key) && !stagedKeys.get('batches')?.has(key)) need('batches', key, 'parent_batch_code');
  }
  if (item.entity === 'assignments') {
    const subjectKey = `${refs.semesterKey}|${refs.subjectCode}`;
    if (!maps.subjectNatural.has(subjectKey) && !stagedKeys.get('subjects')?.has(subjectKey)) need('subjects', refs.subjectCode, 'subject_code');
    if (!maps.facultyByEmployee.has(refs.facultyEmployeeId) && !stagedKeys.get('faculty')?.has(refs.facultyEmployeeId)) need('faculty', refs.facultyEmployeeId, 'faculty_employee_id');
    if (refs.batchCode) {
      const batchKey = `${refs.semesterKey}|${refs.batchCode}`;
      if (!maps.batchNatural.has(batchKey) && !stagedKeys.get('batches')?.has(batchKey)) need('batches', refs.batchCode, 'batch_code');
    }
    if (refs.roomCode && !maps.classroomByCode.has(refs.roomCode) && !stagedKeys.get('classrooms')?.has(refs.roomCode)) need('classrooms', refs.roomCode, 'room_code');
  }
}

function crossRecordChecks(staged: StagedRow[], maps: any, errors: any[]) {
  const records = new Map(staged.map(item => [`${item.entity}:${item.key}`, item]));
  const resolve = (entity: Entity, key: string, existing: Map<string, any>) => records.get(`${entity}:${key}`) || existing.get(key);
  const recordOf = (value: any) => value && 'record' in value ? value.record : value;
  const stagedRowOf = (value: any) => value && 'record' in value ? value as StagedRow : undefined;
  for (const item of staged.filter(candidate => candidate.entity === 'assignments')) {
    const ref = item.refs;
    const subjectKey = `${ref.semesterKey}|${ref.subjectCode}`;
    const teacherKey = ref.facultyEmployeeId;
    const subjectEntry = resolve('subjects', subjectKey, maps.subjectNatural);
    const teacherEntry = resolve('faculty', teacherKey, maps.facultyByEmployee);
    const batchKey = ref.batchCode ? `${ref.semesterKey}|${ref.batchCode}` : '';
    const batchEntry = batchKey ? resolve('batches', batchKey, maps.batchNatural) : undefined;
    const roomEntry = ref.roomCode ? resolve('classrooms', ref.roomCode, maps.classroomByCode) : undefined;
    const subject = recordOf(subjectEntry); const teacher = recordOf(teacherEntry); const batch = recordOf(batchEntry); const room = recordOf(roomEntry);
    const issue = (field: string, code: string, message: string) => errors.push({ sheet: item.sheet, row: item.row, field, code, message });
    if (subject) {
      if (item.record.courseType !== subject.courseType) issue('course_type', 'SUBJECT_ASSIGNMENT_MISMATCH', 'Assignment course_type must match the referenced subject.');
      if (Number(item.record.weeklyPeriods) !== Number(subject.weeklyPeriods)) issue('weekly_periods', 'WEEKLY_HOURS_MISMATCH', 'Assignment weekly_periods must match the subject weekly_periods.');
      if (item.record.courseType === 'Lab' && Number(item.record.sessionDuration) !== Number(subject.labDuration || 1)) issue('session_duration', 'LAB_DURATION_MISMATCH', `Lab session_duration must match the subject lab_duration (${subject.labDuration || 1}).`);
    }
    if (teacher) {
      const stagedTeacher = stagedRowOf(teacherEntry);
      let teacherDepartment = stagedTeacher?.refs.departmentCode;
      if (!teacherDepartment) teacherDepartment = maps.departments.find((department: any) => String(department._id) === String(teacher.departmentId))?.code;
      if (teacherDepartment && String(teacherDepartment).toUpperCase() !== ref.departmentCode) issue('faculty_employee_id', 'FACULTY_DEPARTMENT_MISMATCH', 'Assignment faculty must belong to the assignment department.');
      if (subject) {
        const stagedSubject = stagedRowOf(subjectEntry);
        let eligible: string[] = stagedSubject?.refs.eligibleFacultyEmployeeIds || [];
        if (!stagedSubject && subject.eligibleFaculty?.length) eligible = subject.eligibleFaculty.map((id: any) => maps.faculty.find((faculty: any) => String(faculty._id) === String(id))?.employeeId).filter(Boolean).map((id: string) => id.toUpperCase());
        if (eligible.length && !eligible.includes(teacher.employeeId.toUpperCase())) issue('faculty_employee_id', 'INELIGIBLE_FACULTY', 'Assigned faculty is not listed in the subject eligible_faculty_employee_ids.');
      }
    }
    if (room && subject) {
      const stagedSubject = stagedRowOf(subjectEntry);
      let eligibleRooms: string[] = stagedSubject?.refs.eligibleClassroomCodes || [];
      if (!stagedSubject && subject.eligibleClassrooms?.length) eligibleRooms = subject.eligibleClassrooms.map((id: any) => maps.classrooms.find((classroom: any) => String(classroom._id) === String(id))?.roomCode).filter(Boolean).map((code: string) => code.toUpperCase());
      if (eligibleRooms.length && !eligibleRooms.includes(room.roomCode.toUpperCase())) issue('room_code', 'INELIGIBLE_CLASSROOM', 'Assigned classroom is not listed in the subject eligible_classroom_codes.');
      const requiresLab = Boolean(subject.requiresLab || item.record.courseType === 'Lab');
      if (requiresLab && room.roomType !== 'Laboratory') issue('room_code', 'CLASSROOM_TYPE_MISMATCH', 'Lab assignments and lab-required subjects must use a Laboratory room.');
      if (!requiresLab && room.roomType === 'Laboratory') issue('room_code', 'CLASSROOM_TYPE_MISMATCH', 'Non-lab assignments cannot use a Laboratory room.');
      const sizes = batch ? [Number(batch.studentCount || 0)] : staged.filter(candidate => candidate.entity === 'batches' && candidate.refs.semesterKey === ref.semesterKey).map(candidate => Number(candidate.record.studentCount || 0));
      const existingSizes = maps.batches.filter((candidate: any) => String(maps.semesterById.get(String(candidate.semesterId))?.naturalKey) === ref.semesterKey).map((candidate: any) => Number(candidate.studentCount || 0));
      const requiredCapacity = sizes.length || existingSizes.length ? Math.max(...sizes, ...existingSizes) : 0;
      if (Number(room.capacity) < requiredCapacity) issue('room_code', 'CLASSROOM_CAPACITY', `Assigned classroom capacity (${room.capacity}) is below the assigned cohort size (${requiredCapacity}).`);
      const stagedRoom = stagedRowOf(roomEntry);
      let roomDepartment = stagedRoom?.refs.departmentCode;
      if (!stagedRoom && room.departmentId) roomDepartment = maps.departments.find((department: any) => String(department._id) === String(room.departmentId))?.code;
      if (roomDepartment && String(roomDepartment).toUpperCase() !== ref.departmentCode) issue('room_code', 'CLASSROOM_DEPARTMENT_MISMATCH', 'Assigned classroom must be global or belong to the assignment department.');
    }
  }
}

function findExisting(item: StagedRow, maps: any): any {
  switch (item.entity) {
    case 'departments': return maps.departmentByCode.get(item.key);
    case 'academicYears': return maps.yearByName.get(item.key);
    case 'semesters': return maps.semesterNatural.get(item.key);
    case 'faculty': return maps.facultyByEmployee.get(item.key);
    case 'subjects': return maps.subjectNatural.get(item.key);
    case 'batches': return maps.batchNatural.get(item.key);
    case 'classrooms': return maps.classroomByCode.get(item.key);
    case 'assignments': return maps.assignmentNatural.get(item.key);
    default: return undefined;
  }
}
function dbKeyExists(item: StagedRow, maps: any) { return Boolean(findExisting(item, maps)); }

export async function parseWorkbook(buffer: Buffer, updateExisting: boolean, mapsOverride?: any) {
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as any); } catch { throw new ApiError(400, 'Workbook could not be opened. Upload a valid, unencrypted .xlsx file.', 'INVALID_WORKBOOK'); }
  if (workbook.worksheets.length > 12) throw new ApiError(400, 'Workbook may contain at most 12 sheets.', 'WORKBOOK_LIMIT');
  const errors: any[] = [];
  const rawRows: Array<{ entity: Entity; sheet: any; row: number; raw: any }> = [];
  const recognized = new Map(Object.entries(specs).map(([entity, spec]) => [headerKey(spec.sheet), entity as Entity]));
  for (const sheet of workbook.worksheets) {
    const entity = recognized.get(headerKey(sheet.name));
    if (!entity) { errors.push({ sheet: sheet.name, row: 1, code: 'UNKNOWN_SHEET', message: `Sheet "${sheet.name}" is not a supported template sheet.` }); continue; }
    if (sheet.rowCount > 5001 || sheet.columnCount > 60) { errors.push({ sheet: sheet.name, row: 1, code: 'WORKBOOK_LIMIT', message: 'Sheet exceeds 5,000 data rows or 60 columns.' }); continue; }
    const headerRow = sheet.getRow(1);
    const headerPositions = new Map<string, number>();
    const supportedHeaders = new Set(specs[entity].fields.map(field => headerKey(field.header)));
    for (let column = 1; column <= sheet.columnCount; column++) {
      const value = headerKey(headerRow.getCell(column).value);
      if (!value) continue;
      if (headerPositions.has(value)) errors.push({ sheet: sheet.name, row: 1, field: text(headerRow.getCell(column).value), code: 'DUPLICATE_HEADER', message: `Header "${text(headerRow.getCell(column).value)}" appears more than once.` });
      else headerPositions.set(value, column);
      if (!supportedHeaders.has(value)) errors.push({ sheet: sheet.name, row: 1, field: text(headerRow.getCell(column).value), code: 'UNKNOWN_HEADER', message: `Header "${text(headerRow.getCell(column).value)}" is not supported by the ${specs[entity].sheet} template.` });
    }
    const missingHeaders = specs[entity].fields.filter(field => field.required && !headerPositions.has(headerKey(field.header)));
    for (const field of missingHeaders) errors.push({ sheet: sheet.name, row: 1, field: field.header, code: 'MISSING_HEADER', message: `Required header "${field.header}" is missing.` });
    if (missingHeaders.length) continue;
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      let hasValue = false; let hasFormula = false; let hasUnmappedData = false;
      for (let column = 1; column <= sheet.columnCount; column++) {
        const cell = row.getCell(column);
        if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
          hasValue = true;
          if (!headerKey(headerRow.getCell(column).value)) hasUnmappedData = true;
        }
        if (cell.type === ExcelJS.ValueType.Formula || (cell.value && typeof cell.value === 'object' && 'formula' in (cell.value as any))) hasFormula = true;
      }
      if (!hasValue) continue;
      if (hasFormula) { errors.push({ sheet: sheet.name, row: rowNumber, code: 'FORMULA_NOT_ALLOWED', message: 'Formula cells are not accepted. Replace them with reviewed values.' }); continue; }
      if (hasUnmappedData) { errors.push({ sheet: sheet.name, row: rowNumber, code: 'UNMAPPED_COLUMN_DATA', message: 'Row contains values under an empty header. Add a supported header or remove those values.' }); continue; }
      const raw: any = {};
      for (const field of specs[entity].fields) {
        const column = headerPositions.get(headerKey(field.header));
        raw[field.field] = column ? row.getCell(column).value : '';
      }
      rawRows.push({ entity, sheet, row: rowNumber, raw });
    }
  }
  if (!rawRows.length && !errors.length) errors.push({ sheet: 'Workbook', row: 1, code: 'EMPTY_WORKBOOK', message: 'No data rows were found.' });
  const staged: StagedRow[] = [];
  const stagedKeys = new Map<Entity, Set<string>>();
  for (const item of rawRows) {
    const parsed = parseEntity(item.entity, item.raw, item.sheet.name, item.row, errors);
    if (!parsed) continue;
    const set = stagedKeys.get(item.entity) || new Set<string>();
    if (set.has(parsed.key)) errors.push({ sheet: parsed.sheet, row: parsed.row, code: 'DUPLICATE_IN_WORKBOOK', message: `Duplicate ${item.entity} record "${parsed.key}" appears more than once in this workbook.` });
    set.add(parsed.key); stagedKeys.set(item.entity, set); staged.push(parsed);
  }
  const maps = mapsOverride || await existingMaps();
  const batchRows = new Map(staged.filter(item => item.entity === 'batches').map(item => [item.key, item]));
  const completedBatchPaths = new Set<string>();
  for (const start of batchRows.values()) {
    if (completedBatchPaths.has(start.key)) continue;
    const path: StagedRow[] = []; const positions = new Map<string, number>(); let cursor: StagedRow | undefined = start;
    while (cursor && !completedBatchPaths.has(cursor.key)) {
      if (positions.has(cursor.key)) {
        const cycleStart = positions.get(cursor.key)!; const cycle = path.slice(cycleStart);
        errors.push({ sheet: cycle[0].sheet, row: cycle[0].row, field: 'parent_batch_code', code: 'BATCH_HIERARCHY_CYCLE', message: `Batch parent references form a cycle: ${cycle.map(item => item.record.batchCode).join(' → ')}.` });
        break;
      }
      positions.set(cursor.key, path.length); path.push(cursor);
      const parentKey = cursor.refs.parentBatchCode ? `${cursor.refs.semesterKey}|${cursor.refs.parentBatchCode}` : '';
      cursor = parentKey ? batchRows.get(parentKey) : undefined;
    }
    for (const item of path) completedBatchPaths.add(item.key);
  }
  for (const item of staged) {
    dependencyChecks(item, maps, stagedKeys, errors);
    if (dbKeyExists(item, maps) && !updateExisting && item.entity !== 'facultyAvailability') errors.push({ sheet: item.sheet, row: item.row, code: 'DUPLICATE_IN_DATABASE', message: `A ${item.entity} record with key "${item.key}" already exists. Enable "Update existing" to overwrite it.` });
    if (item.entity === 'facultyAvailability') {
      const teacher = maps.facultyByEmployee.get(item.refs.employeeId);
      const existingWindows = [...(teacher?.availability || []), ...(teacher?.unavailableSlots || [])];
      if (existingWindows.some((entry: any) => String(entry.day || '').toLowerCase() === item.record.day.toLowerCase() && entry.startTime === item.record.startTime && entry.endTime === item.record.endTime)) errors.push({ sheet: item.sheet, row: item.row, field: 'start_time/end_time', code: 'DUPLICATE_IN_DATABASE', message: 'This faculty availability window already exists in MongoDB.' });
    }
  }
  crossRecordChecks(staged, maps, errors);
  return { staged, errors, maps, updateExisting };
}

function findStagedByKey(staged: StagedRow[], entity: Entity, key: string) { return staged.find(item => item.entity === entity && item.key === key); }
async function resolveRecords(staged: StagedRow[], maps: any, updateExisting: boolean, rollback: any[]) {
  const resolvedIds = new Map<string, string>();
  const out: Array<{ item: StagedRow; Model: any; record: any; document: any }> = [];
  const batchRows = new Map(staged.filter(item => item.entity === 'batches').map(item => [item.key, item]));
  const batchDepths = new Map<string, number>();
  const batchDepth = (item: StagedRow, seen = new Set<string>()): number => {
    if (batchDepths.has(item.key)) return batchDepths.get(item.key)!;
    if (seen.has(item.key)) return 0;
    const nextSeen = new Set(seen); nextSeen.add(item.key);
    const parentKey = item.refs.parentBatchCode ? `${item.refs.semesterKey}|${item.refs.parentBatchCode}` : '';
    const parent = parentKey ? batchRows.get(parentKey) : undefined;
    const depth = parent ? batchDepth(parent, nextSeen) + 1 : 0;
    batchDepths.set(item.key, depth);
    return depth;
  };
  const originalOrder = new Map(staged.map((item, index) => [item.key + ':' + item.entity, index]));
  const records = [...staged].sort((a, b) => {
    const priority = importOrder.indexOf(a.entity) - importOrder.indexOf(b.entity);
    if (priority) return priority;
    if (a.entity === 'batches' && b.entity === 'batches') return batchDepth(a) - batchDepth(b);
    return originalOrder.get(a.key + ':' + a.entity)! - originalOrder.get(b.key + ':' + b.entity)!;
  });
  const retrieve = async (entity: Entity, key: string) => {
    const stagedRecord = out.find(entry => entry.item.entity === entity && entry.item.key === key);
    if (stagedRecord) return String(stagedRecord.document._id);
    const existing = findExisting({ entity, key } as StagedRow, maps);
    return existing ? String(existing._id) : undefined;
  };
  for (const item of records) {
    if (item.entity === 'facultyAvailability') continue;
    const Model = modelMap[item.entity];
    if (!Model) throw new Error(`Unsupported import entity ${item.entity}.`);
    const record = { ...item.record };
    const refs = item.refs;
    const deptId = item.entity === 'departments' || item.entity === 'academicYears' ? undefined : await retrieve('departments', refs.departmentCode);
    if (item.entity !== 'departments' && item.entity !== 'academicYears' && deptId) record.departmentId = deptId;
    if (item.entity === 'semesters' || item.entity === 'subjects' || item.entity === 'batches' || item.entity === 'assignments') {
      const yearId = await retrieve('academicYears', refs.academicYearName.toLowerCase());
      const semesterId = await retrieve('semesters', refs.semesterKey);
      if (item.entity === 'semesters') { record.departmentId = deptId; record.academicYearId = yearId; }
      else record.semesterId = semesterId;
    }
    if (item.entity === 'subjects') {
      record.eligibleClassrooms = await Promise.all((refs.eligibleClassroomCodes || []).map((code: string) => retrieve('classrooms', code)));
      record.eligibleFaculty = await Promise.all((refs.eligibleFacultyEmployeeIds || []).map((code: string) => retrieve('faculty', code)));
      delete record.eligibleClassroomCodes; delete record.eligibleFacultyEmployeeIds;
    }
    if (item.entity === 'batches' && refs.parentBatchCode) record.parentBatchId = await retrieve('batches', `${refs.semesterKey}|${refs.parentBatchCode}`);
    if (item.entity === 'assignments') {
      record.subjectId = await retrieve('subjects', `${refs.semesterKey}|${refs.subjectCode}`);
      record.facultyId = await retrieve('faculty', refs.facultyEmployeeId);
      record.batchId = refs.batchCode ? await retrieve('batches', `${refs.semesterKey}|${refs.batchCode}`) : undefined;
      record.classroomId = refs.roomCode ? await retrieve('classrooms', refs.roomCode) : undefined;
      delete record.subjectCode; delete record.facultyEmployeeId; delete record.batchCode; delete record.roomCode;
    }
    if (item.entity === 'classrooms' && !refs.departmentCode) delete record.departmentId;
    const existing = findExisting(item, maps);
    const current = existing ? await Model.findById(existing._id) : null;
    let document: any;
    if (current) {
      if (!updateExisting) throw new Error(`Record ${item.key} already exists and updateExisting was not enabled.`);
      const before = current.toObject();
      Object.assign(current, record);
      document = await current.save();
      rollback.push({ type: 'update', Model, id: String(current._id), before });
    } else {
      document = await Model.create(record);
      rollback.push({ type: 'create', Model, id: String(document._id) });
    }
    out.push({ item, Model, record, document });
  }
  for (const item of records.filter(record => record.entity === 'facultyAvailability')) {
    const facultyId = await retrieve('faculty', item.refs.employeeId);
    const teacher = await Faculty.findById(facultyId);
    if (!teacher) throw new Error(`Faculty ${item.refs.employeeId} disappeared during import.`);
    const duplicate = [...(teacher.availability || []), ...(teacher.unavailableSlots || [])].some((entry: any) => String(entry.day || '').toLowerCase() === item.record.day.toLowerCase() && entry.startTime === item.record.startTime && entry.endTime === item.record.endTime);
    if (duplicate) throw new Error(`Availability row for ${item.refs.employeeId} already exists.`);
    const before = teacher.toObject();
    if (item.record.available === false) teacher.unavailableSlots.push(item.record);
    else teacher.availability.push(item.record);
    const updated = await teacher.save();
    rollback.push({ type: 'update', Model: Faculty, id: String(updated._id), before });
    out.push({ item, Model: Faculty, record: item.record, document: updated });
  }
  return out;
}

export function buildImportTemplate(type: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SmartSlot AI';
  const requested = type === 'all' ? importOrder : importOrder.filter(entity => entity === type);
  if (!requested.length) throw new ApiError(404, 'Unknown template. Use a supported resource name or "all".', 'TEMPLATE_NOT_FOUND');
  for (const entity of requested) {
    const sheet = workbook.addWorksheet(specs[entity].sheet);
    sheet.columns = specs[entity].fields.map(field => ({ header: field.header, key: field.field, width: Math.max(18, field.header.length + 3) }));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172554' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + sheet.columnCount)}1` };
  }
  return workbook;
}

router.get('/template/:type', authenticate, authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
  const templateType = String(req.params.type);
  const workbook = buildImportTemplate(templateType);
  const filename = `smartslot-${templateType}-template.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res); res.end();
}));

router.post('/validate', authenticate, authorize('Admin'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Choose an .xlsx workbook to validate.', 'FILE_REQUIRED');
  if (!req.file.buffer.subarray(0, 2).equals(Buffer.from('PK'))) throw new ApiError(400, 'The uploaded file is not a valid .xlsx workbook.', 'INVALID_WORKBOOK');
  const updateExisting = req.body.updateExisting === 'true';
  const dryRun = req.body.dryRun === 'true';
  const parsed = await parseWorkbook(req.file.buffer, updateExisting);
  const history = await ImportHistory.create({
    uploadedBy: (req as AuthRequest).user!.id,
    filename: req.file.originalname.replace(/[\\/]/g, '_').slice(0, 180),
    status: parsed.errors.length ? 'invalid' : 'validated',
    updateExisting,
    rows: parsed.staged.map(item => ({ entity: item.entity, sheet: item.sheet, row: item.row, record: item.record, refs: item.refs, key: item.key })),
    rowErrors: parsed.errors,
    summary: { totalRows: parsed.staged.length, validRows: Math.max(0, parsed.staged.length - new Set(parsed.errors.map((error: any) => `${error.sheet}:${error.row}`)).size), dryRun, updateExisting }
  });
  const preview = parsed.staged.slice(0, 100).map(item => ({ sheet: item.sheet, row: item.row, entity: item.entity, key: item.key, data: item.record }));
  res.status(parsed.errors.length ? 422 : 200).json({ data: { importId: String(history._id), status: history.status, preview, previewLimit: 100, errors: parsed.errors, summary: history.summary, confirmAllowed: !parsed.errors.length && !dryRun } });
}));

router.post('/confirm', authenticate, authorize('Admin'), asyncHandler(async (req, res) => {
  const id = String(req.body?.importId || '');
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, 'A valid importId is required.', 'VALIDATION_ERROR');
  const history: any = await ImportHistory.findById(id);
  if (!history || history.uploadedBy.toString() !== (req as AuthRequest).user!.id) throw new ApiError(404, 'Validated import not found.', 'IMPORT_NOT_FOUND');
  if (history.status !== 'validated' || history.rowErrors.length || history.summary?.dryRun) throw new ApiError(409, 'Only a clean, non-dry-run validation can be confirmed.', 'IMPORT_NOT_CONFIRMABLE');
  const existing = await existingMaps();
  const staged: StagedRow[] = history.rows.map((item: any) => ({ entity: item.entity, sheet: item.sheet, row: item.row, record: item.record, refs: item.refs, key: item.key }));
  const rollback: any[] = [];
  try {
    const resolved = await resolveRecords(staged, existing, Boolean(history.updateExisting), rollback);
    // Store count by entity; successful writes are the only records reported as imported.
    const summary: any = { successful: resolved.length, skipped: 0, failed: 0, byEntity: {} };
    for (const entry of resolved) summary.byEntity[entry.item.entity] = (summary.byEntity[entry.item.entity] || 0) + 1;
    history.status = 'committed'; history.committedAt = new Date(); history.summary = { ...history.summary.toObject?.() || history.summary, ...summary };
    await history.save();
    await AuditLog.create({ actorId: (req as AuthRequest).user!.id, action: 'import-confirm', entityType: 'ImportHistory', entityId: history._id, changes: summary });
    res.json({ data: { importId: String(history._id), status: history.status, summary } });
  } catch (error: any) {
    // Compensating rollback protects local MongoDB installations without replica-set transactions.
    let rollbackFailed = false;
    for (const operation of rollback.reverse()) {
      try {
        if (operation.type === 'create') await operation.Model.deleteOne({ _id: operation.id });
        else await operation.Model.replaceOne({ _id: operation.id }, operation.before, { runValidators: false });
      } catch { rollbackFailed = true; }
    }
    history.status = 'failed';
    history.rowErrors = [{ sheet: 'Import', row: 0, code: 'COMMIT_FAILED', message: rollbackFailed ? 'Import failed and automatic rollback was incomplete. Review database records before retrying.' : 'Import failed; applied changes were rolled back.' }];
    await history.save();
    throw new ApiError(500, rollbackFailed ? 'Import failed and automatic rollback was incomplete. An administrator must review the records before retrying.' : 'Import failed and applied changes were rolled back safely.', 'IMPORT_COMMIT_FAILED');
  }
}));

router.get('/history', authenticate, authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const query: any = {};
  if ((req as AuthRequest).user?.role === 'HOD') query.uploadedBy = (req as AuthRequest).user!.id;
  const [records, total] = await Promise.all([ImportHistory.find(query).select('-rows').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), ImportHistory.countDocuments(query)]);
  const data = records.map((record: any) => ({ ...record, errors: record.rowErrors || [] }));
  res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get('/history/:id/errors', authenticate, authorize('Admin', 'HOD'), asyncHandler(async (req, res) => {
  const record: any = await ImportHistory.findById(req.params.id).lean();
  if (!record || ((req as AuthRequest).user?.role === 'HOD' && String(record.uploadedBy) !== (req as AuthRequest).user!.id)) throw new ApiError(404, 'Import history record not found.', 'NOT_FOUND');
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Errors');
  sheet.columns = [{ header: 'Sheet', key: 'sheet', width: 24 }, { header: 'Row', key: 'row', width: 10 }, { header: 'Field', key: 'field', width: 26 }, { header: 'Code', key: 'code', width: 24 }, { header: 'Message', key: 'message', width: 90 }];
  for (const error of record.rowErrors || []) sheet.addRow(error);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="smartslot-import-${req.params.id}-errors.xlsx"`);
  await workbook.xlsx.write(res); res.end();
}));

export default router;
