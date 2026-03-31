const prisma = require("../config/database");
const { AppError } = require("../utils/helpers");

// ═══════════════════════════════════════════════════════════════
//  AGE VERIFICATION SERVICE
//  Timeline ref: Phase 1, Weeks 2–3
//  Spec ref: Section 7.3
//  Architecture ref: Age Verification external service
//
//  Modular design — swap Onfido/Jumio without touching routes.
//  CinCin stores ONLY pass/fail + verified DOB. No ID images.
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

/**
 * Initiate an age verification check.
 * Creates a check with the chosen provider and returns a verification
 * session token/URL for the client SDK to use.
 *
 * Flow:
 * 1. Client calls this endpoint to start verification
 * 2. Response contains an SDK token the client passes to the Onfido/Jumio
 *    SDK embedded in the frontend
 * 3. User completes ID scanning in the provider's SDK
 * 4. Provider sends a webhook to our callback endpoint
 * 5. We update the user's verification status
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
  const requiredAge = DRINKING_AGE[region.toUpperCase()] || DRINKING_AGE.DEFAULT;

  const session = await provider.createCheck({
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    requiredAge,
    region,
  });

  return {
    status: "pending",
    provider: provider.name,
    sdkToken: session.sdkToken,
    checkId: session.checkId,
    requiredAge,
    region,
  };
}

/**
 * Process the verification webhook callback from the provider.
 * Called by POST /api/auth/age-verify/webhook
 *
 * The provider sends the result once the user completes their check.
 * We extract pass/fail + DOB and update the user record.
 * We do NOT store any ID document images (Section 7.3).
 */
async function processWebhook(payload, providerSignature) {
  const provider = getProvider();

  // Verify webhook signature to prevent spoofing
  const isValid = provider.verifyWebhookSignature(payload, providerSignature);
  if (!isValid) throw new AppError("Invalid webhook signature", 403);

  const result = provider.parseWebhookResult(payload);

  if (!result.userId || result.passed === undefined) {
    throw new AppError("Invalid webhook payload", 400);
  }

  // Update user record — only store pass/fail and DOB
  if (result.passed) {
    await prisma.user.update({
      where: { id: result.userId },
      data: {
        ageVerified: true,
        ageVerifiedAt: new Date(),
        dateOfBirth: result.dateOfBirth || null,
      },
    });
  }

  return {
    userId: result.userId,
    passed: result.passed,
    reason: result.reason || null,
  };
}

/**
 * Manual verification result handler (for development/testing).
 * In production, results come exclusively through webhooks.
 */
async function manualVerify(userId, { passed, dateOfBirth, region = "AU" } = {}) {
  if (process.env.NODE_ENV === "production") {
    throw new AppError("Manual verification not available in production", 403);
  }

  const requiredAge = DRINKING_AGE[region.toUpperCase()] || DRINKING_AGE.DEFAULT;

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
//  Modular pattern — each provider implements the same interface.
//  Switch via AGE_VERIFY_PROVIDER env variable.
// ═══════════════════════════════════════════════════════════════

function getProvider() {
  const providerName = process.env.AGE_VERIFY_PROVIDER || "onfido";

  switch (providerName) {
    case "jumio":
      return jumioProvider;
    case "mock":
      return mockProvider;
    case "onfido":
    default:
      return onfidoProvider;
  }
}

// ─── Onfido Provider ───

const onfidoProvider = {
  name: "onfido",

  async createCheck({ userId, email, displayName, requiredAge, region }) {
    const apiKey = process.env.AGE_VERIFY_API_KEY;
    if (!apiKey) throw new AppError("Onfido API key not configured", 503);

    // Step 1: Create an applicant
    const applicantRes = await fetch("https://api.eu.onfido.com/v3.6/applicants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token=${apiKey}`,
      },
      body: JSON.stringify({
        first_name: displayName.split(" ")[0] || "User",
        last_name: displayName.split(" ").slice(1).join(" ") || userId.slice(-6),
        email,
      }),
    });

    if (!applicantRes.ok) {
      const err = await applicantRes.text();
      throw new AppError(`Onfido applicant creation failed: ${err}`, 502);
    }

    const applicant = await applicantRes.json();

    // Step 2: Generate an SDK token for the frontend
    const tokenRes = await fetch("https://api.eu.onfido.com/v3.6/sdk_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token=${apiKey}`,
      },
      body: JSON.stringify({
        applicant_id: applicant.id,
        referrer: process.env.CORS_ORIGIN || "*",
      }),
    });

    if (!tokenRes.ok) {
      throw new AppError("Onfido SDK token generation failed", 502);
    }

    const tokenData = await tokenRes.json();

    return {
      sdkToken: tokenData.token,
      checkId: applicant.id,
      metadata: { applicantId: applicant.id, requiredAge, region, userId },
    };
  },

  verifyWebhookSignature(payload, signature) {
    const webhookSecret = process.env.AGE_VERIFY_WEBHOOK_SECRET;
    if (!webhookSecret) return false;

    const crypto = require("crypto");
    const expected = crypto
      .createHmac("sha256", webhookSecret)
      .update(typeof payload === "string" ? payload : JSON.stringify(payload))
      .digest("hex");

    return crypto.timingSafeEqual(Buffer.from(signature || ""), Buffer.from(expected));
  },

  parseWebhookResult(payload) {
    // Onfido webhook structure
    const action = payload?.payload?.action;
    const checkResult = payload?.payload?.object;

    if (action !== "check.completed") {
      return { userId: null, passed: undefined };
    }

    // Extract from check metadata
    const userId = checkResult?.tags?.find(t => t.startsWith("user:"))?.replace("user:", "");
    const passed = checkResult?.result === "clear";
    const dateOfBirth = checkResult?.applicant?.date_of_birth || null;

    return {
      userId,
      passed,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      reason: checkResult?.result === "consider"
        ? "Verification requires manual review"
        : null,
    };
  },
};

// ─── Jumio Provider ───

const jumioProvider = {
  name: "jumio",

  async createCheck({ userId, email, displayName, requiredAge, region }) {
    const apiKey = process.env.AGE_VERIFY_API_KEY;
    const apiSecret = process.env.AGE_VERIFY_API_SECRET;
    if (!apiKey || !apiSecret) throw new AppError("Jumio credentials not configured", 503);

    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

    const response = await fetch("https://netverify.com/api/v4/initiate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
        "User-Agent": "CinCin/1.0",
      },
      body: JSON.stringify({
        customerInternalReference: userId,
        userReference: userId,
        callbackUrl: `${process.env.API_BASE_URL || "https://api.getcincin.com"}/api/auth/age-verify/webhook`,
        workflowId: 100, // ID verification
      }),
    });

    if (!response.ok) {
      throw new AppError("Jumio initiation failed", 502);
    }

    const data = await response.json();

    return {
      sdkToken: data.transactionReference,
      checkId: data.transactionReference,
      redirectUrl: data.redirectUrl,
      metadata: { requiredAge, region, userId },
    };
  },

  verifyWebhookSignature(payload, signature) {
    // Jumio uses a different signature mechanism
    const webhookSecret = process.env.AGE_VERIFY_WEBHOOK_SECRET;
    if (!webhookSecret) return false;

    const crypto = require("crypto");
    const expected = crypto
      .createHmac("sha256", webhookSecret)
      .update(typeof payload === "string" ? payload : JSON.stringify(payload))
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(signature || ""),
      Buffer.from(expected)
    );
  },

  parseWebhookResult(payload) {
    const userId = payload?.customerInternalReference;
    const status = payload?.verificationStatus;
    const passed = status === "APPROVED_VERIFIED";
    const dob = payload?.document?.dob;

    return {
      userId,
      passed,
      dateOfBirth: dob ? new Date(dob) : null,
      reason: status === "DENIED_FRAUD" ? "Verification denied" : null,
    };
  },
};

// ─── Mock Provider (Development/Testing) ───

const mockProvider = {
  name: "mock",

  async createCheck({ userId, requiredAge, region }) {
    return {
      sdkToken: `mock_token_${userId}_${Date.now()}`,
      checkId: `mock_check_${userId}`,
      metadata: { requiredAge, region, userId },
    };
  },

  verifyWebhookSignature() {
    return true; // always pass in mock
  },

  parseWebhookResult(payload) {
    return {
      userId: payload.userId,
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
  processWebhook,
  manualVerify,
  getVerificationStatus,
  DRINKING_AGE,
};
