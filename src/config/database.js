const { PrismaClient } = require("@prisma/client");

let prisma;

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  // Prevent multiple instances during hot reloading in dev
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      // Query logging only in development — it drowns out test output
      log: process.env.NODE_ENV === "test" ? ["warn", "error"] : ["query", "warn", "error"],
    });
  }
  prisma = global.__prisma;
}

module.exports = prisma;
