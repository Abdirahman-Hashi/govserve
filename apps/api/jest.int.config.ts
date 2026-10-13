import type { Config } from 'jest';

// Integration tests: real Postgres and Redis via Testcontainers (test/testcontainers.ts).
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/int/**/*.int-spec.ts'],
  transform: { '^.+\\.ts$': '@swc/jest' },
  globalSetup: '<rootDir>/test/int/global-setup.ts',
  globalTeardown: '<rootDir>/test/int/global-teardown.ts',
  testTimeout: 120_000,
  // Testcontainers keeps a keep-alive socket to the Docker daemon open after containers stop;
  // --detectOpenHandles finds no app handles, so exit once the run completes.
  forceExit: true,
};

export default config;
