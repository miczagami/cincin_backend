const { body, validationResult } = require("express-validator");

/**
 * Middleware that checks validation results and throws if errors exist.
 */
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

const signUpRules = [
  body("email")
    .isEmail().withMessage("Valid email required")
    .normalizeEmail(),
  body("password")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
    .matches(/[A-Za-z]/).withMessage("Password must contain at least one letter")
    .matches(/[0-9]/).withMessage("Password must contain at least one number"),
  body("displayName")
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage("Display name is required (max 50 chars)"),
];

const loginRules = [
  body("email")
    .isEmail().withMessage("Valid email required")
    .normalizeEmail(),
  body("password")
    .notEmpty().withMessage("Password required"),
];

const socialLoginRules = [
  body("provider")
    .isIn(["GOOGLE", "APPLE"]).withMessage("Provider must be GOOGLE or APPLE"),
  body("token")
    .notEmpty().withMessage("Provider token required"),
  body("displayName")
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 }),
];

const updateProfileRules = [
  body("displayName")
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage("Display name max 50 chars"),
  body("bio")
    .optional()
    .trim()
    .isLength({ max: 160 }).withMessage("Bio max 160 characters"),
  body("location")
    .optional()
    .trim()
    .isLength({ max: 100 }),
  body("drinkPreferences")
    .optional()
    .isArray()
    .custom(val => val.every(v => ["WINE", "BEER", "SPIRITS", "OTHER"].includes(v)))
    .withMessage("Invalid drink category"),
];

const passwordResetRequestRules = [
  body("email")
    .isEmail().withMessage("Valid email required")
    .normalizeEmail(),
];

const passwordResetRules = [
  body("token")
    .notEmpty().withMessage("Reset token required"),
  body("newPassword")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
    .matches(/[A-Za-z]/).withMessage("Password must contain at least one letter")
    .matches(/[0-9]/).withMessage("Password must contain at least one number"),
];

const changePasswordRules = [
  body("currentPassword")
    .notEmpty().withMessage("Current password is required"),
  body("newPassword")
    .isLength({ min: 8 }).withMessage("New password must be at least 8 characters")
    .matches(/[A-Za-z]/).withMessage("New password must contain at least one letter")
    .matches(/[0-9]/).withMessage("New password must contain at least one number"),
];

module.exports = {
  validate,
  signUpRules,
  loginRules,
  socialLoginRules,
  updateProfileRules,
  passwordResetRequestRules,
  passwordResetRules,
  changePasswordRules,
};
