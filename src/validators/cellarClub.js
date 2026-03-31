/**
 * Phase 3: Cellar Club Validation Rules
 *
 * Input validation for all Cellar Club endpoints.
 */

const { body } = require("express-validator");
const { validationResult } = require("express-validator");

/**
 * Shared validation middleware.
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const err = new Error("Validation failed");
    err.type = "validation";
    err.errors = errors.array();
    return next(err);
  }
  next();
}

/**
 * Rules for creating a Cellar Club.
 */
const createClubRules = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Club name must be 2–50 characters"),
  body("memberCap")
    .optional()
    .isInt({ min: 2, max: 1000 })
    .withMessage("Member cap must be between 2 and 1000"),
  body("seasonType")
    .optional()
    .isIn(["FIXED_DATE", "FIXED_LENGTH", "ROLLING"])
    .withMessage("Season type must be FIXED_DATE, FIXED_LENGTH, or ROLLING"),
  body("seasonStartDate")
    .optional()
    .isISO8601()
    .withMessage("Season start date must be a valid date"),
  body("seasonEndDate")
    .optional()
    .isISO8601()
    .withMessage("Season end date must be a valid date"),
  body("seasonLengthDays")
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage("Season length must be 1–365 days"),
  body("seasonName")
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage("Season name must be 50 characters or less"),
];

/**
 * Rules for joining a club via invite code.
 */
const joinClubRules = [
  body("inviteCode")
    .trim()
    .isLength({ min: 6, max: 6 })
    .isAlphanumeric()
    .withMessage("Invite code must be a 6-character alphanumeric code"),
];

/**
 * Rules for starting a new season.
 */
const startSeasonRules = [
  body("name")
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage("Season name must be 50 characters or less"),
  body("seasonType")
    .optional()
    .isIn(["FIXED_DATE", "FIXED_LENGTH", "ROLLING"])
    .withMessage("Invalid season type"),
  body("startDate")
    .optional()
    .isISO8601()
    .withMessage("Start date must be a valid date"),
  body("endDate")
    .optional()
    .isISO8601()
    .withMessage("End date must be a valid date"),
  body("lengthDays")
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage("Season length must be 1–365 days"),
];

module.exports = {
  validate,
  createClubRules,
  joinClubRules,
  startSeasonRules,
};
