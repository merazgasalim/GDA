import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    entry: 'src/main/index.ts',
    build: {
      rollupOptions: {
        // Keep native modules and runtime-generated clients external so they resolve at runtime
        external: [
          'electron',
          'better-sqlite3',
          '@prisma/client',
          /^@prisma\/.*/,
        ],
      },
    },
  },
  preload: {
    entry: 'src/main/preload.ts',
    build: {
      rollupOptions: {
        input: 'src/main/preload.ts',
      },
    },
  },
  renderer: {
    // Use project root where `index.html` lives
    root: '.',
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: 'index.html',
      },
    },
  },
});
