/**
 * Phase 4: User Service
 *
 * Manages user profiles, notification preferences, data privacy controls,
 * and (Phase 4) CSV data export and B2B data opt-in consent.
 *
 * Spec ref: Sections 3.3, 3.8, 7.4, 7.5, 8.5, 10.3
 * Timeline: Phases 1–4
 */

const prisma = require("../config/database");
const { AppError } = require("../utils/helpers");

// ═══════════════════════════════════════════
//  PROFILE (Section 3.3)
// ═══════════════════════════════════════════

/**
 * Get full user profile (Section 3.3).
 */
async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      location: true,
      drinkPreferences: true,
      subscriptionTier: true,
      subscriptionStatus: true,
      subscriptionPlan: true,
      subscriptionCurrentPeriodEnd: true,
      trialEligible: true,
      trialEndsAt: true,
      ageVerified: true,
      emailVerified: true,
      monthlyScansUsed: true,
      scanResetDate: true,
      b2bDataOptIn: true,
      notifGameInvites: true,
      notifCellarClubActivity: true,
      notifSeasonReminders: true,
      notifPalateUpdates: true,
      notifWeeklyDigests: true,
      notifEmail: true,
      notifPush: true,
      createdAt: true,
      _count: {
        select: {
          gamePlayers: true,
          cellarMemberships: true,
          bottleScans: true,
        },
      },
    },
  });

  if (!user) throw new AppError("User not found", 404);

  return {
    ...user,
    stats: {
      gamesPlayed: user._count.gamePlayers,
      clubs: user._count.cellarMemberships,
      bottlesScanned: user._count.bottleScans,
    },
    _count: undefined,
  };
}

/**
 * Update user profile.
 */
async function updateProfile(userId, data) {
  const allowedFields = [
    "displayName", "avatarUrl", "bio", "location", "drinkPreferences",
  ];

  const updateData = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updateData[field] = data[field];
    }
  }

  return prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      location: true,
      drinkPreferences: true,
    },
  });
}

// ═══════════════════════════════════════════
//  NOTIFICATION PREFERENCES (Section 10.3)
// ═══════════════════════════════════════════

/**
 * Update notification preferences (Section 10.3).
 */
async function updateNotificationPrefs(userId, prefs) {
  const allowedPrefs = [
    "notifGameInvites", "notifCellarClubActivity", "notifSeasonReminders",
    "notifPalateUpdates", "notifWeeklyDigests", "notifEmail", "notifPush",
  ];

  const updateData = {};
  for (const field of allowedPrefs) {
    if (typeof prefs[field] === "boolean") {
      updateData[field] = prefs[field];
    }
  }

  return prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: Object.fromEntries(allowedPrefs.map(k => [k, true])),
  });
}

// ═══════════════════════════════════════════
//  DATA PRIVACY — EXPORT (Section 3.8 / 7.5)
// ═══════════════════════════════════════════

/**
 * Export all user data as JSON (Section 3.8 — GDPR/Privacy Act compliance).
 */
async function exportData(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      gamePlayers: {
        include: {
          guesses: true,
          game: { select: { id: true, bottleId: true, createdAt: true } },
        },
      },
      cellarMemberships: {
        include: { club: { select: { id: true, name: true } } },
      },
      palateStats: true,
      bottleScans: true,
      notifications: { take: 100, orderBy: { createdAt: "desc" } },
    },
  });

  if (!user) throw new AppError("User not found", 404);

  // Strip internal fields
  const { passwordHash, ...exportableUser } = user;
  return exportableUser;
}

/**
 * Phase 4: Export all user data in CSV format (Section 3.8).
 * Returns CSV strings for each data category, ready for download.
 */
async function exportDataCSV(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      gamePlayers: {
        include: {
          guesses: {
            select: {
              guessText: true,
              pointsAwarded: true,
              isSpecific: true,
              matchedVia: true,
              createdAt: true,
            },
          },
          game: {
            select: {
              id: true,
              createdAt: true,
              endedAt: true,
              bottle: { select: { name: true, category: true } },
            },
          },
        },
      },
      cellarMemberships: {
        include: { club: { select: { id: true, name: true } } },
      },
      palateStats: true,
      bottleScans: {
        include: { bottle: { select: { name: true, category: true } } },
      },
    },
  });

  if (!user) throw new AppError("User not found", 404);

  // Profile CSV
  const profileCSV = [
    "field,value",
    `display_name,"${escapeCSV(user.displayName)}"`,
    `email,"${escapeCSV(user.email)}"`,
    `location,"${escapeCSV(user.location || "")}"`,
    `bio,"${escapeCSV(user.bio || "")}"`,
    `subscription_tier,${user.subscriptionTier}`,
    `age_verified,${user.ageVerified}`,
    `email_verified,${user.emailVerified}`,
    `b2b_data_opt_in,${user.b2bDataOptIn}`,
    `created_at,${user.createdAt.toISOString()}`,
  ].join("\n");

  // Games CSV
  const gamesCSV = [
    "game_id,bottle_name,bottle_category,score,date",
    ...user.gamePlayers.map((gp) =>
      [
        gp.game.id,
        `"${escapeCSV(gp.game.bottle?.name || "Unknown")}"`,
        gp.game.bottle?.category || "",
        gp.totalScore,
        (gp.game.endedAt || gp.game.createdAt).toISOString(),
      ].join(",")
    ),
  ].join("\n");

  // Guesses CSV
  const guessRows = [];
  for (const gp of user.gamePlayers) {
    for (const guess of gp.guesses) {
      guessRows.push(
        [
          gp.game.id,
          `"${escapeCSV(guess.guessText)}"`,
          guess.pointsAwarded,
          guess.isSpecific,
          guess.matchedVia || "",
          guess.createdAt.toISOString(),
        ].join(",")
      );
    }
  }
  const guessesCSV = [
    "game_id,guess_text,points,is_specific,match_type,date",
    ...guessRows,
  ].join("\n");

  // Scans CSV
  const scansCSV = [
    "bottle_name,bottle_category,confidence,method,date",
    ...user.bottleScans.map((scan) =>
      [
        `"${escapeCSV(scan.bottle?.name || "Unmatched")}"`,
        scan.bottle?.category || "",
        scan.confidence || "",
        scan.inputMethod,
        scan.createdAt.toISOString(),
      ].join(",")
    ),
  ].join("\n");

  // Palate stats CSV
  const palateCSV = [
    "category,drink_type,total_guesses,correct_guesses,accuracy,games_appeared_in",
    ...user.palateStats.map((stat) =>
      [
        `"${escapeCSV(stat.category)}"`,
        stat.drinkType || "all",
        stat.totalGuesses,
        stat.correctGuesses,
        stat.accuracy,
        stat.gamesAppearedIn || 0,
      ].join(",")
    ),
  ].join("\n");

  // Club memberships CSV
  const clubsCSV = [
    "club_name,role,joined_at,left_at",
    ...user.cellarMemberships.map((m) =>
      [
        `"${escapeCSV(m.club.name)}"`,
        m.role,
        m.joinedAt.toISOString(),
        m.leftAt ? m.leftAt.toISOString() : "",
      ].join(",")
    ),
  ].join("\n");

  return {
    format: "csv",
    files: {
      profile: profileCSV,
      games: gamesCSV,
      guesses: guessesCSV,
      scans: scansCSV,
      palate_stats: palateCSV,
      club_memberships: clubsCSV,
    },
  };
}

// ═══════════════════════════════════════════
//  DATA PRIVACY — ANONYMISE & DELETE (Section 3.8)
// ═══════════════════════════════════════════

/**
 * Anonymise user data (Section 3.8).
 * Removes personal identity but preserves aggregate game data for B2B reports.
 */
async function anonymiseData(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      displayName: `Player_${userId.slice(-6)}`,
      email: `anonymised_${userId}@deleted.cincin.app`,
      avatarUrl: null,
      bio: null,
      location: null,
      passwordHash: null,
      socialProviderId: null,
    },
  });

  return { message: "Your data has been anonymised." };
}

/**
 * Permanently delete account and all associated data (Section 3.8).
 */
async function deleteAccount(userId) {
  // Soft delete — mark as deleted, then a background job handles hard deletion
  await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: new Date() },
  });

  // Immediately delete sessions
  await prisma.session.deleteMany({ where: { userId } });

  return { message: "Account scheduled for deletion." };
}

// ═══════════════════════════════════════════
//  B2B DATA OPT-IN (Phase 4 — Section 8.5)
// ═══════════════════════════════════════════

/**
 * Update B2B data opt-in consent (Section 8.5).
 * Only Pro subscribers are prompted to opt in (they generate the most data).
 * Users can opt out at any time in settings.
 */
async function updateB2BConsent(userId, optIn) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true },
  });

  if (!user) throw new AppError("User not found", 404);

  // Only Pro users can opt in (Section 8.5)
  if (optIn && user.subscriptionTier !== "PRO") {
    throw new AppError("B2B data opt-in is only available for Pro subscribers.", 403);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { b2bDataOptIn: optIn },
  });

  return {
    b2bDataOptIn: optIn,
    message: optIn
      ? "You've opted in to anonymised data sharing. Your data helps improve tasting insights."
      : "You've opted out of data sharing.",
  };
}

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

/**
 * Escape a string for safe CSV output.
 */
function escapeCSV(str) {
  if (!str) return "";
  return str.replace(/"/g, '""');
}

// ═══════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════

module.exports = {
  // Profile
  getProfile,
  updateProfile,
  // Notification preferences
  updateNotificationPrefs,
  // Data export
  exportData,
  exportDataCSV,
  // Data privacy
  anonymiseData,
  deleteAccount,
  // B2B consent
  updateB2BConsent,
};
