const prisma = require("../config/database");
const config = require("../config");
const { AppError } = require("../utils/helpers");

// ═══════════════════════════════════════════════════════════════
//  SUBSCRIPTION SERVICE — Phase 4 (Stripe Integration)
//  Timeline ref: Weeks 14–16
//  Spec ref: Sections 8.1, 8.2
//
//  Handles:
//    - Stripe checkout session creation (monthly + annual plans)
//    - Webhook processing for subscription lifecycle events
//    - 7-day trial trigger (after first game, once per account)
//    - Upgrade, downgrade, cancel flows
//    - Free tier enforcement + Pro feature gating
//    - Email verification gate for paid features (Section 7.2)
// ═══════════════════════════════════════════════════════════════

/**
 * Get Stripe SDK instance (lazy-loaded).
 * Returns null if STRIPE_SECRET_KEY is not configured.
 */
function getStripe() {
  if (!config.stripe.secretKey) {
    // Mock mode grants Pro without payment, so it must never run in production
    if (config.env === "production") {
      throw new AppError("Payments are not configured", 503);
    }
    console.warn("[Subscription] STRIPE_SECRET_KEY not set — running in mock mode");
    return null;
  }
  const Stripe = require("stripe");
  return new Stripe(config.stripe.secretKey, { apiVersion: "2024-12-18.acacia" });
}

/**
 * Get subscription status for a user.
 */
async function getSubscriptionStatus(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionTier: true,
      subscriptionId: true,
      subscriptionStatus: true,
      subscriptionPlan: true,
      subscriptionCurrentPeriodEnd: true,
      trialUsed: true,
      trialStartedAt: true,
      trialEndsAt: true,
      trialEligible: true,
      emailVerified: true,
    },
  });

  if (!user) throw new AppError("User not found", 404);

  return {
    tier: user.subscriptionTier,
    status: user.subscriptionStatus || "none",
    plan: user.subscriptionPlan,
    currentPeriodEnd: user.subscriptionCurrentPeriodEnd,
    trialUsed: user.trialUsed,
    trialEligible: user.trialEligible,
    trialEndsAt: user.trialEndsAt,
    isActive: user.subscriptionTier === "PRO",
    emailVerified: user.emailVerified,
  };
}

/**
 * Create a Stripe Checkout session for subscribing.
 * Requires email verification (Section 7.2).
 *
 * @param {string} userId
 * @param {object} options - { plan: 'monthly' | 'annual', successUrl, cancelUrl }
 */
async function createCheckoutSession(userId, { plan = "monthly", successUrl, cancelUrl }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      stripeCustomerId: true,
      subscriptionTier: true,
      trialEligible: true,
    },
  });

  if (!user) throw new AppError("User not found", 404);

  // Email verification gate (Section 7.2)
  if (!user.emailVerified) {
    throw new AppError(
      "Email verification required before subscribing. Please verify your email first.",
      403
    );
  }

  if (user.subscriptionTier === "PRO") {
    throw new AppError("Already subscribed to Pro.", 409);
  }

  const stripe = getStripe();

  // Mock mode for development
  if (!stripe) {
    return createMockCheckoutSession(userId, plan);
  }

  // Get or create Stripe customer
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customerId },
    });
  }

  // Select price ID based on plan
  const priceId =
    plan === "annual"
      ? config.stripe.annualPriceId
      : config.stripe.monthlyPriceId;

  if (!priceId) {
    throw new AppError("Stripe price not configured for this plan.", 500);
  }

  // Build checkout session params
  const sessionParams = {
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl || `${config.appUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || `${config.appUrl}/subscription/cancel`,
    metadata: { userId: user.id, plan },
  };

  // Apply trial if eligible (Section 8.2: 7-day trial after first game)
  if (user.trialEligible) {
    sessionParams.subscription_data = {
      trial_period_days: 7,
      metadata: { userId: user.id },
    };
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  return {
    sessionId: session.id,
    url: session.url,
    plan,
    trialApplied: user.trialEligible,
  };
}

/**
 * Create Stripe billing portal session for managing subscription.
 */
async function createBillingPortalSession(userId, { returnUrl }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });

  if (!user?.stripeCustomerId) {
    throw new AppError("No active subscription to manage.", 400);
  }

  const stripe = getStripe();
  if (!stripe) {
    return { url: `${config.appUrl}/subscription/mock-portal` };
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: returnUrl || `${config.appUrl}/settings`,
  });

  return { url: session.url };
}

/**
 * Cancel subscription (takes effect at period end, Section 8.2).
 */
async function cancelSubscription(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionId: true, stripeCustomerId: true },
  });

  if (!user?.subscriptionId) {
    throw new AppError("No active subscription to cancel.", 400);
  }

  const stripe = getStripe();
  if (!stripe) {
    return cancelMockSubscription(userId);
  }

  // Cancel at period end (not immediately)
  await stripe.subscriptions.update(user.subscriptionId, {
    cancel_at_period_end: true,
  });

  await prisma.user.update({
    where: { id: userId },
    data: { subscriptionStatus: "canceling" },
  });

  return { message: "Subscription will cancel at the end of the current billing period." };
}

/**
 * Reactivate a subscription that was set to cancel at period end.
 */
async function reactivateSubscription(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionId: true },
  });

  if (!user?.subscriptionId) {
    throw new AppError("No subscription to reactivate.", 400);
  }

  const stripe = getStripe();
  if (!stripe) {
    await prisma.user.update({
      where: { id: userId },
      data: { subscriptionStatus: "active" },
    });
    return { message: "Subscription reactivated." };
  }

  await stripe.subscriptions.update(user.subscriptionId, {
    cancel_at_period_end: false,
  });

  await prisma.user.update({
    where: { id: userId },
    data: { subscriptionStatus: "active" },
  });

  return { message: "Subscription reactivated." };
}

// ═══════════════════════════════════════════
//  STRIPE WEBHOOK HANDLERS
// ═══════════════════════════════════════════

/**
 * Process a Stripe webhook event.
 * Called from the webhook route after signature verification.
 */
async function handleWebhookEvent(event) {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(event.data.object);
    case "customer.subscription.created":
      return handleSubscriptionCreated(event.data.object);
    case "customer.subscription.updated":
      return handleSubscriptionUpdated(event.data.object);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(event.data.object);
    case "invoice.payment_failed":
      return handlePaymentFailed(event.data.object);
    default:
      console.log(`[Subscription] Unhandled webhook event: ${event.type}`);
  }
}

async function handleCheckoutCompleted(session) {
  const userId = session.metadata?.userId;
  if (!userId) return;

  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionId: session.subscription,
      subscriptionPlan: session.metadata.plan || "monthly",
    },
  });
}

async function handleSubscriptionCreated(subscription) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    // Look up by Stripe customer ID
    const user = await prisma.user.findFirst({
      where: { stripeCustomerId: subscription.customer },
    });
    if (!user) return;
    return activateSubscription(user.id, subscription);
  }
  return activateSubscription(userId, subscription);
}

async function handleSubscriptionUpdated(subscription) {
  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: subscription.customer },
  });
  if (!user) return;

  const status = subscription.status; // active, trialing, past_due, canceled

  await prisma.user.update({
    where: { id: user.id },
    data: {
      subscriptionTier: ["active", "trialing"].includes(status) ? "PRO" : "FREE",
      subscriptionStatus: status,
      subscriptionCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
    },
  });
}

async function handleSubscriptionDeleted(subscription) {
  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: subscription.customer },
  });
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      subscriptionTier: "FREE",
      subscriptionStatus: "canceled",
      subscriptionId: null,
    },
  });

  // Handle club membership reduction (Section 8.2: downgrade to 1 club)
  await handleDowngradeClubMemberships(user.id);
}

async function handlePaymentFailed(invoice) {
  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: invoice.customer },
  });
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: { subscriptionStatus: "past_due" },
  });

  // Notify user about payment failure
  const notificationService = require("./notificationService");
  await notificationService.createNotification(user.id, {
    type: "payment_failed",
    title: "Payment failed",
    body: "Your Pro subscription payment failed. Please update your payment method to keep your Pro features.",
    data: { action: "update_payment" },
  });
}

/**
 * Activate a subscription for a user.
 */
async function activateSubscription(userId, subscription) {
  const isTrial = subscription.status === "trialing";

  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionTier: "PRO",
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      subscriptionCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
      ...(isTrial
        ? {
            trialUsed: true,
            trialEligible: false,
            trialStartedAt: new Date(subscription.trial_start * 1000),
            trialEndsAt: new Date(subscription.trial_end * 1000),
          }
        : {}),
    },
  });
}

/**
 * When downgrading from Pro to Free, reduce club memberships to 1.
 * User is notified and must choose which club to keep (handled client-side).
 * For now, we keep the oldest membership and leave the rest.
 */
async function handleDowngradeClubMemberships(userId) {
  const memberships = await prisma.cellarMember.findMany({
    where: { userId, leftAt: null },
    orderBy: { joinedAt: "asc" },
  });

  if (memberships.length <= 1) return;

  // Keep the first (oldest) membership, mark others as left
  const toLeave = memberships.slice(1);
  for (const m of toLeave) {
    await prisma.cellarMember.update({
      where: { id: m.id },
      data: { leftAt: new Date() },
    });
  }

  // Notify user
  const notificationService = require("./notificationService");
  await notificationService.createNotification(userId, {
    type: "club_membership_reduced",
    title: "Club memberships updated",
    body: `Your free account is limited to 1 Cellar Club. You've been removed from ${toLeave.length} club(s). Upgrade to Pro for unlimited clubs.`,
    data: { clubsRemoved: toLeave.length },
  });
}

// ═══════════════════════════════════════════
//  TRIAL TRIGGER (Section 8.2)
// ═══════════════════════════════════════════

/**
 * Check if user is eligible for trial and trigger the offer.
 * Called after first game completion.
 * Returns trial eligibility info for the frontend to show the offer.
 */
async function checkTrialEligibility(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionTier: true,
      trialUsed: true,
      trialEligible: true,
    },
  });

  if (!user) return { eligible: false };

  if (user.subscriptionTier === "PRO") return { eligible: false, reason: "already_pro" };
  if (user.trialUsed) return { eligible: false, reason: "trial_used" };
  if (!user.trialEligible) return { eligible: false, reason: "not_eligible" };

  // Check if this is their first completed game
  const gamesPlayed = await prisma.gamePlayer.count({
    where: { userId, game: { status: "COMPLETED" } },
  });

  if (gamesPlayed === 1) {
    return {
      eligible: true,
      trialDays: 7,
      message: "Start your 7-day Pro trial — unlock Palate Profile, unlimited scans, and more!",
    };
  }

  // Still eligible but not first game — show if they haven't subscribed yet
  return {
    eligible: user.trialEligible,
    trialDays: 7,
  };
}

// ═══════════════════════════════════════════
//  MOCK MODE (for development without Stripe)
// ═══════════════════════════════════════════

async function createMockCheckoutSession(userId, plan) {
  // Simulate immediate subscription activation
  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionTier: "PRO",
      subscriptionId: `mock_sub_${Date.now()}`,
      subscriptionStatus: "active",
      subscriptionPlan: plan,
      subscriptionCurrentPeriodEnd: new Date(
        Date.now() + (plan === "annual" ? 365 : 30) * 24 * 60 * 60 * 1000
      ),
    },
  });

  return {
    sessionId: `mock_session_${Date.now()}`,
    url: `${config.appUrl}/subscription/success?mock=true`,
    plan,
    trialApplied: false,
    mock: true,
  };
}

async function cancelMockSubscription(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionTier: "FREE",
      subscriptionStatus: "canceled",
      subscriptionId: null,
    },
  });

  await handleDowngradeClubMemberships(userId);
  return { message: "Mock subscription canceled." };
}

module.exports = {
  getSubscriptionStatus,
  createCheckoutSession,
  createBillingPortalSession,
  cancelSubscription,
  reactivateSubscription,
  handleWebhookEvent,
  checkTrialEligibility,
};
