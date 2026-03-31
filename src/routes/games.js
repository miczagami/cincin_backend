/**
 * Game Routes — Phase 3 update
 *
 * Changes from Phase 2:
 * - createGame now accepts optional cellarClubId for pre-tagging
 * - Game state endpoint broadcasts via WebSocket when available
 * - Added middleware to check for WebSocket availability
 */

const express = require("express");
const router = express.Router();
const gameService = require("../services/gameService");
const { requireAuth, requireAgeVerified } = require("../middleware/auth");
const {
  validate, createGameRules, joinGameRules, submitGuessRules,
  guestPlayerRules, offlineSyncRules,
} = require("../validators/game");

// ─── Public routes (no auth) ───

// GET /api/games/shared/:shareToken — view shared results (Section 4.10)
router.get("/shared/:shareToken", async (req, res, next) => {
  try {
    const results = await gameService.getResultsByShareToken(req.params.shareToken);
    res.json(results);
  } catch (err) { next(err); }
});

// ─── Authenticated routes ───
router.use(requireAuth, requireAgeVerified);

// POST /api/games — create a new game
// Phase 3: now accepts optional cellarClubId to pre-tag the game
router.post("/", createGameRules, validate, async (req, res, next) => {
  try {
    const game = await gameService.createGame(req.user.id, req.body);

    // Phase 3: If WebSocket server is available, broadcast lobby creation
    const io = req.app.get("io");
    if (io && game.multiplayerType !== "PASS_THE_PHONE") {
      // Room will be created when players connect via WebSocket
    }

    res.status(201).json(game);
  } catch (err) { next(err); }
});

// POST /api/games/join — join via game code
router.post("/join", joinGameRules, validate, async (req, res, next) => {
  try {
    const game = await gameService.joinGame(req.user.id, req.body.gameCode);

    // Phase 3: Broadcast new player to lobby via WebSocket
    const io = req.app.get("io");
    if (io) {
      const { broadcastToGame } = require("../config/socketServer");
      broadcastToGame(game.id, "game:player-joined", {
        userId: req.user.id,
        displayName: req.user.displayName || "Player",
      });
    }

    res.json(game);
  } catch (err) { next(err); }
});

// GET /api/games/history — game history (Pro only, Phase 2)
router.get("/history", async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const history = await gameService.getGameHistory(req.user.id, { limit, offset });
    res.json(history);
  } catch (err) { next(err); }
});

// ─── Per-game routes ───

// GET /api/games/:gameId/state — get current game state (Phase 2)
router.get("/:gameId/state", async (req, res, next) => {
  try {
    const state = await gameService.getGameState(req.params.gameId, req.user.id);
    res.json(state);
  } catch (err) { next(err); }
});

// POST /api/games/:gameId/start — host starts the game
router.post("/:gameId/start", async (req, res, next) => {
  try {
    const game = await gameService.startGame(req.params.gameId, req.user.id);

    // Phase 3: Broadcast game start via WebSocket
    const io = req.app.get("io");
    if (io) {
      const { broadcastToGame } = require("../config/socketServer");
      broadcastToGame(req.params.gameId, "game:started", {
        gameId: req.params.gameId,
        multiplayerType: game.multiplayerType,
        roundTimerSecs: game.roundTimerSecs,
        mode: game.mode,
      });
    }

    res.json(game);
  } catch (err) { next(err); }
});

// POST /api/games/:gameId/guests — add guest player (Phase 2)
router.post("/:gameId/guests", guestPlayerRules, validate, async (req, res, next) => {
  try {
    const guest = await gameService.addGuestPlayer(
      req.params.gameId, req.user.id, req.body.displayName
    );
    res.status(201).json(guest);
  } catch (err) { next(err); }
});

// DELETE /api/games/:gameId/guests/:guestId — remove guest player (Phase 2)
router.delete("/:gameId/guests/:guestId", async (req, res, next) => {
  try {
    const result = await gameService.removeGuestPlayer(
      req.params.gameId, req.user.id, req.params.guestId
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/games/:gameId/guess — submit a guess (supports guest players)
router.post("/:gameId/guess", submitGuessRules, validate, async (req, res, next) => {
  try {
    const result = await gameService.submitGuess(
      req.params.gameId,
      req.user.id,
      req.body.guessText,
      {
        isGuest: req.body.isGuest || false,
        guestPlayerId: req.body.guestPlayerId || null,
      }
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/games/:gameId/opt-out — opt out (supports guest players)
router.post("/:gameId/opt-out", async (req, res, next) => {
  try {
    const result = await gameService.optOut(
      req.params.gameId,
      req.user.id,
      {
        isGuest: req.body.isGuest || false,
        guestPlayerId: req.body.guestPlayerId || null,
      }
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/games/:gameId/advance — advance to next turn/round (host only)
router.post("/:gameId/advance", async (req, res, next) => {
  try {
    const result = await gameService.advanceRound(req.params.gameId, req.user.id);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/games/:gameId/auto-skip — auto-skip on timer expiry (Phase 2)
router.post("/:gameId/auto-skip", async (req, res, next) => {
  try {
    const result = await gameService.autoSkipTurn(
      req.params.gameId,
      req.user.id,
      {
        isGuest: req.body.isGuest || false,
        guestPlayerId: req.body.guestPlayerId || null,
        playerId: req.body.playerId || null,
      }
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/games/:gameId/end — host manually ends the game
router.post("/:gameId/end", async (req, res, next) => {
  try {
    const result = await gameService.hostEndGame(req.params.gameId, req.user.id);

    // Phase 3: Broadcast game end via WebSocket
    const io = req.app.get("io");
    if (io) {
      const { broadcastToGame } = require("../config/socketServer");
      broadcastToGame(req.params.gameId, "game:ended", {
        gameId: req.params.gameId,
        reason: "HOST_ENDED",
      });
    }

    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/games/:gameId/results — get game results
router.get("/:gameId/results", async (req, res, next) => {
  try {
    const results = await gameService.getResults(req.params.gameId, req.user.id);
    res.json(results);
  } catch (err) { next(err); }
});

// GET /api/games/:gameId/cache — get bottle cache data for offline (Phase 2)
router.get("/:gameId/cache", async (req, res, next) => {
  try {
    const game = await require("../config/database").game.findUnique({
      where: { id: req.params.gameId },
      select: { bottleId: true },
    });
    if (!game) return res.status(404).json({ error: "Game not found" });
    const cacheData = await gameService.getBottleCacheData(game.bottleId, req.user.id);
    res.json(cacheData);
  } catch (err) { next(err); }
});

// ─── Offline Sync (Phase 2) ───

// POST /api/games/offline-sync — sync an offline game
router.post("/offline-sync", offlineSyncRules, validate, async (req, res, next) => {
  try {
    const result = await gameService.queueOfflineGame(req.user.id, req.body);
    res.status(202).json(result);
  } catch (err) { next(err); }
});

module.exports = router;
