import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react({ jsxRuntime: 'automatic' })],
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    // The pure shared libraries' tests run here too, so CI's frontend-tests job covers them.
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)', '../../lib/martial-core/test/**/*.test.ts'],
    exclude: ['node_modules/**', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
