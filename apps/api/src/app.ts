import './config/environment';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth';
import importRoutes from './routes/import';
import timetableRoutes from './routes/timetables';
import { createResourceRouter } from './routes/resources';
import { RESOURCE_MODELS } from './models';
import { errorHandler } from './middleware/errors';
import { authenticate, authorize, AuthRequest } from './middleware/auth';
import { asyncHandler, ApiError } from './middleware/errors';
import { AcademicYear, Assignment, Batch, Classroom, Department, Faculty, Semester, Subject, Timetable } from './models';
import { validateTimetable } from './services/validateTimetable';
import { reportsRouter } from './routes/reports';

const app = express();
app.disable('x-powered-by');

async function schedulerHealthStatus(): Promise<'ok' | 'unavailable'> {
  const baseUrl = (process.env.SCHEDULER_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return 'unavailable';
    const body = await response.json() as { status?: string };
    return body.status === 'ok' ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const configured = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(value => value.trim());
    if (configured.includes(origin) || (process.env.NODE_ENV !== 'production' && /^https:\/\/[a-z0-9-]+\.e2b\.app$/i.test(origin))) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
  credentials: false
}));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const requestId = req.header('x-request-id')?.slice(0, 100) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-request-id', requestId);
  next();
});
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'smartslot-api' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'smartslot-api' }));
app.get('/api/health/readiness', asyncHandler(async (_req, res) => {
  const databaseStatus = mongoose.connection.readyState === 1 ? 'ok' : 'unavailable';
  const schedulerStatus = await schedulerHealthStatus();
  const ready = databaseStatus === 'ok' && schedulerStatus === 'ok';
  res.status(ready ? 200 : 503).json({ data: {
    status: ready ? 'ready' : 'degraded',
    checkedAt: new Date().toISOString(),
    checks: {
      api: { status: 'ok' },
      database: { status: databaseStatus },
      scheduler: { status: schedulerStatus }
    }
  } });
}));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }), authRoutes);
app.use('/api/import', importRoutes);
app.use('/api/timetables', timetableRoutes);
app.use('/api/reports', reportsRouter);

for (const name of Object.keys(RESOURCE_MODELS) as Array<keyof typeof RESOURCE_MODELS>) {
  app.use(`/api/${name}`, createResourceRouter(name));
}

app.get('/api/dashboard/summary', authenticate, authorize('Admin', 'HOD', 'Faculty', 'Student'), asyncHandler(async (req, res) => {
  const user = (req as AuthRequest).user!;
  if (user.role === 'Student') {
    const published = await Timetable.countDocuments({ published: true });
    return res.json({ data: { departments: 0, academicYears: 0, semesters: 0, faculty: 0, subjects: 0, batches: 0, classrooms: 0, timetables: published, pendingApprovals: 0, conflicts: 0 } });
  }
  let semIds: any[] | undefined;
  const scoped = user.role === 'HOD' && user.departmentId ? { departmentId: user.departmentId } : {};
  if (user.role === 'HOD' && user.departmentId) semIds = await Semester.find({ departmentId: user.departmentId }).distinct('_id');
  const semQuery: any = user.role === 'HOD' ? { departmentId: user.departmentId } : {};
  const assignmentsQuery: any = semIds ? { semesterId: { $in: semIds }, active: true } : { active: true };
  const timetableQuery: any = semIds ? { semesterId: { $in: semIds } } : {};
  const [departments, academicYears, semesters, faculty, subjects, batches, classrooms, timetables, pendingApprovals, conflicts] = await Promise.all([
    Department.countDocuments(scoped), AcademicYear.countDocuments({}), Semester.countDocuments(semQuery),
    Faculty.countDocuments(scoped), Subject.countDocuments(scoped), Batch.countDocuments(semIds ? { semesterId: { $in: semIds }, active: true } : { active: true }),
    Classroom.countDocuments(scoped), Timetable.countDocuments(timetableQuery), Timetable.countDocuments({ ...timetableQuery, published: false, generationStatus: { $in: ['FEASIBLE', 'OPTIMAL'] } }),
    Assignment.countDocuments({ ...assignmentsQuery, needsVerification: true })
  ]);
  res.json({ data: { departments, academicYears, semesters, faculty, subjects, batches, classrooms, timetables, pendingApprovals, conflicts } });
}));

app.use('/api', (_req, _res, next) => next(new ApiError(404, 'API endpoint not found.', 'NOT_FOUND')));
app.use(errorHandler);

export default app;
