import { z } from 'zod';

const DEVELOPMENT_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];

function isOrigin(value: string): boolean {
  const url = URL.parse(value);
  return url !== null && /^https?:$/.test(url.protocol) && url.origin === value;
}

const originList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ''),
  )
  .pipe(
    z.array(z.string().refine(isOrigin, 'not an origin such as https://pos.example.com')).min(1),
  );

const wholeNumber = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: wholeNumber(0, 65_535).default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /** Comma-separated list of POS origins allowed to call the API (ARCH §11). */
    CORS_ORIGINS: originList.optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Number of reverse proxies in front of the API, so rate limits see the real client. */
    TRUST_PROXY_HOPS: wholeNumber(0, 10).default(0),
    RATE_LIMIT_PER_MINUTE: wholeNumber(1, 1_000_000).default(120),
    ENROL_RATE_LIMIT_PER_MINUTE: wholeNumber(1, 1_000_000).default(10),
    /** Lets the demo terminals' enrolment codes be used again and again (ARCH §11). */
    DEMO_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .transform((env, context) => {
    if (env.CORS_ORIGINS === undefined && env.NODE_ENV === 'production') {
      context.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'required in production',
      });
      return z.NEVER;
    }
    return { ...env, CORS_ORIGINS: env.CORS_ORIGINS ?? DEVELOPMENT_ORIGINS };
  });

export type Env = z.infer<typeof envSchema>;

/** The error lists variable names and rules, never values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const set = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(set);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
