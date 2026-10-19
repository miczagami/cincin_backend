const express = require("express");
const router = express.Router();
const ageVerifyService = require("../services/ageVerifyService");
const { requireAuth } = require("../middleware/auth");

// POST /api/auth/age-verify/initiate — start verification
router.post("/initiate", requireAuth, async (req, res, next) => {
  try {
    const result = await ageVerifyService.initiateVerification(req.user.id, {
      region: req.body.region || "AU",
    });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/auth/age-verify/submit — user finished the provider SDK flow; start the check
router.post("/submit", requireAuth, async (req, res, next) => {
  try {
    const result = await ageVerifyService.submitVerification(req.user.id);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/auth/age-verify/webhook — provider callback (no auth — signature-checked)
// app.js mounts express.raw for this path so the signature covers the exact bytes sent
router.post("/webhook", async (req, res, next) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const result = await ageVerifyService.processWebhook(rawBody, req.headers);
    res.json({ received: true, ...result });
  } catch (err) { next(err); }
});

// GET /api/auth/age-verify/status — check verification status
router.get("/status", requireAuth, async (req, res, next) => {
  try {
    const status = await ageVerifyService.getVerificationStatus(req.user.id);
    res.json(status);
  } catch (err) { next(err); }
});

// POST /api/auth/age-verify/manual — dev-only manual verification
// Only available in non-production environments
router.post("/manual", requireAuth, async (req, res, next) => {
  try {
    const result = await ageVerifyService.manualVerify(req.user.id, {
      passed: req.body.passed !== false,
      dateOfBirth: req.body.dateOfBirth || null,
      region: req.body.region || "AU",
    });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
