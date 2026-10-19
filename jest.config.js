// Unit tests (no database). Integration tests: npm run test:integration
module.exports = {
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/tests/integration/"],
};
