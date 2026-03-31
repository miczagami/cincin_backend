const express = require("express");
const router = express.Router();
const notificationService = require("../services/notificationService");
const { requireAuth } = require("../middleware/auth");

// ═══════════════════════════════════════════════════════════════
//  NOTIFICATION ROUTES — Phase 4
//  Timeline ref: Weeks 16–17
//  Spec ref: Sections 10.1–10.3
//
//  Notification Centre:
//    GET   /api/notifications           — Get notifications (paginated)
//    PATCH /api/notifications/:id/read  — Mark single notification read
//    POST  /api/notifications/read-all  — Mark all notifications read
//
//  Push Tokens:
//    POST   /api/notifications/push-token     — Register device token
//    DELETE /api/notifications/push-token      — Remove device token
// ═══════════════════════════════════════════════════════════════

// GET /api/notifications
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { limit, offset, unreadOnly } = req.query;
    const result = await notificationService.getNotifications(req.user.id, {
      limit: parseInt(limit) || 30,
      offset: parseInt(offset) || 0,
      unreadOnly: unreadOnly === "true",
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/notifications/:id/read
router.patch("/:id/read", requireAuth, async (req, res, next) => {
  try {
    const result = await notificationService.markAsRead(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/read-all
router.post("/read-all", requireAuth, async (req, res, next) => {
  try {
    const result = await notificationService.markAllAsRead(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/push-token
router.post("/push-token", requireAuth, async (req, res, next) => {
  try {
    const { token, platform } = req.body;
    const result = await notificationService.registerPushToken(req.user.id, {
      token,
      platform,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/notifications/push-token
router.delete("/push-token", requireAuth, async (req, res, next) => {
  try {
    const { token } = req.body;
    const result = await notificationService.removePushToken(req.user.id, token);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
