import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.js';

const DATABASE_URL = 'postgresql://pos:s3cret@127.0.0.1:5432/pos';

describe('parseEnv', () => {
  it('applies defaults for development', () => {
    expect(parseEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
      CORS_ORIGINS: ['http://localhost:5173', 'http://localhost:4173'],
      LOG_LEVEL: 'info',
      TRUST_PROXY_HOPS: 0,
      RATE_LIMIT_PER_MINUTE: 120,
      ENROL_RATE_LIMIT_PER_MINUTE: 10,
      DEMO_MODE: false,
    });
  });

  it('reads and converts every value', () => {
    expect(
      parseEnv({
        NODE_ENV: 'production',
        PORT: '8080',
        DATABASE_URL,
        CORS_ORIGINS: ' https://pos.example.com , http://localhost:5173,',
        LOG_LEVEL: 'warn',
        TRUST_PROXY_HOPS: '1',
        RATE_LIMIT_PER_MINUTE: '300',
        ENROL_RATE_LIMIT_PER_MINUTE: '5',
        DEMO_MODE: 'true',
        UNRELATED: 'ignored',
      }),
    ).toEqual({
      NODE_ENV: 'production',
      PORT: 8080,
      DATABASE_URL,
      CORS_ORIGINS: ['https://pos.example.com', 'http://localhost:5173'],
      LOG_LEVEL: 'warn',
      TRUST_PROXY_HOPS: 1,
      RATE_LIMIT_PER_MINUTE: 300,
      ENROL_RATE_LIMIT_PER_MINUTE: 5,
      DEMO_MODE: true,
    });
  });

  it.each(['false', ''])('keeps demo mode off for DEMO_MODE=%o', (DEMO_MODE) => {
    expect(parseEnv({ DATABASE_URL, DEMO_MODE }).DEMO_MODE).toBe(false);
  });

  it('treats an empty value as unset', () => {
    expect(parseEnv({ DATABASE_URL, PORT: '', CORS_ORIGINS: '' })).toMatchObject({ PORT: 3000 });
  });

  it.each([
    ['DATABASE_URL', {}],
    ['DATABASE_URL', { DATABASE_URL: 'mysql://pos:s3cret@localhost/pos' }],
    ['DATABASE_URL', { DATABASE_URL: 'not a url' }],
    ['PORT', { DATABASE_URL, PORT: 'abc' }],
    ['PORT', { DATABASE_URL, PORT: '70000' }],
    ['PORT', { DATABASE_URL, PORT: '-1' }],
    ['NODE_ENV', { DATABASE_URL, NODE_ENV: 'staging' }],
    ['LOG_LEVEL', { DATABASE_URL, LOG_LEVEL: 'loud' }],
    ['CORS_ORIGINS', { DATABASE_URL, CORS_ORIGINS: '*' }],
    ['CORS_ORIGINS', { DATABASE_URL, CORS_ORIGINS: 'https://pos.example.com/' }],
    ['CORS_ORIGINS', { DATABASE_URL, CORS_ORIGINS: 'pos.example.com' }],
    ['CORS_ORIGINS', { DATABASE_URL, CORS_ORIGINS: ' , ' }],
    ['CORS_ORIGINS', { DATABASE_URL, NODE_ENV: 'production' }],
    ['RATE_LIMIT_PER_MINUTE', { DATABASE_URL, RATE_LIMIT_PER_MINUTE: '0' }],
    ['ENROL_RATE_LIMIT_PER_MINUTE', { DATABASE_URL, ENROL_RATE_LIMIT_PER_MINUTE: '1.5' }],
    ['TRUST_PROXY_HOPS', { DATABASE_URL, TRUST_PROXY_HOPS: 'true' }],
    ['DEMO_MODE', { DATABASE_URL, DEMO_MODE: 'yes' }],
    ['DEMO_MODE', { DATABASE_URL, DEMO_MODE: '1' }],
  ])('names %s when it is invalid: %o', (name, source) => {
    expect(() => parseEnv(source)).toThrow(name);
  });

  it('never repeats a value in the error, which could be a secret', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://pos:s3cret@localhost/pos' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('s3cret') as string }),
    );
  });
});
