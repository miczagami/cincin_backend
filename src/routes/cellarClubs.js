/**
 * Phase 3: Cellar Club Routes
 *
 * REST API endpoints for Cellar Club management.
 * Complements the WebSocket layer for real-time game operations.
 *
 * Timeline: Weeks 11–13
 */

const express = require("express");
const router = express.Router();
const cellarClubService = require("../services/cellarClubService");
const { requireAuth, requireAgeVerified } = require("../middleware/auth");
const { validate, createClubRules, joinClubRules, startSeasonRules } = require("../validators/cellarClub");

// All club routes require auth + age verification
router.use(requireAuth, requireAgeVerified);

// ═══════════════════════════════════════════
//  CLUB CRUD
// ═══════════════════════════════════════════

// POST /api/clubs — create a new Cellar Club
router.post("/", createClubRules, validate, async (req, res, next) => {
  try {
    const club = await cellarClubService.createClub(req.user.id, req.body);
    res.status(201).json(club);
  } catch (err) { next(err); }
});

// GET /api/clubs — list user's clubs
router.get("/", async (req, res, next) => {
  try {
    const clubs = await cellarClubService.listUserClubs(req.user.id);
    res.json(clubs);
  } catch (err) { next(err); }
});

// GET /api/clubs/:clubId — get club details
router.get("/:clubId", async (req, res, next) => {
  try {
    const club = await cellarClubService.getClub(req.params.clubId, req.user.id);
    res.json(club);
  } catch (err) { next(err); }
});

// PATCH /api/clubs/:clubId — update club settings (admin)
router.patch("/:clubId", async (req, res, next) => {
  try {
    const club = await cellarClubService.updateClub(req.params.clubId, req.user.id, req.body);
    res.json(club);
  } catch (err) { next(err); }
});

// POST /api/clubs/:clubId/archive — archive club (admin)
router.post("/:clubId/archive", async (req, res, next) => {
  try {
    const club = await cellarClubService.archiveClub(req.params.clubId, req.user.id);
    res.json(club);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════
//  MEMBERSHIP
// ═══════════════════════════════════════════

// POST /api/clubs/join — join via invite code
router.post("/join", joinClubRules, validate, async (req, res, next) => {
  try {
    const result = await cellarClubService.joinClub(req.user.id, req.body.inviteCode);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/clubs/:clubId/leave — leave a club
router.post("/:clubId/leave", async (req, res, next) => {
  try {
    const result = await cellarClubService.leaveClub(req.params.clubId, req.user.id);
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/clubs/:clubId/members/:userId — admin removes a member
router.delete("/:clubId/members/:userId", async (req, res, next) => {
  try {
    const result = await cellarClubService.removeMember(
      req.params.clubId, req.user.id, req.params.userId
    );
    res.json(result);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════
//  GAME APPROVAL
// ═══════════════════════════════════════════

// POST /api/clubs/:clubId/games/:gameId/tag — tag game to club
router.post("/:clubId/games/:gameId/tag", async (req, res, next) => {
  try {
    const result = await cellarClubService.tagGameToClub(
      req.params.gameId, req.user.id, req.params.clubId
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/clubs/:clubId/games/:gameId/approve — admin approves game
router.post("/:clubId/games/:gameId/approve", async (req, res, next) => {
  try {
    const result = await cellarClubService.approveGame(req.params.gameId, req.user.id);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/clubs/:clubId/games/:gameId/reject — admin rejects game
router.post("/:clubId/games/:gameId/reject", async (req, res, next) => {
  try {
    const result = await cellarClubService.rejectGame(req.params.gameId, req.user.id);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/clubs/:clubId/games/pending — get pending games for approval
router.get("/:clubId/games/pending", async (req, res, next) => {
  try {
    const games = await cellarClubService.getPendingGames(req.params.clubId, req.user.id);
    res.json(games);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════
//  SEASONS
// ═══════════════════════════════════════════

// GET /api/clubs/:clubId/leaderboard — current season leaderboard
router.get("/:clubId/leaderboard", async (req, res, next) => {
  try {
    const club = await cellarClubService.getClub(req.params.clubId, req.user.id);
    if (!club.activeSeason) {
      return res.json({ leaderboard: [], message: "No active season" });
    }
    const leaderboard = await cellarClubService.getSeasonLeaderboard(
      req.params.clubId, club.activeSeason.id
    );
    res.json({ leaderboard, season: club.activeSeason });
  } catch (err) { next(err); }
});

// GET /api/clubs/:clubId/seasons — season history
router.get("/:clubId/seasons", async (req, res, next) => {
  try {
    const seasons = await cellarClubService.getSeasonHistory(req.params.clubId, req.user.id);
    res.json(seasons);
  } catch (err) { next(err); }
});

// POST /api/clubs/:clubId/seasons/:seasonId/end — end current season (admin)
router.post("/:clubId/seasons/:seasonId/end", async (req, res, next) => {
  try {
    const result = await cellarClubService.endSeason(
      req.params.clubId, req.params.seasonId, req.user.id
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/clubs/:clubId/seasons — start new season (admin)
router.post("/:clubId/seasons", startSeasonRules, validate, async (req, res, next) => {
  try {
    const season = await cellarClubService.startNewSeason(
      req.params.clubId, req.user.id, req.body
    );
    res.status(201).json(season);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════
//  ACTIVITY FEED
// ═══════════════════════════════════════════

// GET /api/clubs/:clubId/activity — activity feed
router.get("/:clubId/activity", async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const feed = await cellarClubService.getActivityFeed(
      req.params.clubId, req.user.id, { limit, offset }
    );
    res.json(feed);
  } catch (err) { next(err); }
});

module.exports = router;
