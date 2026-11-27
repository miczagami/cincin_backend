/**
 * CinCin — Application Configuration
 *
 * Phase 4 update: Added Stripe, email, push notification, and cron configuration.
 */

require("dotenv").config();

// Tokens signed with the dev fallback secret could be forged by anyone who has read this file
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production");
}

// AI runs on Anthropic only. A leftover provider setting from an older environment fails
// here rather than silently changing which AI runs (or turning it off).
for (const name of ["AI_VISION_PROVIDER", "AI_LLM_PROVIDER"]) {
  const value = process.env[name];
  if (value && value !== "anthropic") {
    throw new Error(`${name}=${value} is not supported: CinCin uses Anthropic only. Remove the variable or set it to "anthropic".`);
  }
}

module.exports = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT, 10) || 4000,
  // The app's public URL, used in emails, push links and Stripe returns. Local dev sets APP_URL (see .env.example).
  appUrl: process.env.APP_URL || "https://app.playcincin.com",
  corsOrigin: process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : 'http://localhost:3000',

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || "dev-secret-change-me",
    expiresIn: process.env.JWT_EXPIRES_IN || "1h",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },
  // Legacy flat access (backward compat with Phase 1–3 code)
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1h",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",

  // Request header holding the real client IP, set by the proxy in front of the API
  // (Sevalla/Cloudflare: cf-connecting-ip). Rate limits key on it. Only set it when every
  // request reaches the API through that proxy — otherwise clients can spoof it.
  clientIpHeader: process.env.CLIENT_IP_HEADER ? process.env.CLIENT_IP_HEADER.trim().toLowerCase() : null,

  // Per-IP request limits per 15 minutes (all /api routes, and /api/auth on top)
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 20,
  },

  // Social login — OAuth client IDs accepted as ID token audiences (comma-separated)
  social: {
    googleClientIds: (process.env.GOOGLE_CLIENT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
    appleClientIds: (process.env.APPLE_CLIENT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
  },

  // Database
  databaseUrl: process.env.DATABASE_URL,

  // Redis
  redisUrl: process.env.REDIS_URL || null,

  // AI (Anthropic only; see the provider check at the top)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,

  // Claude models per role (read by services/aiClient.js). Model IDs are config so a
  // retired model is an env change. `thinking: "off"` uses each model's own off switch.
  ai: {
    // "us" keeps inference in the US (1.1x price); unset = global routing
    inferenceGeo: process.env.AI_INFERENCE_GEO || null,
    roles: {
      vision: {
        model: process.env.AI_VISION_MODEL || "claude-sonnet-5-5",
        fallbackModel: process.env.AI_VISION_FALLBACK_MODEL || "claude-haiku-5-5",
        effort: "low",
        thinking: "off",
        maxTokens: 4096,
        timeoutMs: parseInt(process.env.AI_VISION_TIMEOUT_MS, 10) || 15000,
        maxRetries: 1,
      },
      guess: {
        model: process.env.AI_LLM_MODEL || "claude-haiku-5-5",
        fallbackModel: process.env.AI_LLM_FALLBACK_MODEL || "claude-sonnet-5-5",
        effort: "low",
        thinking: "off",
        maxTokens: 4096,
        // Players are waiting mid-round; the non-AI matcher is the last resort
        timeoutMs: parseInt(process.env.AI_GUESS_TIMEOUT_MS, 10) || 4000,
        maxRetries: 0,
      },
      synthesis: {
        model: process.env.AI_SYNTHESIS_MODEL || "claude-sonnet-5-5",
        fallbackModel: process.env.AI_SYNTHESIS_FALLBACK_MODEL || "claude-haiku-5-5",
        effort: "medium",
        thinking: "adaptive",
        maxTokens: 8192,
        timeoutMs: parseInt(process.env.AI_SYNTHESIS_TIMEOUT_MS, 10) || 60000,
        maxRetries: 2,
      },
    },
  },

  // Age Verification (read directly by services/ageVerifyService.js)
  ageVerifyProvider: process.env.AGE_VERIFY_PROVIDER || "onfido",
  ageVerifyApiKey: process.env.AGE_VERIFY_API_KEY,
  ageVerifyWebhookSecret: process.env.AGE_VERIFY_WEBHOOK_SECRET,

  // Free tier limits (Section 8.1)
  freeTier: {
    maxScansPerMonth: 5,
    monthlyScans: 5, // read by scanService / helpers
    maxCellarClubs: 1,
    roundTimerSecs: 60, // free users get the default game config
    maxRounds: 20,
  },

  // Scan settings
  scan: {
    noteCountRange: 2,
    noteCountFloor: 3,
    highConfidence: 0.8,
    mediumConfidence: 0.5,
  },

  // Game settings
  game: {
    lobbyTimeoutMs: 10 * 60 * 1000, // 10 minutes
    lobbyTimeoutMinutes: 10,
    gameCodeLength: 6, // join validator requires exactly 6 chars
    maxGuestPlayers: 20,
    offlineSyncMaxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    defaultTimerSecs: 60,
    defaultMaxRounds: 20,
  },

  // Phase 2: AI Guess Evaluation (model and timeout: ai.roles.guess)
  aiGuessEval: {
    minConfidence: 0.7,
  },

  // Phase 3: WebSocket configuration
  websocket: {
    reconnectWindowMs: 2 * 60 * 1000,
    pingInterval: 10000,
    pingTimeout: 5000,
    roundRevealDelayMs: 3000,
  },

  // Phase 3: Cellar Club settings
  cellarClub: {
    maxMemberCapDefault: 1000,
    seasonAutoEndCronInterval: "0 * * * *",
  },

  // ═══════════════════════════════════════════
  //  PHASE 4: Stripe Subscription (Section 8.2)
  // ═══════════════════════════════════════════
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || null,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || null,
    monthlyPriceId: process.env.STRIPE_MONTHLY_PRICE_ID || null,
    annualPriceId: process.env.STRIPE_ANNUAL_PRICE_ID || null,
    // AUD $12.99/month, annual option (discounted ~20%)
    monthlyPriceAud: 12.99,
    annualPriceAud: 9.99, // per month, billed annually ($119.88/year)
  },

  // ═══════════════════════════════════════════
  //  PHASE 4: Email Service (Sections 10.1, 10.4)
  // ═══════════════════════════════════════════
  email: {
    sendgridApiKey: process.env.SENDGRID_API_KEY || null,
    fromAddress: process.env.EMAIL_FROM_ADDRESS || "noreply@playcincin.com",
    fromName: process.env.EMAIL_FROM_NAME || "CinCin",
  },

  // ═══════════════════════════════════════════
  //  PHASE 4: Push Notifications (Section 10.1)
  // ═══════════════════════════════════════════
  push: {
    fcmServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT || null,
    apnsKeyPath: process.env.APNS_KEY_PATH || null,
    apnsKeyId: process.env.APNS_KEY_ID || null,
    apnsTeamId: process.env.APNS_TEAM_ID || null,
    apnsBundleId: process.env.APNS_BUNDLE_ID || "com.playcincin.app",
  },

  // ═══════════════════════════════════════════
  //  PHASE 4: Cron / Scheduled Jobs
  // ═══════════════════════════════════════════
  cron: {
    enabled: process.env.CRON_ENABLED !== "false", // default enabled
  },
};
