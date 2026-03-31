const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
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
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});
app.use("/api/", limiter);

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many authentication attempts. Please try again later." },
});
app.use("/api/auth/", authLimiter);

// ─── Stripe webhook needs raw body — mount BEFORE json parsing ───
// (Section 8.2: Stripe verifies webhook signatures against the raw body)
app.use(
  "/api/subscription/webhook",
  express.raw({ type: "application/json" })
);

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
