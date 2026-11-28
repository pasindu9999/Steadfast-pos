/** `pnpm --filter pos icons` redraws the PNGs in `public/` from `icon.svg`. They are committed. */
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

import { THEME_COLOR } from './pwa.config.js';

/** Maskable and Apple icons must be opaque to the edges: the system cuts the shape itself. */
const opaque = { padding: 0.1, resizeOptions: { background: THEME_COLOR } };

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    transparent: { ...minimal2023Preset.transparent, padding: 0 },
    maskable: { ...minimal2023Preset.maskable, ...opaque },
    apple: { ...minimal2023Preset.apple, ...opaque },
  },
  images: ['public/icon.svg'],
});
