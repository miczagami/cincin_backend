/**
 * With no environment variables set, the API's emails and links use playcincin.com,
 * the only domain (getcincin.com is retired).
 */
jest.mock("dotenv", () => ({ config: jest.fn() })); // a local .env must not leak into the defaults
// One send mock for every module registry: the service loads SendGrid lazily, outside isolateModules
const mockSend = jest.fn(async () => [{ statusCode: 202 }]);
jest.mock("@sendgrid/mail", () => ({ setApiKey: jest.fn(), send: mockSend }));

const UNSET = ["APP_URL", "EMAIL_FROM_ADDRESS", "EMAIL_FROM_NAME", "APNS_BUNDLE_ID"];

/** Load the notification service against config built with none of the domain settings set. */
function loadWithDefaults() {
  const saved = Object.fromEntries(UNSET.map((name) => [name, process.env[name]]));
  UNSET.forEach((name) => delete process.env[name]);
  let loaded;
  jest.isolateModules(() => {
    const config = require("../src/config");
    config.email.sendgridApiKey = "SG.test"; // send through the (mocked) SendGrid client
    loaded = { notificationService: require("../src/services/notificationService") };
  });
  for (const [name, value] of Object.entries(saved)) if (value !== undefined) process.env[name] = value;
  return loaded;
}

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("emails come from a playcincin.com address by default", async () => {
  const { notificationService } = loadWithDefaults();

  await notificationService.sendAccountEmail("taster@example.com", {
    userId: "u1", type: "password_reset", subject: "Reset", heading: "Reset", body: "Tap below.",
    actionUrl: "https://app.playcincin.com/auth/forgot-password?token=abc", actionLabel: "Reset password",
  });

  expect(mockSend.mock.calls.at(-1)[0].from).toEqual({ email: "noreply@playcincin.com", name: "CinCin" });
});

test("a notification's tap link opens the app on playcincin.com by default", () => {
  const { notificationService } = loadWithDefaults();

  expect(notificationService.buildDeepLink(null)).toBe("https://app.playcincin.com/");
});

test("an email's links open the app on playcincin.com by default", () => {
  const { notificationService } = loadWithDefaults();

  const html = notificationService.buildEmailHtml("payment_failed", { title: "Payment failed", body: "Update your card.", data: {} });

  expect(html).toContain('href="https://app.playcincin.com/settings"');
});

test("iOS pushes go to the playcincin.com app by default", () => {
  let config;
  const saved = process.env.APNS_BUNDLE_ID;
  delete process.env.APNS_BUNDLE_ID;
  jest.isolateModules(() => { config = require("../src/config"); });
  if (saved !== undefined) process.env.APNS_BUNDLE_ID = saved;

  expect(config.push.apnsBundleId).toBe("com.playcincin.app");
});
