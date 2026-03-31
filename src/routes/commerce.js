const express = require("express");
const router = express.Router();
const commerceService = require("../services/commerceService");
const { requireAuth, optionalAuth } = require("../middleware/auth");

// ═══════════════════════════════════════════════════════════════
//  COMMERCE ROUTES — Phase 4
//  Timeline ref: Weeks 15–17
//  Spec ref: Sections 8.3, 8.4
//
//  Buy Tab:
//    GET   /api/commerce/buy-tab           — Scanned bottles with affiliate links
//    GET   /api/commerce/bottles/:id/links — Affiliate links for a specific bottle
//    POST  /api/commerce/affiliate/click   — Track affiliate click
//
//  Discovery Feed:
//    GET   /api/commerce/feed              — Mixed sponsored + organic content
//    POST  /api/commerce/sponsored/:id/start — Track sponsored game start
// ═══════════════════════════════════════════════════════════════

// ── Buy Tab ──

// GET /api/commerce/buy-tab
router.get("/buy-tab", requireAuth, async (req, res, next) => {
  try {
    const { limit, offset } = req.query;
    const buyTab = await commerceService.getBuyTab(req.user.id, {
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0,
    });
    res.json(buyTab);
  } catch (err) {
    next(err);
  }
});

// GET /api/commerce/bottles/:id/links
router.get("/bottles/:id/links", optionalAuth, async (req, res, next) => {
  try {
    const links = await commerceService.getBottleAffiliateLinks(req.params.id);
    res.json({ links });
  } catch (err) {
    next(err);
  }
});

// POST /api/commerce/affiliate/click
router.post("/affiliate/click", optionalAuth, async (req, res, next) => {
  try {
    const { affiliateLinkId, source } = req.body;
    if (!affiliateLinkId) {
      return res.status(400).json({ error: "affiliateLinkId is required" });
    }
    const result = await commerceService.trackAffiliateClick(
      req.user?.id || null,
      affiliateLinkId,
      source || "buy_tab"
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── Discovery Feed ──

// GET /api/commerce/feed
router.get("/feed", requireAuth, async (req, res, next) => {
  try {
    const { limit, offset } = req.query;
    const feed = await commerceService.getDiscoveryFeed(req.user.id, {
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0,
    });
    res.json(feed);
  } catch (err) {
    next(err);
  }
});

// POST /api/commerce/sponsored/:id/start
router.post("/sponsored/:id/start", requireAuth, async (req, res, next) => {
  try {
    await commerceService.trackSponsoredGameStart(req.params.id);
    res.json({ tracked: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
