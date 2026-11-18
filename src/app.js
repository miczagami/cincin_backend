const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const config = require("./config");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

const app = express();

// ─── Security middleware ───
app.use(helmet());
app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
}));

// ─── Rate limiting ───
// Provider webhooks are signature-checked and must not be throttled by per-IP limits
const WEBHOOK_PATHS = ["/api/subscription/webhook", "/api/auth/age-verify/webhook"];
const isWebhook = (req) => WEBHOOK_PATHS.includes(req.originalUrl.split("?")[0]);

// Behind a proxy every request arrives from the proxy's address, so key on the
// client IP header it sets — otherwise all users would share one limit
const clientIp = (req) =>
  (config.clientIpHeader && req.get(config.clientIpHeader)?.split(",")[0].trim()) || req.ip;
const limitOptions = {
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
  validate: { xForwardedForHeader: !config.clientIpHeader },
  skip: isWebhook,
};

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
  ...limitOptions,
});
app.use("/api/", limiter);

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.rateLimit.authMax,
  message: { error: "Too many authentication attempts. Please try again later." },
  ...limitOptions,
});
app.use("/api/auth/", authLimiter);

// ─── Webhooks need the raw body — mount BEFORE json parsing ───
// (Stripe and the age-verification provider sign the exact bytes they send)
app.use(WEBHOOK_PATHS, express.raw({ type: "*/*" }));

// ─── Body parsing ───
app.use(express.json({ limit: "10mb" })); // 10mb for image uploads
app.use(express.urlencoded({ extended: true }));

// ─── Health check ───
app.get("/health", (req, res) => {
  const { isRedisConnected } = require("./config/redis");
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    redis: isRedisConnected() ? "connected" : "disconnected",
    phase: "4", // Phase 4: Profile & Monetisation
  });
});

// ─── API routes (Phase 1–3) ───
app.use("/api/auth", require("./routes/auth"));
app.use("/api/auth/age-verify", require("./routes/ageVerify"));
app.use("/api/users", require("./routes/users"));
app.use("/api/games", require("./routes/games"));
app.use("/api/scan", require("./routes/scan"));
app.use("/api/bottles", require("./routes/bottles"));
app.use("/api/clubs", require("./routes/cellarClubs"));

// ─── API routes (Phase 4 — Profile & Monetisation) ───
app.use("/api/palate", require("./routes/palateProfile"));         // Palate Profile dashboard
app.use("/api/subscription", require("./routes/subscription"));     // Stripe subscriptions
app.use("/api/commerce", require("./routes/commerce"));             // Buy tab + discovery feed
app.use("/api/notifications", require("./routes/notifications"));   // Notification centre + push

// ─── Error handling ───
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
