// API smoke tests against a real Postgres database — see tests/integration/README.md
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/integration/**/*.test.js"],
  globalSetup: "<rootDir>/tests/integration/globalSetup.js",
  setupFiles: ["<rootDir>/tests/integration/setupEnv.js"],
  testTimeout: 30000,
  maxWorkers: 1, // suites share one database
};
