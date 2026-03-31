const prisma = require("../config/database");
const config = require("../config");
const { AppError } = require("../utils/helpers");

// ═══════════════════════════════════════════════════════════════
//  COMMERCE & AFFILIATE SERVICE — Phase 4
//  Timeline ref: Weeks 15–17
//  Spec ref: Sections 8.3, 8.4
//
//  Two sub-systems:
//    1. Buy Tab — scanned bottle history with affiliate links,
//       click-through tracking, pricing display
//    2. Discovery Feed — mixed sponsored + organic content,
//       location/preference-based serving
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════
//  BUY TAB (Section 8.4)
// ═══════════════════════════════════════════

/**
 * Get the Buy Tab for a user — all scanned bottles with affiliate links.
 * Sorted by most recently scanned. Includes pricing and "Buy Again" shortcut.
 */
async function getBuyTab(userId, { limit = 20, offset = 0 } = {}) {
  // Get bottles the user has scanned
  const scans = await prisma.bottleScan.findMany({
    where: { userId, bottleId: { not: null } },
    distinct: ["bottleId"],
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
    include: {
      bottle: {
        select: {
          id: true,
          name: true,
          producer: true,
          vintage: true,
          region: true,
          category: true,
          subcategory: true,
          imageUrl: true,
          affiliateLinks: {
            select: {
              id: true,
              partner: true,
              url: true,
              price: true,
              currency: true,
            },
          },
        },
      },
    },
  });

  const totalScanned = await prisma.bottleScan.groupBy({
    by: ["bottleId"],
    where: { userId, bottleId: { not: null } },
    _count: true,
  });

  return {
    bottles: scans.map((scan) => ({
      bottleId: scan.bottle.id,
      name: scan.bottle.name,
      producer: scan.bottle.producer,
      vintage: scan.bottle.vintage,
      region: scan.bottle.region,
      category: scan.bottle.category,
      subcategory: scan.bottle.subcategory,
      imageUrl: scan.bottle.imageUrl,
      lastScanned: scan.createdAt,
      affiliateLinks: scan.bottle.affiliateLinks,
    })),
    total: totalScanned.length,
    limit,
    offset,
  };
}

/**
 * Get affiliate links for a specific bottle.
 * Used on scan confirmation screen and game results screen (contextual placement).
 */
async function getBottleAffiliateLinks(bottleId) {
  const links = await prisma.affiliateLink.findMany({
    where: { bottleId },
    select: {
      id: true,
      partner: true,
      url: true,
      price: true,
      currency: true,
    },
  });

  return links;
}

/**
 * Track an affiliate link click (Section 8.4: 3–7% commission tracking).
 *
 * @param {string} userId - may be null for unauthenticated clicks
 * @param {string} affiliateLinkId
 * @param {string} source - 'buy_tab' | 'scan_confirm' | 'game_results'
 */
async function trackAffiliateClick(userId, affiliateLinkId, source = "buy_tab") {
  const link = await prisma.affiliateLink.findUnique({
    where: { id: affiliateLinkId },
    select: { id: true, bottleId: true, partner: true, url: true },
  });

  if (!link) throw new AppError("Affiliate link not found", 404);

  await prisma.affiliateClick.create({
    data: {
      userId,
      affiliateLinkId: link.id,
      bottleId: link.bottleId,
      partner: link.partner,
      source,
    },
  });

  return { url: link.url };
}

// ═══════════════════════════════════════════
//  DISCOVERY FEED (Section 8.3)
// ═══════════════════════════════════════════

/**
 * Get the discovery feed — mixed sponsored and organic content.
 * Sponsored content is served based on user location, drink preferences,
 * and game history (Section 8.3).
 * Free users see ads; Pro users see ad-free experience (Section 8.1).
 */
async function getDiscoveryFeed(userId, { limit = 20, offset = 0 } = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionTier: true,
      location: true,
      drinkPreferences: true,
    },
  });

  const now = new Date();

  // Get organic content
  const organicItems = await prisma.discoveryFeedItem.findMany({
    where: {
      isActive: true,
      startDate: { lte: now },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: limit,
    skip: offset,
    include: {
      bottle: {
        select: {
          id: true,
          name: true,
          producer: true,
          imageUrl: true,
          category: true,
        },
      },
    },
  });

  let feed = organicItems.map((item) => ({
    id: item.id,
    type: item.type,
    isSponsored: false,
    title: item.title,
    subtitle: item.subtitle,
    imageUrl: item.imageUrl || item.bottle?.imageUrl,
    bottle: item.bottle,
    linkUrl: item.linkUrl,
    data: item.data,
  }));

  // Insert sponsored content for free users (Section 8.1: ads in discovery feed)
  if (user?.subscriptionTier !== "PRO") {
    const sponsoredItems = await getSponsoredContent(user, limit);

    // Interleave sponsored items (roughly 1 sponsored per 4 organic)
    const merged = [];
    let orgIdx = 0;
    let sponIdx = 0;
    let count = 0;

    while (orgIdx < feed.length || sponIdx < sponsoredItems.length) {
      // Insert a sponsored item every 4th position
      if (count > 0 && count % 4 === 0 && sponIdx < sponsoredItems.length) {
        merged.push(sponsoredItems[sponIdx++]);
      } else if (orgIdx < feed.length) {
        merged.push(feed[orgIdx++]);
      } else if (sponIdx < sponsoredItems.length) {
        merged.push(sponsoredItems[sponIdx++]);
      }
      count++;
    }

    feed = merged;
  }

  return { items: feed.slice(0, limit), total: feed.length };
}

/**
 * Get targeted sponsored content based on user profile.
 */
async function getSponsoredContent(user, limit = 5) {
  const now = new Date();

  const where = {
    isActive: true,
    startDate: { lte: now },
    OR: [{ endDate: null }, { endDate: { gte: now } }],
  };

  // Target by drink preferences if available
  if (user?.drinkPreferences?.length > 0) {
    where.targetDrinkTypes = { hasSome: user.drinkPreferences };
  }

  // Target by region if available
  if (user?.location) {
    // Simplified region matching — would use geolocation in production
    where.targetRegions = { hasSome: [user.location, "ALL"] };
  }

  const sponsored = await prisma.sponsoredTasting.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      bottle: {
        select: {
          id: true,
          name: true,
          producer: true,
          imageUrl: true,
          category: true,
        },
      },
    },
  });

  // Track impressions
  for (const item of sponsored) {
    await prisma.sponsoredTasting.update({
      where: { id: item.id },
      data: { impressions: { increment: 1 } },
    }).catch(() => {}); // non-blocking
  }

  return sponsored.map((item) => ({
    id: item.id,
    type: "sponsored",
    isSponsored: true,
    title: item.headline,
    subtitle: item.description,
    imageUrl: item.imageUrl || item.bottle?.imageUrl,
    bottle: item.bottle,
    badgeText: item.badgeText,
    doublePoints: item.doublePoints,
    brandName: item.brandName,
  }));
}

/**
 * Track a sponsored tasting game start.
 * Called when a user starts a game from a sponsored tasting in the discovery feed.
 */
async function trackSponsoredGameStart(sponsoredTastingId) {
  await prisma.sponsoredTasting.update({
    where: { id: sponsoredTastingId },
    data: { gameStarts: { increment: 1 } },
  }).catch((err) => {
    console.error("[Commerce] Sponsored game start tracking failed:", err.message);
  });
}

module.exports = {
  // Buy Tab
  getBuyTab,
  getBottleAffiliateLinks,
  trackAffiliateClick,
  // Discovery Feed
  getDiscoveryFeed,
  trackSponsoredGameStart,
};
