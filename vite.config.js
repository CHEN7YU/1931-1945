import { defineConfig } from 'vite';
import { readBuildStamp } from './scripts/build-stamp.mjs';

export default defineConfig({
  build: {
    rollupOptions: {
      input: { game: 'index.html', 'town-preview': 'town-preview.html' },
    },
  },
  define: {
    __BUILD_STAMP__: JSON.stringify(readBuildStamp()),
  },
  server: {
    watch: { ignored: ['**/references/**', '**/asset-research/**', '**/public/assets/characters/**', '**/public/assets/audio/**', '**/public/assets/game/**'] },
  },
});
