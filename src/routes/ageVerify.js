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

// POST /api/auth/age-verify/webhook — provider callback (no auth — webhook)
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res, next) => {
  try {
    const signature = req.headers["x-onfido-signature"]
      || req.headers["x-jumio-signature"]
      || req.headers["x-signature"]
      || "";

    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const result = await ageVerifyService.processWebhook(payload, signature);
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
