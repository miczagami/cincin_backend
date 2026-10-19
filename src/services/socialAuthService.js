const { createRemoteJWKSet, jwtVerify } = require("jose");
const { normalizeEmail } = require("validator");
const config = require("../config");
const { AppError } = require("../utils/helpers");

// ═══════════════════════════════════════════════════════════════
//  SOCIAL ID TOKEN VERIFICATION (Section 7.1)
//
//  The client sends the ID token it received from Google / Apple.
//  Identity (provider user ID + email) is taken ONLY from the verified
//  token — never from the request body.
// ═══════════════════════════════════════════════════════════════

const PROVIDERS = {
  GOOGLE: {
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    audiences: () => config.social.googleClientIds,
    jwks: null,
  },
  APPLE: {
    jwksUrl: "https://appleid.apple.com/auth/keys",
    issuers: ["https://appleid.apple.com"],
    audiences: () => config.social.appleClientIds,
    jwks: null,
  },
};

/**
 * Verify a provider ID token and return the identity it asserts.
 * @returns {Promise<{ providerUserId: string, email: string|null, emailVerified: boolean, name: string|null }>}
 */
async function verifyIdToken(provider, idToken) {
  const p = PROVIDERS[provider];
  if (!p) throw new AppError("Unsupported social login provider", 400);

  const audience = p.audiences();
  if (!audience.length) {
    throw new AppError(`${provider} sign-in is not configured`, 503);
  }

  p.jwks = p.jwks || createRemoteJWKSet(new URL(p.jwksUrl));

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, p.jwks, { issuer: p.issuers, audience }));
  } catch (err) {
    throw new AppError("Invalid social login token", 401);
  }

  if (!payload.sub) throw new AppError("Invalid social login token", 401);

  // Apple sends email_verified as a string ("true"); Google as a boolean
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";

  return {
    providerUserId: payload.sub,
    // Same normalisation as email signup (express-validator normalizeEmail) so accounts match
    email: typeof payload.email === "string" ? normalizeEmail(payload.email) || null : null,
    emailVerified,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}

module.exports = { verifyIdToken, PROVIDERS };
