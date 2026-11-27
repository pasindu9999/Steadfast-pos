const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The API base URL as typed at enrolment, without a trailing `/` or `/v1`. `null` if unusable.
 * HTTPS only (ARCH §11), except for an API on the same machine during development.
 */
export function normaliseApiUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
  if (!secure || url.username || url.password || url.search || url.hash) return null;

  const path = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}
