const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const config = require("../config");
const prisma = require("../config/database");
const { AppError } = require("../utils/helpers");
const { verifyIdToken } = require("./socialAuthService");
const notificationService = require("./notificationService");

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

  const tokens = await startSession(user.id);

  // Don't fail signup if the email can't be sent — the user can resend from Settings
  await sendVerificationEmail(user).catch((err) =>
    console.error("[Auth] Verification email failed:", err.message)
  );

  return { user, ...tokens };
}

// ═══════════════════════════════════════════
//  EMAIL VERIFICATION (Section 7.2)
// ═══════════════════════════════════════════

const EMAIL_VERIFY_EXPIRY = "24h";

/**
 * Email a verification link. The token is a signed JWT bound to the user's
 * current email, so changing email invalidates outstanding links.
 */
async function sendVerificationEmail({ id, email }) {
  const token = jwt.sign({ userId: id, email, type: "email_verify" }, config.jwt.secret, {
    expiresIn: EMAIL_VERIFY_EXPIRY,
  });

  const sent = await notificationService.sendAccountEmail(email, {
    type: "email_verification",
    subject: "Verify your CinCin email",
    heading: "Confirm your email",
    body: "Tap the button below to verify your email address. The link expires in 24 hours.",
    actionUrl: `${config.appUrl}/auth/verify-email?token=${encodeURIComponent(token)}`,
    actionLabel: "Verify email",
  });
  if (!sent) throw new AppError("Could not send verification email. Please try again later.", 502);
}

/**
 * Resend the verification email for the signed-in user.
 */
async function resendVerificationEmail(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true },
  });
  if (!user) throw new AppError("User not found", 404);
  if (user.emailVerified) return { message: "Email already verified.", emailVerified: true };

  await sendVerificationEmail(user);
  return { message: "Verification email sent.", emailVerified: false };
}

/**
 * Verify an email address from a link token.
 */
async function verifyEmail(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch {
    throw new AppError("This verification link is invalid or has expired.", 400);
  }
  if (payload.type !== "email_verify") {
    throw new AppError("This verification link is invalid or has expired.", 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, emailVerified: true, deletedAt: true },
  });
  if (!user || user.deletedAt || user.email !== payload.email) {
    throw new AppError("This verification link is invalid or has expired.", 400);
  }

  if (!user.emailVerified) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });
  }

  return { message: "Email verified.", emailVerified: true };
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

  const tokens = await startSession(user.id);

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

  const tokens = await startSession(user.id);

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

  // Only a hash is stored, so a database leak doesn't expose usable reset links
  await prisma.passwordReset.create({
    data: { userId: user.id, token: hashToken(token), expiresAt },
  });

  const sent = await notificationService.sendAccountEmail(user.email, {
    type: "password_reset",
    subject: "Reset your CinCin password",
    heading: "Reset your password",
    body: "Someone asked to reset the password for this account. If it was you, tap the button below — the link expires in 1 hour. If not, you can ignore this email.",
    actionUrl: `${config.appUrl}/auth/forgot-password?token=${token}`,
    actionLabel: "Reset password",
  });
  if (!sent) console.error(`[Auth] Password reset email to user ${user.id} failed`);

  return { message: "If that email exists, a reset link has been sent." };
}

/**
 * Reset password using token.
 */
async function resetPassword({ token, newPassword }) {
  const reset = await prisma.passwordReset.findUnique({ where: { token: hashToken(token) } });

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
async function changePassword(userId, { currentPassword, newPassword }, currentSessionId) {
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
    // Sign out every other device; this one stays signed in
    prisma.session.deleteMany({
      where: { userId, id: { not: currentSessionId } },
    }),
  ]);

  return { message: "Password changed successfully." };
}

/**
 * Exchange a refresh token for a new token pair (rotation).
 * Each refresh token works once: presenting an already-used one means it was
 * copied, so the whole session is revoked.
 */
async function refreshToken(refreshTokenStr) {
  let payload;
  try {
    payload = jwt.verify(refreshTokenStr, config.jwt.secret);
  } catch {
    throw new AppError("Invalid refresh token", 401);
  }
  if (payload.type !== "refresh" || !payload.sid) {
    throw new AppError("Invalid refresh token", 401);
  }

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: { select: { id: true, deletedAt: true } } },
  });

  if (!session || session.userId !== payload.userId || session.expiresAt < new Date() || session.user.deletedAt) {
    throw new AppError("Session expired. Please log in again.", 401);
  }

  if (session.token !== hashToken(refreshTokenStr)) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    console.warn(`[Auth] Refresh token reuse for session ${session.id} — session revoked`);
    throw new AppError("Session expired. Please log in again.", 401);
  }

  const tokens = generateTokens(session.userId, session.id);
  await prisma.session.update({
    where: { id: session.id },
    data: { token: hashToken(tokens.refreshToken), expiresAt: refreshExpiry(tokens.refreshToken) },
  });

  return tokens;
}

/**
 * Logout — revoke this device's session (its access and refresh tokens stop working).
 */
async function logout(sessionId) {
  await prisma.session.deleteMany({ where: { id: sessionId } });
  return { message: "Logged out" };
}

// ─── Internal helpers ───

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Sign an access + refresh token pair bound to a session (sid).
 * jwtid keeps tokens issued in the same second distinct.
 */
function generateTokens(userId, sessionId) {
  const accessToken = jwt.sign(
    { userId, sid: sessionId, type: "access" },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn, jwtid: crypto.randomUUID() }
  );

  const refreshToken = jwt.sign(
    { userId, sid: sessionId, type: "refresh" },
    config.jwt.secret,
    { expiresIn: config.jwt.refreshExpiresIn, jwtid: crypto.randomUUID() }
  );

  return { accessToken, refreshToken };
}

const refreshExpiry = (refreshToken) => new Date(jwt.decode(refreshToken).exp * 1000);

/**
 * Start a session for a new sign-in. The session lives as long as its refresh
 * token; only a hash of the current refresh token is stored.
 */
async function startSession(userId) {
  // Housekeeping: drop this user's expired sessions
  await prisma.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });

  const sessionId = crypto.randomUUID();
  const tokens = generateTokens(userId, sessionId);
  await prisma.session.create({
    data: {
      id: sessionId,
      userId,
      token: hashToken(tokens.refreshToken),
      expiresAt: refreshExpiry(tokens.refreshToken),
    },
  });
  return tokens;
}

module.exports = {
  signUp,
  login,
  socialLogin,
  requestPasswordReset,
  resetPassword,
  changePassword,
  resendVerificationEmail,
  verifyEmail,
  refreshToken,
  logout,
};
