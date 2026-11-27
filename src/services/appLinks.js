/**
 * Every app path the backend links to from a push notification, an email or an invite.
 *
 * The app's suite (cincin_frontend tests/e2e/links.spec.js) loads this file and opens
 * every path in it, so a link added here is checked against the app's real screens.
 * Keep it free of other requires for that reason: each entry takes one object of named
 * params ({ gameCode, inviteCode, clubId, seasonId, token }) and returns a path on the app.
 */
const enc = encodeURIComponent;

const appPaths = {
  home: () => "/",
  gameJoin: ({ gameCode }) => (gameCode ? `/game/join?code=${enc(gameCode)}` : "/game/join"),
  clubJoin: ({ inviteCode }) => `/clubs/join?code=${enc(inviteCode)}`,
  club: ({ clubId }) => (clubId ? `/clubs/${enc(clubId)}` : "/clubs"),
  // An ended season's final standings and awards (without a season, the club itself)
  seasonResults: ({ clubId, seasonId }) =>
    clubId && seasonId ? `/clubs/${enc(clubId)}/season-end/${enc(seasonId)}` : appPaths.club({ clubId }),
  palateProfile: () => "/palate/profile",
  palateWrapped: () => "/palate/wrapped",
  subscription: () => "/subscription",
  // Where Stripe returns a player; {CHECKOUT_SESSION_ID} is Stripe's own placeholder, left as is
  subscriptionSuccess: () => "/subscription/success?session_id={CHECKOUT_SESSION_ID}",
  subscriptionCancel: () => "/subscription/cancel",
  notifications: () => "/notifications",
  settings: () => "/settings",
  verifyEmail: ({ token }) => `/auth/verify-email?token=${enc(token)}`,
  resetPassword: ({ token }) => `/auth/forgot-password?token=${enc(token)}`,
};

/** The full link to an app path, on the app's configured address (config.appUrl). */
function appLink(name, params = {}) {
  const pathFor = appPaths[name];
  if (!pathFor) throw new Error(`No app path named "${name}" in appLinks.js`);
  const { appUrl } = require("../config");
  return `${appUrl}${pathFor(params)}`;
}

module.exports = { appPaths, appLink };
