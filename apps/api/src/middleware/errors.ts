import type { NextFunction, Request, Response } from 'express';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code = 'REQUEST_ERROR', details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const asyncHandler = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res, next)).catch(next);

export function errorHandler(error: any, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (error?.message === 'Origin is not allowed by CORS') return res.status(403).json({ error: { code: 'CORS_ORIGIN_DENIED', message: 'Origin is not allowed.' } });
  if (error?.name === 'ValidationError') {
    const details = Object.values(error.errors || {}).map((item: any) => ({ field: item.path, message: item.message }));
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'The submitted data is invalid.', details } });
  }
  if (error?.name === 'CastError') {
    return res.status(400).json({ error: { code: 'INVALID_ID', message: `Invalid ${error.path || 'identifier'}.` } });
  }
  if (error?.code === 11000) {
    return res.status(409).json({ error: { code: 'DUPLICATE_RECORD', message: 'A record with that unique identifier already exists.', details: error.keyValue } });
  }
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error('Unhandled API error:', error?.message || 'Unknown error');
  res.status(status).json({
    error: {
      code: error?.code || 'INTERNAL_ERROR',
      message: status >= 500 ? 'An unexpected server error occurred.' : error.message,
      ...(error?.details !== undefined ? { details: error.details } : {})
    }
  });
}
