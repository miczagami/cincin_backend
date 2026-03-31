const { body, validationResult } = require("express-validator");

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

const createGameRules = [
  body("bottleId")
    .notEmpty().withMessage("Bottle ID required"),
  body("multiplayerType")
    .optional()
    .isIn(["PASS_THE_PHONE", "MULTI_DEVICE", "REMOTE"])
    .withMessage("Invalid multiplayer type"),
  body("mode")
    .optional()
    .isIn(["COMPETITIVE", "PARALLEL"])
    .withMessage("Mode must be COMPETITIVE or PARALLEL"),
  body("roundTimerSecs")
    .optional()
    .isInt({ min: 10, max: 300 })
    .withMessage("Timer must be 10–300 seconds"),
  body("maxRounds")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Max rounds must be 1–100"),
  body("optOutTiming")
    .optional()
    .isIn(["ANY_MOMENT", "START_OF_ROUND", "AFTER_RESULTS"])
    .withMessage("Invalid opt-out timing"),
  body("scoreboardVisible")
    .optional()
    .isBoolean(),
  body("cellarClubId")
    .optional()
    .isString(),
  // Phase 2: Guest player names for pass-the-phone
  body("guestPlayerNames")
    .optional()
    .isArray({ max: 20 })
    .withMessage("Maximum 20 guest players"),
  body("guestPlayerNames.*")
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("Player names must be 1–50 characters"),
];

const joinGameRules = [
  body("gameCode")
    .trim()
    .isLength({ min: 6, max: 6 })
    .withMessage("Game code must be exactly 6 characters")
    .isAlphanumeric()
    .withMessage("Game code must be alphanumeric"),
];

const submitGuessRules = [
  body("guessText")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Guess must be 1–200 characters"),
  // Phase 2: Guest player support
  body("isGuest")
    .optional()
    .isBoolean(),
  body("guestPlayerId")
    .optional()
    .isString(),
];

// Phase 2: Guest player management
const guestPlayerRules = [
  body("displayName")
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("Display name must be 1–50 characters"),
];

// Phase 2: Offline sync payload validation
const offlineSyncRules = [
  body("bottleId")
    .notEmpty().withMessage("Bottle ID required"),
  body("mode")
    .optional()
    .isIn(["COMPETITIVE", "PARALLEL"]),
  body("guestPlayerNames")
    .optional()
    .isArray(),
  body("rounds")
    .isArray({ min: 1 })
    .withMessage("At least one round of data required"),
  body("rounds.*.guesses")
    .isArray()
    .withMessage("Each round must have guesses"),
  body("rounds.*.guesses.*.guessText")
    .trim()
    .isLength({ min: 1, max: 200 }),
];

module.exports = {
  validate,
  createGameRules,
  joinGameRules,
  submitGuessRules,
  guestPlayerRules,
  offlineSyncRules,
};
