import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // VITE_* variables come from the repo-root .env (see .env.example).
  const env = loadEnv(mode, '../..', 'VITE_');
  const target = env['VITE_API_PROXY_TARGET'] ?? 'http://localhost:3000';
  return {
    envDir: '../..',
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': target, '/health': target, '/ready': target },
    },
    build: { target: 'es2022', sourcemap: true },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
