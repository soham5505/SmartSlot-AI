import type { Role } from '../middleware/auth';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: Role; name: string; email: string; departmentId?: string; facultyId?: string };
    }
  }
}
export {};
