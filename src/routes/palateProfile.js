const express = require("express");
const router = express.Router();
const palateProfileService = require("../services/palateProfileService");
const { requireAuth, requirePro } = require("../middleware/auth");

// ═══════════════════════════════════════════════════════════════
//  PALATE PROFILE ROUTES — Phase 4
//  Timeline ref: Weeks 14–15
//  Spec ref: Sections 6.1–6.6
//
//  GET  /api/palate/profile       — Full dashboard (Pro only)
//  GET  /api/palate/progress      — Unlock progress (all users)
//  POST /api/palate/wrapped       — Generate Palate Wrapped card (Pro only)
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/palate/profile
 * Full Palate Profile dashboard.
 * Query params: ?view=all_time|recent
 */
router.get("/profile", requireAuth, async (req, res, next) => {
  try {
    const view = req.query.view || "all_time";
    const profile = await palateProfileService.getProfile(req.user.id, { view });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/palate/progress
 * Progress towards unlocking the Palate Profile.
 * Available to all users (conversion incentive).
 */
router.get("/progress", requireAuth, async (req, res, next) => {
  try {
    const progress = await palateProfileService.getProgress(req.user.id);
    res.json(progress);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/palate/wrapped
 * Generate a Palate Wrapped shareable card.
 * Body: { month?, year? } — defaults to current month.
 */
router.post("/wrapped", requireAuth, async (req, res, next) => {
  try {
    const { month, year } = req.body;
    const wrapped = await palateProfileService.generateWrappedCard(req.user.id, {
      month,
      year,
    });
    res.json(wrapped);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
