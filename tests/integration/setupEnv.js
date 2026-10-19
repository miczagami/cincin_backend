// Environment for the in-process API under test (runs before each suite's modules load)
process.env.NODE_ENV = "test";
process.env.AGE_VERIFY_PROVIDER = "mock";
process.env.CRON_ENABLED = "false";
process.env.RATE_LIMIT_MAX = "100000";
process.env.AUTH_RATE_LIMIT_MAX = "100000";
process.env.APP_URL = "http://app.test";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.SENDGRID_API_KEY;
delete process.env.GOOGLE_CLIENT_IDS;
delete process.env.APPLE_CLIENT_IDS;
delete process.env.REDIS_URL;
