import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app';
import { AcademicYear, Assignment, Batch, Classroom, Department, Faculty, ImportHistory, Semester, Subject, Timetable, User } from '../models';
import { buildImportTemplate } from '../routes/import';

const repoRoot = path.resolve(__dirname, '../../../../');
const integrationDatabase = 'smartslot_api_integration';
const importMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const serviceToken = 'integration-test-scheduler-token-at-least-32';
const jwtSecret = 'integration-test-jwt-secret-at-least-32-characters';

let mongoServer: MongoMemoryServer | undefined;
let scheduler: ChildProcessWithoutNullStreams | undefined;
let schedulerLog = '';
let adminToken = '';
let schedulerPort = 0;

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function findFreePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a scheduler test port.');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function startScheduler() {
  schedulerPort = await findFreePort();
  const python = process.env.SCHEDULER_TEST_PYTHON || path.join(repoRoot, '.venv', 'bin', 'python');
  scheduler = spawn(python, ['-m', 'uvicorn', 'services.scheduler.app.main:app', '--host', '127.0.0.1', '--port', String(schedulerPort)], {
    cwd: repoRoot,
    env: { ...process.env, SCHEDULER_API_TOKEN: serviceToken, SCHEDULER_CORS_ORIGINS: 'http://127.0.0.1:4000' },
    stdio: 'pipe'
  });
  scheduler.stdout.on('data', chunk => { schedulerLog = (schedulerLog + chunk.toString()).slice(-6000); });
  scheduler.stderr.on('data', chunk => { schedulerLog = (schedulerLog + chunk.toString()).slice(-6000); });
  process.env.SCHEDULER_URL = `http://127.0.0.1:${schedulerPort}`;
  process.env.SCHEDULER_API_TOKEN = serviceToken;

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (scheduler.exitCode !== null) throw new Error(`Test scheduler exited (${scheduler.exitCode}). ${schedulerLog}`);
    try {
      const response = await fetch(`${process.env.SCHEDULER_URL}/health`, { signal: AbortSignal.timeout(700) });
      if (response.ok) return;
    } catch { /* uvicorn is still starting */ }
    await delay(150);
  }
  throw new Error(`Test scheduler did not become healthy. ${schedulerLog}`);
}

async function stopScheduler() {
  if (!scheduler || scheduler.exitCode !== null) return;
  const child = scheduler;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>(resolve => child.once('exit', () => resolve())),
    delay(4000).then(() => { child.kill('SIGKILL'); })
  ]);
}

async function authenticateAdmin() {
  const response = await request(app).post('/api/auth/register').send({
    name: 'Integration Admin', email: 'integration-admin@example.test', password: 'IntegrationPassword!234'
  }).expect(201);
  adminToken = response.body.data.token;
}

async function addFoundation() {
  const auth = { Authorization: `Bearer ${adminToken}` };
  const department = (await request(app).post('/api/departments').set(auth).send({ code: 'IT', name: 'Information Technology' }).expect(201)).body.data;
  const year = (await request(app).post('/api/academicYears').set(auth).send({ name: 'AY 2026-27', startDate: '2026-07-01', endDate: '2027-06-30', status: 'planned' }).expect(201)).body.data;
  return { department, year, auth };
}

beforeAll(async () => {
  jest.setTimeout(180000);
  process.env.JWT_SECRET = jwtSecret;
  process.env.SCHEDULER_API_TOKEN = serviceToken;
  const externalUri = process.env.MONGODB_TEST_URI;
  if (externalUri) {
    const uriDatabase = new URL(externalUri).pathname.split('/').filter(Boolean)[0];
    if (uriDatabase !== integrationDatabase) {
      throw new Error(`MONGODB_TEST_URI must name the disposable /${integrationDatabase} database; it will be cleared by the integration suite.`);
    }
    await mongoose.connect(externalUri, { serverSelectionTimeoutMS: 12000 });
  } else {
    mongoServer = await MongoMemoryServer.create({ instance: { dbName: integrationDatabase } });
    await mongoose.connect(mongoServer.getUri(integrationDatabase), { serverSelectionTimeoutMS: 12000 });
  }
  await Promise.all(Object.values(mongoose.connection.models).map(model => model.init()));
  await startScheduler();
}, 180000);

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.models).map(model => model.deleteMany({})));
  await authenticateAdmin();
});

afterAll(async () => {
  await stopScheduler();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('MongoDB-backed CRUD persists and soft-deletes semester resources', async () => {
  const { department, year, auth } = await addFoundation();
  const semResponse = await request(app).post('/api/semesters').set(auth).send({
    departmentId: department._id, academicYearId: year._id, semesterNumber: 3, semesterName: 'CRUD Test Semester',
    workingDays: ['Monday', 'Tuesday'], timeSlots: [{ periodIndex: 1, startTime: '09:00', endTime: '10:00' }],
    breakConfiguration: [], status: 'active', configurationVerified: true
  }).expect(201);
  const semester = semResponse.body.data;

  const faculty = (await request(app).post('/api/faculty').set(auth).send({
    employeeId: 'F001', name: 'Faculty One', email: 'faculty-one@example.test', departmentId: department._id,
    maxDailyPeriods: 4, maxWeeklyPeriods: 12, availability: [], unavailableSlots: []
  }).expect(201)).body.data;
  const subject = (await request(app).post('/api/subjects').set(auth).send({
    subjectCode: 'IT301', subjectName: 'Integration Test Theory', shortName: 'ITT', departmentId: department._id,
    semesterId: semester._id, courseType: 'Theory', weeklyPeriods: 2, lectureDuration: 1, labDuration: 2, requiresLab: false
  }).expect(201)).body.data;
  const batch = (await request(app).post('/api/batches').set(auth).send({
    semesterId: semester._id, batchCode: 'B1', batchName: 'Batch 1', studentCount: 24, batchType: 'standard'
  }).expect(201)).body.data;
  const room = (await request(app).post('/api/classrooms').set(auth).send({
    roomCode: 'R101', roomName: 'Room 101', roomType: 'Lecture', capacity: 40, departmentId: department._id
  }).expect(201)).body.data;
  const assignment = (await request(app).post('/api/assignments').set(auth).send({
    semesterId: semester._id, subjectId: subject._id, facultyId: faculty._id, batchId: batch._id,
    classroomId: room._id, weeklyPeriods: 2, sessionDuration: 1, courseType: 'Theory'
  }).expect(201)).body.data;

  const resources = [
    ['semesters', semester], ['faculty', faculty], ['subjects', subject], ['batches', batch], ['classrooms', room], ['assignments', assignment]
  ] as const;
  for (const [resource, record] of resources) {
    const fetched = await request(app).get(`/api/${resource}/${record._id}`).set(auth).expect(200);
    expect(fetched.body.data._id).toBe(record._id);
    const listed = await request(app).get(`/api/${resource}`).set(auth).expect(200);
    expect(listed.body.data.some((item: any) => item._id === record._id)).toBe(true);
  }

  await request(app).put(`/api/semesters/${semester._id}`).set(auth).send({ semesterName: 'CRUD Test Semester Updated' }).expect(200);
  await request(app).put(`/api/faculty/${faculty._id}`).set(auth).send({ maxWeeklyPeriods: 14 }).expect(200);
  await request(app).put(`/api/subjects/${subject._id}`).set(auth).send({ shortName: 'ITT2' }).expect(200);
  await request(app).put(`/api/batches/${batch._id}`).set(auth).send({ studentCount: 25 }).expect(200);
  await request(app).put(`/api/classrooms/${room._id}`).set(auth).send({ capacity: 45 }).expect(200);
  await request(app).put(`/api/assignments/${assignment._id}`).set(auth).send({ preferredSlots: [{ day: 'Monday', periodIndex: 1 }] }).expect(200);

  expect((await Semester.findById(semester._id))?.semesterName).toBe('CRUD Test Semester Updated');
  expect((await Faculty.findById(faculty._id))?.maxWeeklyPeriods).toBe(14);
  expect((await Subject.findById(subject._id))?.shortName).toBe('ITT2');
  expect((await Batch.findById(batch._id))?.studentCount).toBe(25);
  expect((await Classroom.findById(room._id))?.capacity).toBe(45);
  expect((await Assignment.findById(assignment._id))?.preferredSlots).toHaveLength(1);

  for (const [resource, record] of [...resources].reverse()) await request(app).delete(`/api/${resource}/${record._id}`).set(auth).expect(200);
  expect((await Semester.findById(semester._id))?.status).toBe('archived');
  expect((await Faculty.findById(faculty._id))?.active).toBe(false);
  expect((await Subject.findById(subject._id))?.active).toBe(false);
  expect((await Batch.findById(batch._id))?.active).toBe(false);
  expect((await Classroom.findById(room._id))?.active).toBe(false);
  expect((await Assignment.findById(assignment._id))?.active).toBe(false);
});

test('rejects invalid MongoDB references and returns duplicate-key errors cleanly', async () => {
  const { department, year, auth } = await addFoundation();
  await request(app).post('/api/subjects').set(auth).send({
    subjectCode: 'BAD1', subjectName: 'Invalid Ref', shortName: 'BAD', departmentId: department._id,
    semesterId: new mongoose.Types.ObjectId().toString(), courseType: 'Theory', weeklyPeriods: 1
  }).expect(422).expect(response => expect(response.body.error.code).toBe('INVALID_REFERENCE'));
  await request(app).get('/api/subjects/not-an-object-id').set(auth).expect(400);
  await request(app).post('/api/departments').set(auth).send({ code: 'IT', name: 'Duplicate Department' })
    .expect(409).expect(response => expect(response.body.error.code).toBe('DUPLICATE_RECORD'));
  expect(await Department.countDocuments()).toBe(1);
  expect(await AcademicYear.countDocuments({ _id: year._id })).toBe(1);
});

test('imports an Excel pilot fixture, generates through CP-SAT, persists, validates, displays, and exports the timetable', async () => {
  const workbook = buildImportTemplate('all');
  workbook.getWorksheet('Departments')!.addRow({ code: 'IT', name: 'Information Technology' });
  workbook.getWorksheet('AcademicYears')!.addRow({ name: 'AY Pilot 2026-27', startDate: '2026-07-01', endDate: '2027-06-30', status: 'planned' });
  workbook.getWorksheet('Semesters')!.addRow({
    departmentCode: 'IT', academicYearName: 'AY Pilot 2026-27', semesterNumber: 3, semesterName: 'SE IT Semester III — integration fixture',
    workingDays: 'Monday,Tuesday,Wednesday,Thursday,Friday',
    timeSlotsJson: JSON.stringify([
      { periodIndex: 1, startTime: '09:00', endTime: '10:00' },
      { periodIndex: 2, startTime: '10:00', endTime: '11:00' }
    ]), breaksJson: '[]', status: 'active', configurationVerified: true,
    sourceNotes: 'Synthetic integration fixture; not extracted from or verified against the unavailable timetable PDF.'
  });
  workbook.getWorksheet('Faculty')!.addRow({
    employeeId: 'F001', name: 'Faculty One', email: 'faculty-one@example.test', departmentCode: 'IT',
    maxDailyPeriods: 4, maxWeeklyPeriods: 12
  });
  workbook.getWorksheet('Classrooms')!.addRow({ roomCode: 'R101', roomName: 'Room 101', roomType: 'Lecture', capacity: 40, equipment: '', departmentCode: 'IT' });
  workbook.getWorksheet('Subjects')!.addRow({
    departmentCode: 'IT', academicYearName: 'AY Pilot 2026-27', semesterNumber: 3, subjectCode: 'IT301',
    subjectName: 'Integration Test Theory', shortName: 'ITT', courseType: 'Theory', weeklyPeriods: 2,
    lectureDuration: 1, labDuration: 2, requiresLab: false
  });
  workbook.getWorksheet('Batches')!.addRow({
    departmentCode: 'IT', academicYearName: 'AY Pilot 2026-27', semesterNumber: 3,
    batchCode: 'B1', batchName: 'Batch 1', studentCount: 24, batchType: 'standard'
  });
  workbook.getWorksheet('Assignments')!.addRow({
    departmentCode: 'IT', academicYearName: 'AY Pilot 2026-27', semesterNumber: 3,
    subjectCode: 'IT301', facultyEmployeeId: 'F001', batchCode: 'B1', roomCode: 'R101',
    weeklyPeriods: 2, sessionDuration: 1, courseType: 'Theory'
  });
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const auth = { Authorization: `Bearer ${adminToken}` };

  const validation = await request(app).post('/api/import/validate').set(auth).attach('file', buffer, {
    filename: 'se-it-sem-iii-integration-fixture.xlsx', contentType: importMime
  }).expect(200);
  expect(validation.body.data.confirmAllowed).toBe(true);
  expect(validation.body.data.errors).toEqual([]);
  const importId = validation.body.data.importId;
  const confirmation = await request(app).post('/api/import/confirm').set(auth).send({ importId }).expect(200);
  expect(confirmation.body.data.status).toBe('committed');
  expect(confirmation.body.data.summary.successful).toBe(8);

  const [department, year, semester, faculty, subject, batch, room, assignment, history] = await Promise.all([
    Department.findOne({ code: 'IT' }), AcademicYear.findOne({ name: 'AY Pilot 2026-27' }),
    Semester.findOne({ semesterNumber: 3 }), Faculty.findOne({ employeeId: 'F001' }),
    Subject.findOne({ subjectCode: 'IT301' }), Batch.findOne({ batchCode: 'B1' }),
    Classroom.findOne({ roomCode: 'R101' }), Assignment.findOne({ weeklyPeriods: 2 }), ImportHistory.findById(importId)
  ]);
  expect([department, year, semester, faculty, subject, batch, room, assignment].every(Boolean)).toBe(true);
  expect(String(subject?.semesterId)).toBe(String(semester?._id));
  expect(String(assignment?.subjectId)).toBe(String(subject?._id));
  expect(String(assignment?.facultyId)).toBe(String(faculty?._id));
  expect(String(assignment?.batchId)).toBe(String(batch?._id));
  expect(String(assignment?.classroomId)).toBe(String(room?._id));
  expect(history?.status).toBe('committed');

  const generated = await request(app).post('/api/timetables/generate').set(auth).send({
    semesterId: String(semester?._id), options: { timeLimitSeconds: 10, randomSeed: 13 }
  }).timeout({ response: 25000, deadline: 35000 });
  expect(generated.status).toBe(201);
  expect(['FEASIBLE', 'OPTIMAL']).toContain(generated.body.status);
  const timetableId = generated.body.data._id;
  expect(generated.body.data.schedule).toHaveLength(2);
  expect(generated.body.data.schedule.every((session: any) => String(session.batchId) === String(batch?._id))).toBe(true);

  const stored: any = await Timetable.findById(timetableId).lean();
  expect(stored?.schedule).toHaveLength(2);
  expect(stored?.generationStatus).toBe(generated.body.status);
  const validationResult = await request(app).get(`/api/timetables/${timetableId}/validate`).set(auth).expect(200);
  expect(validationResult.body.data.valid).toBe(true);
  expect(validationResult.body.data.conflicts).toEqual([]);

  const view = await request(app).get(`/api/timetables/${timetableId}/view`).set(auth).expect(200);
  expect(view.body.data.schedule).toHaveLength(2);
  expect(view.body.data.configurationVerified).toBe(true);
  expect(view.body.data.sourceNotes).toContain('Synthetic integration fixture');
  expect(view.body.data.schedule.every((session: any) => session.batchCode === 'B1' && session.subjectCode === 'IT301')).toBe(true);

  const excel = await request(app).get(`/api/timetables/${timetableId}/export/excel`).set(auth).expect(200);
  expect(Buffer.from(excel.body).subarray(0, 2).toString()).toBe('PK');
  const exportedWorkbook = new ExcelJS.Workbook();
  await exportedWorkbook.xlsx.load(Buffer.from(excel.body) as any);
  expect(exportedWorkbook.worksheets.length).toBeGreaterThan(0);
  expect(exportedWorkbook.worksheets[0].rowCount).toBeGreaterThan(1);

  const pdf = await request(app).get(`/api/timetables/${timetableId}/export/pdf`).set(auth).expect(200);
  expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');

  await Assignment.updateOne({ _id: assignment?._id }, { $set: { needsVerification: true } });
  const blockedPublish = await request(app).post(`/api/timetables/${timetableId}/publish`).set(auth).send({ locked: true }).expect(422);
  expect(blockedPublish.body.error.code).toBe('REFERENCE_REVIEW_REQUIRED');
  await Assignment.updateOne({ _id: assignment?._id }, { $set: { needsVerification: false } });
  expect(await Timetable.countDocuments()).toBe(1); // The timetable was created only by the API generation endpoint.
});
