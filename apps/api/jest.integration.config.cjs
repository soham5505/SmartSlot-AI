module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.integration.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  testTimeout: 180000,
  maxWorkers: 1
};
