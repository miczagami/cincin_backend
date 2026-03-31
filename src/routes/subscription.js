const express = require("express");
const router = express.Router();
const subscriptionService = require("../services/subscriptionService");
const { requireAuth, requireEmailVerified } = require("../middleware/auth");
const config = require("../config");

// ═══════════════════════════════════════════════════════════════
//  SUBSCRIPTION ROUTES — Phase 4
//  Timeline ref: Weeks 14–16
//  Spec ref: Sections 8.1, 8.2
//
//  GET    /api/subscription/status      — Current subscription status
//  POST   /api/subscription/checkout    — Create Stripe checkout session
//  POST   /api/subscription/portal      — Create billing portal session
//  POST   /api/subscription/cancel      — Cancel subscription (at period end)
//  POST   /api/subscription/reactivate  — Reactivate canceling subscription
//  GET    /api/subscription/trial       — Check trial eligibility
//  POST   /api/subscription/webhook     — Stripe webhook handler (no auth)
// ═══════════════════════════════════════════════════════════════

// GET /api/subscription/status
router.get("/status", requireAuth, async (req, res, next) => {
  try {
    const status = await subscriptionService.getSubscriptionStatus(req.user.id);
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// POST /api/subscription/checkout
// Requires email verification (Section 7.2)
router.post("/checkout", requireAuth, requireEmailVerified, async (req, res, next) => {
  try {
    const { plan, successUrl, cancelUrl } = req.body;
    const session = await subscriptionService.createCheckoutSession(req.user.id, {
      plan,
      successUrl,
      cancelUrl,
    });
    res.json(session);
  } catch (err) {
    next(err);
  }
});

// POST /api/subscription/portal
router.post("/portal", requireAuth, async (req, res, next) => {
  try {
    const { returnUrl } = req.body;
    const session = await subscriptionService.createBillingPortalSession(req.user.id, {
      returnUrl,
    });
    res.json(session);
  } catch (err) {
    next(err);
  }
});

// POST /api/subscription/cancel
router.post("/cancel", requireAuth, async (req, res, next) => {
  try {
    const result = await subscriptionService.cancelSubscription(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/subscription/reactivate
router.post("/reactivate", requireAuth, async (req, res, next) => {
  try {
    const result = await subscriptionService.reactivateSubscription(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/subscription/trial
router.get("/trial", requireAuth, async (req, res, next) => {
  try {
    const eligibility = await subscriptionService.checkTrialEligibility(req.user.id);
    res.json(eligibility);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/subscription/webhook
 * Stripe webhook handler.
 * No auth middleware — Stripe signs the payload.
 * Uses raw body for signature verification.
 */
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    if (!config.stripe.webhookSecret) {
      console.warn("[Subscription] Webhook secret not configured — processing without verification");
      try {
        const event = JSON.parse(req.body.toString());
        await subscriptionService.handleWebhookEvent(event);
        return res.json({ received: true });
      } catch (err) {
        console.error("[Subscription] Webhook error:", err.message);
        return res.status(400).json({ error: err.message });
      }
    }

    try {
      const Stripe = require("stripe");
      const stripe = new Stripe(config.stripe.secretKey);
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        config.stripe.webhookSecret
      );

      await subscriptionService.handleWebhookEvent(event);
      res.json({ received: true });
    } catch (err) {
      console.error("[Subscription] Webhook signature verification failed:", err.message);
      res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }
  }
);

module.exports = router;
