'use strict';
/**
 * Unit tests for requireAdminStepUp — verifies fail-closed behavior.
 *
 * Critical invariant: if ADMIN_STEPUP_SECRET is not configured in env vars,
 * ALL mutation requests (POST/PUT/PATCH/DELETE) must be blocked with 503.
 * GET requests must always pass through regardless of config state.
 */

// auth.js throws at require-time if JWT_SECRET is missing — set before loading
process.env.JWT_SECRET = 'test-jwt-secret-for-adminauth-tests';

const { requireAdminStepUp } = require('../src/middleware/adminAuth');

function mockReq(method, headers = {}) {
  return { method, headers, path: '/api/admin/test' };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

// ── Fail-closed: secret NOT configured ──────────────────────────────────────

describe('requireAdminStepUp — ADMIN_STEPUP_SECRET not configured', () => {
  beforeEach(() => {
    delete process.env.ADMIN_STEPUP_SECRET;
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'blocks %s with 503 when secret is missing',
    (method) => {
      const req  = mockReq(method);
      const res  = mockRes();
      const next = jest.fn();

      requireAdminStepUp(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'STEPUP_SECRET_MISSING' })
      );
    }
  );

  test.each(['GET', 'HEAD', 'OPTIONS'])(
    'passes %s through when secret is missing',
    (method) => {
      const req  = mockReq(method);
      const res  = mockRes();
      const next = jest.fn();

      requireAdminStepUp(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    }
  );
});

// ── Secret configured ─────────────────────────────────────────────────────────

describe('requireAdminStepUp — ADMIN_STEPUP_SECRET configured', () => {
  const SECRET = 'test-secret-xyz';

  beforeEach(() => {
    process.env.ADMIN_STEPUP_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.ADMIN_STEPUP_SECRET;
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'allows %s with correct header',
    (method) => {
      const req  = mockReq(method, { 'x-admin-stepup': SECRET });
      const res  = mockRes();
      const next = jest.fn();

      requireAdminStepUp(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    }
  );

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'blocks %s with wrong header — 403',
    (method) => {
      const req  = mockReq(method, { 'x-admin-stepup': 'wrong-secret' });
      const res  = mockRes();
      const next = jest.fn();

      requireAdminStepUp(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'STEPUP_REQUIRED' })
      );
    }
  );

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'blocks %s with missing header — 403',
    (method) => {
      const req  = mockReq(method, {});
      const res  = mockRes();
      const next = jest.fn();

      requireAdminStepUp(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    }
  );

  test('GET always passes through even with secret configured', () => {
    const req  = mockReq('GET');
    const res  = mockRes();
    const next = jest.fn();

    requireAdminStepUp(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
