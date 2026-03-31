const { body, query } = require("express-validator");

// ═══════════════════════════════════════════════════════════════
//  PHASE 4 VALIDATORS — Subscription & Commerce
// ═══════════════════════════════════════════════════════════════

const checkoutRules = [
  body("plan")
    .optional()
    .isIn(["monthly", "annual"])
    .withMessage("Plan must be 'monthly' or 'annual'"),
  body("successUrl")
    .optional()
    .isURL()
    .withMessage("successUrl must be a valid URL"),
  body("cancelUrl")
    .optional()
    .isURL()
    .withMessage("cancelUrl must be a valid URL"),
];

const affiliateClickRules = [
  body("affiliateLinkId")
    .notEmpty()
    .withMessage("affiliateLinkId is required"),
  body("source")
    .optional()
    .isIn(["buy_tab", "scan_confirm", "game_results"])
    .withMessage("source must be buy_tab, scan_confirm, or game_results"),
];

const pushTokenRules = [
  body("token")
    .notEmpty()
    .withMessage("Push token is required"),
  body("platform")
    .optional()
    .isIn(["web", "ios", "android"])
    .withMessage("Platform must be web, ios, or android"),
];

const palateProfileRules = [
  query("view")
    .optional()
    .isIn(["all_time", "recent"])
    .withMessage("View must be 'all_time' or 'recent'"),
];

const wrappedCardRules = [
  body("month")
    .optional()
    .isInt({ min: 0, max: 11 })
    .withMessage("Month must be 0–11"),
  body("year")
    .optional()
    .isInt({ min: 2024, max: 2030 })
    .withMessage("Year must be between 2024 and 2030"),
];

module.exports = {
  checkoutRules,
  affiliateClickRules,
  pushTokenRules,
  palateProfileRules,
  wrappedCardRules,
};
