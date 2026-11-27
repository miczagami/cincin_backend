/**
 * A notification's push and email link to the screen for its type. Callers pass the type
 * beside the data, as `createNotification(userId, { type, title, body, data })` (e.g. a
 * season ending sends data { clubId, seasonId }), so the links must not rely on the data
 * repeating it.
 */
const mockFcmSend = jest.fn(async () => "projects/test/messages/1");
jest.mock("firebase-admin", () => ({
  apps: [],
  credential: { cert: jest.fn(() => ({})) },
  initializeApp: jest.fn(),
  messaging: () => ({ send: mockFcmSend }),
}));
const mockEmailSend = jest.fn(async () => [{ statusCode: 202 }]);
jest.mock("@sendgrid/mail", () => ({ setApiKey: jest.fn(), send: mockEmailSend }));
jest.mock("../src/config/database", () => ({
  user: { findUnique: jest.fn(async () => ({ id: "u1", email: "taster@example.com", notifPush: true, notifEmail: true, notifSeasonReminders: true })) },
  notification: { create: jest.fn(async () => ({ id: "n1" })), update: jest.fn(async () => ({})) },
  pushToken: { findMany: jest.fn(async () => [{ id: "t1", token: "web-token-0123456789abcdef", platform: "web" }]) },
}));

const config = require("../src/config");
const notificationService = require("../src/services/notificationService");

const APP = config.appUrl;
const originalEnv = config.env;

beforeEach(() => {
  config.env = "production";
  config.email.sendgridApiKey = "SG.test";
  config.push.fcmServiceAccount = JSON.stringify({ project_id: "cincin-test" });
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  config.env = originalEnv;
  jest.restoreAllMocks();
});

const SEASON_ENDED = {
  type: "season_ended",
  title: "Season 1 has ended!",
  body: "Sam wins with 120 pts",
  data: { clubId: "club-1", seasonId: "s-1" }, // as cellarClubService.endSeason sends it
};

test("a season-ended push links to that season's results and carries its type", async () => {
  await notificationService.createNotification("u1", SEASON_ENDED);

  const message = mockFcmSend.mock.calls.at(-1)[0];
  expect(message.webpush.fcmOptions.link).toBe(`${APP}/clubs/club-1/season-end/s-1`);
  // The app's service worker routes action taps and data-only pushes by this
  expect(message.data.type).toBe("season_ended");
});

test("a season-ended email links to that season's results", async () => {
  await notificationService.createNotification("u1", SEASON_ENDED);

  const email = mockEmailSend.mock.calls.at(-1)[0];
  expect(email.html).toContain(`${APP}/clubs/club-1/season-end/s-1`);
});
