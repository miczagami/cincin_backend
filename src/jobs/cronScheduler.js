const config = require("../config");

// ═══════════════════════════════════════════════════════════════
//  CRON SCHEDULER — Phase 4
//  Timeline ref: Weeks 16–17
//
//  Scheduled jobs:
//    1. Check & auto-end expired seasons (hourly)
//    2. Generate Monthly Palate Wrapped summaries (1st of month)
//    3. Generate Quarterly Summaries (1st of Jan/Apr/Jul/Oct)
//    4. Send weekly Cellar Club standings digest (Mondays)
//    5. Send season-ending-soon reminders (daily)
//
//  Uses node-cron for scheduling. Each job is wrapped in a
//  try/catch so failures don't crash the process.
// ═══════════════════════════════════════════════════════════════

let cron;

/**
 * Initialise all cron jobs.
 * Called from server.js on startup.
 */
function initCronJobs() {
  try {
    cron = require("node-cron");
  } catch (err) {
    console.warn("[Cron] node-cron not installed — scheduled jobs disabled");
    return;
  }

  console.log("[Cron] Initialising scheduled jobs...");

  // 1. Check expired seasons — hourly
  cron.schedule("0 * * * *", async () => {
    console.log("[Cron] Checking for expired seasons...");
    try {
      const cellarClubService = require("../services/cellarClubService");
      const count = await cellarClubService.checkExpiredSeasons();
      if (count > 0) console.log(`[Cron] Auto-ended ${count} season(s)`);
    } catch (err) {
      console.error("[Cron] Expired season check failed:", err.message);
    }
  });

  // 2. Monthly Palate Wrapped — 1st of every month at 06:00
  cron.schedule("0 6 1 * *", async () => {
    console.log("[Cron] Generating Monthly Palate Wrapped summaries...");
    try {
      const count = await generateMonthlyWrappedSummaries();
      console.log(`[Cron] Generated ${count} Palate Wrapped card(s)`);
    } catch (err) {
      console.error("[Cron] Monthly Wrapped generation failed:", err.message);
    }
  });

  // 3. Quarterly Summary — 1st of Jan/Apr/Jul/Oct at 07:00
  cron.schedule("0 7 1 1,4,7,10 *", async () => {
    console.log("[Cron] Generating Quarterly Summaries...");
    try {
      const count = await generateQuarterlySummaries();
      console.log(`[Cron] Generated ${count} quarterly summary/summaries`);
    } catch (err) {
      console.error("[Cron] Quarterly summary generation failed:", err.message);
    }
  });

  // 4. Weekly Cellar Club standings — Mondays at 09:00
  cron.schedule("0 9 * * 1", async () => {
    console.log("[Cron] Sending weekly Cellar Club standings...");
    try {
      const count = await sendWeeklyStandingsDigest();
      console.log(`[Cron] Sent ${count} weekly standings digest(s)`);
    } catch (err) {
      console.error("[Cron] Weekly standings failed:", err.message);
    }
  });

  // 5. Season ending soon reminders — daily at 10:00
  cron.schedule("0 10 * * *", async () => {
    console.log("[Cron] Checking for season-ending-soon reminders...");
    try {
      const count = await sendSeasonEndingReminders();
      console.log(`[Cron] Sent ${count} season-ending reminder(s)`);
    } catch (err) {
      console.error("[Cron] Season ending reminders failed:", err.message);
    }
  });

  console.log("[Cron] All scheduled jobs initialised");
}

// ═══════════════════════════════════════════
//  JOB IMPLEMENTATIONS
// ═══════════════════════════════════════════

/**
 * Generate Monthly Palate Wrapped for all eligible Pro users (Section 10.4.1).
 * Eligible: Pro users who played at least 1 game in the previous month.
 */
async function generateMonthlyWrappedSummaries() {
  const prisma = require("../config/database");
  const palateProfileService = require("../services/palateProfileService");
  const notificationService = require("../services/notificationService");

  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // Find Pro users who played games last month
  const eligibleUsers = await prisma.user.findMany({
    where: {
      subscriptionTier: "PRO",
      deletedAt: null,
      gamePlayers: {
        some: {
          game: {
            status: "COMPLETED",
            endedAt: {
              gte: prevMonth,
              lt: new Date(now.getFullYear(), now.getMonth(), 1),
            },
          },
        },
      },
    },
    select: { id: true },
  });

  let count = 0;
  for (const user of eligibleUsers) {
    try {
      await palateProfileService.generateWrappedCard(user.id, {
        month: prevMonth.getMonth(),
        year: prevMonth.getFullYear(),
      });

      await notificationService.createNotification(user.id, {
        type: "monthly_palate_wrapped",
        title: "Your Monthly Palate Wrapped is ready!",
        body: `See how your palate performed in ${prevMonth.toLocaleDateString("en-AU", { month: "long" })}.`,
        data: { month: prevMonth.getMonth(), year: prevMonth.getFullYear() },
      });

      count++;
    } catch (err) {
      console.error(`[Cron] Wrapped generation failed for user ${user.id}:`, err.message);
    }
  }

  return count;
}

/**
 * Generate Quarterly Summaries for Pro users (Section 10.4.2).
 * STUB: Generates skeleton data — full implementation includes
 * 3-month trend, comparison to previous quarter, bottles scanned, new flavours.
 */
async function generateQuarterlySummaries() {
  const prisma = require("../config/database");
  const notificationService = require("../services/notificationService");

  const now = new Date();
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 - 3, 1);
  const quarterEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 0);

  const eligibleUsers = await prisma.user.findMany({
    where: {
      subscriptionTier: "PRO",
      deletedAt: null,
      gamePlayers: {
        some: {
          game: {
            status: "COMPLETED",
            endedAt: { gte: quarterStart, lte: quarterEnd },
          },
        },
      },
    },
    select: { id: true },
  });

  let count = 0;
  for (const user of eligibleUsers) {
    try {
      // STUB: Phase 5 will add full quarterly trend analysis
      // For now, create a summary record with basic data
      const gamesPlayed = await prisma.gamePlayer.count({
        where: {
          userId: user.id,
          game: {
            status: "COMPLETED",
            endedAt: { gte: quarterStart, lte: quarterEnd },
          },
        },
      });

      await prisma.engagementSummary.upsert({
        where: {
          userId_type_periodStart: {
            userId: user.id,
            type: "quarterly_summary",
            periodStart: quarterStart,
          },
        },
        update: { data: { gamesPlayed, generatedAt: now } },
        create: {
          userId: user.id,
          type: "quarterly_summary",
          periodStart: quarterStart,
          periodEnd: quarterEnd,
          data: { gamesPlayed, generatedAt: now },
        },
      });

      await notificationService.createNotification(user.id, {
        type: "quarterly_summary",
        title: "Your Quarterly Summary is ready!",
        body: `You played ${gamesPlayed} game(s) this quarter. See your full breakdown.`,
        data: { periodStart: quarterStart, periodEnd: quarterEnd },
      });

      count++;
    } catch (err) {
      console.error(`[Cron] Quarterly summary failed for user ${user.id}:`, err.message);
    }
  }

  return count;
}

/**
 * Send weekly Cellar Club standings to members (Section 10.2).
 */
async function sendWeeklyStandingsDigest() {
  const prisma = require("../config/database");
  const cellarClubService = require("../services/cellarClubService");
  const notificationService = require("../services/notificationService");

  // Find all clubs with active seasons
  const activeSeasons = await prisma.season.findMany({
    where: { status: "ACTIVE" },
    include: {
      club: {
        include: {
          members: {
            where: { leftAt: null },
            select: { userId: true },
          },
        },
      },
    },
  });

  let count = 0;
  for (const season of activeSeasons) {
    try {
      const leaderboard = await cellarClubService.getSeasonLeaderboard(
        season.clubId,
        season.id
      );

      if (leaderboard.length === 0) continue;

      const leader = leaderboard[0];
      for (const member of season.club.members) {
        const playerRank = leaderboard.find((p) => p.userId === member.userId);
        const rankText = playerRank
          ? `You're #${playerRank.rank} with ${playerRank.totalScore} pts`
          : "Check your standings";

        await notificationService.createNotification(member.userId, {
          type: "weekly_standings",
          title: `${season.club.name} Weekly Update`,
          body: `${leader.displayName} leads with ${leader.totalScore} pts. ${rankText}.`,
          data: { clubId: season.clubId, seasonId: season.id },
        });
        count++;
      }
    } catch (err) {
      console.error(`[Cron] Weekly standings failed for season ${season.id}:`, err.message);
    }
  }

  return count;
}

/**
 * Send season-ending-soon reminders (Section 10.2).
 * Triggers at 7 days and 1 day before season end.
 */
async function sendSeasonEndingReminders() {
  const prisma = require("../config/database");
  const notificationService = require("../services/notificationService");

  const now = new Date();
  const oneDay = 24 * 60 * 60 * 1000;
  const sevenDays = 7 * oneDay;

  // Find seasons ending in ~7 days or ~1 day
  const endingSoons = await prisma.season.findMany({
    where: {
      status: "ACTIVE",
      endDate: { not: null },
    },
    include: {
      club: {
        include: {
          members: {
            where: { leftAt: null },
            select: { userId: true },
          },
        },
      },
    },
  });

  let count = 0;
  for (const season of endingSoons) {
    if (!season.endDate) continue;

    const timeUntilEnd = season.endDate.getTime() - now.getTime();
    let reminderType = null;

    if (timeUntilEnd > 0 && timeUntilEnd <= oneDay + 3600000 && timeUntilEnd > oneDay - 3600000) {
      reminderType = "1_day";
    } else if (timeUntilEnd > 0 && timeUntilEnd <= sevenDays + 3600000 && timeUntilEnd > sevenDays - 3600000) {
      reminderType = "7_days";
    }

    if (!reminderType) continue;

    const daysText = reminderType === "1_day" ? "tomorrow" : "in 7 days";

    for (const member of season.club.members) {
      try {
        await notificationService.createNotification(member.userId, {
          type: "season_ending",
          title: `${season.club.name} season ending ${daysText}`,
          body: `The current season ends ${daysText}. Play your final games!`,
          data: {
            clubId: season.clubId,
            seasonId: season.id,
            daysRemaining: reminderType === "1_day" ? 1 : 7,
          },
        });
        count++;
      } catch (err) {
        // Skip individual failures
      }
    }
  }

  return count;
}

module.exports = { initCronJobs };
