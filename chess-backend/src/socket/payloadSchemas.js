'use strict';
/**
 * payloadSchemas — Zod validation schemas for all Socket.IO event payloads.
 *
 * Usage in handlers:
 *   const data = validateOrReject(schemas.moveSchema, payload, socket, 'game:move');
 *   if (!data) return; // invalid payload — error already emitted to client
 *
 * Security:
 *   - Rejects malformed payloads before any handler logic runs.
 *   - Prevents prototype pollution (Zod strips unknown keys by default in .parse).
 *   - Ensures consistent error response format for all validation failures.
 */

const { z } = require('zod');

// ── Reusable primitives ───────────────────────────────────────────────────────

const uuidField   = z.string().uuid();
const squareField = z.string().regex(/^[a-h][1-8]$/, 'Must be a valid chess square (e.g. e4)');

// ── Event schemas ─────────────────────────────────────────────────────────────

const joinSchema = z.object({
  gameId: uuidField,
});

const moveSchema = z.object({
  gameId:    uuidField,
  from:      squareField,
  to:        squareField,
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
  moveToken: z.string().min(1, 'moveToken is required'),
});

const resignSchema = z.object({
  gameId: uuidField,
});

const drawOfferSchema = z.object({
  gameId: uuidField,
});

const spectateSchema = z.object({
  gameId: uuidField,
});

const chatSchema = z.object({
  gameId:  uuidField,
  message: z.string().max(200),
});

const tabHiddenSchema = z.object({
  gameId:       uuidField,
  hiddenMs:     z.number().int().min(0).max(3_600_000),
  totalHiddenMs: z.number().int().min(0).max(3_600_000),
});

// C5: Zod schema for queue:join — was previously unvalidated raw destructuring
const ALLOWED_INITIALS  = [60, 120, 180, 300, 600, 900];  // 1, 2, 3, 5, 10, 15 min
const ALLOWED_INCREMENTS = [0, 1, 2, 3, 5, 10];
const queueJoinSchema = z.object({
  timeControl: z.object({
    initial:   z.number().int().refine(v => ALLOWED_INITIALS.includes(v),
      { message: `initial must be one of ${ALLOWED_INITIALS.join(',')}` }),
    increment: z.number().int().refine(v => ALLOWED_INCREMENTS.includes(v),
      { message: `increment must be one of ${ALLOWED_INCREMENTS.join(',')}` }),
  }),
  stakes: z.number().int().min(0).max(10_000_000).default(0),  // max 10M IDR
  color:  z.enum(['white', 'black', 'random']).optional(),
});

// ── Validation helper ─────────────────────────────────────────────────────────

/**
 * Validate `payload` against `schema`.
 * On success: returns the parsed (coerced + stripped) payload.
 * On failure: emits 'error:validation' to the socket and returns null.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {unknown}                  payload
 * @param {import('socket.io').Socket} socket
 * @param {string}                   eventName
 * @returns {object|null}
 */
function validateOrReject(schema, payload, socket, eventName) {
  // Guard against prototype pollution via __proto__ / constructor keys
  if (payload !== null && typeof payload === 'object') {
    // Guard against prototype pollution — check OWN properties only
    const keys = Object.keys(payload);
    if (keys.includes('__proto__') || keys.includes('constructor') || keys.includes('prototype')) {
      socket.emit('error:validation', {
        event: eventName,
        issues: [{ path: [], message: 'Prototype pollution attempt detected' }],
      });
      return null;
    }
  }

  try {
    return schema.parse(payload ?? {});
  } catch (err) {
    // Zod v4 uses .issues; v3 uses .errors — support both
    const issues = (err.issues || err.errors || []).map(i => ({
      path: i.path,
      message: i.message,
    }));
    socket.emit('error:validation', { event: eventName, issues });
    return null;
  }
}

module.exports = {
  schemas: {
    joinSchema,
    moveSchema,
    resignSchema,
    drawOfferSchema,
    spectateSchema,
    chatSchema,
    tabHiddenSchema,
    queueJoinSchema,
  },
  validateOrReject,
};
