/**
 * Phase 3: WebSocket Server (Socket.io)
 *
 * Real-time multiplayer infrastructure for multi-device and remote games.
 * Handles: game rooms, lobby management, simultaneous round orchestration,
 * state sync, disconnection handling (2-min reconnect window).
 *
 * Timeline: Weeks 10–12
 */

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const config = require("./index");
const prisma = require("./database");
const { getRedisClient, isRedisConnected } = require("./redis");

let io = null;

// ─── Active game room state (in-memory + Redis backed) ───
// Key: gameId → { players: Map<socketId, playerInfo>, timers: {}, roundState: {} }
const gameRooms = new Map();

// ─── Disconnection tracking ───
// Key: `${gameId}:${userId}` → { timeout, disconnectedAt }
const disconnectTimers = new Map();

const RECONNECT_WINDOW_MS = 2 * 60 * 1000; // 2 minutes per Section 4.9

/**
 * Initialise Socket.io on the HTTP server.
 * Called from server.js after Express is listening.
 */
function initSocketServer(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin,
      credentials: true,
    },
    pingInterval: 10000,
    pingTimeout: 5000,
    transports: ["websocket", "polling"],
  });

  // ─── Auth middleware: verify JWT before allowing connection ───
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
        || socket.handshake.headers?.authorization?.replace("Bearer ", "");

      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = jwt.verify(token, config.jwtSecret);
      if (decoded.type !== "access") {
        return next(new Error("Authentication failed"));
      }
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, displayName: true, subscriptionTier: true, ageVerified: true },
      });

      if (!user || !user.ageVerified) {
        return next(new Error("Invalid or unverified user"));
      }

      socket.userId = user.id;
      socket.displayName = user.displayName;
      socket.subscriptionTier = user.subscriptionTier;
      next();
    } catch (err) {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`[WS] Connected: ${socket.userId} (${socket.id})`);

    // ── Join game room (lobby or in-progress) ──
    socket.on("game:join", async (data, ack) => {
      try {
        const { gameId } = data;
        const result = await handleJoinRoom(socket, gameId);
        if (ack) ack({ success: true, ...result });
      } catch (err) {
        console.error("[WS] game:join error:", err.message);
        if (ack) ack({ success: false, error: err.message });
      }
    });

    // ── Leave game room ──
    socket.on("game:leave", async (data) => {
      try {
        const { gameId } = data;
        await handleLeaveRoom(socket, gameId);
      } catch (err) {
        console.error("[WS] game:leave error:", err.message);
      }
    });

    // ── Host starts game ──
    socket.on("game:start", async (data, ack) => {
      try {
        const { gameId } = data;
        const result = await handleStartGame(socket, gameId);
        if (ack) ack({ success: true, ...result });
      } catch (err) {
        console.error("[WS] game:start error:", err.message);
        if (ack) ack({ success: false, error: err.message });
      }
    });

    // ── Submit guess (multi-device simultaneous) ──
    socket.on("game:guess", async (data, ack) => {
      try {
        const { gameId, guessText } = data;
        const result = await handleGuess(socket, gameId, guessText);
        if (ack) ack({ success: true, ...result });
      } catch (err) {
        console.error("[WS] game:guess error:", err.message);
        if (ack) ack({ success: false, error: err.message });
      }
    });

    // ── Opt out (multi-device) ──
    socket.on("game:opt-out", async (data, ack) => {
      try {
        const { gameId } = data;
        const result = await handleOptOut(socket, gameId);
        if (ack) ack({ success: true, ...result });
      } catch (err) {
        console.error("[WS] game:opt-out error:", err.message);
        if (ack) ack({ success: false, error: err.message });
      }
    });

    // ── Host ends game ──
    socket.on("game:end", async (data, ack) => {
      try {
        const { gameId } = data;
        const result = await handleHostEnd(socket, gameId);
        if (ack) ack({ success: true, ...result });
      } catch (err) {
        console.error("[WS] game:end error:", err.message);
        if (ack) ack({ success: false, error: err.message });
      }
    });

    // ── Heartbeat / ping ──
    socket.on("game:ping", async (data) => {
      const { gameId } = data;
      // Update lastPingAt for disconnect detection
      if (gameId && socket.userId) {
        await prisma.gamePlayer.updateMany({
          where: { gameId, userId: socket.userId },
          data: { lastPingAt: new Date() },
        }).catch(() => {}); // non-critical
      }
    });

    // ── Disconnect handling ──
    socket.on("disconnect", async (reason) => {
      console.log(`[WS] Disconnected: ${socket.userId} (${reason})`);
      await handleDisconnect(socket, reason);
    });
  });

  console.log("[WS] Socket.io server initialised");
  return io;
}

// ═══════════════════════════════════════════
//  ROOM MANAGEMENT
// ═══════════════════════════════════════════

/**
 * Handle player joining a game room.
 * Supports both lobby joins and reconnections to in-progress games.
 */
async function handleJoinRoom(socket, gameId) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: { include: { user: { select: { id: true, displayName: true } } } },
      guestPlayers: true,
    },
  });

  if (!game) throw new Error("Game not found");

  // Check if reconnecting to an in-progress game
  const reconnectKey = `${gameId}:${socket.userId}`;
  if (disconnectTimers.has(reconnectKey)) {
    clearTimeout(disconnectTimers.get(reconnectKey).timeout);
    disconnectTimers.delete(reconnectKey);

    // Mark player as reconnected
    await prisma.gamePlayer.updateMany({
      where: { gameId, userId: socket.userId },
      data: {
        status: "ACTIVE",
        reconnectedAt: new Date(),
        socketId: socket.id,
      },
    });

    socket.join(`game:${gameId}`);
    io.to(`game:${gameId}`).emit("game:player-reconnected", {
      userId: socket.userId,
      displayName: socket.displayName,
    });

    console.log(`[WS] Player reconnected: ${socket.userId} to game ${gameId}`);
    return { reconnected: true, gameState: await getGameRoomState(gameId) };
  }

  // New join — check lobby status
  if (game.status === "LOBBY") {
    // Check if already joined via REST API (player record exists)
    const existingPlayer = game.players.find((p) => p.userId === socket.userId);
    if (existingPlayer) {
      // Update socket ID
      await prisma.gamePlayer.update({
        where: { id: existingPlayer.id },
        data: { socketId: socket.id },
      });
    }
    // If not yet a player, they need to join via REST first, then connect WS

    socket.join(`game:${gameId}`);
    io.to(`game:${gameId}`).emit("game:player-joined", {
      userId: socket.userId,
      displayName: socket.displayName,
      playerCount: game.players.length + game.guestPlayers.length,
    });

    return { joined: true, lobby: await getLobbyState(gameId) };
  }

  if (game.status === "IN_PROGRESS") {
    // Late join not allowed for in-progress games (except reconnection above)
    throw new Error("Game already in progress");
  }

  throw new Error("Game is not joinable");
}

/**
 * Handle player leaving a game room.
 */
async function handleLeaveRoom(socket, gameId) {
  socket.leave(`game:${gameId}`);
  io.to(`game:${gameId}`).emit("game:player-left", {
    userId: socket.userId,
    displayName: socket.displayName,
  });
}

// ═══════════════════════════════════════════
//  GAME LIFECYCLE (Multi-device)
// ═══════════════════════════════════════════

/**
 * Host starts the game — transitions from LOBBY to IN_PROGRESS.
 * Kicks off the first round for multi-device games.
 */
async function handleStartGame(socket, gameId) {
  const gameService = require("../services/gameService");
  const game = await gameService.startGame(gameId, socket.userId);

  if (game.multiplayerType !== "PASS_THE_PHONE") {
    // Multi-device/remote: gameService.startGame already created round 1 — open it now
    await beginRound(gameId, 1);
  }

  io.to(`game:${gameId}`).emit("game:started", {
    gameId,
    multiplayerType: game.multiplayerType,
    roundTimerSecs: game.roundTimerSecs,
    mode: game.mode,
  });

  return { started: true };
}

/**
 * Start a new simultaneous round for multi-device games.
 * All active players get the round timer and submit within it.
 */
async function startNewRound(gameId) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { players: true },
  });

  if (!game || game.status !== "IN_PROGRESS") return;

  const newRoundNumber = game.currentRound + 1;

  // Check max rounds
  if (newRoundNumber > game.maxRounds) {
    await endGame(gameId, "MAX_ROUNDS_REACHED");
    return;
  }

  await prisma.round.create({
    data: { gameId, roundNumber: newRoundNumber },
  });

  await beginRound(gameId, newRoundNumber);
}

/**
 * Open an existing round: reset submissions, broadcast round-start, and arm the round timer.
 */
async function beginRound(gameId, roundNumber) {
  const game = await prisma.game.update({
    where: { id: gameId },
    data: {
      currentRound: roundNumber,
      roundStartedAt: new Date(),
      roundSubmissions: 0,
    },
    include: { players: true },
  });

  const round = await prisma.round.findFirst({ where: { gameId, roundNumber } });

  // Get claimed notes for reveal-proof display
  const gameService = require("../services/gameService");
  const gameState = await gameService.getGameState(gameId, game.hostId);

  io.to(`game:${gameId}`).emit("game:round-start", {
    roundNumber,
    roundId: round?.id,
    timerSecs: game.roundTimerSecs,
    claimedNotes: gameState.claimedNotes || [],
    activePlayers: game.players.filter((p) => p.status === "ACTIVE").length,
  });

  // Set round timer — auto-skip and reveal when timer expires
  const roundTimerMs = game.roundTimerSecs * 1000;
  setTimeout(async () => {
    await handleRoundTimeout(gameId, roundNumber);
  }, roundTimerMs);
}

/**
 * Handle a guess submission in multi-device mode.
 * Uses the existing gameService.submitGuess for evaluation.
 */
async function handleGuess(socket, gameId, guessText) {
  const gameService = require("../services/gameService");

  const result = await gameService.submitGuess(gameId, socket.userId, guessText, {
    isGuest: false,
    guestPlayerId: null,
  });

  // Track submission count
  const game = await prisma.game.update({
    where: { id: gameId },
    data: { roundSubmissions: { increment: 1 } },
    include: { players: { where: { status: "ACTIVE" } } },
  });

  // Send private result to the submitting player only
  socket.emit("game:guess-result", {
    ...result,
    private: true, // only this player sees their own result
  });

  // Notify room that a player has submitted (without revealing what)
  io.to(`game:${gameId}`).emit("game:player-submitted", {
    userId: socket.userId,
    submissionsCount: game.roundSubmissions,
    totalActive: game.players.length,
  });

  // Check if all active players have submitted
  if (game.roundSubmissions >= game.players.length) {
    await revealRoundResults(gameId, game.currentRound);
  }

  return result;
}

/**
 * Handle opt-out in multi-device mode.
 */
async function handleOptOut(socket, gameId) {
  const gameService = require("../services/gameService");
  const result = await gameService.optOut(gameId, socket.userId, {
    isGuest: false,
    guestPlayerId: null,
  });

  // Increment submission count (opt-out counts as a submission for the round)
  const game = await prisma.game.update({
    where: { id: gameId },
    data: { roundSubmissions: { increment: 1 } },
    include: { players: { where: { status: "ACTIVE" } } },
  });

  io.to(`game:${gameId}`).emit("game:player-opted-out", {
    userId: socket.userId,
    displayName: socket.displayName,
  });

  // Check if all active players submitted or opted out
  const activePlayers = game.players.filter((p) => p.status === "ACTIVE");
  if (activePlayers.length === 0) {
    await endGame(gameId, "ALL_OPTED_OUT");
  } else if (game.roundSubmissions >= activePlayers.length + 1) {
    // +1 because the opt-out player was active when we queried but just opted out
    await revealRoundResults(gameId, game.currentRound);
  }

  return result;
}

/**
 * Handle host manually ending the game.
 */
async function handleHostEnd(socket, gameId) {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game || game.hostId !== socket.userId) {
    throw new Error("Only the host can end the game");
  }

  await endGame(gameId, "HOST_ENDED");
  return { ended: true };
}

// ═══════════════════════════════════════════
//  ROUND MANAGEMENT
// ═══════════════════════════════════════════

/**
 * When the round timer expires, auto-skip any players who haven't submitted
 * and reveal results.
 */
async function handleRoundTimeout(gameId, roundNumber) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { players: { where: { status: "ACTIVE" } } },
  });

  // Guard: game might have ended or moved to next round
  if (!game || game.status !== "IN_PROGRESS" || game.currentRound !== roundNumber) {
    return;
  }

  const round = await prisma.round.findFirst({
    where: { gameId, roundNumber },
    include: { guesses: true },
  });

  // Already revealed (everyone submitted before the timer ran out)
  if (!round || round.endedAt) return;

  // Auto-skip players who didn't submit
  const submittedPlayerIds = new Set(round.guesses.map((g) => g.gamePlayerId));
  const gameService = require("../services/gameService");

  for (const player of game.players) {
    if (!submittedPlayerIds.has(player.id)) {
      await gameService.autoSkipTurn(gameId, game.hostId, {
        isGuest: false,
        playerId: player.id,
      }).catch(() => {}); // non-critical if already ended
    }
  }

  await revealRoundResults(gameId, roundNumber);
}

/**
 * Reveal round results to all players simultaneously (delayed reveal).
 * Per Section 4.6: reveal which notes were claimed but not by whom.
 */
async function revealRoundResults(gameId, roundNumber) {
  const round = await prisma.round.findFirst({
    where: { gameId, roundNumber },
    include: {
      guesses: {
        include: { tastingNote: { select: { note: true, genericNote: true } } },
      },
      guestGuesses: {
        include: { tastingNote: { select: { note: true, genericNote: true } } },
      },
    },
  });

  if (!round || round.endedAt) return;

  // End the round
  await prisma.round.update({
    where: { id: round.id },
    data: { endedAt: new Date() },
  });

  // Build reveal data — notes claimed this round (without attribution)
  const claimedThisRound = [...round.guesses, ...round.guestGuesses]
    .filter((g) => g.isCorrect && g.tastingNote)
    .map((g) => ({
      note: g.tastingNote.note,
      genericNote: g.tastingNote.genericNote,
      isSpecific: g.isSpecific,
    }));

  // Get current scoreboard
  const gameService = require("../services/gameService");
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: { include: { user: { select: { displayName: true } } } },
      guestPlayers: true,
    },
  });

  const scoreboard = [
    ...game.players.map((p) => ({
      userId: p.userId,
      displayName: p.user.displayName,
      score: p.totalScore,
      status: p.status,
      isGuest: false,
    })),
    ...game.guestPlayers.map((g) => ({
      guestPlayerId: g.id,
      displayName: g.displayName,
      score: g.totalScore,
      status: g.status,
      isGuest: true,
    })),
  ].sort((a, b) => b.score - a.score);

  // Send public round results to all
  io.to(`game:${gameId}`).emit("game:round-reveal", {
    roundNumber,
    claimedThisRound,
    scoreboard: game.scoreboardVisible ? scoreboard : null,
    totalClaimedNotes: claimedThisRound.length, // always shown
  });

  // Send each player their private result
  for (const guess of round.guesses) {
    const player = game.players.find((p) => p.id === guess.gamePlayerId);
    if (player?.socketId) {
      io.to(player.socketId).emit("game:my-round-result", {
        roundNumber,
        guessText: guess.guessText,
        isCorrect: guess.isCorrect,
        isSpecific: guess.isSpecific,
        pointsAwarded: guess.pointsAwarded,
        matchedNote: guess.tastingNote?.note || null,
      });
    }
  }

  // Check game end conditions
  const gameState = await gameService.getGameState(gameId, game.hostId);

  if (gameState.allNotesClaimed && game.mode === "COMPETITIVE") {
    await endGame(gameId, "ALL_NOTES_CLAIMED");
    return;
  }

  // Auto-advance to next round after a brief delay
  setTimeout(() => startNewRound(gameId), 3000);
}

/**
 * End the game and broadcast results.
 */
async function endGame(gameId, reason) {
  const gameService = require("../services/gameService");

  try {
    await gameService.endGame(gameId, reason);
  } catch (err) {
    // Game may already be ended
    console.warn(`[WS] endGame warning: ${err.message}`);
  }

  const results = await gameService.getResults(gameId, null).catch(() => null);

  io.to(`game:${gameId}`).emit("game:ended", {
    gameId,
    reason,
    results,
  });

  // Clean up room state
  gameRooms.delete(gameId);
}

// ═══════════════════════════════════════════
//  DISCONNECT HANDLING (Section 4.9)
// ═══════════════════════════════════════════

/**
 * Handle socket disconnection.
 * Starts 2-minute reconnect timer for in-progress games.
 */
async function handleDisconnect(socket, reason) {
  // Find all games this user is currently in
  const activeGames = await prisma.gamePlayer.findMany({
    where: {
      userId: socket.userId,
      status: "ACTIVE",
      game: { status: "IN_PROGRESS" },
    },
    include: { game: true },
  });

  for (const gp of activeGames) {
    const gameId = gp.gameId;
    const reconnectKey = `${gameId}:${socket.userId}`;

    // Mark as disconnected
    await prisma.gamePlayer.update({
      where: { id: gp.id },
      data: {
        status: "DISCONNECTED",
        disconnectedAt: new Date(),
        socketId: null,
      },
    });

    // If host disconnected, pause the game for all players
    if (gp.game.hostId === socket.userId) {
      io.to(`game:${gameId}`).emit("game:host-disconnected", {
        message: "Host disconnected. Waiting 2 minutes for reconnection...",
        reconnectDeadline: new Date(Date.now() + RECONNECT_WINDOW_MS).toISOString(),
      });
    } else {
      io.to(`game:${gameId}`).emit("game:player-disconnected", {
        userId: socket.userId,
        displayName: socket.displayName,
        reconnectDeadline: new Date(Date.now() + RECONNECT_WINDOW_MS).toISOString(),
      });
    }

    // Start 2-minute reconnect timer
    const timeout = setTimeout(async () => {
      disconnectTimers.delete(reconnectKey);

      // Freeze the player
      await prisma.gamePlayer.updateMany({
        where: { gameId, userId: socket.userId, status: "DISCONNECTED" },
        data: { status: "FROZEN" },
      });

      if (gp.game.hostId === socket.userId) {
        // Host didn't reconnect — end game
        await endGame(gameId, "HOST_DISCONNECTED");
      } else {
        io.to(`game:${gameId}`).emit("game:player-frozen", {
          userId: socket.userId,
          displayName: socket.displayName,
          message: "Player did not reconnect. Score frozen.",
        });
      }
    }, RECONNECT_WINDOW_MS);

    disconnectTimers.set(reconnectKey, {
      timeout,
      disconnectedAt: new Date(),
    });
  }
}

// ═══════════════════════════════════════════
//  STATE HELPERS
// ═══════════════════════════════════════════

/**
 * Get current lobby state for a game.
 */
async function getLobbyState(gameId) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } },
      guestPlayers: { select: { id: true, displayName: true, playerOrder: true } },
      host: { select: { id: true, displayName: true } },
    },
  });

  if (!game) return null;

  return {
    gameId: game.id,
    gameCode: game.gameCode,
    hostId: game.hostId,
    hostName: game.host.displayName,
    status: game.status,
    multiplayerType: game.multiplayerType,
    mode: game.mode,
    roundTimerSecs: game.roundTimerSecs,
    maxRounds: game.maxRounds,
    lobbyExpiresAt: game.lobbyExpiresAt,
    players: game.players.map((p) => ({
      userId: p.userId,
      displayName: p.user.displayName,
      avatarUrl: p.user.avatarUrl,
      isHost: p.userId === game.hostId,
      isGuest: false,
    })),
    guestPlayers: game.guestPlayers.map((g) => ({
      guestPlayerId: g.id,
      displayName: g.displayName,
      isGuest: true,
    })),
  };
}

/**
 * Get in-progress game room state (for reconnections).
 */
async function getGameRoomState(gameId) {
  const gameService = require("../services/gameService");
  try {
    // Use the host as context user (game state is the same for all in multi-device)
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) return null;
    return await gameService.getGameState(gameId, game.hostId);
  } catch {
    return null;
  }
}

/**
 * Broadcast to a specific game room.
 */
function broadcastToGame(gameId, event, data) {
  if (io) {
    io.to(`game:${gameId}`).emit(event, data);
  }
}

/**
 * Send to a specific socket.
 */
function sendToSocket(socketId, event, data) {
  if (io) {
    io.to(socketId).emit(event, data);
  }
}

/**
 * Get the Socket.io instance.
 */
function getIO() {
  return io;
}

module.exports = {
  initSocketServer,
  broadcastToGame,
  sendToSocket,
  getIO,
  getLobbyState,
};
