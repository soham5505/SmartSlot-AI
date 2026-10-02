import type { NextFunction, Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { ApiError } from './errors';

export type Role = 'Admin' | 'HOD' | 'Faculty' | 'Student';
export interface AuthUser { id: string; role: Role; name: string; email: string; departmentId?: string; facultyId?: string }
export type AuthRequest = Request & { user?: AuthUser };

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new ApiError(500, 'JWT_SECRET must be configured with at least 32 characters.', 'AUTH_NOT_CONFIGURED');
  return value;
}

export function signToken(user: AuthUser) {
  const expiresIn = (process.env.JWT_EXPIRES_IN || '8h') as SignOptions['expiresIn'];
  return jwt.sign(user, secret(), { expiresIn, issuer: 'smartslot-api', audience: 'smartslot-client' });
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new ApiError(401, 'Authentication is required.', 'UNAUTHORIZED'));
  try {
    const payload = jwt.verify(header.slice(7), secret(), { issuer: 'smartslot-api', audience: 'smartslot-client' }) as AuthUser;
    (req as AuthRequest).user = payload;
    next();
  } catch {
    next(new ApiError(401, 'Your session is invalid or has expired. Please sign in again.', 'INVALID_TOKEN'));
  }
}

export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) return next();
  if (!header.startsWith('Bearer ')) return next(new ApiError(401, 'Invalid authorization header.', 'INVALID_TOKEN'));
  try {
    (req as AuthRequest).user = jwt.verify(header.slice(7), secret(), { issuer: 'smartslot-api', audience: 'smartslot-client' }) as AuthUser;
    next();
  } catch {
    next(new ApiError(401, 'Your session is invalid or has expired. Please sign in again.', 'INVALID_TOKEN'));
  }
}

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as AuthRequest).user;
    if (!user) return next(new ApiError(401, 'Authentication is required.', 'UNAUTHORIZED'));
    if (!roles.includes(user.role)) return next(new ApiError(403, 'You do not have permission to perform this action.', 'FORBIDDEN'));
    next();
  };
}
