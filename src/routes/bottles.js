const express = require("express");
const router = express.Router();
const gameService = require("../services/gameService");
const { requireAuth, requireAgeVerified } = require("../middleware/auth");

router.use(requireAuth, requireAgeVerified);

// GET /api/bottles/:bottleId/cache — get bottle data optimised for offline caching (Phase 2)
// Returns tasting notes for client-side encrypted storage (Section 2.7)
router.get("/:bottleId/cache", async (req, res, next) => {
  try {
    const cacheData = await gameService.getBottleCacheData(req.params.bottleId, req.user.id);
    res.json(cacheData);
  } catch (err) { next(err); }
});

// GET /api/bottles/:bottleId — get bottle details (public info, no notes)
router.get("/:bottleId", async (req, res, next) => {
  try {
    const prisma = require("../config/database");
    const bottle = await prisma.bottle.findUnique({
      where: { id: req.params.bottleId },
      include: {
        affiliateLinks: true,
        tastingNotes: { select: { id: true } }, // count only
      },
    });

    if (!bottle) {
      return res.status(404).json({ error: "Bottle not found" });
    }

    const { getNoteCountRange } = require("../utils/helpers");
    const noteRange = getNoteCountRange(bottle.tastingNotes.length);

    res.json({
      id: bottle.id,
      name: bottle.name,
      vintage: bottle.vintage,
      region: bottle.region,
      subRegion: bottle.subRegion,
      country: bottle.country,
      producer: bottle.producer,
      category: bottle.category,
      subcategory: bottle.subcategory,
      varietal: bottle.varietal,
      imageUrl: bottle.imageUrl,
      description: bottle.description,
      noteRange,
      noteCount: bottle.tastingNotes.length,
      affiliateLinks: bottle.affiliateLinks,
    });
  } catch (err) { next(err); }
});

module.exports = router;
