const crypto = require("crypto");
const prisma = require("../config/database");
const config = require("../config");
const { AppError } = require("../utils/helpers");

// ═══════════════════════════════════════════════════════════════
//  AGE VERIFICATION SERVICE
//  Timeline ref: Phase 1, Weeks 2–3
//  Spec ref: Section 7.3
//  Architecture ref: Age Verification external service
//
//  Modular design — swap providers without touching routes.
//  CinCin stores ONLY pass/fail + verified DOB. No ID images.
//
//  Security model:
//  - Webhooks are only a trigger. Results are fetched from the provider's
//    API with our credentials; the webhook body is never trusted.
//  - Results map to users via ageVerifyRef, stored when the check starts.
//  - The mock provider and manual verification are dev-only and require
//    AGE_VERIFY_PROVIDER=mock outside production.
// ═══════════════════════════════════════════════════════════════

// Legal drinking age by region (Section 7.3)
const DRINKING_AGE = {
  AU: 18,
  NZ: 18,
  GB: 18,
  UK: 18,
  US: 21,
  DEFAULT: 18,
};

const requiredAgeFor = (region) => DRINKING_AGE[(region || "").toUpperCase()] || DRINKING_AGE.DEFAULT;

/**
 * Initiate an age verification check.
 *
 * Flow (Onfido):
 * 1. Client calls this endpoint; we create an applicant and return an SDK token
 * 2. User completes document capture in the provider SDK
 * 3. Client calls POST /age-verify/submit; we create the check
 * 4. Provider sends a check.completed webhook; we fetch the result and update the user
 */
async function initiateVerification(userId, { region = "AU" } = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, ageVerified: true },
  });

  if (!user) throw new AppError("User not found", 404);
  if (user.ageVerified) {
    return { status: "already_verified", message: "Age already verified." };
  }

  const provider = getProvider();
  const requiredAge = requiredAgeFor(region);

  const session = await provider.createCheck({
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { ageVerifyRef: session.ref, ageVerifyRegion: region.toUpperCase() },
  });

  return {
    status: "pending",
    provider: provider.name,
    sdkToken: session.sdkToken,
    checkId: session.ref,
    requiredAge,
    region,
  };
}

/**
 * Called by the client once the user has finished the provider SDK flow.
 * Starts the provider-side check for the user's stored reference.
 */
async function submitVerification(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ageVerified: true, ageVerifyRef: true },
  });

  if (!user) throw new AppError("User not found", 404);
  if (user.ageVerified) return { status: "already_verified" };
  if (!user.ageVerifyRef) throw new AppError("Start verification first", 400);

  await getProvider().submitCheck(user.ageVerifyRef);
  return { status: "pending" };
}

/**
 * Process the verification webhook callback from the provider.
 * Called by POST /api/auth/age-verify/webhook with the raw request body.
 *
 * We do NOT store any ID document images (Section 7.3).
 */
async function processWebhook(rawBody, headers) {
  const provider = getProvider();

  // Verify webhook signature to prevent spoofing (defence in depth — the result is re-fetched below)
  if (!provider.verifyWebhookSignature(rawBody, headers)) {
    throw new AppError("Invalid webhook signature", 403);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AppError("Invalid webhook payload", 400);
  }

  const result = await provider.fetchResult(payload);
  if (!result) return { ignored: true }; // not a completion event

  const user = await prisma.user.findUnique({
    where: { ageVerifyRef: result.ref },
    select: { id: true, ageVerifyRegion: true },
  });
  if (!user) {
    console.warn(`[AgeVerify] Webhook for unknown reference ${result.ref} — ignored`);
    return { ignored: true };
  }

  let { passed, reason } = result;
  const requiredAge = requiredAgeFor(user.ageVerifyRegion);

  if (passed) {
    if (!result.dateOfBirth) {
      passed = false;
      reason = "Date of birth could not be confirmed";
    } else if (calculateAge(result.dateOfBirth) < requiredAge) {
      passed = false;
      reason = `Must be ${requiredAge}+ to use CinCin in ${user.ageVerifyRegion || "your region"}.`;
    }
  }

  if (passed) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        ageVerified: true,
        ageVerifiedAt: new Date(),
        dateOfBirth: result.dateOfBirth,
        ageVerifyRef: null,
      },
    });
  }

  return { userId: user.id, passed, reason: reason || null };
}

/**
 * Manual verification result handler (for development/testing).
 * Only available with AGE_VERIFY_PROVIDER=mock outside production.
 */
async function manualVerify(userId, { passed, dateOfBirth, region = "AU" } = {}) {
  if (!isMockMode()) {
    throw new AppError("Manual verification is only available with the mock provider in development", 403);
  }

  const requiredAge = requiredAgeFor(region);

  // Validate age if DOB provided
  if (dateOfBirth) {
    const dob = new Date(dateOfBirth);
    const age = calculateAge(dob);
    if (age < requiredAge) {
      return {
        passed: false,
        reason: `Must be ${requiredAge}+ to use CinCin in ${region}.`,
      };
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      ageVerified: passed,
      ageVerifiedAt: passed ? new Date() : null,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
    },
  });

  return { passed, userId };
}

/**
 * Check verification status for a user.
 */
async function getVerificationStatus(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ageVerified: true,
      ageVerifiedAt: true,
    },
  });

  if (!user) throw new AppError("User not found", 404);

  return {
    verified: user.ageVerified,
    verifiedAt: user.ageVerifiedAt,
  };
}

// ═══════════════════════════════════════════════════════════════
//  PROVIDER IMPLEMENTATIONS
//  Each provider implements: createCheck, submitCheck,
//  verifyWebhookSignature(rawBody, headers), fetchResult(payload).
//  Switch via AGE_VERIFY_PROVIDER env variable.
// ═══════════════════════════════════════════════════════════════

function isMockMode() {
  return config.ageVerifyProvider === "mock" && config.env !== "production";
}

function getProvider() {
  switch (config.ageVerifyProvider) {
    case "mock":
      if (config.env === "production") {
        throw new AppError("Mock age verification is disabled in production", 503);
      }
      return mockProvider;
    case "jumio":
      return jumioProvider;
    case "onfido":
    default:
      return onfidoProvider;
  }
}

/** Constant-time comparison that tolerates length mismatches (timingSafeEqual throws on them). */
function safeEqual(a, b) {
  const bufA = Buffer.from(a || "");
  const bufB = Buffer.from(b || "");
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// ─── Onfido Provider (API v3.6) ───

const onfidoProvider = {
  name: "onfido",

  baseUrl() {
    return process.env.AGE_VERIFY_API_BASE || "https://api.eu.onfido.com/v3.6";
  },

  async request(path, { method = "GET", body } = {}) {
    const apiKey = process.env.AGE_VERIFY_API_KEY;
    if (!apiKey) throw new AppError("Onfido API key not configured", 503);

    const res = await fetch(`${this.baseUrl()}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token=${apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new AppError(`Onfido ${method} ${path} failed: ${err}`, 502);
    }
    return res.json();
  },

  async createCheck({ userId, email, displayName }) {
    const applicant = await this.request("/applicants", {
      method: "POST",
      body: {
        first_name: displayName.split(" ")[0] || "User",
        last_name: displayName.split(" ").slice(1).join(" ") || userId.slice(-6),
        email,
      },
    });

    const tokenData = await this.request("/sdk_token", {
      method: "POST",
      body: { applicant_id: applicant.id, referrer: process.env.CORS_ORIGIN || "*" },
    });

    return { sdkToken: tokenData.token, ref: applicant.id };
  },

  async submitCheck(applicantId) {
    await this.request("/checks", {
      method: "POST",
      body: { applicant_id: applicantId, report_names: ["document"] },
    });
  },

  // Onfido signs the raw body with HMAC-SHA256 (hex) in the X-SHA2-Signature header
  verifyWebhookSignature(rawBody, headers) {
    const webhookSecret = process.env.AGE_VERIFY_WEBHOOK_SECRET;
    if (!webhookSecret) return false;

    const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    return safeEqual(headers["x-sha2-signature"], expected);
  },

  async fetchResult(payload) {
    const event = payload?.payload;
    if (event?.resource_type !== "check" || event?.action !== "check.completed" || !event?.object?.id) {
      return null;
    }

    const checkId = encodeURIComponent(event.object.id);
    const check = await this.request(`/checks/${checkId}`);
    const { reports = [] } = await this.request(`/reports?check_id=${checkId}`);
    const documentReport = reports.find((r) => r.name === "document");
    const dob = documentReport?.properties?.date_of_birth;

    return {
      ref: check.applicant_id,
      passed: check.result === "clear",
      dateOfBirth: dob ? new Date(dob) : null,
      reason: check.result === "consider" ? "Verification requires manual review" : null,
    };
  },
};

// ─── Jumio Provider ───
// Not usable yet: Jumio callbacks are not HMAC-signed, so results must be
// fetched from Jumio's retrieval API before this provider can be enabled.

const jumioProvider = {
  name: "jumio",

  async createCheck() {
    throw new AppError("Jumio age verification is not implemented yet", 501);
  },

  async submitCheck() {
    throw new AppError("Jumio age verification is not implemented yet", 501);
  },

  verifyWebhookSignature() {
    console.error("[AgeVerify] Jumio webhook rejected — Jumio integration is not implemented");
    return false;
  },

  async fetchResult() {
    return null;
  },
};

// ─── Mock Provider (Development/Testing only — see getProvider) ───

const mockProvider = {
  name: "mock",

  async createCheck({ userId }) {
    return {
      sdkToken: `mock_token_${userId}_${Date.now()}`,
      ref: `mock_${userId}_${Date.now()}`,
    };
  },

  async submitCheck() {},

  verifyWebhookSignature() {
    return true;
  },

  // Dev payload: { ref, passed?, dateOfBirth }
  async fetchResult(payload) {
    if (!payload?.ref) return null;
    return {
      ref: payload.ref,
      passed: payload.passed !== false,
      dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : null,
      reason: null,
    };
  },
};

// ─── Utility ───

function calculateAge(dob) {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

module.exports = {
  initiateVerification,
  submitVerification,
  processWebhook,
  manualVerify,
  getVerificationStatus,
  DRINKING_AGE,
};
