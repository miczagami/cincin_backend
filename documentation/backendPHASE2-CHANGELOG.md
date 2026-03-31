# Phase 2 Backend — Changelog

## Summary

Phase 2 (Weeks 5–9) completes the core game backend: pass-the-phone gameplay loop, results screen, offline game support, and game history. All files below are either **new** or **updated** from Phase 1.

---

## Updated Files

### `prisma/schema.prisma`
**What changed:** Added 3 new models, 5 new columns on `Game`, 1 new column on `Guess`
- **GuestPlayer** model — non-account participants for pass-the-phone mode
- **GuestGuess** model — guesses by guest players (separate from registered Guess)
- **OfflineSyncQueue** model — queue for replaying offline games on the server
- **Game**: added `currentTurnPlayerId`, `currentTurnOrder` (pass-the-phone turn tracking), `createdOffline`, `syncedAt` (offline sync), `shareToken` (results sharing)
- **Guess**: added `aiEvaluation` JSON field (stores AI reasoning for free-text matches)
- **TastingNote**: added relation to GuestGuess

### `src/services/gameService.js`
**What changed:** Major expansion — from 8 exports to 16
- `createGame` — now accepts `guestPlayerNames` for pass-the-phone, generates `shareToken`
- `addGuestPlayer` / `removeGuestPlayer` — 🆕 manage non-account players in lobby
- `startGame` — now initialises `currentTurnOrder` for pass-the-phone
- `getGameState` — 🆕 returns full game state (turn info, claimed notes, scoreboard) without revealing tasting notes
- `submitGuess` — now supports guest players via `isGuest`/`guestPlayerId` params; 3-pass evaluation engine (exact → taxonomy → AI)
- `evaluateGuess` — 🆕 internal: 3-pass guess evaluation with taxonomy lookup and AI fallback
- `evaluateGuessWithAI` — 🆕 internal: LLM-powered synonym/regional term matching
- `matchViaTaxonomy` — 🆕 internal: parent-child flavour taxonomy matching
- `optOut` — now supports guest players
- `advanceRound` — rewritten to handle pass-the-phone turn sequencing (player-by-player within each round)
- `autoSkipTurn` — 🆕 records 0-point skip on timer expiry
- `getResults` — expanded with unified leaderboard (registered + guests), round numbers on guesses
- `getResultsByShareToken` — 🆕 public access to shared results
- `getGameHistory` — 🆕 paginated game history (Pro only)
- `updatePalateStats` — 🆕 post-game palate profile stat updates
- `queueOfflineGame` / `processOfflineGame` — 🆕 offline game sync pipeline
- `getBottleCacheData` — 🆕 bottle + notes data for offline client cache

### `src/routes/games.js`
**What changed:** From 8 routes to 16 routes
- Added: `GET /shared/:shareToken` (public, no auth)
- Added: `GET /:gameId/state`
- Added: `POST /:gameId/guests` and `DELETE /:gameId/guests/:guestId`
- Added: `POST /:gameId/auto-skip`
- Added: `GET /history`
- Added: `POST /offline-sync`
- Updated: `POST /:gameId/guess` and `POST /:gameId/opt-out` now accept `isGuest`/`guestPlayerId`

### `src/validators/game.js`
**What changed:** Added 3 new validation rule sets
- `guestPlayerRules` — validates guest player display name
- `offlineSyncRules` — validates offline sync payload structure
- Updated `createGameRules` — added `guestPlayerNames` array validation
- Updated `submitGuessRules` — added `isGuest` and `guestPlayerId` fields

### `src/config/index.js`
**What changed:** Added Phase 2 configuration keys
- `game.maxGuestPlayers` — 20 max guest players per game
- `game.offlineSyncMaxAge` — 7-day max age for offline sync queue items
- `aiGuessEval.minConfidence` — 0.7 threshold for AI guess match acceptance
- `aiGuessEval.timeoutMs` — 5-second timeout for AI evaluation calls

### `src/utils/helpers.js`
**What changed:** Added 2 new utility functions
- `generateShareToken()` — crypto-safe token for results sharing
- `calculateGameStats()` — compute game stats (MVP, accuracy, precision leader)

### `src/app.js`
**What changed:** Added bottles route
- New route: `app.use("/api/bottles", require("./routes/bottles"))`
- Health check now reports `phase: "2"`

### `prisma/seed.js`
**What changed:** Expanded test data
- 3 test users (host + 2 players) with age verification
- 7 bottles (up from 5) with 55+ tasting notes
- Expanded flavour taxonomy with more specific variants
- Better structured for testing pass-the-phone with guest players

### `.env.example`
**What changed:** Added `SHARE_BASE_URL` for share link generation

### `README.md`
**What changed:** Complete rewrite documenting Phase 2 coverage

---

## New Files

### `src/routes/bottles.js`
Bottle detail and cache data endpoints for the offline support feature.
- `GET /api/bottles/:id` — bottle details without tasting notes (reveal-proof)
- `GET /api/bottles/:id/cache` — full bottle data including notes for offline encrypted storage

### `prisma/migrations/20260309_phase2_core_game/migration.sql`
SQL migration for Phase 2 schema changes. Adds guest_players, guest_guesses, offline_sync_queue tables and new columns on games/guesses.

---

## Architecture Decisions

### Guest Players vs Shared Accounts
Pass-the-phone games need non-account players. Rather than relaxing the auth requirement, we created a `GuestPlayer` model that belongs to the game only. Guest players have no persistent identity — their data lives and dies with the game. This preserves the account requirement for all durable features (Cellar Club, Palate Profile, game history) while making pass-the-phone frictionless.

### 3-Pass Guess Evaluation
The guess evaluation engine uses a tiered approach to balance accuracy and cost:
1. **Exact match** — free, instant, most common
2. **Taxonomy match** — free, instant, handles "cherry" → "Rainier cherry" relationships
3. **AI evaluation** — costs API call, ~1-2s latency, handles synonyms and regional terms

The AI evaluation only fires when passes 1 and 2 fail, keeping costs low. The confidence threshold (0.7) prevents false positives.

### Offline Sync as Replay
Rather than trying to reconcile an offline game state with the server, we take the simpler approach of replaying the offline game server-side. The client sends the full game payload, and the server creates a new game and processes each round sequentially. This ensures all server-side validation, scoring, and palate profile updates happen correctly.

### Share Tokens
Each game gets a unique share token at creation. The `GET /api/games/shared/:shareToken` endpoint requires no auth, making it suitable for social sharing. The share URL format is `https://app.getcincin.com/game/results/shared/{token}`.
