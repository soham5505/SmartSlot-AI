import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const mapById = (items: any[]) => new Map((items || []).map(item => [String(item._id), item]));
const minutes = (value: string) => { const [hours, mins] = String(value).split(':').map(Number); return hours * 60 + mins; };
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;
const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function timeAxis(semester: any, schedule: any[]) {
  let periods = (semester.timeSlots || []).filter((slot: any) => slot.kind !== 'break' && slot.kind !== 'blocked');
  if (!periods.length) {
    const intervals = new Map<string, any>();
    for (const session of schedule) intervals.set(`${session.startTime}-${session.endTime}`, { periodIndex: 0, startTime: session.startTime, endTime: session.endTime });
    periods = [...intervals.values()].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((slot, index) => ({ ...slot, periodIndex: index + 1 }));
  }
  const breaks = (semester.breakConfiguration || []).map((item: any) => ({ ...item, axisKind: 'break' }));
  return [
    ...periods.map((slot: any) => ({ ...slot, axisKind: 'class' })),
    ...breaks
  ].sort((a: any, b: any) => {
    const byTime = minutes(a.startTime) - minutes(b.startTime);
    if (byTime) return byTime;
    if (a.axisKind === b.axisKind) return 0;
    return a.axisKind === 'break' ? -1 : 1;
  });
}

export function addTimetableGridSheet(workbook: ExcelJS.Workbook, timetable: any, context: any, schedule: any[] = timetable.schedule || [], name = 'Timetable Grid') {
  const semester = context.semester || {};
  const axis = timeAxis(semester, schedule);
  const sheet = workbook.addWorksheet(name);
  const lastColumn = axis.length + 1;
  sheet.columns = [{ key: 'day', width: 14 }, ...axis.map((item: any) => ({ key: `${item.axisKind}-${item.periodIndex || item.name}`, width: item.axisKind === 'break' ? 13 : 21 }))];
  sheet.mergeCells(1, 1, 1, lastColumn);
  sheet.getCell(1, 1).value = `${semester.semesterName || `Semester ${semester.semesterNumber || ''}`} — Timetable`;
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  sheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172554' } };
  sheet.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 30;
  sheet.mergeCells(2, 1, 2, lastColumn);
  sheet.getCell(2, 1).value = `CampusChronos · Version ${timetable.version ?? 'Demo'} · ${timetable.generationStatus || 'TIMETABLE FORMAT'} · ${timetable.published ? 'Published' : 'Draft'}`;
  sheet.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF475569' } };
  sheet.mergeCells(3, 1, 3, lastColumn);
  sheet.getCell(3, 1).value = schedule.length ? 'Each class cell lists batch, subject, faculty, and room. Multi-period sessions are shown in each occupied period.' : 'Blank output layout — generated sessions are filled here only after solver generation and validation.';
  sheet.getCell(3, 1).font = { size: 9, color: { argb: 'FF475569' } };
  const header = sheet.getRow(4);
  header.getCell(1).value = 'Day';
  axis.forEach((item: any, index: number) => {
    const value = item.axisKind === 'break'
      ? `${item.name}\n${item.startTime}–${item.endTime}`
      : `P${item.periodIndex}${item.label && item.label !== `Period ${item.periodIndex}` ? ` · ${item.label}` : ''}\n${item.startTime}–${item.endTime}`;
    header.getCell(index + 2).value = value;
    header.getCell(index + 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: item.axisKind === 'break' ? 'FFFDE68A' : 'FF1E3A8A' } };
    header.getCell(index + 2).font = { bold: true, color: { argb: item.axisKind === 'break' ? 'FF78350F' : 'FFFFFFFF' }, size: 9 };
    header.getCell(index + 2).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  header.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172554' } };
  header.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  header.height = 42;

  const configuredDays = semester.workingDays?.length ? semester.workingDays : dayOrder.slice(0, 6);
  const days = [...configuredDays].sort((a: string, b: string) => (dayOrder.indexOf(a) < 0 ? 99 : dayOrder.indexOf(a)) - (dayOrder.indexOf(b) < 0 ? 99 : dayOrder.indexOf(b)));
  days.forEach((day: string) => {
    const row = sheet.addRow([day, ...axis.map(() => '')]);
    row.height = 84;
    row.getCell(1).font = { bold: true, color: { argb: 'FF172554' } };
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.eachCell({ includeEmpty: true }, cell => {
      cell.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
      cell.alignment = { ...(cell.alignment || {}), vertical: 'middle', wrapText: true };
    });
  });

  const subjects = mapById(context.subjects); const faculty = mapById(context.faculty); const batches = mapById(context.batches); const rooms = mapById(context.classrooms);
  const rowForDay = new Map(days.map((day: string, index: number) => [day.toLowerCase(), index + 5]));
  const ordered = [...schedule].sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.startTime).localeCompare(String(b.startTime)) || String(a.batchId || '').localeCompare(String(b.batchId || '')));
  for (const session of ordered) {
    const rowNumber = rowForDay.get(String(session.day).toLowerCase());
    if (!rowNumber) continue;
    const subject: any = subjects.get(String(session.subjectId)); const teacher: any = faculty.get(String(session.facultyId));
    const batch: any = batches.get(String(session.batchId)); const room: any = rooms.get(String(session.classroomId));
    const start = minutes(session.startTime), end = minutes(session.endTime);
    const label = [
      `${batch?.batchCode || 'ALL'} · ${subject?.shortName || subject?.subjectCode || 'Session'}`,
      teacher?.shortName || teacher?.name || '',
      room?.roomCode || ''
    ].filter(Boolean).join('\n');
    axis.forEach((item: any, index: number) => {
      if (item.axisKind !== 'class' || (item.day && String(item.day).toLowerCase() !== String(session.day).toLowerCase())) return;
      if (!overlaps(start, end, minutes(item.startTime), minutes(item.endTime))) return;
      const cell = sheet.getCell(rowNumber, index + 2);
      cell.value = cell.value ? `${cell.value}\n\n${label}` : label;
      cell.font = { size: 9, color: { argb: 'FF0F172A' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
  }
  axis.forEach((item: any, index: number) => {
    if (item.axisKind !== 'break') return;
    const column = index + 2;
    const appliesToDays = !item.days?.length || days.every((day: string) => item.days.some((entry: string) => entry.toLowerCase() === day.toLowerCase()));
    if (appliesToDays && days.length) {
      sheet.mergeCells(5, column, 4 + days.length, column);
      sheet.getCell(5, column).value = `${item.name}\n${item.startTime}–${item.endTime}`;
      sheet.getCell(5, column).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, textRotation: 0 };
      sheet.getCell(5, column).font = { bold: true, color: { argb: 'FF78350F' }, size: 9 };
      sheet.getCell(5, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
    } else {
      days.forEach((day: string, indexDay: number) => {
        const cell = sheet.getCell(indexDay + 5, column);
        const applies = !item.days?.length || item.days.some((entry: string) => entry.toLowerCase() === day.toLowerCase());
        cell.value = applies ? `${item.name}\n${item.startTime}–${item.endTime}` : '';
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        if (applies) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      });
    }
  });
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }];
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(lastColumn).letter}${4 + days.length}`;
  return sheet;
}

export function buildTimetableWorkbook(timetable: any, context: any, schedule: any[] = timetable.schedule || []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CampusChronos'; workbook.subject = 'College timetable';
  addTimetableGridSheet(workbook, timetable, context, schedule);
  const sheet = workbook.addWorksheet('Sessions');
  const periods = context.semester?.timeSlots || [];
  sheet.columns = [
    { header: 'Day', key: 'day', width: 14 }, { header: 'Start', key: 'startTime', width: 12 }, { header: 'End', key: 'endTime', width: 12 },
    { header: 'Period(s)', key: 'periods', width: 14 }, { header: 'Subject', key: 'subject', width: 30 }, { header: 'Faculty', key: 'faculty', width: 24 }, { header: 'Batch', key: 'batch', width: 16 },
    { header: 'Room', key: 'room', width: 18 }, { header: 'Session type', key: 'type', width: 16 }, { header: 'Periods', key: 'duration', width: 12 }
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172554' } };
  const subjects = mapById(context.subjects); const faculty = mapById(context.faculty); const batches = mapById(context.batches); const rooms = mapById(context.classrooms);
  const ordered = [...schedule].sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.startTime).localeCompare(String(b.startTime)));
  for (const session of ordered) {
    const subject: any = subjects.get(String(session.subjectId)); const teacher: any = faculty.get(String(session.facultyId));
    const batch: any = batches.get(String(session.batchId)); const room: any = rooms.get(String(session.classroomId));
    const occupied = periods.filter((slot: any) => slot.kind !== 'break' && slot.kind !== 'blocked' && (!slot.day || String(slot.day).toLowerCase() === String(session.day).toLowerCase()) && overlaps(minutes(session.startTime), minutes(session.endTime), minutes(slot.startTime), minutes(slot.endTime))).map((slot: any) => slot.periodIndex).join(', ');
    sheet.addRow({ day: session.day, startTime: session.startTime, endTime: session.endTime, periods: occupied, subject: subject ? `${subject.subjectCode} — ${subject.subjectName}` : '', faculty: teacher?.name || '', batch: batch?.batchCode || 'All batches', room: room?.roomCode || '', type: session.sessionType, duration: session.duration });
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return workbook;
}

export function buildTimetablePdfBuffer(timetable: any, context: any, schedule: any[] = timetable.schedule || []) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, info: { Title: 'SmartSlot Timetable', Author: 'SmartSlot AI' } });
    doc.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(18).fillColor('#172554').text(`Semester ${context.semester.semesterNumber} timetable`, { align: 'left' });
    doc.moveDown(0.3).fontSize(9).fillColor('#475569').text(`Version ${timetable.version} · ${timetable.generationStatus} · ${timetable.published ? 'Published' : 'Draft'}`);
    doc.moveDown();
    const columns = [32, 105, 165, 250, 420, 555, 810];
    const headers = ['Day', 'Time', 'Subject', 'Faculty', 'Batch', 'Room / type'];
    const rowHeight = 29;
    let y = doc.y;
    doc.rect(32, y, 778, rowHeight).fill('#172554');
    headers.forEach((header, index) => doc.fillColor('#ffffff').fontSize(8).text(header, columns[index] + 4, y + 9, { width: columns[index + 1] - columns[index] - 8, ellipsis: true }));
    y += rowHeight;
    const subjects = mapById(context.subjects); const faculty = mapById(context.faculty); const batches = mapById(context.batches); const rooms = mapById(context.classrooms);
    const ordered = [...schedule].sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.startTime).localeCompare(String(b.startTime)));
    for (const session of ordered) {
      if (y > 535) { doc.addPage(); y = 32; }
      const subject: any = subjects.get(String(session.subjectId)); const teacher: any = faculty.get(String(session.facultyId));
      const batch: any = batches.get(String(session.batchId)); const room: any = rooms.get(String(session.classroomId));
      const values = [session.day, `${session.startTime}–${session.endTime}`, subject?.shortName || subject?.subjectCode || 'Subject', teacher?.name || '', batch?.batchCode || 'All batches', `${room?.roomCode || ''} · ${session.sessionType}`];
      if (Math.round(y / rowHeight) % 2 === 0) doc.rect(32, y, 778, rowHeight).fill('#f1f5f9');
      values.forEach((value, index) => doc.fillColor('#0f172a').fontSize(8).text(String(value), columns[index] + 4, y + 8, { width: columns[index + 1] - columns[index] - 8, height: 14, ellipsis: true }));
      y += rowHeight;
    }
    doc.end();
  });
}
