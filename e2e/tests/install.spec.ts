/** What a browser needs to install the app and keep it offline (task P7-1). */
import { expect, test } from '../support/test.js';

interface Icon {
  src: string;
  sizes: string;
  purpose?: string;
}

/** The width and height in a PNG's header. */
const pngSize = (png: Buffer) => `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;

test('has an installable manifest with every icon', async ({ request }) => {
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
    icons: Icon[];
  };

  expect(manifest).toMatchObject({
    name: 'Apparel POS',
    short_name: 'Apparel POS',
    display: 'standalone',
    start_url: '/',
    scope: '/',
    theme_color: '#0f172a',
    background_color: '#ffffff',
  });
  const kinds = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose ?? 'any'}`);
  expect(kinds).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']));
  for (const icon of manifest.icons) {
    const response = await request.get(`/${icon.src}`);
    expect(response.headers()['content-type']).toBe('image/png');
    expect(pngSize(await response.body())).toBe(icon.sizes);
  }
});

test('has what an iPad needs to add it to the home screen', async ({ page, request }) => {
  await page.goto('/');
  const meta = (name: string) => page.locator(`meta[name="${name}"]`);

  await expect(meta('apple-mobile-web-app-capable')).toHaveAttribute('content', 'yes');
  await expect(meta('apple-mobile-web-app-title')).toHaveAttribute('content', 'Apparel POS');
  await expect(meta('apple-mobile-web-app-status-bar-style')).toHaveAttribute('content', 'default');
  await expect(meta('theme-color')).toHaveAttribute('content', '#0f172a');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);

  const icon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(pngSize(await (await request.get(icon ?? '')).body())).toBe('180x180');
});

test('precaches the app shell and nothing else', async ({ request }) => {
  const worker = await (await request.get('/sw.js')).text();
  const index = await (await request.get('/')).text();
  const assets = [...index.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((match) => match[1]);

  expect(assets.length).toBeGreaterThanOrEqual(2);
  for (const file of ['index.html', 'manifest.webmanifest', 'favicon.ico', ...assets]) {
    expect(worker).toContain(`url:"${file}"`);
  }
  // One route, for navigations: no response from the network is ever stored.
  expect(worker.match(/registerRoute\(/g)).toHaveLength(1);
  expect(worker).toContain('NavigationRoute');
  expect(worker).toContain('denylist:[/^\\/v1(\\/|\\?|$)/]');
  expect(worker).not.toMatch(/NetworkFirst|NetworkOnly|CacheFirst|StaleWhileRevalidate/);
});
