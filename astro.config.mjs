// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
// import VitePWA from '@vite-pwa/astro';

import { seoConfig } from './utils/seoConfig';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

// https://astro.build/config
export default defineConfig({
  site: seoConfig.baseURL,
  output: 'static',
  integrations: [
    svelte(),
    react(),
    sitemap(),
    // VitePWA disabled due to Vite 6 compatibility issue
  ],
  vite: {
    resolve: {
      alias: {
        '@': srcDir,
        '@stores': `${srcDir}/stores`,
        '@constants': `${srcDir}/constants`,
        '@lib': `${srcDir}/lib`,
        '@components': `${srcDir}/components`,
      },
    },
    worker: {
      format: 'es',
    },
  },
  devToolbar: {
    enabled: false,
  },
});
