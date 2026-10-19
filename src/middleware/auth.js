const jwt = require("jsonwebtoken");
const config = require("../config");
const prisma = require("../config/database");

const USER_FIELDS = {
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
};

/**
 * Verify an access token and the session it belongs to.
 * Revoked sessions (logout, password change/reset) stop working immediately.
 * Throws jsonwebtoken errors for bad/expired tokens.
 * @returns {Promise<{ user, sessionId } | null>} null when the token or session isn't valid
 */
async function authenticateAccessToken(token) {
  const payload = jwt.verify(token, config.jwt.secret);
  // Refresh / email-verification tokens share the secret but must not authenticate requests
  if (payload.type !== "access" || !payload.sid) return null;

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    select: { userId: true, expiresAt: true, user: { select: USER_FIELDS } },
  });

  if (!session || session.userId !== payload.userId || session.expiresAt < new Date()) return null;
  if (session.user.deletedAt) return null;

  return { user: session.user, sessionId: payload.sid };
}

/**
 * Require authentication. Attaches req.user (full user record) and req.sessionId.
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const auth = await authenticateAccessToken(authHeader.split(" ")[1]);
    if (!auth) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    req.user = auth.user;
    req.sessionId = auth.sessionId;
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
 * Optional auth — attaches user if a valid token is present, continues without if not.
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const auth = await authenticateAccessToken(authHeader.split(" ")[1]);
      if (auth) {
        req.user = auth.user;
        req.sessionId = auth.sessionId;
      }
    }
  } catch {
    // Invalid token — continue without auth
  }
  next();
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
  authenticateAccessToken,
  requireAuth,
  optionalAuth,
  requirePro,
  requireEmailVerified,
  requireAgeVerified,
};
