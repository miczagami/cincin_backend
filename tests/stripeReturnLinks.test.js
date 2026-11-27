/**
 * Stripe sends a paying player back to the app, never to a site the request names:
 * checkout and billing-portal return links are built on the server from APP_URL.
 */
const mockStripe = {
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })) } },
  billingPortal: { sessions: { create: jest.fn(async () => ({ url: "https://billing.stripe.test/p_1" })) } },
};
jest.mock("stripe", () => jest.fn(() => mockStripe));
jest.mock("../src/config/database", () => ({
  user: {
    findUnique: jest.fn(async () => ({
      id: "u1", email: "taster@example.com", emailVerified: true, stripeCustomerId: "cus_1", subscriptionTier: "FREE", trialEligible: false,
    })),
    update: jest.fn(async () => ({})),
  },
}));

const config = require("../src/config");
const subscriptionService = require("../src/services/subscriptionService");

const APP = config.appUrl;
const FOREIGN = { successUrl: "https://evil.example/phish", cancelUrl: "https://evil.example/cancel", returnUrl: "https://evil.example/portal" };
const saved = { ...config.stripe, env: config.env };

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(config.stripe, { secretKey: "sk_test_x", monthlyPriceId: "price_m", annualPriceId: "price_a" });
});
afterAll(() => {
  Object.assign(config.stripe, saved);
  config.env = saved.env;
});

test("checkout returns the player to the app's success and cancel screens, whatever the request names", async () => {
  await subscriptionService.createCheckoutSession("u1", { plan: "monthly", ...FOREIGN });

  const params = mockStripe.checkout.sessions.create.mock.calls[0][0];
  expect(params.success_url).toBe(`${APP}/subscription/success?session_id={CHECKOUT_SESSION_ID}`);
  expect(params.cancel_url).toBe(`${APP}/subscription/cancel`);
});

test("the billing portal returns the player to the app's settings, whatever the request names", async () => {
  await subscriptionService.createBillingPortalSession("u1", FOREIGN);

  expect(mockStripe.billingPortal.sessions.create.mock.calls[0][0].return_url).toBe(`${APP}/settings`);
});

test("without Stripe (development), the stand-in portal opens the app's settings", async () => {
  config.stripe.secretKey = undefined;
  config.env = "development";
  jest.spyOn(console, "warn").mockImplementation(() => {});

  await expect(subscriptionService.createBillingPortalSession("u1", FOREIGN)).resolves.toEqual({ url: `${APP}/settings` });
});
