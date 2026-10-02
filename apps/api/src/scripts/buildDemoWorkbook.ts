import ExcelJS from 'exceljs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { addTimetableGridSheet } from '../services/exports';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const slots = [
  { periodIndex: 1, label: 'Period 1', startTime: '09:15', endTime: '10:15', kind: 'class' },
  { periodIndex: 2, label: 'Period 2', startTime: '10:15', endTime: '11:15', kind: 'class' },
  { periodIndex: 3, label: 'Period 3', startTime: '11:30', endTime: '12:30', kind: 'class' },
  { periodIndex: 4, label: 'Period 4', startTime: '12:30', endTime: '13:30', kind: 'class' },
  { periodIndex: 5, label: 'Period 5', startTime: '14:15', endTime: '15:15', kind: 'class' },
  { periodIndex: 6, label: 'Period 6', startTime: '15:15', endTime: '16:15', kind: 'class' },
  { periodIndex: 7, label: 'Period 7', startTime: '16:15', endTime: '17:15', kind: 'class' }
];
const breaks = [
  { name: 'Short Break', startTime: '11:15', endTime: '11:30' },
  { name: 'Lunch Break', startTime: '13:30', endTime: '14:15' }
];

type CourseRow = [string, string, string, string, string, string, string, string, string, string, string];
const header = ['Semester', 'Course code', 'Course name (as printed)', 'Short name', 'Course type (as printed)', 'Weekly contact hours (as printed)', 'Batch allocation (as printed)', 'Faculty allocation (as printed)', 'Location notes (not mapped row-wise)', 'Review status', 'Notes'];
const courses: CourseRow[] = [
  ['SE IT III', '2343111', 'Applied Mathematics Thinking', 'AMT-1', 'Theory', '2 + 4 (TUT) = 6', '--', 'Prof. T. P. Soman (TPS)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Tutorial contact hours are combined in the source total; confirm API modeling as theory/tutorial.'],
  ['SE IT III', '2343112', 'Advance Data Structure & Analysis', 'ADSA', 'Theory', '3', '--', 'Prof. S. Sankreswari (SS)', 'Not linked to a course/batch row in the current transcription', 'TRANSCRIBED', 'Spelling retained as visible in the course table.'],
  ['SE IT III', '2343113', 'Database Management System & Application', 'DMS', 'Theory', '3', '--', 'Prof. R. S. More (RSM)', 'Not linked to a course/batch row in the current transcription', 'TRANSCRIBED', ''],
  ['SE IT III', '2343114', 'Automata Theory', 'AT', 'Theory', '3', '--', 'Prof. M. S. Joshi (MSJ)', 'Not linked to a course/batch row in the current transcription', 'TRANSCRIBED', ''],
  ['SE IT III', 'OEC301', 'Open Elective-Web Designing with Word Press', 'OE', 'Theory', '2', '--', 'Prof. A. B. Vartak (ABV)', 'Not linked to a course/batch row in the current transcription', 'TRANSCRIBED', ''],
  ['SE IT III', '2343611', 'Mini Project-Full Stack Java Programming', 'FS Java Lab', 'Theory (as printed)', '2', '--', 'Prof. A. R. Palwankar (ARP)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Same course code also appears on a separate Lab row; do not import both until the subject model is clarified.'],
  ['SE IT III', '2993511', 'Entrepreneurship Development', 'Ent.Dev', 'Theory', '2', '--', 'Prof. P. L. Fernandes (PLF)', 'Not linked to a course/batch row in the current transcription', 'TRANSCRIBED', ''],
  ['SE IT III', '2993512', 'Environmental Science', 'EVS', 'Theory', '2', '--', 'Prof. S. S. Tolye (SST)', 'Not linked to a course/batch row in the current transcription', 'TRANSCRIBED', ''],
  ['SE IT III', '2343115', 'ADSA Lab', 'ADSA Lab', 'Lab', '8', 'B1, B2, B3, B4', 'Prof. S. Sankreswari (SS)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Confirm whether 8 hours is per batch or aggregate and confirm continuous session duration.'],
  ['SE IT III', '2343116', 'SQL Lab', 'SQL Lab', 'Lab', '8', 'B1: SS; B2: ARK; B3: RSM; B4: SS', 'SS: Prof. S. Sankreswari; ARK: Prof. A. R. Kazi; RSM: Prof. R. S. More', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Resolve exact room/location per batch and whether weekly hours are per group.'],
  ['SE IT III', '2343611', 'Mini Project-Full Stack Java Programming', 'FS Java Lab', 'Lab', '8', 'B1: SST; B2: SST; B3: SST; B4: MSJ', 'SST: Prof. S. S. Tolye; MSJ: Prof. M. S. Joshi', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Duplicate code 2343611 also has a Theory row; confirm application subject identity.'],
  ['SE IT III', '2993511', 'Entrepreneurship Development', 'Ent Lab', 'Lab', '8', 'B1-B2: PLF; B3-B4: ABV', 'PLF: Prof. P. L. Fernandes; ABV: Prof. A. B. Vartak', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Confirm exact rooms and weekly session duration per batch.'],
  ['SE IT III', '2993512', 'Environmental Science', 'EVS Lab', 'Lab', '8', 'B1/B3: ABV; B2/B4: ODD', 'ABV: Prof. A. B. Vartak; ODD: Prof. O. D. Dike', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Confirm exact rooms and weekly session duration per batch.'],

  ['TE IT V', '2345111', 'Software Engineering and Agile Practices', 'SEAP', 'Theory', '3', '--', 'Prof. P. L. Fernandes (PLF)', 'Not linked to a course/batch row in the current transcription', 'TRANSCRIBED', ''],
  ['TE IT V', '2345112', 'Artificial Intelligence and Machine Learning', 'AIML', 'Theory', '3', '--', 'Prof. M. S. Joshi (MSJ)', 'Not linked to a course/batch row in the current transcription', 'TRANSCRIBED', ''],
  ['TE IT V', '2345113', 'Web Technology', 'WT', 'Theory', '3', '--', 'Prof. A. R. Palwankar (ARP)', 'Not linked to a course/batch row in the current transcription', 'TRANSCRIBED', ''],
  ['TE IT V', '23451142', 'PEC-1 Advanced Database Technologies', 'PEC-1', 'Theory', '3', '--', 'Prof. M. K. Zagade (MKZ)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Course-code transcription should be checked against original PDF at full resolution.'],
  ['TE IT V', 'MCD501', 'Multidisciplinary Minor (Wireless & MComm)', 'MDM', 'Theory', '3', '--', 'Prof. A. B. Vartak (ABV)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'MCD501 is also used by a distinct MDM stream below; subject-code uniqueness needs an admin decision.'],
  ['TE IT V', 'MCD501', 'Multidisciplinary Minor (Data Structure and Analysis of Algorithm)', 'MDM', 'Theory', '3', '--', 'Prof. S. V. Jadhav (SVJ)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Same source course code as the other MDM theory stream.'],
  ['TE IT V', 'OEC501', 'Open Elective: GENERATIVE AI', 'OE', 'Theory', '2', '--', 'Prof. M. K. Zagade (MKZ)', 'Not linked to a course/batch row in the current transcription', 'TRANSCRIBED', ''],
  ['TE IT V', '2345511', 'India Knowledge System - 2', 'IKS2', 'Theory', '2', '--', 'Prof. V. M. Kulkarni (VMK)', 'Not linked to a course/batch row in the current transcription', 'TRANSCRIBED', ''],
  ['TE IT V', '2345115', 'DevOps Lab', 'DevOps Lab', 'Lab', '8', 'B1-B4', 'Prof. R. S. More (RSM)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Confirm session length and each batch location.'],
  ['TE IT V', '2345116', 'AI & ML Lab', 'AI & ML Lab', 'Lab', '8', 'B1-B4', 'Prof. Mandar Joshi (MSJ)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Confirm session length and each batch location.'],
  ['TE IT V', '2345117', 'Web Lab', 'Web Lab', 'Lab', '8', 'B1-B4', 'Prof. A. R. Palwankar (ARP)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Confirm session length and each batch location.'],
  ['TE IT V', '23451182', 'PEL-1 Lab', 'PEL-1 Lab', 'Lab', '8', 'B1-B4', 'Prof. M. K. Zagade (MKZ)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Confirm exact code, session length and each batch location.'],
  ['TE IT V', 'MCD501', 'Multidisciplinary Minor Lab (Wireless & MComm)', 'MDM LAB', 'Lab', '8', 'W1: ABV; W2: ARP; W3: ABV; W4: MKZ', 'ABV: Prof. A. B. Vartak; ARP: Prof. A. R. Palwankar; MKZ: Prof. M. K. Zagade', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'MCD501 collision with other MDM streams; confirm one session duration per W group.'],
  ['TE IT V', 'MCD501', 'Multidisciplinary Minor Lab (Data Structure and Analysis of Algorithm)', 'MDM LAB', 'Lab', '4', 'D1-D2', 'Prof. A. R. Kazi (ARK)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'MCD501 collision with other MDM streams; verify D1/D2 total and duration.'],
  ['TE IT V', '2345511', 'India Knowledge System 2 Lab', 'IKS2 LAB', 'Lab', '8', 'B1-B2: VMK; B3-B4: APP', 'VMK: Prof. V. M. Kulkarni; APP: A. P. Prabhudesai', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Confirm session length and each batch location.'],

  ['BE IT VII', 'ITC701', 'AI and DS - II', 'AI DS-II', 'Theory', '3', '--', 'Prof. S. V. Jadhav (SVJ)', 'L & AB 2/4', 'TRANSCRIBED', ''],
  ['BE IT VII', 'ITC702', 'Internet of Everything', 'IoE', 'Theory', '3', '--', 'Dr. V. A. Bharadi (VAB)', 'L & AB 2/4', 'TRANSCRIBED', ''],
  ['BE IT VII', 'ITD07013', 'Department Optional Course - 3: Infrastructure Security', 'DOC-3 IS', 'Theory', '3', '--', 'Prof. A. R. Kazi (ARK)', 'L & AB 2/4', 'REVIEW', 'Check exact code and punctuation at full PDF resolution.'],
  ['BE IT VII', 'ITD07024', 'Department Optional Course - 4: Information Retrieval System', 'DOC-4 IRS', 'Theory', '3', '--', 'Prof. S. S. Tolye (SST)', 'L & AB 2/4', 'REVIEW', 'Check exact code and punctuation at full PDF resolution.'],
  ['BE IT VII', 'ITL701', 'Data Science Lab', 'DS Lab', 'Lab', '8', 'B1-B3', 'Prof. S. V. Jadhav (SVJ)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Confirm whether 8 hours is per batch or aggregate and confirm duration.'],
  ['BE IT VII', 'ITL702', 'IoE Lab', 'IoE Lab', 'Lab', '8', 'B1: SST; B2: RSM; B3: SST', 'SST: Prof. S. S. Tolye; RSM: Prof. R. S. More', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Confirm exact locations and weekly session length.'],
  ['BE IT VII', 'ITL703', 'Secure Application Lab', 'SAD Lab', 'Lab', '8', 'B1-B3', 'Prof. A. R. Kazi (ARK)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Confirm whether 8 hours is per batch or aggregate and confirm duration.'],
  ['BE IT VII', 'ITL704', 'Recent Open Source Project Lab', 'ROSP Lab', 'Lab', '8', 'B1-B3', 'Prof. O. D. Dike (ODD)', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Check exact faculty-to-batch mapping and session duration.'],
  ['BE IT VII', 'ITP701', 'Major Project I', '--', 'Project', '2', 'ALL', 'Project Guides', 'Not linked to a course/batch row in the current transcription', 'REVIEW', 'Confirm how common/project guide sessions map into the app assignment model.']
];

const facultyRows = [
  ['SE IT III', 'TPS', 'Prof. T. P. Soman'], ['SE IT III', 'SS', 'Prof. S. Sankreswari'], ['SE IT III', 'RSM', 'Prof. R. S. More'], ['SE IT III', 'MSJ', 'Prof. M. S. Joshi'], ['SE IT III', 'ABV', 'Prof. A. B. Vartak'], ['SE IT III', 'ARP', 'Prof. A. R. Palwankar'], ['SE IT III', 'PLF', 'Prof. P. L. Fernandes'], ['SE IT III', 'SST', 'Prof. S. S. Tolye'], ['SE IT III', 'ARK', 'Prof. A. R. Kazi'], ['SE IT III', 'ODD', 'Prof. O. D. Dike'],
  ['TE IT V', 'PLF', 'Prof. P. L. Fernandes'], ['TE IT V', 'MSJ', 'Prof. M. S. Joshi'], ['TE IT V', 'ARP', 'Prof. A. R. Palwankar'], ['TE IT V', 'MKZ', 'Prof. M. K. Zagade'], ['TE IT V', 'ABV', 'Prof. A. B. Vartak'], ['TE IT V', 'SVJ', 'Prof. S. V. Jadhav'], ['TE IT V', 'VMK', 'Prof. V. M. Kulkarni'], ['TE IT V', 'RSM', 'Prof. R. S. More'], ['TE IT V', 'APP', 'A. P. Prabhudesai'], ['TE IT V', 'ARK', 'Prof. A. R. Kazi'],
  ['BE IT VII', 'SVJ', 'Prof. S. V. Jadhav'], ['BE IT VII', 'VAB', 'Dr. V. A. Bharadi'], ['BE IT VII', 'ARK', 'Prof. A. R. Kazi'], ['BE IT VII', 'SST', 'Prof. S. S. Tolye'], ['BE IT VII', 'RSM', 'Prof. R. S. More'], ['BE IT VII', 'ODD', 'Prof. O. D. Dike']
];

const sourceIssues = [
  ['All', 'Faculty IDs and emails', 'PDF tables show names/short names only; employee IDs and email addresses are not printed.', 'Enter from approved faculty master; do not fabricate.'],
  ['All', 'Rooms / locations', 'Locations such as L & AB 2/4 and EN 2/12 appear, but the room inventory, capacity and equipment are not defined.', 'Map to actual room records with an administrator.'],
  ['All', 'Lab session duration', 'Weekly contact-hour totals are printed, but exact per-batch duration and whether hours are per group or aggregate need confirmation.', 'Do not set labDuration/sessionDuration from totals alone.'],
  ['SE IT III', 'Course code 2343611', 'Full Stack Java appears in both a Theory row (2 contact hours) and a Lab row (8 contact hours).', 'Resolve whether this is one composite course or two application subjects.'],
  ['SE IT III', 'AMT-1 split', 'Weekly hours are printed as 2 + 4 (TUT) = 6.', 'Confirm whether lecture and tutorial are separate assignments/course types.'],
  ['TE IT V', 'MCD501 repeated', 'Two distinct MDM theory streams and their labs are printed with course code MCD501.', 'Choose an approved distinct subject key/stream model; current subject uniqueness is semester + code.'],
  ['TE IT V', 'Course codes', 'PEC-1 and PEL-1 code text is small in the image.', 'Verify the exact codes from the PDF before import.'],
  ['BE IT VII', 'Friday lunch/lab exception', 'Header shows lunch 13:30-14:15; Friday row says 12:30-13:15 and Honor/Minor Lab 13:15-17:15.', 'Confirm which Friday pattern is authoritative and whether it overrides periods.'],
  ['BE IT VII', 'ROSP faculty', 'Merged B1-B3 faculty cell is small in the screenshot.', 'Confirm each batch/faculty assignment from the original PDF.']
];

function styleTable(sheet: ExcelJS.Worksheet, widths: number[]) {
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172554' } };
  sheet.getRow(1).height = 32;
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(widths.length).letter}1` };
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    row.alignment = { vertical: 'top', wrapText: true };
    row.height = 38;
    row.eachCell(cell => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }; });
  });
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CampusChronos';
  workbook.subject = 'FAMT Ratnagiri AY 2026-27 Odd Semester timetable format demo';
  workbook.description = 'Visually transcribed source course data plus blank solver-output grids. Not ready for API import.';

  const start = workbook.addWorksheet('START HERE');
  start.mergeCells('A1:F1');
  start.getCell('A1').value = "CampusChronos — FAMT Ratnagiri timetable demo";
  start.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  start.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172554' } };
  start.getCell('A1').alignment = { vertical: 'middle' };
  start.getRow(1).height = 34;
  const instructions = [
    ['Purpose', 'Shows the timetable grid/output format and the course/batch facts transcribed from the user-provided PDF page images.'],
    ['Not an import workbook', 'Do not upload this file to /api/import/validate. It intentionally omits employee IDs/emails, room IDs, and unresolved session-duration decisions. Use GET /api/import/template/all after the administrator resolves the Source Issues sheet.'],
    ['Timetable grids', 'The three blank grid tabs reproduce the PDF time columns, days, and break columns. They contain no manually inserted or generated sessions. Actual cells should be populated only from a solver-generated, independently validated timetable.'],
    ['Source data', 'The Course Data sheet copies transcribed codes, names, types, contact-hour totals, group allocations, and faculty labels. Location labels are listed separately without guessed course/batch mappings. REVIEW rows need confirmation against the original PDFs.'],
    ['Common period grid', 'P1 09:15–10:15; P2 10:15–11:15; short break 11:15–11:30; P3 11:30–12:30; P4 12:30–13:30; lunch 13:30–14:15; P5 14:15–15:15; P6 15:15–16:15; P7 16:15–17:15.'],
    ['BE Friday exception', 'The BE grid header and Friday row disagree on lunch and Honor/Minor lab time; see Source Issues. The BE semester remains unverified until an administrator resolves it.'],
    ['No fabricated master data', 'Faculty source names do not include the API employee IDs/emails; location strings are not treated as room IDs; lab session lengths are not inferred from weekly totals.'],
    ['Source totals', 'SE IT III: 63 weekly contact hours. TE IT V: 74. BE IT VII: 46. These are the totals printed in the supplied course tables.']
  ];
  start.addRow(['Topic', 'Details']);
  instructions.forEach(row => start.addRow(row));
  start.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  start.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  start.getRow(3).alignment = { vertical: 'middle', wrapText: true };
  start.getColumn(1).width = 28; start.getColumn(2).width = 110;
  start.getColumn(1).font = { bold: true, color: { argb: 'FF1E3A8A' } };
  start.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  start.eachRow((row, index) => { row.alignment = { vertical: 'top', wrapText: true }; if (index >= 4) row.height = 42; });

  const gridSemesters = [
    { name: 'SE IT III', semesterNumber: 3 },
    { name: 'TE IT V', semesterNumber: 5 },
    { name: 'BE IT VII', semesterNumber: 7 }
  ];
  for (const semester of gridSemesters) addTimetableGridSheet(
    workbook,
    { version: 'Demo layout', generationStatus: 'TEMPLATE ONLY', published: false, schedule: [] },
    { semester: { semesterName: semester.name, semesterNumber: semester.semesterNumber, workingDays: days, timeSlots: slots, breakConfiguration: breaks } },
    [],
    semester.name
  );

  const periodSheet = workbook.addWorksheet('Period Grid');
  periodSheet.addRow(['Semester', 'Grid column', 'Start', 'End', 'Type', 'Days', 'Source/review note']);
  for (const semester of gridSemesters) {
    slots.forEach(slot => periodSheet.addRow([semester.name, `P${slot.periodIndex}`, slot.startTime, slot.endTime, 'Class', 'Monday-Saturday', 'Transcribed from shared PDF header.']));
    breaks.forEach(item => periodSheet.addRow([semester.name, item.name, item.startTime, item.endTime, 'Break', 'Monday-Saturday', semester.semesterNumber === 7 && item.name === 'Lunch Break' ? 'BE Friday row conflicts with this header; review before solver generation.' : 'Transcribed from shared PDF header.']));
  }
  styleTable(periodSheet, [18, 20, 14, 14, 14, 24, 72]);

  const courseSheet = workbook.addWorksheet('Course Data');
  courseSheet.addRow(header);
  courses.forEach(row => courseSheet.addRow(row));
  styleTable(courseSheet, [15, 16, 48, 17, 23, 25, 36, 72, 40, 18, 72]);
  courseSheet.autoFilter = { from: 'A1', to: 'K1' };
  courseSheet.eachRow((row, index) => { if (index > 1 && String(row.getCell(10).value).includes('REVIEW')) row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } }; });

  const locationSheet = workbook.addWorksheet('Locations (unmapped)');
  locationSheet.addRow(['Printed location label', 'Course/batch mapping', 'Review note']);
  for (const label of ['L & AB 0/3', 'L & AB 2/3', 'L & AB 1/2', 'EN 2/12']) {
    locationSheet.addRow([label, 'Not mapped', 'Copied from the visual source review; administrator must map to canonical room IDs and confirm which course/batch uses it.']);
  }
  styleTable(locationSheet, [28, 26, 104]);

  const batchSheet = workbook.addWorksheet('Batch Groups');
  batchSheet.addRow(['Semester', 'Batch/group code', 'Group kind as printed/inferred', 'Student count', 'Review status', 'Note']);
  for (const code of ['B1', 'B2', 'B3', 'B4']) batchSheet.addRow(['SE IT III', code, 'Batch (as printed)', '', 'REVIEW', 'Student counts and parent hierarchy are not in the PDF.']);
  for (const code of ['B1', 'B2', 'B3', 'B4']) batchSheet.addRow(['TE IT V', code, 'Batch (as printed)', '', 'REVIEW', 'Student counts and parent hierarchy are not in the PDF.']);
  for (const code of ['W1', 'W2', 'W3', 'W4']) batchSheet.addRow(['TE IT V', code, 'MDM wireless/MComm practical group', '', 'REVIEW', 'Group appears in MDM lab allocation; confirm parent stream and student count.']);
  for (const code of ['D1', 'D2']) batchSheet.addRow(['TE IT V', code, 'MDM DSAA practical group', '', 'REVIEW', 'Group appears in MDM lab allocation; confirm parent stream and student count.']);
  for (const code of ['B1', 'B2', 'B3']) batchSheet.addRow(['BE IT VII', code, 'Batch (as printed)', '', 'REVIEW', 'Student counts and parent hierarchy are not in the PDF.']);
  styleTable(batchSheet, [18, 20, 42, 18, 18, 72]);

  const facultySheet = workbook.addWorksheet('Faculty Reference');
  facultySheet.addRow(['Semester', 'Source short name', 'Name as printed/transcribed', 'API employee ID', 'API email', 'Status']);
  const facultySeen = new Set<string>();
  facultyRows.forEach(row => {
    const key = `${row[0]}|${row[1]}`;
    if (!facultySeen.has(key)) { facultySeen.add(key); facultySheet.addRow([...row, '', '', 'Needs admin master-data match']); }
  });
  styleTable(facultySheet, [18, 20, 42, 24, 40, 32]);

  const issuesSheet = workbook.addWorksheet('Source Issues');
  issuesSheet.addRow(['Semester', 'Issue', 'What the source shows', 'Required action']);
  sourceIssues.forEach(row => issuesSheet.addRow(row));
  styleTable(issuesSheet, [18, 34, 78, 72]);

  const outputPath = resolve(__dirname, '../../../../examples/FAMT_AY2026-27_Timetable_Demo.xlsx');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(await workbook.xlsx.writeBuffer()));
  console.log(`Demo workbook written to ${outputPath}`);
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
