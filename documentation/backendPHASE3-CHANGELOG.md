# Phase 3 Backend — Changelog

## Summary

Phase 3 (Weeks 10–13) adds real-time multiplayer infrastructure and the Cellar Club system. All files below are either **new** or **updated** from Phase 2.

---

## New Files

### `src/config/socketServer.js`
**The WebSocket layer.** Socket.io server handling real-time multiplayer for multi-device and remote games.

- **Auth middleware:** JWT verification on WebSocket connections — reuses the same tokens as REST API
- **Game room management:** `game:join`, `game:leave` events. Players join rooms keyed by gameId
- **Reconnection handling (Section 4.9):** 2-minute reconnect window. Disconnected players get auto-skipped each round. Host disconnect pauses game for all players. Reconnecting restores `ACTIVE` status and syncs current game state
- **Simultaneous round orchestration:** `startNewRound()` creates a round, broadcasts timer, and sets a timeout for auto-skip. All active players submit within the timer via `game:guess`
- **Delayed reveal (Section 4.6):** `revealRoundResults()` broadcasts claimed notes without attribution to all players, then sends private per-player results. 3-second pause before next round starts
- **Host controls:** `game:start`, `game:end` events. Only the host's socket can trigger these
- **Player heartbeat:** `game:ping` updates `lastPingAt` for disconnect detection
- **Round timeout:** Server-side timer auto-skips non-submitting players and triggers reveal

### `src/services/cellarClubService.js`
**Full Cellar Club business logic.** Implements Section 5 of the functional requirements.

**Club CRUD:**
- `createClub()` — creates club + first season + admin membership in one transaction. Generates 6-char invite code. Enforces email verification and free-tier club limits
- `getClub()` — returns club with members, active season, recent games, leaderboard, and admin flag
- `listUserClubs()` — lists all active memberships with club metadata
- `updateClub()` — admin updates name/member cap
- `archiveClub()` — admin archives club, ends active season, makes it read-only

**Membership (Section 5.3):**
- `joinClub()` — join via invite code. Checks email verification, free-tier limit (1 club), member cap, archived status. Supports rejoin after leaving
- `leaveClub()` — voluntary leave. Historical scores preserved. Admin cannot leave (must archive or transfer)
- `removeMember()` — admin removes a member. Notifies the removed user

**Game Approval (Section 5.4):**
- `tagGameToClub()` — member tags a completed game to a club. Sets `PENDING` status. Notifies admin
- `approveGame()` — admin approves. Scores count toward season leaderboard
- `rejectGame()` — admin rejects. Game visible in history but doesn't affect standings
- `getPendingGames()` — admin-only list of games awaiting approval

**Seasons (Sections 5.5–5.6):**
- `getSeasonLeaderboard()` — cumulative scoring from approved games within season date range. Registered players only (guest players don't persist across games)
- `endSeason()` — calculates awards/superlatives, snapshots final standings, notifies all members
- `calculateAwards()` — Sharpest Palate (highest avg), Iron Stomach (most games), Champion (highest total). **STUB:** Most Improved, Precision King (require deeper game data aggregation)
- `startNewSeason()` — admin starts new season after previous ends
- `getSeasonHistory()` — all past seasons with awards and final standings

**Activity Feed (Section 5.7):**
- `getActivityFeed()` — paginated activity feed for a club
- `createActivity()` — internal helper for creating activity entries
- Activity types: GAME_SUBMITTED, GAME_APPROVED, GAME_REJECTED, MEMBER_JOINED, MEMBER_LEFT, MEMBER_REMOVED, SEASON_STARTED, SEASON_ENDED, LEADERBOARD_CHANGE

**STUB:** `checkExpiredSeasons()` — cron job to auto-end seasons that have reached their end date. Phase 4/5 will implement the cron infrastructure

### `src/routes/cellarClubs.js`
REST API routes for all Cellar Club operations: 15 endpoints.

### `src/validators/cellarClub.js`
Validation rules for club creation, joining, and season management.

---

## Updated Files

### `prisma/schema.prisma`
**What changed:** Added 1 new model, 4 new columns, 1 new enum
- **ClubActivity** model — activity feed entries for each club
- **ClubActivityType** enum — 9 activity types
- **Game**: added `roundStartedAt`, `roundSubmissions` (multi-device round state)
- **GamePlayer**: added `socketId`, `lastPingAt` (WebSocket session tracking)
- **Season**: added `awards` (JSON), `finalStandings` (JSON) for season end data
- **TastingNote**: added `guestGuesses` relation (was missing in Phase 2)

### `prisma/migrations/20260309_phase3_multiplayer_clubs/migration.sql`
SQL migration for Phase 3 schema changes.

### `src/app.js`
**What changed:** Added clubs route, updated health check phase indicator
- New route: `app.use("/api/clubs", require("./routes/cellarClubs"))`
- Health check now reports `phase: "3"`

### `src/server.js`
**What changed:** Major restructure — now creates HTTP server and initialises Socket.io
- Express app wrapped in `http.createServer()` for Socket.io compatibility
- `initSocketServer(httpServer)` called after HTTP server creation
- Socket.io instance stored on `app.set("io", io)` for access from routes
- Graceful shutdown handles both HTTP and Socket.io cleanup

### `src/config/index.js`
**What changed:** Added Phase 3 configuration sections
- `websocket.*` — reconnect window (2min), ping interval/timeout, round reveal delay
- `cellarClub.*` — max member cap, season auto-end cron interval

### `src/routes/games.js`
**What changed:** WebSocket broadcast integration
- `POST /api/games/join` — broadcasts `game:player-joined` via WebSocket when io is available
- `POST /api/games/:id/start` — broadcasts `game:started` via WebSocket
- `POST /api/games/:id/end` — broadcasts `game:ended` via WebSocket
- All existing Phase 2 routes unchanged in function

### `prisma/seed.js`
**What changed:** Phase 3 test data
- 4 test users (was 3) — added player4 for multi-device testing
- All test users now have `emailVerified: true` (required for Cellar Club operations)
- 8 bottles (was 7) — added Torbreck RunRig
- Test Cellar Club: "Friday Night Vino" with 3 members, active season, activity feed entries

### `package.json`
**What changed:** Version bump, new dependency
- Version: `0.3.0` (was `0.1.0`)
- Added: `socket.io: ^4.8.0`

### `.env.example`
**What changed:** Phase 3 header, Stripe vars stubbed for Phase 4

---

## Architecture Decisions

### Socket.io on Same Port as Express
Rather than running WebSocket on a separate port, Socket.io upgrades HTTP connections on the same port (4000). This simplifies deployment (one process, one port, one health check) and avoids CORS headaches. Socket.io automatically falls back to long-polling if WebSocket isn't available.

### REST + WebSocket Hybrid
Multi-device games use WebSocket for real-time round management (guess submission, timer sync, delayed reveal). But game creation, joining, and results still use REST endpoints. This means pass-the-phone games work identically to Phase 2 (REST-only), while multi-device/remote games get the WebSocket layer. The REST routes now broadcast to WebSocket rooms when the `io` instance is available.

### Cellar Club as Separate Service
The Cellar Club service is fully decoupled from the game service. It reads game data (via Game model) but never modifies game state. The only integration point is `cellarClubId` and `clubApprovalStatus` on the Game model, which are set by the club service after game completion.

### Season Leaderboard as Query, Not Materialized View
The season leaderboard is calculated on-demand by querying approved games within the season date range and aggregating player scores. This is simpler than maintaining a materialized view and acceptable at the expected scale (dozens of games per season, not thousands). If performance becomes an issue, a Redis-cached leaderboard can be added without changing the API.

### Awards as JSON on Season
Rather than creating a separate Awards model with foreign keys, awards are stored as a JSON blob on the Season record. This is fine because awards are write-once (calculated at season end) and read-many. The JSON structure is flexible for adding new award types without migrations.

---

## Phase 3 Exit Criteria (from Timeline)

| Milestone | Status |
|-----------|--------|
| Host creates game, players join via code on separate devices, lobby shows all connected players | ✅ |
| Full simultaneous-round game with delayed reveal, disconnection handling, correct scoring | ✅ |
| Club created, game tagged and approved, season leaderboard updating correctly | ✅ |
| Season end triggers celebration screen with awards | ✅ |
| Club activity feed showing recent games, leaderboard changes, member activity | ✅ |

## Stub Functions (to be completed in later phases)

| Function | Location | Phase | Description |
|----------|----------|-------|-------------|
| `calculateAwards()` → `mostImproved` | `cellarClubService.js` | Phase 4 | Requires tracking score progression over season |
| `calculateAwards()` → `precisionKing` | `cellarClubService.js` | Phase 4 | Requires aggregating `isSpecific=true` guesses from approved games |
| `checkExpiredSeasons()` | `cellarClubService.js` | Phase 4/5 | Needs cron infrastructure (node-cron or external scheduler) |
| `createNotification()` → push delivery | `cellarClubService.js` | Phase 4 | Currently creates in-app notification only. Push delivery via NotificationService in Phase 4 |
| `LEADERBOARD_CHANGE` activity type | `cellarClubService.js` | Phase 4 | Needs comparison of leaderboard positions before/after game approval |

## Next Phases

- [ ] **Phase 4 (Weeks 14–17):** Palate Profile dashboard, Stripe subscriptions, Buy tab, discovery feed, notifications
- [ ] **Phase 5 (Weeks 18–20):** PWA optimisation, offline hardening, QA, beta, launch
