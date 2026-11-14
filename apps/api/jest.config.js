/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.spec.ts"],
  setupFiles: ["reflect-metadata/Reflect"],
  testTimeout: 30_000,
};
