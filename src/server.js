/**
 * CinCin API — Server Entry Point
 *
 * Phase 4 update: Initialises cron scheduler for automated jobs
 * (expired season checks, engagement summaries, weekly digests).
 */

require("dotenv").config();
const http = require("http");
const app = require("./app");
const config = require("./config");
const { initSocketServer } = require("./config/socketServer");
const { initCronJobs } = require("./jobs/cronScheduler");

const PORT = config.port || 4000;

// Create HTTP server (Express handles REST, Socket.io handles WS)
const httpServer = http.createServer(app);

// Phase 3: Initialise WebSocket server
const io = initSocketServer(httpServer);

// Store io instance on app for access from routes if needed
app.set("io", io);

httpServer.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║  CinCin API — Phase 4                    ║
  ║  HTTP + WebSocket on port ${String(PORT).padEnd(14)}║
  ║  Environment: ${config.env.padEnd(26)}║
  ║  Stripe: ${(config.stripe.secretKey ? "configured" : "mock mode").padEnd(31)}║
  ║  Cron: ${(config.cron.enabled ? "enabled" : "disabled").padEnd(33)}║
  ╚═══════════════════════════════════════════╝
  `);

  // Phase 4: Start cron scheduler
  if (config.cron.enabled) {
    initCronJobs();
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[Server] SIGTERM received. Shutting down...");
  io.close(() => {
    console.log("[Server] Socket.io closed");
  });
  httpServer.close(() => {
    console.log("[Server] HTTP server closed");
    process.exit(0);
  });
});

module.exports = httpServer;
