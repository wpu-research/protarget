module.exports = {
  rootDir: '..',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.integration-spec.ts'],
  setupFiles: ['<rootDir>/test/setup-env.cjs'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/test/tsconfig.json' }],
  },
  maxWorkers: 1,
  testTimeout: 30000,
  clearMocks: true,
};
