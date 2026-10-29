import 'dotenv/config';
import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://postgres:postgres@localhost:5433/obe?schema=public'),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
    .default('development-only-secret-change-me-0123456789abcdef'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_SECURE: booleanFromString.default(false),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.string().default('info'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@uiit.edu.pk'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin123!'),
  SEED_TUTOR_PASSWORD: z.string().min(8).default('Tutor123!'),
  SEED_STUDENT_PASSWORD: z.string().min(8).default('Student123!'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Do not print secrets: only the names of invalid keys.
  console.error('Invalid environment configuration:', parsed.error.issues.map((i) => i.path.join('.')));
  process.exit(1);
}

export const env = parsed.data;

if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET.includes('development-only')) {
  throw new Error('Refusing to start in production with the development JWT secret.');
}
