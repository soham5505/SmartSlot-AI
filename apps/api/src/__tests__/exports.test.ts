import ExcelJS from 'exceljs';
import { buildTimetablePdfBuffer, buildTimetableWorkbook } from '../services/exports';

const context: any = {
  semester: {
    semesterNumber: 3, semesterName: 'SE IT — Semester III', workingDays: ['Monday', 'Tuesday'],
    timeSlots: [
      { periodIndex: 1, startTime: '09:15', endTime: '10:15' },
      { periodIndex: 2, startTime: '10:15', endTime: '11:15' },
      { periodIndex: 3, startTime: '11:30', endTime: '12:30' },
      { periodIndex: 4, startTime: '12:30', endTime: '13:30' },
      { periodIndex: 5, startTime: '14:15', endTime: '15:15' }
    ],
    breakConfiguration: [
      { name: 'Short Break', startTime: '11:15', endTime: '11:30' },
      { name: 'Lunch Break', startTime: '13:30', endTime: '14:15' }
    ]
  },
  subjects: [{ _id: 's1', subjectCode: 'IT301', subjectName: 'Systems', shortName: 'SYS' }],
  faculty: [{ _id: 'f1', name: 'A. Teacher' }],
  batches: [{ _id: 'b1', batchCode: 'B1' }],
  classrooms: [{ _id: 'r1', roomCode: 'LAB-1' }]
};
const timetable: any = { version: 2, generationStatus: 'OPTIMAL', published: true, schedule: [{ day: 'Monday', startTime: '09:15', endTime: '10:15', subjectId: 's1', facultyId: 'f1', batchId: 'b1', classroomId: 'r1', sessionType: 'Theory', duration: 1 }] };

test('Excel export uses the timetable-grid layout, shows break columns, and includes detailed sessions', async () => {
  const buffer = Buffer.from(await buildTimetableWorkbook(timetable, context).xlsx.writeBuffer());
  expect(buffer.subarray(0, 2).toString()).toBe('PK');
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer as any);
  const grid = restored.getWorksheet('Timetable Grid')!;
  expect(grid.getCell('A4').value).toBe('Day');
  expect(String(grid.getCell('B4').value)).toContain('09:15–10:15');
  expect(String(grid.getCell('D4').value)).toContain('Short Break');
  expect(String(grid.getCell('D5').value)).toContain('11:15–11:30');
  expect(String(grid.getCell('B5').value)).toContain('B1 · SYS');
  expect(String(grid.getCell('B5').value)).toContain('A. Teacher');
  const sessions = restored.getWorksheet('Sessions')!;
  expect(sessions.getRow(1).values).toEqual(expect.arrayContaining(['Subject', 'Faculty', 'Batch', 'Room', 'Period(s)']));
  expect(sessions.getCell('E2').value).toContain('IT301');
  expect(sessions.getCell('F2').value).toBe('A. Teacher');
  expect(sessions.getCell('G2').value).toBe('B1');
});

test('PDF export returns a valid PDF document', async () => {
  const buffer = await buildTimetablePdfBuffer(timetable, context);
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  expect(buffer.length).toBeGreaterThan(500);
});

test('ExcelJS conditional-format extension round-trips with the pinned CommonJS UUID v4 dependency', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('UUID compatibility');
  sheet.getCell('A1').value = 12;
  sheet.addConditionalFormatting({
    ref: 'A1:A2',
    rules: [{ type: 'dataBar', gradient: false, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF638EC6' } }]
  } as any);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  expect(buffer.subarray(0, 2).toString()).toBe('PK');
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer as any);
  const rule = (restored.getWorksheet('UUID compatibility') as any).conditionalFormattings[0].rules[0];
  expect(rule.type).toBe('dataBar');
  expect(rule.gradient).toBe(false);
  expect(rule.x14Id).toMatch(/^\{[A-F0-9-]{36}\}$/);
});
