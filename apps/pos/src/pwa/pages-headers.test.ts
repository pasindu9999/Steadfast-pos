/** What Cloudflare Pages sends with the built app (ARCH §8.1). */
import { describe, expect, it } from 'vitest';

import headersFile from '../../public/_headers?raw';

/** `path → (header name → value)`, as written. */
function parseRules(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      rules.set(line.trim(), current);
      continue;
    }
    const colon = line.indexOf(':');
    current?.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return rules;
}

const rules = parseRules(headersFile);
const cacheControl = (path: string) => rules.get(path)?.get('cache-control');

const escape = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
/** Pages matches a rule's `*` against any run of characters. */
const matches = (rule: string, path: string) =>
  new RegExp(`^${rule.split('*').map(escape).join('.*')}$`).test(path);

describe('_headers', () => {
  it.each(['/', '/index.html', '/sw.js', '/manifest.webmanifest'])(
    'always revalidates %s, so an update is found',
    (path) => {
      expect(cacheControl(path)).toBe('no-cache');
    },
  );

  it.each(['/assets/*', '/workbox-*'])('keeps the hashed files %s for a year', (path) => {
    expect(cacheControl(path)).toBe('public, max-age=31536000, immutable');
  });

  // Pages joins the values of every rule that matches, so two would contradict each other.
  it.each([
    '/',
    '/index.html',
    '/sw.js',
    '/manifest.webmanifest',
    '/assets/index-Ab12.js',
    '/workbox-1a2b.js',
    '/receipt/0198',
  ])('sets Cache-Control for %s at most once', (path) => {
    const setting = [...rules].filter(
      ([rule, headers]) => headers.has('cache-control') && matches(rule, path),
    );

    expect(setting.length).toBeLessThanOrEqual(1);
  });

  it('sends security headers with everything', () => {
    expect(Object.fromEntries(rules.get('/*') ?? [])).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
    });
  });
});
