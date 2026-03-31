const jwt = require("jsonwebtoken");
const config = require("../config");
const prisma = require("../config/database");

/**
 * Require authentication. Attaches req.user with full user record.
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(" ")[1];
    const payload = jwt.verify(token, config.jwt.secret);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        subscriptionTier: true,
        ageVerified: true,
        emailVerified: true,
        monthlyScansUsed: true,
        scanResetDate: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt) {
      return res.status(401).json({ error: "User not found or deleted" });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token" });
    }
    next(err);
  }
}

/**
 * Optional auth — attaches user if token present, continues without if not.
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split(" ")[1];
    const payload = jwt.verify(token, config.jwt.secret);

    req.user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, displayName: true, subscriptionTier: true },
    });

    next();
  } catch {
    // Invalid token — continue without auth
    next();
  }
}

/**
 * Require Pro subscription (Section 8.2).
 * Must be used after requireAuth.
 */
function requirePro(req, res, next) {
  if (req.user.subscriptionTier !== "PRO") {
    return res.status(403).json({
      error: "Pro subscription required",
      upgradeUrl: "/subscription",
    });
  }
  next();
}

/**
 * Require email verification (Section 7.2).
 * Needed for: Pro subscription, creating/joining Cellar Clubs.
 */
function requireEmailVerified(req, res, next) {
  if (!req.user.emailVerified) {
    return res.status(403).json({
      error: "Email verification required",
      message: "Please verify your email address to access this feature.",
    });
  }
  next();
}

/**
 * Require age verification (Section 7.3).
 */
function requireAgeVerified(req, res, next) {
  if (!req.user.ageVerified) {
    return res.status(403).json({
      error: "Age verification required",
      message: "You must verify your age before using CinCin.",
    });
  }
  next();
}

module.exports = {
  requireAuth,
  optionalAuth,
  requirePro,
  requireEmailVerified,
  requireAgeVerified,
};
