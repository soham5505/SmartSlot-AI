import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app';

test('health endpoint responds without exposing database or secret configuration', async () => {
  const response = await request(app).get('/api/health').expect(200);
  expect(response.body).toEqual({ status: 'ok', service: 'smartslot-api' });
  expect(JSON.stringify(response.body)).not.toMatch(/password|secret|mongodb/i);
});

test('readiness health checks report database and scheduler separately without exposing configuration', async () => {
  const previousUrl = process.env.SCHEDULER_URL;
  process.env.SCHEDULER_URL = 'http://scheduler-test.invalid';
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'ok', service: 'scheduler-test' })
  } as Response);
  try {
    const response = await request(app).get('/api/health/readiness');
    expect(response.status).toBe(mongoose.connection.readyState === 1 ? 200 : 503);
    expect(response.body.data.checks.api.status).toBe('ok');
    expect(response.body.data.checks.database.status).toBe(mongoose.connection.readyState === 1 ? 'ok' : 'unavailable');
    expect(response.body.data.checks.scheduler.status).toBe('ok');
    expect(response.body.data.checkedAt).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toMatch(/scheduler-test\.invalid|password|secret|mongodb/i);
  } finally {
    fetchMock.mockRestore();
    if (previousUrl === undefined) delete process.env.SCHEDULER_URL;
    else process.env.SCHEDULER_URL = previousUrl;
  }
});

test('readiness health check degrades cleanly if scheduler is unreachable', async () => {
  const previousUrl = process.env.SCHEDULER_URL;
  process.env.SCHEDULER_URL = 'http://scheduler-test.invalid';
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private network detail'));
  try {
    const response = await request(app).get('/api/health/readiness').expect(503);
    expect(response.body.data.status).toBe('degraded');
    expect(response.body.data.checks.scheduler.status).toBe('unavailable');
    expect(JSON.stringify(response.body)).not.toContain('private network detail');
  } finally {
    fetchMock.mockRestore();
    if (previousUrl === undefined) delete process.env.SCHEDULER_URL;
    else process.env.SCHEDULER_URL = previousUrl;
  }
});

test('unknown API paths use the consistent error envelope', async () => {
  const response = await request(app).get('/api/not-a-route').expect(404);
  expect(response.body.error.code).toBe('NOT_FOUND');
  expect(response.body.error.message).toBe('API endpoint not found.');
});

test('production CORS does not accept arbitrary Arena preview hosts', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const response = await request(app).get('/api/health').set('Origin', 'https://untrusted-preview.e2b.app').expect(403);
    expect(response.body.error.code).toBe('CORS_ORIGIN_DENIED');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
