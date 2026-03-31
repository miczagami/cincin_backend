const express = require("express");
const router = express.Router();
const authService = require("../services/authService");
const { requireAuth } = require("../middleware/auth");
const {
  validate, signUpRules, loginRules, socialLoginRules,
  passwordResetRequestRules, passwordResetRules,
} = require("../validators/auth");

// POST /api/auth/signup
router.post("/signup", signUpRules, validate, async (req, res, next) => {
  try {
    const result = await authService.signUp(req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post("/login", loginRules, validate, async (req, res, next) => {
  try {
    const result = await authService.login(req.body);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/auth/social
router.post("/social", socialLoginRules, validate, async (req, res, next) => {
  try {
    const result = await authService.socialLogin(req.body);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/auth/refresh
router.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: "Refresh token required" });
    const result = await authService.refreshToken(refreshToken);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/auth/password-reset/request
router.post("/password-reset/request", passwordResetRequestRules, validate, async (req, res, next) => {
  try {
    const result = await authService.requestPasswordReset(req.body.email);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/auth/password-reset
router.post("/password-reset", passwordResetRules, validate, async (req, res, next) => {
  try {
    const result = await authService.resetPassword(req.body);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/auth/logout
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const token = req.headers.authorization.split(" ")[1];
    const result = await authService.logout(token);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
