/**
 * Phase 4: User Routes
 *
 * All user profile, notification preference, data privacy, and B2B consent endpoints.
 * Consolidated for Phase 4 — all endpoints use the single userService.js.
 */

const express = require("express");
const router = express.Router();
const userService = require("../services/userService");
const { requireAuth } = require("../middleware/auth");
const { validate, updateProfileRules } = require("../validators/auth");

// ═══════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════

// GET /api/users/me
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const profile = await userService.getProfile(req.user.id);
    res.json(profile);
  } catch (err) { next(err); }
});

// PATCH /api/users/me
router.patch("/me", requireAuth, updateProfileRules, validate, async (req, res, next) => {
  try {
    const updated = await userService.updateProfile(req.user.id, req.body);
    res.json(updated);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════
//  NOTIFICATION PREFERENCES
// ═══════════════════════════════════════════

// PATCH /api/users/me/notifications
router.patch("/me/notifications", requireAuth, async (req, res, next) => {
  try {
    const updated = await userService.updateNotificationPrefs(req.user.id, req.body);
    res.json(updated);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════
//  DATA EXPORT (Section 3.8 — GDPR/Privacy Act)
// ═══════════════════════════════════════════

// GET /api/users/me/export — JSON format
router.get("/me/export", requireAuth, async (req, res, next) => {
  try {
    const data = await userService.exportData(req.user.id);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/users/me/export/csv — Phase 4: CSV format
router.get("/me/export/csv", requireAuth, async (req, res, next) => {
  try {
    const data = await userService.exportDataCSV(req.user.id);
    res.json(data);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════
//  DATA PRIVACY (Section 3.8)
// ═══════════════════════════════════════════

// POST /api/users/me/anonymise — anonymise data
router.post("/me/anonymise", requireAuth, async (req, res, next) => {
  try {
    const result = await userService.anonymiseData(req.user.id);
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/users/me — delete account
router.delete("/me", requireAuth, async (req, res, next) => {
  try {
    const result = await userService.deleteAccount(req.user.id);
    res.json(result);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════
//  B2B DATA CONSENT (Phase 4 — Section 8.5)
// ═══════════════════════════════════════════

// PATCH /api/users/me/b2b-consent
router.patch("/me/b2b-consent", requireAuth, async (req, res, next) => {
  try {
    const result = await userService.updateB2BConsent(req.user.id, req.body.optIn === true);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
