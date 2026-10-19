/**
 * Reset the test database (migrations + seed) once before the integration suites.
 * Refuses to run unless the database name ends in "_test", so it can't wipe a real database.
 */
const { execSync } = require("child_process");
require("dotenv").config();

module.exports = async () => {
  const url = process.env.DATABASE_URL;
  const dbName = url && new URL(url).pathname.replace(/^\//, "");
  if (!dbName || !dbName.endsWith("_test")) {
    throw new Error(
      `Integration tests reset the database. Set DATABASE_URL to a database whose name ends in "_test" (got "${dbName || "unset"}").`
    );
  }

  const run = (cmd) => execSync(cmd, { stdio: "inherit", env: process.env });
  run("npx prisma migrate reset --force --skip-generate --skip-seed");
  run("node prisma/seed.js");
};
