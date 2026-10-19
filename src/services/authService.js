const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const config = require("../config");
const prisma = require("../config/database");
const { AppError } = require("../utils/helpers");
const { verifyIdToken } = require("./socialAuthService");

const SALT_ROUNDS = 12;

/**
 * Register a new user with email + password (Section 7.1).
 */
async function signUp({ email, password, displayName }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError("Email already registered", 409);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName,
      authProvider: "EMAIL",
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      subscriptionTier: true,
      ageVerified: true,
      emailVerified: true,
    },
  });

  const tokens = generateTokens(user.id);
  await createSession(user.id, tokens.accessToken);

  return { user, ...tokens };
}

/**
 * Login with email + password.
 */
async function login({ email, password }) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      displayName: true,
      passwordHash: true,
      subscriptionTier: true,
      ageVerified: true,
      emailVerified: true,
      deletedAt: true,
    },
  });

  if (!user || user.deletedAt) {
    throw new AppError("Invalid email or password", 401);
  }

  if (!user.passwordHash) {
    throw new AppError(
      "This account uses social login. Please sign in with Google or Apple.",
      401
    );
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new AppError("Invalid email or password", 401);
  }

  const tokens = generateTokens(user.id);
  await createSession(user.id, tokens.accessToken);

  const { passwordHash, deletedAt, ...safeUser } = user;
  return { user: safeUser, ...tokens };
}

/**
 * Social login / registration (Google or Apple) — Section 7.1.
 * Identity comes only from the verified provider ID token.
 * Creates an account if none exists, logs in if it does.
 */
async function socialLogin({ provider, token, displayName }) {
  const identity = await verifyIdToken(provider, token);

  // 1. Returning social user
  let user = await prisma.user.findFirst({
    where: { authProvider: provider, socialProviderId: identity.providerUserId },
  });

  // 2. Existing account with the same email — only trust a provider-verified email
  if (!user && identity.email && identity.emailVerified) {
    user = await prisma.user.findUnique({ where: { email: identity.email } });
  }

  if (!user) {
    if (!identity.email || !identity.emailVerified) {
      throw new AppError("A verified email is required to create an account", 400);
    }
    user = await prisma.user.create({
      data: {
        email: identity.email,
        displayName: (displayName || identity.name || identity.email.split("@")[0]).slice(0, 50),
        authProvider: provider,
        socialProviderId: identity.providerUserId,
        emailVerified: true, // verified by the provider
        emailVerifiedAt: new Date(),
      },
    });
  } else if (user.deletedAt) {
    throw new AppError("This account has been deleted", 401);
  }

  const tokens = generateTokens(user.id);
  await createSession(user.id, tokens.accessToken);

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      subscriptionTier: user.subscriptionTier,
      ageVerified: user.ageVerified,
      emailVerified: user.emailVerified,
    },
    ...tokens,
  };
}

/**
 * Request a password reset — generates token, returns it.
 * In production, this would send an email instead of returning the token.
 */
async function requestPasswordReset(email) {
  const user = await prisma.user.findUnique({ where: { email } });

  // Always return success to prevent email enumeration
  if (!user || user.deletedAt) return { message: "If that email exists, a reset link has been sent." };

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.passwordReset.create({
    data: { userId: user.id, token, expiresAt },
  });

  // TODO: Send email with reset link
  return { message: "If that email exists, a reset link has been sent." };
}

/**
 * Reset password using token.
 */
async function resetPassword({ token, newPassword }) {
  const reset = await prisma.passwordReset.findUnique({ where: { token } });

  if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
    throw new AppError("Invalid or expired reset token", 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: reset.userId },
      data: { passwordHash },
    }),
    prisma.passwordReset.update({
      where: { id: reset.id },
      data: { usedAt: new Date() },
    }),
    // Invalidate all existing sessions
    prisma.session.deleteMany({ where: { userId: reset.userId } }),
  ]);

  return { message: "Password reset successfully. Please log in again." };
}

/**
 * Change password for an authenticated email/password user.
 * Invalidates all other sessions, keeping the current one.
 */
async function changePassword(userId, { currentPassword, newPassword }, currentToken) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, authProvider: true, deletedAt: true },
  });

  if (!user || user.deletedAt) {
    throw new AppError("User not found", 404);
  }

  // Social-only accounts have no password to change
  if (!user.passwordHash || user.authProvider !== "EMAIL") {
    throw new AppError("This account uses social login. Password change is not available.", 400);
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw new AppError("Current password is incorrect", 401);
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    }),
    prisma.session.deleteMany({
      where: { userId, token: { not: currentToken } },
    }),
  ]);

  return { message: "Password changed successfully." };
}

/**
 * Refresh access token.
 */
async function refreshToken(refreshTokenStr) {
  try {
    const payload = jwt.verify(refreshTokenStr, config.jwt.secret);
    if (payload.type !== "refresh") {
      throw new AppError("Invalid refresh token", 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, deletedAt: true },
    });

    if (!user || user.deletedAt) {
      throw new AppError("User not found", 401);
    }

    const tokens = generateTokens(user.id);
    await createSession(user.id, tokens.accessToken);

    return tokens;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("Invalid refresh token", 401);
  }
}

/**
 * Logout — remove session.
 */
async function logout(token) {
  await prisma.session.deleteMany({ where: { token } });
  return { message: "Logged out" };
}

// ─── Internal helpers ───

function generateTokens(userId) {
  const accessToken = jwt.sign(
    { userId, type: "access" },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  const refreshToken = jwt.sign(
    { userId, type: "refresh" },
    config.jwt.secret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );

  return { accessToken, refreshToken };
}

async function createSession(userId, token) {
  const decoded = jwt.decode(token);
  await prisma.session.create({
    data: {
      userId,
      token,
      expiresAt: new Date(decoded.exp * 1000),
    },
  });
}

module.exports = {
  signUp,
  login,
  socialLogin,
  requestPasswordReset,
  resetPassword,
  changePassword,
  refreshToken,
  logout,
};
