import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models';
import { asyncHandler, ApiError } from '../middleware/errors';
import { AuthRequest, authenticate, optionalAuthenticate, signToken } from '../middleware/auth';

const router = Router();
const credentials = z.object({ name: z.string().min(2).max(100), email: z.string().email().max(254), password: z.string().min(10).max(128), role: z.enum(['Admin', 'HOD', 'Faculty', 'Student']).optional(), departmentId: z.string().regex(/^[a-f\d]{24}$/i).optional(), facultyId: z.string().regex(/^[a-f\d]{24}$/i).optional() });
const publicUser = (user: any) => ({ id: String(user._id), name: user.name, email: user.email, role: user.role, departmentId: user.departmentId ? String(user.departmentId) : undefined, facultyId: user.facultyId ? String(user.facultyId) : undefined });

router.post('/register', optionalAuthenticate, asyncHandler(async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'Check the registration fields and try again.', 'VALIDATION_ERROR', parsed.error.flatten());
  const count = await User.countDocuments();
  const actor = (req as AuthRequest).user;
  if (count > 0 && (!actor || actor.role !== 'Admin')) throw new ApiError(403, 'Only an administrator can create additional accounts.', 'FORBIDDEN');
  const role = count === 0 ? 'Admin' : (parsed.data.role || 'Student');
  if (count > 0 && role === 'Admin' && actor?.role !== 'Admin') throw new ApiError(403, 'Only an administrator can create administrator accounts.', 'FORBIDDEN');
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = await User.create({ name: parsed.data.name, email: parsed.data.email.toLowerCase(), passwordHash, role, departmentId: parsed.data.departmentId, facultyId: parsed.data.facultyId });
  const profile = publicUser(user);
  res.status(201).json({ data: { user: profile, token: signToken(profile as any) } });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'Email and password are required.', 'VALIDATION_ERROR');
  const user = await User.findOne({ email: parsed.data.email.toLowerCase(), active: true }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) throw new ApiError(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS');
  user.lastLoginAt = new Date();
  await user.save();
  const profile = publicUser(user);
  res.json({ data: { user: profile, token: signToken(profile as any) } });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await User.findById((req as AuthRequest).user!.id);
  if (!user || !user.active) throw new ApiError(401, 'This account is no longer active.', 'UNAUTHORIZED');
  res.json({ data: publicUser(user) });
}));

export default router;
