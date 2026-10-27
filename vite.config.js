import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    watch: { ignored: ['**/references/**', '**/asset-research/**', '**/public/assets/characters/**', '**/public/assets/audio/**', '**/public/assets/game/**'] },
  },
});
