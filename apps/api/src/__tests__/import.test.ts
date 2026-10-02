import ExcelJS from 'exceljs';
import { buildImportTemplate, parseWorkbook } from '../routes/import';

const emptyMaps = () => ({
  departments: [], years: [], semesters: [], faculty: [], subjects: [], batches: [], classrooms: [], assignments: [],
  departmentByCode: new Map(), yearByName: new Map(), semesterById: new Map(), semesterNatural: new Map(), facultyByEmployee: new Map(),
  classroomByCode: new Map(), subjectNatural: new Map(), batchNatural: new Map(), assignmentNatural: new Map()
});
const bufferFor = async (workbook: ExcelJS.Workbook) => Buffer.from(await workbook.xlsx.writeBuffer());

test('all template has resource and faculty-availability sheets in a multi-sheet workbook', () => {
  const workbook = buildImportTemplate('all');
  expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(expect.arrayContaining(['Semesters', 'Batches', 'Assignments', 'FacultyAvailability']));
  expect(workbook.getWorksheet('Assignments')?.getRow(1).values).toContain('subject_code');
  for (const sheetName of ['Subjects', 'Batches', 'Assignments']) expect(workbook.getWorksheet(sheetName)?.getRow(1).values).toContain('needs_verification');
});

test('reports duplicate natural keys in the uploaded workbook', async () => {
  const workbook = buildImportTemplate('departments');
  const sheet = workbook.getWorksheet('Departments')!;
  sheet.addRow({ code: 'IT', name: 'Information Technology' });
  sheet.addRow({ code: 'it', name: 'Duplicate IT' });
  const result = await parseWorkbook(await bufferFor(workbook), false, emptyMaps());
  expect(result.errors.some(error => error.code === 'DUPLICATE_IN_WORKBOOK')).toBe(true);
});

test('detects missing semester foreign references with sheet and row details', async () => {
  const workbook = buildImportTemplate('semesters');
  workbook.getWorksheet('Semesters')!.addRow({
    departmentCode: 'IT', academicYearName: 'AY 2026–27', semesterNumber: 3, semesterName: 'SE IT Sem III',
    workingDays: 'Monday,Tuesday', timeSlotsJson: JSON.stringify([{ periodIndex: 1, startTime: '09:15', endTime: '10:15' }])
  });
  const result = await parseWorkbook(await bufferFor(workbook), false, emptyMaps());
  expect(result.errors.some(error => error.sheet === 'Semesters' && error.row === 2 && error.code === 'MISSING_REFERENCE')).toBe(true);
  expect(result.errors.some(error => error.field === 'department_code')).toBe(true);
  expect(result.errors.some(error => error.field === 'academic_year')).toBe(true);
});

test('formula cells are rejected rather than evaluated during import', async () => {
  const workbook = buildImportTemplate('departments');
  const row = workbook.getWorksheet('Departments')!.addRow({ code: 'IT', name: 'Information Technology' });
  row.getCell('name').value = { formula: '1+1', result: 'unsafe' } as any;
  const result = await parseWorkbook(await bufferFor(workbook), false, emptyMaps());
  expect(result.errors.some(error => error.code === 'FORMULA_NOT_ALLOWED')).toBe(true);
});

test('database duplicates require explicit update-existing confirmation', async () => {
  const workbook = buildImportTemplate('departments');
  workbook.getWorksheet('Departments')!.addRow({ code: 'IT', name: 'Information Technology' });
  const maps = { ...emptyMaps(), departmentByCode: new Map([['IT', { _id: 'dept-1' }]]) };
  const rejected = await parseWorkbook(await bufferFor(workbook), false, maps);
  const allowed = await parseWorkbook(await bufferFor(workbook), true, maps);
  expect(rejected.errors.some(error => error.code === 'DUPLICATE_IN_DATABASE')).toBe(true);
  expect(allowed.errors).toHaveLength(0);
});

test('rejects out-of-range semester, workload, subject, room, and batch numeric values', async () => {
  const cases: Array<{ type: string; row: Record<string, any>; fields: string[] }> = [
    { type: 'semesters', row: { departmentCode: 'IT', academicYearName: 'AY 2026-27', semesterNumber: 0, semesterName: 'Sem III', workingDays: 'Monday', timeSlotsJson: JSON.stringify([{ periodIndex: 1, startTime: '09:00', endTime: '10:00' }]) }, fields: ['semester_number'] },
    { type: 'faculty', row: { employeeId: 'F1', name: 'Faculty One', email: 'f1@example.edu', departmentCode: 'IT', maxDailyPeriods: 0, maxWeeklyPeriods: 0 }, fields: ['max_daily_periods', 'max_weekly_periods'] },
    { type: 'subjects', row: { departmentCode: 'IT', academicYearName: 'AY 2026-27', semesterNumber: 3, subjectCode: 'S1', subjectName: 'Subject', shortName: 'S1', courseType: 'Theory', weeklyPeriods: 0, lectureDuration: 0, labDuration: 0 }, fields: ['weekly_periods', 'lecture_duration', 'lab_duration'] },
    { type: 'batches', row: { departmentCode: 'IT', academicYearName: 'AY 2026-27', semesterNumber: 3, batchCode: 'B1', batchName: 'Batch 1', studentCount: -1 }, fields: ['student_count'] },
    { type: 'classrooms', row: { roomCode: 'R1', roomName: 'Room 1', roomType: 'Lecture', capacity: 0 }, fields: ['capacity'] },
    { type: 'assignments', row: { departmentCode: 'IT', academicYearName: 'AY 2026-27', semesterNumber: 3, subjectCode: 'S1', facultyEmployeeId: 'F1', weeklyPeriods: 0, sessionDuration: 0, courseType: 'Theory' }, fields: ['weekly_periods', 'session_duration'] }
  ];
  for (const item of cases) {
    const workbook = buildImportTemplate(item.type);
    workbook.worksheets[0].addRow(item.row);
    const result = await parseWorkbook(await bufferFor(workbook), false, emptyMaps());
    for (const field of item.fields) expect(result.errors.some(error => error.field === field && error.code === 'OUT_OF_RANGE')).toBe(true);
  }
});

test('validates semester period boundaries, break intersections, enums, and booleans', async () => {
  const workbook = buildImportTemplate('semesters');
  workbook.getWorksheet('Semesters')!.addRow({
    departmentCode: 'IT', academicYearName: 'AY 2026-27', semesterNumber: 3, semesterName: 'SE IT Sem III',
    workingDays: 'Monday,Tuesday',
    timeSlotsJson: JSON.stringify([
      { periodIndex: 1, startTime: '09:00', endTime: '10:00' },
      { periodIndex: 2, startTime: '09:30', endTime: '10:30' }
    ]),
    breaksJson: JSON.stringify([{ name: 'Short break', startTime: '09:40', endTime: '09:50' }]),
    status: 'unknown', configurationVerified: 'maybe'
  });
  const result = await parseWorkbook(await bufferFor(workbook), false, emptyMaps());
  expect(result.errors.some(error => error.code === 'INVALID_ENUM')).toBe(true);
  expect(result.errors.some(error => error.code === 'INVALID_BOOLEAN')).toBe(true);
  expect(result.errors.some(error => error.code === 'PERIOD_OVERLAPS_BREAK')).toBe(true);
  expect(result.errors.some(error => error.code === 'OVERLAPPING_PERIODS')).toBe(true);
});

test('rejects unknown headers and values under blank headers instead of dropping them', async () => {
  const workbook = buildImportTemplate('departments');
  const sheet = workbook.getWorksheet('Departments')!;
  sheet.getRow(1).getCell(4).value = 'legacy_column';
  const row = sheet.addRow({ code: 'IT', name: 'Information Technology' });
  row.getCell(4).value = 'must not be ignored';
  row.getCell(5).value = 'unmapped';
  const result = await parseWorkbook(await bufferFor(workbook), false, emptyMaps());
  expect(result.errors.some(error => error.code === 'UNKNOWN_HEADER')).toBe(true);
  expect(result.errors.some(error => error.code === 'UNMAPPED_COLUMN_DATA')).toBe(true);
});

test('rejects cyclic batch parent references before confirmation', async () => {
  const workbook = buildImportTemplate('batches');
  const sheet = workbook.getWorksheet('Batches')!;
  sheet.addRow({ departmentCode: 'IT', academicYearName: 'AY 2026-27', semesterNumber: 3, batchCode: 'B1', batchName: 'Batch 1', parentBatchCode: 'B2' });
  sheet.addRow({ departmentCode: 'IT', academicYearName: 'AY 2026-27', semesterNumber: 3, batchCode: 'B2', batchName: 'Batch 2', parentBatchCode: 'B1' });
  const maps = emptyMaps();
  maps.departmentByCode.set('IT', { _id: 'department-1', code: 'IT' });
  maps.yearByName.set('ay 2026-27', { _id: 'year-1', name: 'AY 2026-27' });
  maps.semesterNatural.set('IT|ay 2026-27|3', { _id: 'semester-1' });
  const result = await parseWorkbook(await bufferFor(workbook), false, maps);
  expect(result.errors.some(error => error.code === 'BATCH_HIERARCHY_CYCLE')).toBe(true);
});

test('reports linked subject, faculty, room-type, and weekly-hours mismatches in assignments', async () => {
  const workbook = buildImportTemplate('assignments');
  workbook.getWorksheet('Assignments')!.addRow({
    departmentCode: 'IT', academicYearName: 'AY 2026-27', semesterNumber: 3,
    subjectCode: 'LAB1', facultyEmployeeId: 'F1', roomCode: 'R1',
    weeklyPeriods: 2, sessionDuration: 1, courseType: 'Theory'
  });
  const maps: any = emptyMaps();
  maps.departments.push({ _id: 'department-1', code: 'IT' });
  maps.departmentByCode.set('IT', maps.departments[0]);
  maps.yearByName.set('ay 2026-27', { _id: 'year-1', name: 'AY 2026-27' });
  maps.semesterNatural.set('IT|ay 2026-27|3', { _id: 'semester-1' });
  maps.subjectNatural.set('IT|ay 2026-27|3|LAB1', { _id: 'subject-1', subjectCode: 'LAB1', courseType: 'Lab', weeklyPeriods: 4, labDuration: 2, requiresLab: true });
  maps.facultyByEmployee.set('F1', { _id: 'faculty-1', employeeId: 'F1', departmentId: 'department-1' });
  maps.classroomByCode.set('R1', { _id: 'room-1', roomCode: 'R1', roomType: 'Lecture', capacity: 60, departmentId: 'department-1' });
  const result = await parseWorkbook(await bufferFor(workbook), false, maps);
  expect(result.staged[0].key).toBe('IT|ay 2026-27|3|LAB1|F1|COMMON');
  expect(result.errors.some(error => error.code === 'SUBJECT_ASSIGNMENT_MISMATCH')).toBe(true);
  expect(result.errors.some(error => error.code === 'WEEKLY_HOURS_MISMATCH')).toBe(true);
  expect(result.errors.some(error => error.code === 'CLASSROOM_TYPE_MISMATCH')).toBe(true);
});

test('imports optional needs_verification flags without clearing an existing value when blank', async () => {
  const workbook = buildImportTemplate('all');
  workbook.getWorksheet('Subjects')!.addRow({
    departmentCode: 'IT', academicYearName: 'AY 2026-27', semesterNumber: 3,
    subjectCode: 'S1', subjectName: 'Subject One', shortName: 'S1', courseType: 'Theory', weeklyPeriods: 2,
    needsVerification: 'false'
  });
  workbook.getWorksheet('Batches')!.addRow({
    departmentCode: 'IT', academicYearName: 'AY 2026-27', semesterNumber: 3,
    batchCode: 'B1', batchName: 'Batch B1', needsVerification: 'yes'
  });
  workbook.getWorksheet('Assignments')!.addRow({
    departmentCode: 'IT', academicYearName: 'AY 2026-27', semesterNumber: 3,
    subjectCode: 'S1', facultyEmployeeId: 'F1', weeklyPeriods: 2, sessionDuration: 1,
    courseType: 'Theory', needsVerification: 'maybe'
  });
  const result = await parseWorkbook(await bufferFor(workbook), false, emptyMaps());
  const subject = result.staged.find(row => row.entity === 'subjects')!;
  const batch = result.staged.find(row => row.entity === 'batches')!;
  expect(subject.record.needsVerification).toBe(false);
  expect(batch.record.needsVerification).toBe(true);
  expect(result.errors.some(error => error.sheet === 'Assignments' && error.field === 'needs_verification' && error.code === 'INVALID_BOOLEAN')).toBe(true);

  const withoutFlag = buildImportTemplate('batches');
  withoutFlag.getWorksheet('Batches')!.addRow({ departmentCode: 'IT', academicYearName: 'AY 2026-27', semesterNumber: 3, batchCode: 'B2', batchName: 'Batch B2' });
  const unflagged = await parseWorkbook(await bufferFor(withoutFlag), false, emptyMaps());
  expect(Object.prototype.hasOwnProperty.call(unflagged.staged[0].record, 'needsVerification')).toBe(false);
});
