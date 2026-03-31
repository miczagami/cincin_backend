const prisma = require("../config/database");
const config = require("../config");
const { AppError } = require("../utils/helpers");

// ═══════════════════════════════════════════════════════════════
//  NOTIFICATION SERVICE — Priority 3 (Production)
//  Timeline ref: Weeks 16–17
//  Spec ref: Sections 10.1–10.4
//
//  Multi-channel notification delivery:
//    - Push (FCM for Android/Web, APNs for iOS) — PRODUCTION SDK
//    - Email (SendGrid with designed HTML templates) — PRODUCTION
//    - In-app notification centre
//
//  Replaces all stubs from Phase 4 with real SDK integrations.
// ═══════════════════════════════════════════════════════════════

// ─── Lazy-loaded SDK singletons ───
let _firebaseAdmin = null;
let _apnProvider = null;
let _sgMail = null;

/**
 * Initialise Firebase Admin SDK (singleton).
 * Requires FIREBASE_SERVICE_ACCOUNT env var containing either:
 *   - A JSON string of the service account credentials, OR
 *   - A file path to the service account JSON file
 */
function getFirebaseAdmin() {
  if (_firebaseAdmin) return _firebaseAdmin;

  const admin = require("firebase-admin");
  const serviceAccountRaw = config.push.fcmServiceAccount;

  if (!serviceAccountRaw) {
    throw new Error("FCM not configured — set FIREBASE_SERVICE_ACCOUNT in env");
  }

  let credential;
  try {
    // Try parsing as JSON string first
    const serviceAccount =
      typeof serviceAccountRaw === "string" && serviceAccountRaw.startsWith("{")
        ? JSON.parse(serviceAccountRaw)
        : require(serviceAccountRaw); // Treat as file path

    credential = admin.credential.cert(serviceAccount);
  } catch (err) {
    throw new Error(`Failed to parse Firebase service account: ${err.message}`);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential });
  }

  _firebaseAdmin = admin;
  console.log("[FCM] Firebase Admin SDK initialised");
  return _firebaseAdmin;
}

/**
 * Initialise APNs provider (singleton).
 * Requires:
 *   - APNS_KEY_PATH  — path to .p8 key file
 *   - APNS_KEY_ID    — Key ID from Apple Developer
 *   - APNS_TEAM_ID   — Team ID from Apple Developer
 *   - APNS_BUNDLE_ID — App bundle ID (default: com.getcincin.app)
 */
function getApnProvider() {
  if (_apnProvider) return _apnProvider;

  const apn = require("@parse/node-apn");

  const keyPath = config.push.apnsKeyPath;
  const keyId = config.push.apnsKeyId;
  const teamId = config.push.apnsTeamId;

  if (!keyPath || !keyId || !teamId) {
    throw new Error(
      "APNs not configured — set APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID in env"
    );
  }

  _apnProvider = new apn.Provider({
    token: {
      key: keyPath,
      keyId,
      teamId,
    },
    production: config.env === "production",
  });

  console.log("[APNs] Provider initialised (production:", config.env === "production", ")");
  return _apnProvider;
}

/**
 * Initialise SendGrid (singleton).
 * Requires SENDGRID_API_KEY env var.
 */
function getSendGrid() {
  if (_sgMail) return _sgMail;

  const sgMail = require("@sendgrid/mail");
  const apiKey = config.email.sendgridApiKey;

  if (!apiKey) {
    throw new Error("SendGrid not configured — set SENDGRID_API_KEY in env");
  }

  sgMail.setApiKey(apiKey);
  _sgMail = sgMail;
  console.log("[Email] SendGrid initialised");
  return _sgMail;
}

// ═══════════════════════════════════════════
//  NOTIFICATION CATEGORIES & PREFERENCES
// ═══════════════════════════════════════════

// Notification category → user preference field mapping (Section 10.2)
const CATEGORY_PREF_MAP = {
  game_invite: "notifGameInvites",
  club_approval: "notifCellarClubActivity",
  club_game_approved: "notifCellarClubActivity",
  club_game_rejected: "notifCellarClubActivity",
  club_member_joined: "notifCellarClubActivity",
  season_ending: "notifSeasonReminders",
  season_ended: "notifSeasonReminders",
  palate_updated: "notifPalateUpdates",
  weekly_standings: "notifWeeklyDigests",
  payment_failed: null, // always send — critical billing notification
  club_membership_reduced: null, // always send — account change
  monthly_palate_wrapped: "notifWeeklyDigests",
  quarterly_summary: "notifWeeklyDigests",
  season_end_report: "notifSeasonReminders",
};

// Events that should NOT trigger push notifications (Section 10.2)
const PUSH_EXCLUDED_TYPES = [
  "activity_feed_update",
  "new_sponsored_tasting",
  "marketing",
];

// Notification types that warrant an email (avoid inbox spam)
const EMAIL_TYPES = [
  "payment_failed",
  "season_ended",
  "club_membership_reduced",
  "monthly_palate_wrapped",
  "quarterly_summary",
  "season_end_report",
];

// ═══════════════════════════════════════════
//  MAIN ENTRY POINT
// ═══════════════════════════════════════════

/**
 * Create and deliver a notification across all appropriate channels.
 *
 * @param {string} userId - recipient
 * @param {object} notification - { type, title, body, data }
 * @param {object} options - { forcePush, forceEmail }
 */
async function createNotification(
  userId,
  { type, title, body, data },
  options = {}
) {
  // Fetch user preferences
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      notifGameInvites: true,
      notifCellarClubActivity: true,
      notifSeasonReminders: true,
      notifPalateUpdates: true,
      notifWeeklyDigests: true,
      notifEmail: true,
      notifPush: true,
      email: true,
    },
  });

  if (!user) {
    console.warn(`[Notification] User ${userId} not found — skipping`);
    return null;
  }

  // Check category-level opt-in
  const prefField = CATEGORY_PREF_MAP[type];
  if (prefField && !user[prefField]) {
    return createInAppOnly(userId, { type, title, body, data });
  }

  // 1. Always create in-app notification
  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      data: data || {},
      channel: "in_app",
    },
  });

  // 2. Push notification (if user opted in and type not excluded)
  let pushSent = false;
  if (
    user.notifPush &&
    !PUSH_EXCLUDED_TYPES.includes(type) &&
    (options.forcePush || true)
  ) {
    pushSent = await sendPushNotification(userId, { title, body, data, type });
    if (pushSent) {
      await prisma.notification.update({
        where: { id: notification.id },
        data: { pushSent: true },
      });
    }
  }

  // 3. Email notification (only for specific types or if forced)
  let emailSent = false;
  if (user.notifEmail && (EMAIL_TYPES.includes(type) || options.forceEmail)) {
    emailSent = await sendEmailNotification(user.email, {
      title,
      body,
      data,
      type,
    });
    if (emailSent) {
      await prisma.notification.update({
        where: { id: notification.id },
        data: { emailSent: true },
      });
    }
  }

  return { notificationId: notification.id, pushSent, emailSent };
}

/**
 * Create only an in-app notification (when user opted out of category).
 */
async function createInAppOnly(userId, { type, title, body, data }) {
  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      data: data || {},
      channel: "in_app",
    },
  });

  return { notificationId: notification.id, pushSent: false, emailSent: false };
}

// ═══════════════════════════════════════════
//  PUSH NOTIFICATION DELIVERY (PRODUCTION)
// ═══════════════════════════════════════════

/**
 * Send push notification to all of a user's registered devices.
 * Uses FCM for Android/Web, APNs for iOS.
 */
async function sendPushNotification(userId, { title, body, data, type }) {
  const tokens = await prisma.pushToken.findMany({
    where: { userId },
  });

  if (tokens.length === 0) return false;

  let anySent = false;

  for (const tokenRecord of tokens) {
    try {
      if (tokenRecord.platform === "ios") {
        await sendAPNS(tokenRecord.token, { title, body, data });
      } else {
        // web and android use FCM
        await sendFCM(tokenRecord.token, { title, body, data });
      }
      anySent = true;
    } catch (err) {
      console.error(
        `[Notification] Push failed for token ${tokenRecord.id}:`,
        err.message
      );
      // If token is invalid/expired, remove it
      if (isTokenExpired(err)) {
        await prisma.pushToken.delete({ where: { id: tokenRecord.id } });
        console.log(
          `[Notification] Removed expired token ${tokenRecord.id}`
        );
      }
    }
  }

  return anySent;
}

/**
 * Send via Firebase Cloud Messaging (FCM).
 * Handles Web (PWA) and Android push notifications.
 */
async function sendFCM(token, { title, body, data }) {
  // Development mock
  if (config.env === "development" && !config.push.fcmServiceAccount) {
    console.log(`[FCM Mock] → ${token.slice(0, 20)}... | ${title}`);
    return true;
  }

  const admin = getFirebaseAdmin();

  const message = {
    token,
    notification: {
      title,
      body,
    },
    // FCM data payload must be string key-value pairs
    data: data
      ? Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        )
      : {},
    // Web push specific options
    webpush: {
      notification: {
        icon: "/icons/icon-192x192.png",
        badge: "/icons/badge-72x72.png",
        vibrate: [100, 50, 100],
        actions: getNotificationActions(data?.type),
      },
      fcmOptions: {
        link: buildDeepLink(data),
      },
    },
    // Android specific options
    android: {
      priority: "high",
      notification: {
        icon: "ic_notification",
        color: "#22D3EE", // cin-cyan
        channelId: getAndroidChannel(data?.type),
        sound: "default",
      },
    },
  };

  const response = await admin.messaging().send(message);
  console.log(`[FCM] Sent to ${token.slice(0, 20)}... | messageId: ${response}`);
  return true;
}

/**
 * Send via Apple Push Notification Service (APNs).
 * Handles iOS native push notifications.
 */
async function sendAPNS(token, { title, body, data }) {
  // Development mock
  if (config.env === "development" && !config.push.apnsKeyPath) {
    console.log(`[APNs Mock] → ${token.slice(0, 20)}... | ${title}`);
    return true;
  }

  const apn = require("@parse/node-apn");
  const provider = getApnProvider();

  const notification = new apn.Notification();

  // Alert payload
  notification.alert = { title, body };

  // Custom data payload for the app to handle
  notification.payload = data || {};

  // Required: bundle ID
  notification.topic = config.push.apnsBundleId || "com.getcincin.app";

  // Sound
  notification.sound = "default";

  // Badge — we could query unread count, but for now use increment
  notification.badge = 1;

  // Category for actionable notifications
  notification.category = getApnsCategory(data?.type);

  // Expiry: 24 hours
  notification.expiry = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  // Priority: 10 = immediate, 5 = power-considerate
  notification.priority = isTimeSensitive(data?.type) ? 10 : 5;

  // Push type
  notification.pushType = "alert";

  const result = await provider.send(notification, token);

  if (result.failed.length > 0) {
    const failure = result.failed[0];
    const error = new Error(
      failure.response?.reason || "APNs delivery failed"
    );
    error.status = failure.status;
    throw error;
  }

  console.log(`[APNs] Sent to ${token.slice(0, 20)}... | ${title}`);
  return true;
}

/**
 * Check if a push error indicates an expired/invalid token.
 */
function isTokenExpired(err) {
  const msg = (err.message || "").toLowerCase();
  const status = err.status;

  return (
    // FCM errors
    msg.includes("not registered") ||
    msg.includes("invalid registration") ||
    msg.includes("unregistered") ||
    msg.includes("expired") ||
    msg.includes("messaging/registration-token-not-registered") ||
    msg.includes("messaging/invalid-registration-token") ||
    // APNs errors
    msg.includes("baddevicetoken") ||
    msg.includes("unregistered") ||
    msg.includes("expiredprovidertoken") ||
    status === 410 // APNs Gone = token no longer valid
  );
}

// ═══════════════════════════════════════════
//  PUSH NOTIFICATION HELPERS
// ═══════════════════════════════════════════

/**
 * Build a deep link URL for the notification tap action.
 */
function buildDeepLink(data) {
  const appUrl = config.appUrl || "https://app.getcincin.com";
  if (!data) return appUrl;

  switch (data.type) {
    case "game_invite":
      return `${appUrl}/join/${data.gameCode || ""}`;
    case "club_game_approved":
    case "club_game_rejected":
    case "club_member_joined":
    case "club_approval":
      return `${appUrl}/clubs/${data.clubId || ""}`;
    case "season_ending":
    case "season_ended":
      return `${appUrl}/clubs/${data.clubId || ""}/season`;
    case "palate_updated":
      return `${appUrl}/palate/profile`;
    case "monthly_palate_wrapped":
      return `${appUrl}/palate/wrapped`;
    case "weekly_standings":
      return `${appUrl}/clubs/${data.clubId || ""}`;
    case "payment_failed":
      return `${appUrl}/subscription`;
    default:
      return `${appUrl}/notifications`;
  }
}

/**
 * Get web push notification actions for actionable types.
 */
function getNotificationActions(type) {
  switch (type) {
    case "game_invite":
      return [
        { action: "join", title: "Join Game" },
        { action: "dismiss", title: "Later" },
      ];
    case "club_approval":
      return [
        { action: "approve", title: "Approve" },
        { action: "reject", title: "Reject" },
      ];
    default:
      return [];
  }
}

/**
 * Get Android notification channel ID by type.
 */
function getAndroidChannel(type) {
  if (["game_invite"].includes(type)) return "game_invites";
  if (["club_approval", "club_game_approved", "club_game_rejected", "club_member_joined"].includes(type))
    return "club_activity";
  if (["season_ending", "season_ended"].includes(type)) return "season_updates";
  if (["payment_failed"].includes(type)) return "billing";
  return "general";
}

/**
 * Get APNs category for actionable notifications (iOS).
 */
function getApnsCategory(type) {
  switch (type) {
    case "game_invite":
      return "GAME_INVITE";
    case "club_approval":
      return "CLUB_APPROVAL";
    default:
      return "GENERAL";
  }
}

/**
 * Determine if a notification type is time-sensitive (affects APNs priority).
 */
function isTimeSensitive(type) {
  return ["game_invite", "payment_failed", "club_approval"].includes(type);
}

// ═══════════════════════════════════════════
//  EMAIL NOTIFICATION DELIVERY (PRODUCTION)
// ═══════════════════════════════════════════

/**
 * Send an email notification using SendGrid with designed HTML templates.
 */
async function sendEmailNotification(email, { title, body, data, type }) {
  // Development mock
  if (config.env === "development" && !config.email.sendgridApiKey) {
    console.log(`[Email Mock] → ${email} | ${title}`);
    return true;
  }

  try {
    const sgMail = getSendGrid();

    // Build the email payload
    const msg = {
      to: email,
      from: {
        email: config.email.fromAddress || "noreply@getcincin.com",
        name: config.email.fromName || "CinCin",
      },
      subject: title,
      text: body, // Plain text fallback
      html: buildEmailHtml(type, { title, body, data }),
      // Mail settings
      mailSettings: {
        sandboxMode: {
          enable: config.env === "test",
        },
      },
      // Tracking
      trackingSettings: {
        clickTracking: { enable: true },
        openTracking: { enable: true },
      },
      // Categories for SendGrid analytics
      categories: ["notification", type],
    };

    // If SendGrid Dynamic Templates are configured, use them instead
    const templateId = getTemplateId(type);
    if (templateId) {
      msg.templateId = templateId;
      msg.dynamicTemplateData = {
        subject: title,
        title,
        body,
        appUrl: config.appUrl || "https://app.getcincin.com",
        deepLink: buildDeepLink(data),
        year: new Date().getFullYear(),
        ...flattenData(data),
      };
      // When using templates, don't set html/text (template handles it)
      delete msg.html;
      delete msg.text;
    }

    await sgMail.send(msg);
    console.log(`[Email] Sent to ${email} | ${type} | ${title}`);
    return true;
  } catch (err) {
    console.error("[Email] Send failed:", err.message);
    // Log SendGrid-specific error details
    if (err.response?.body?.errors) {
      console.error("[Email] SendGrid errors:", JSON.stringify(err.response.body.errors));
    }
    return false;
  }
}

/**
 * Map notification type → SendGrid Dynamic Template ID.
 * These template IDs must be created in the SendGrid dashboard.
 * Falls back to inline HTML if no template is configured.
 */
function getTemplateId(type) {
  const templates = {
    payment_failed: process.env.SG_TEMPLATE_PAYMENT_FAILED || null,
    season_ended: process.env.SG_TEMPLATE_SEASON_ENDED || null,
    club_membership_reduced: process.env.SG_TEMPLATE_MEMBERSHIP_REDUCED || null,
    monthly_palate_wrapped: process.env.SG_TEMPLATE_MONTHLY_WRAPPED || null,
    quarterly_summary: process.env.SG_TEMPLATE_QUARTERLY_SUMMARY || null,
    season_end_report: process.env.SG_TEMPLATE_SEASON_END_REPORT || null,
  };

  return templates[type] || null;
}

/**
 * Flatten nested data object for SendGrid dynamic template data.
 */
function flattenData(data) {
  if (!data) return {};
  const flat = {};
  for (const [key, value] of Object.entries(data)) {
    flat[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return flat;
}

// ═══════════════════════════════════════════
//  HTML EMAIL TEMPLATES (Inline Fallback)
//  Used when SendGrid Dynamic Templates are not configured.
//  Designed to match CinCin brand: dark theme, cyan accents.
// ═══════════════════════════════════════════

/**
 * Build inline HTML email for a given notification type.
 * Falls back to generic template for unknown types.
 */
function buildEmailHtml(type, { title, body, data }) {
  const appUrl = config.appUrl || "https://app.getcincin.com";
  const deepLink = buildDeepLink(data);

  switch (type) {
    case "monthly_palate_wrapped":
      return buildWrappedEmail({ title, body, data, appUrl, deepLink });
    case "quarterly_summary":
      return buildQuarterlySummaryEmail({ title, body, data, appUrl, deepLink });
    case "season_ended":
    case "season_end_report":
      return buildSeasonEndEmail({ title, body, data, appUrl, deepLink });
    case "payment_failed":
      return buildPaymentFailedEmail({ title, body, data, appUrl, deepLink });
    case "club_membership_reduced":
      return buildMembershipReducedEmail({ title, body, data, appUrl, deepLink });
    default:
      return buildGenericEmail({ title, body, appUrl, deepLink });
  }
}

/**
 * Base email wrapper — CinCin branded dark theme.
 */
function emailWrapper(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>CinCin</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    body, table, td { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    body { margin: 0; padding: 0; width: 100%; background-color: #0A0A0A; }
    .wrapper { max-width: 600px; margin: 0 auto; }
    .btn {
      display: inline-block;
      padding: 14px 32px;
      background-color: #22D3EE;
      color: #0A0A0A !important;
      text-decoration: none;
      border-radius: 12px;
      font-weight: 700;
      font-size: 15px;
      text-align: center;
    }
    .btn:hover { background-color: #06B6D4; }
    a { color: #22D3EE; text-decoration: none; }
    @media only screen and (max-width: 620px) {
      .wrapper { width: 100% !important; padding: 0 16px !important; }
      .content { padding: 24px 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#0A0A0A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0A0A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0">
          <!-- Header -->
          <tr>
            <td align="center" style="padding:0 0 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:28px;font-weight:900;color:#FFFFFF;letter-spacing:2px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                    CIN<span style="color:#22D3EE;">CIN</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                style="background-color:#141414;border-radius:16px;border:1px solid #262626;">
                <tr>
                  <td class="content" style="padding:32px 28px;">
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding:24px 0 0;">
              <p style="font-size:12px;color:#737373;margin:0;">
                You're receiving this because of your CinCin notification preferences.
                <br>
                <a href="${config.appUrl || "https://app.getcincin.com"}/settings" style="color:#22D3EE;">Manage preferences</a>
                &nbsp;·&nbsp;
                <a href="${config.appUrl || "https://app.getcincin.com"}" style="color:#22D3EE;">Open CinCin</a>
              </p>
              <p style="font-size:11px;color:#525252;margin:12px 0 0;">
                &copy; ${new Date().getFullYear()} CinCin Pty Ltd · Melbourne, Australia
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Monthly Palate Wrapped email — shareable card-style design.
 */
function buildWrappedEmail({ title, body, data, appUrl, deepLink }) {
  const gamesPlayed = data?.gamesPlayed || "—";
  const accuracy = data?.accuracy || "—";
  const topStrength = data?.topStrength || "—";
  const biggestMiss = data?.biggestMiss || "—";
  const period = data?.period || "This Month";

  return emailWrapper(`
    <!-- Period badge -->
    <p style="font-size:11px;color:#22D3EE;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin:0 0 8px;text-align:center;">
      Palate Wrapped · ${period}
    </p>
    <h1 style="font-size:24px;font-weight:900;color:#FFFFFF;margin:0 0 24px;text-align:center;">
      ${title}
    </h1>

    <!-- Stat cards row -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td width="33%" align="center" style="padding:16px 4px;background-color:#1A1A1A;border-radius:12px;">
          <div style="font-size:28px;font-weight:900;color:#22D3EE;">${gamesPlayed}</div>
          <div style="font-size:10px;color:#737373;text-transform:uppercase;margin-top:4px;">Games</div>
        </td>
        <td width="4"></td>
        <td width="33%" align="center" style="padding:16px 4px;background-color:#1A1A1A;border-radius:12px;">
          <div style="font-size:28px;font-weight:900;color:#22D3EE;">${accuracy}%</div>
          <div style="font-size:10px;color:#737373;text-transform:uppercase;margin-top:4px;">Accuracy</div>
        </td>
        <td width="4"></td>
        <td width="33%" align="center" style="padding:16px 4px;background-color:#1A1A1A;border-radius:12px;">
          <div style="font-size:28px;font-weight:900;color:#22D3EE;">${topStrength}</div>
          <div style="font-size:10px;color:#737373;text-transform:uppercase;margin-top:4px;">Best</div>
        </td>
      </tr>
    </table>

    <!-- Strengths & Weaknesses -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="border-top:1px solid #262626;padding-top:16px;margin-bottom:24px;">
      <tr>
        <td style="padding:8px 0;">
          <span style="font-size:12px;color:#737373;">Top strength</span><br>
          <span style="font-size:16px;font-weight:700;color:#4ADE80;">${topStrength}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;">
          <span style="font-size:12px;color:#737373;">Biggest miss</span><br>
          <span style="font-size:16px;font-weight:700;color:#F87171;">${biggestMiss}</span>
        </td>
      </tr>
    </table>

    <p style="font-size:14px;color:#D4D4D4;line-height:1.6;margin:0 0 24px;">
      ${body}
    </p>

    <!-- CTA -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <a href="${deepLink}" class="btn">View Full Wrapped</a>
        </td>
      </tr>
    </table>
  `);
}

/**
 * Quarterly Summary email.
 */
function buildQuarterlySummaryEmail({ title, body, data, appUrl, deepLink }) {
  const quarter = data?.quarter || "Q?";
  const gamesPlayed = data?.gamesPlayed || "—";
  const bottlesScanned = data?.bottlesScanned || "—";
  const newFlavours = data?.newFlavours || "—";

  return emailWrapper(`
    <p style="font-size:11px;color:#22D3EE;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin:0 0 8px;text-align:center;">
      Quarterly Summary · ${quarter}
    </p>
    <h1 style="font-size:24px;font-weight:900;color:#FFFFFF;margin:0 0 16px;text-align:center;">
      ${title}
    </h1>
    <p style="font-size:14px;color:#D4D4D4;line-height:1.6;margin:0 0 24px;text-align:center;">
      ${body}
    </p>

    <!-- Quick stats -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td width="33%" align="center" style="padding:12px 4px;background-color:#1A1A1A;border-radius:12px;">
          <div style="font-size:24px;font-weight:900;color:#22D3EE;">${gamesPlayed}</div>
          <div style="font-size:10px;color:#737373;">Games</div>
        </td>
        <td width="4"></td>
        <td width="33%" align="center" style="padding:12px 4px;background-color:#1A1A1A;border-radius:12px;">
          <div style="font-size:24px;font-weight:900;color:#22D3EE;">${bottlesScanned}</div>
          <div style="font-size:10px;color:#737373;">Scanned</div>
        </td>
        <td width="4"></td>
        <td width="33%" align="center" style="padding:12px 4px;background-color:#1A1A1A;border-radius:12px;">
          <div style="font-size:24px;font-weight:900;color:#22D3EE;">${newFlavours}</div>
          <div style="font-size:10px;color:#737373;">New Flavours</div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <a href="${deepLink}" class="btn">View Full Summary</a>
        </td>
      </tr>
    </table>
  `);
}

/**
 * Season End / Season End Report email.
 */
function buildSeasonEndEmail({ title, body, data, appUrl, deepLink }) {
  const clubName = data?.clubName || "Your Club";
  const champion = data?.champion || "—";
  const championScore = data?.championScore || "—";

  return emailWrapper(`
    <p style="font-size:11px;color:#22D3EE;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin:0 0 8px;text-align:center;">
      Season Complete
    </p>
    <h1 style="font-size:24px;font-weight:900;color:#FFFFFF;margin:0 0 8px;text-align:center;">
      ${clubName}
    </h1>
    <p style="font-size:14px;color:#D4D4D4;line-height:1.6;margin:0 0 24px;text-align:center;">
      ${body}
    </p>

    <!-- Champion spotlight -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background-color:#1A1A1A;border-radius:12px;border:1px solid rgba(34,211,238,0.2);margin:0 0 24px;">
      <tr>
        <td align="center" style="padding:24px 16px;">
          <div style="font-size:40px;margin-bottom:8px;">🏆</div>
          <div style="font-size:11px;color:#737373;text-transform:uppercase;letter-spacing:1px;">Champion</div>
          <div style="font-size:22px;font-weight:900;color:#FFFFFF;margin:4px 0;">${champion}</div>
          <div style="font-size:14px;color:#22D3EE;font-weight:600;">${championScore} points</div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <a href="${deepLink}" class="btn">View Full Results</a>
        </td>
      </tr>
    </table>
  `);
}

/**
 * Payment Failed email — urgent billing alert.
 */
function buildPaymentFailedEmail({ title, body, data, appUrl, deepLink }) {
  return emailWrapper(`
    <div style="text-align:center;margin-bottom:16px;">
      <span style="display:inline-block;width:48px;height:48px;border-radius:50%;background-color:rgba(248,113,113,0.15);line-height:48px;font-size:24px;">⚠️</span>
    </div>
    <h1 style="font-size:22px;font-weight:900;color:#FFFFFF;margin:0 0 12px;text-align:center;">
      ${title}
    </h1>
    <p style="font-size:14px;color:#D4D4D4;line-height:1.6;margin:0 0 24px;text-align:center;">
      ${body}
    </p>
    <p style="font-size:13px;color:#A3A3A3;line-height:1.5;margin:0 0 24px;text-align:center;">
      Please update your payment method to keep your Pro subscription active.
      If payment fails again, your account will be downgraded to Free.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <a href="${deepLink}" class="btn" style="background-color:#F87171;">Update Payment</a>
        </td>
      </tr>
    </table>
  `);
}

/**
 * Club Membership Reduced email.
 */
function buildMembershipReducedEmail({ title, body, data, appUrl, deepLink }) {
  return emailWrapper(`
    <h1 style="font-size:22px;font-weight:900;color:#FFFFFF;margin:0 0 12px;text-align:center;">
      ${title}
    </h1>
    <p style="font-size:14px;color:#D4D4D4;line-height:1.6;margin:0 0 24px;text-align:center;">
      ${body}
    </p>
    <p style="font-size:13px;color:#A3A3A3;line-height:1.5;margin:0 0 24px;text-align:center;">
      As a Free member, you can be in 1 Cellar Club. Upgrade to Pro for unlimited club memberships.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <a href="${appUrl}/subscription" class="btn">Upgrade to Pro</a>
        </td>
      </tr>
    </table>
  `);
}

/**
 * Generic notification email.
 */
function buildGenericEmail({ title, body, appUrl, deepLink }) {
  return emailWrapper(`
    <h1 style="font-size:22px;font-weight:900;color:#FFFFFF;margin:0 0 16px;">
      ${title}
    </h1>
    <p style="font-size:14px;color:#D4D4D4;line-height:1.6;margin:0 0 24px;">
      ${body}
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <a href="${deepLink}" class="btn">Open CinCin</a>
        </td>
      </tr>
    </table>
  `);
}

// ═══════════════════════════════════════════
//  PUSH TOKEN MANAGEMENT
// ═══════════════════════════════════════════

/**
 * Register a push notification token for a device.
 */
async function registerPushToken(userId, { token, platform = "web" }) {
  if (!token) throw new AppError("Token is required", 400);

  // Validate platform
  const validPlatforms = ["web", "ios", "android"];
  if (!validPlatforms.includes(platform)) {
    throw new AppError(`Invalid platform: ${platform}`, 400);
  }

  const pushToken = await prisma.pushToken.upsert({
    where: { userId_token: { userId, token } },
    update: { platform, updatedAt: new Date() },
    create: { userId, token, platform },
  });

  return pushToken;
}

/**
 * Remove a push notification token (on logout or device removal).
 */
async function removePushToken(userId, token) {
  await prisma.pushToken.deleteMany({
    where: { userId, token },
  });
  return { message: "Token removed" };
}

// ═══════════════════════════════════════════
//  NOTIFICATION CENTRE (in-app)
// ═══════════════════════════════════════════

/**
 * Get notifications for the in-app notification centre.
 */
async function getNotifications(
  userId,
  { limit = 30, offset = 0, unreadOnly = false } = {}
) {
  const where = { userId };
  if (unreadOnly) where.read = false;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);

  return { notifications, total, unreadCount, limit, offset };
}

/**
 * Mark a notification as read.
 */
async function markAsRead(userId, notificationId) {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { read: true },
  });
  return { success: true };
}

/**
 * Mark all notifications as read.
 */
async function markAllAsRead(userId) {
  const result = await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
  return { marked: result.count };
}

// ═══════════════════════════════════════════
//  GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════

/**
 * Shut down push providers gracefully (call on process exit).
 */
async function shutdown() {
  if (_apnProvider) {
    _apnProvider.shutdown();
    _apnProvider = null;
    console.log("[APNs] Provider shut down");
  }
}

module.exports = {
  createNotification,
  sendPushNotification,
  sendEmailNotification,
  registerPushToken,
  removePushToken,
  getNotifications,
  markAsRead,
  markAllAsRead,
  shutdown,
  // Exposed for testing
  buildEmailHtml,
  buildDeepLink,
};
