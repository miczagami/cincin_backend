const express = require("express");
const router = express.Router();
const { body, query } = require("express-validator");
const scanService = require("../services/scanService");
const { requireAuth, requireAgeVerified } = require("../middleware/auth");
const { validate } = require("../validators/auth");

// All scan routes require auth + age verification
router.use(requireAuth, requireAgeVerified);

// ─── Bottle Scanning (Section 2.1) ───

// POST /api/scan/label — camera label scan
router.post(
  "/label",
  [
    body("imageBase64").notEmpty().withMessage("Image data required"),
    body("mimeType")
      .optional()
      .isIn(["image/jpeg", "image/png", "image/webp"])
      .withMessage("Supported formats: jpeg, png, webp"),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await scanService.scanLabel(req.user.id, {
        imageBase64: req.body.imageBase64,
        mimeType: req.body.mimeType,
      });
      res.json(result);
    } catch (err) { next(err); }
  }
);

// POST /api/scan/barcode — barcode scan
router.post(
  "/barcode",
  [body("barcode").trim().notEmpty().withMessage("Barcode required")],
  validate,
  async (req, res, next) => {
    try {
      const result = await scanService.scanBarcode(req.user.id, {
        barcode: req.body.barcode,
      });
      res.json(result);
    } catch (err) { next(err); }
  }
);

// GET /api/scan/search — manual text search with autocomplete (Section 2.1.3)
router.get(
  "/search",
  [
    query("q").trim().isLength({ min: 2 }).withMessage("Query must be at least 2 characters"),
    query("category").optional().isIn(["WINE", "BEER", "SPIRITS", "OTHER"]),
    query("limit").optional().isInt({ min: 1, max: 20 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const results = await scanService.searchBottles(req.query.q, {
        limit: parseInt(req.query.limit) || 10,
        category: req.query.category || null,
      });
      res.json(results);
    } catch (err) { next(err); }
  }
);

// POST /api/scan/confirm/:bottleId — confirm bottle selection (Section 2.6)
router.post("/confirm/:bottleId", async (req, res, next) => {
  try {
    const result = await scanService.confirmBottle(req.user.id, req.params.bottleId);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Tasting Note Sourcing (Section 2.3) ───

// POST /api/scan/source-notes/:bottleId — trigger note sourcing for a bottle
// Admin/internal use — sources notes from producer, critic, and AI tiers
router.post("/source-notes/:bottleId", async (req, res, next) => {
  try {
    const result = await scanService.sourceTastingNotes(req.params.bottleId);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Flavour Taxonomy (Section 2.4) ───

// GET /api/scan/taxonomy — get full flavour taxonomy tree
router.get(
  "/taxonomy",
  [query("drinkType").optional().isIn(["WINE", "BEER", "SPIRITS", "OTHER"])],
  validate,
  async (req, res, next) => {
    try {
      const tree = await scanService.getFlavourTaxonomy(req.query.drinkType || null);
      res.json(tree);
    } catch (err) { next(err); }
  }
);

// GET /api/scan/taxonomy/search — search flavours for autocomplete
router.get(
  "/taxonomy/search",
  [
    query("q").trim().isLength({ min: 1 }).withMessage("Query required"),
    query("drinkType").optional().isIn(["WINE", "BEER", "SPIRITS", "OTHER"]),
    query("limit").optional().isInt({ min: 1, max: 20 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const results = await scanService.searchFlavours(req.query.q, {
        limit: parseInt(req.query.limit) || 10,
        drinkType: req.query.drinkType || null,
      });
      res.json(results);
    } catch (err) { next(err); }
  }
);

module.exports = router;
