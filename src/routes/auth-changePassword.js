/**
 * Change Password Route — Priority 1 addition to auth.js routes
 *
 * Add this route to the existing src/routes/auth.js file,
 * before the module.exports line.
 *
 * Requires the changePassword function to be added to authService.js
 * and the changePasswordRules validator to be added to validators/auth.js.
 */

// ─── Add to src/routes/auth.js (before module.exports) ───

// POST /api/auth/change-password — authenticated password change
router.post("/change-password", requireAuth, changePasswordRules, validate, async (req, res, next) => {
  try {
    const currentToken = req.headers.authorization.split(" ")[1];
    const result = await authService.changePassword(
      req.user.id,
      {
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword,
      },
      currentToken
    );
    res.json(result);
  } catch (err) { next(err); }
});


// ─── Add to src/validators/auth.js ───

const changePasswordRules = [
  body("currentPassword").notEmpty().withMessage("Current password is required"),
  body("newPassword")
    .isLength({ min: 8 }).withMessage("New password must be at least 8 characters")
    .matches(/[a-zA-Z]/).withMessage("New password must contain at least one letter")
    .matches(/[0-9]/).withMessage("New password must contain at least one number"),
];

// Add changePasswordRules to the module.exports of validators/auth.js
