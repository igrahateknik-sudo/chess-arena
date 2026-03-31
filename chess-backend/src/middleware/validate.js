/**
 * Input validation middleware using Zod schemas.
 * Usage: router.post('/route', validate(schema), handler)
 *
 * Validates req.body against the given schema.
 * Returns 400 with field-level errors on failure.
 * Sanitizes output: strips unknown fields (Zod strict mode not used —
 * extra fields are simply dropped by schema.parse).
 */

const { z } = require('zod');

// ── Helper ─────────────────────────────────────────────────────────────────

/**
 * Express middleware factory.
 * @param {import('zod').ZodTypeAny} schema - Zod schema to validate req.body against
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Zod v4 uses .issues; v3 uses .errors — support both
      const issues = result.error.issues || result.error.errors || [];
      const errors = issues.map(e => ({
        field: Array.isArray(e.path) ? e.path.join('.') : String(e.path || ''),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    // Replace body with parsed (sanitized) data — strips unexpected fields
    req.body = result.data;
    next();
  };
}

// ── Schemas ────────────────────────────────────────────────────────────────

const schemas = {
  // Auth
  register: z.object({
    username: z
      .string({ required_error: 'Username is required' })
      .min(3, 'Username must be at least 3 characters')
      .max(30, 'Username must be at most 30 characters')
      .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
    email: z
      .string({ required_error: 'Email is required' })
      .email('Invalid email format')
      .max(254, 'Email too long'),
    password: z
      .string({ required_error: 'Password is required' })
      .min(8, 'Password minimal 8 karakter')
      .max(128, 'Password terlalu panjang')
      .regex(/[a-zA-Z]/, 'Password harus mengandung minimal 1 huruf')
      .regex(/[0-9]/, 'Password harus mengandung minimal 1 angka'),
  }),

  login: z.object({
    email: z.string().email('Invalid email format').optional(),
    username: z
      .string()
      .min(1, 'Username cannot be empty')
      .max(30)
      .regex(/^[a-zA-Z0-9_]+$/, 'Invalid username')
      .optional(),
    password: z
      .string({ required_error: 'Password is required' })
      .min(1, 'Password cannot be empty')
      .max(128, 'Password too long'),
  }).refine(d => d.email || d.username, {
    message: 'Email or username is required',
    path: ['email'],
  }),

  changePassword: z.object({
    currentPassword: z
      .string({ required_error: 'Current password is required' })
      .min(1, 'Current password cannot be empty'),
    newPassword: z
      .string({ required_error: 'New password is required' })
      .min(8, 'Password baru minimal 8 karakter')
      .max(128, 'Password terlalu panjang')
      .regex(/[a-zA-Z]/, 'Password harus mengandung minimal 1 huruf')
      .regex(/[0-9]/, 'Password harus mengandung minimal 1 angka'),
  }),

  updateProfile: z.object({
    country: z.string().max(100).optional(),
    avatar_url: z.string().url('Invalid avatar URL').max(500).optional(),
  }),

  forgotPassword: z.object({
    email: z
      .string({ required_error: 'Email is required' })
      .email('Invalid email format'),
  }),

  resetPassword: z.object({
    token: z
      .string({ required_error: 'Reset token is required' })
      .min(1, 'Token cannot be empty'),
    password: z
      .string({ required_error: 'New password is required' })
      .min(8, 'Password minimal 8 karakter')
      .max(128, 'Password terlalu panjang')
      .regex(/[a-zA-Z]/, 'Password harus mengandung minimal 1 huruf')
      .regex(/[0-9]/, 'Password harus mengandung minimal 1 angka'),
  }),

  verifyEmail: z.object({
    token: z
      .string({ required_error: 'Verification token is required' })
      .min(1, 'Token cannot be empty'),
  }),

  resendVerification: z.object({
    email: z
      .string({ required_error: 'Email is required' })
      .email('Format email tidak valid'),
  }),

  // Wallet
  deposit: z.object({
    amount: z
      .number({ required_error: 'Amount is required', invalid_type_error: 'Amount must be a number' })
      .int('Amount must be a whole number')
      .positive('Amount must be positive')
      .min(10_000, 'Minimum deposit is Rp 10,000')
      .max(100_000_000, 'Maximum deposit is Rp 100,000,000'),
  }),

  withdraw: z.object({
    amount: z
      .number({ required_error: 'Amount is required', invalid_type_error: 'Amount must be a number' })
      .int('Amount must be a whole number')
      .positive('Amount must be positive')
      .min(50_000, 'Minimum withdrawal is Rp 50,000')
      .max(50_000_000, 'Maximum withdrawal is Rp 50,000,000'),
    bankCode: z
      .string({ required_error: 'Bank code is required' })
      .min(2, 'Invalid bank code')
      .max(20, 'Invalid bank code')
      .regex(/^[A-Z0-9_]+$/, 'Invalid bank code format'),
    accountNumber: z
      .string({ required_error: 'Account number is required' })
      .min(6, 'Account number too short')
      .max(20, 'Account number too long')
      .regex(/^\d+$/, 'Account number must contain only digits'),
    accountName: z
      .string({ required_error: 'Account name is required' })
      .min(2, 'Account name too short')
      .max(100, 'Account name too long')
      .regex(/^[a-zA-Z\s.'-]+$/, 'Account name contains invalid characters'),
  }),

  // Tournament
  createTournament: z.object({
    name: z
      .string({ required_error: 'Tournament name is required' })
      .min(3, 'Name must be at least 3 characters')
      .max(100, 'Name too long'),
    description: z.string().max(1000, 'Description too long').optional(),
    format: z.enum(['swiss', 'round-robin', 'knockout'], {
      errorMap: () => ({ message: 'Format must be: swiss, round-robin, or knockout' }),
    }),
    time_control: z.object({
      initial: z.number().int().min(30).max(3600),
      increment: z.number().int().min(0).max(60),
    }),
    prize_pool: z.number().int().min(0).max(1_000_000_000).optional(),
    prize_distribution: z.record(z.number()).optional(),
    entry_fee: z.number().int().min(0).max(10_000_000).optional(),
    max_players: z.number().int().min(4).max(256).optional(),
    min_elo: z.number().int().min(100).max(3500).optional(),
    max_elo: z.number().int().min(100).max(3500).optional(),
    starts_at: z.string().datetime('Invalid date format'),
    ends_at: z.string().datetime('Invalid date format').optional(),
  }).refine(d => !d.min_elo || !d.max_elo || d.min_elo <= d.max_elo, {
    message: 'min_elo must be less than or equal to max_elo',
    path: ['min_elo'],
  }),

  // Appeal
  createAppeal: z.object({
    reason: z
      .string({ required_error: 'Reason is required' })
      .min(20, 'Reason must be at least 20 characters')
      .max(2000, 'Reason too long'),
    evidence: z.string().max(2000).optional(),
  }),
};

module.exports = { validate, schemas };
