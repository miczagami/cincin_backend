# CinCin Backend — Phase 3

Real-time multiplayer and Cellar Club system for the CinCin AI tasting game.

## What's Included

### Phase 1 — Foundation (unchanged)
- Prisma schema (17 models → 18 in Phase 3)
- Auth: email/password, Google/Apple social login, JWT tokens
- Age verification: Onfido/Jumio SDK integration with mock provider
- AI pipeline: vision scan, bottle matching, tasting note sourcing, taxonomy
- User profile, privacy controls, data export

### Phase 2 — Core Game (unchanged)
- Pass-the-phone gameplay loop with guest players
- 3-pass guess evaluation (exact → taxonomy → AI)
- Results screen with unified leaderboard and share tokens
- Offline game support with replay-based sync
- Game history (Pro only)

### Phase 3 — Multiplayer & Cellar Clubs (NEW)

#### Real-Time Infrastructure (Weeks 10–11)
- Socket.io WebSocket server on same port as Express
- JWT-authenticated WebSocket connections
- Game room management (join, leave, reconnect)
- Simultaneous round orchestration with server-side timers
- Delayed reveal: claimed notes broadcast without attribution, then private results per player
- 3-second inter-round pause for result absorption

#### Multi-Device & Remote (Weeks 11–12)
- Join-by-code flow with WebSocket lobby sync
- Simultaneous guess submission within round timer
- Auto-skip for non-submitting players when timer expires
- Disconnection handling: 2-minute reconnect window (Section 4.9)
- Host disconnect pauses game, auto-ends after 2 minutes
- Player disconnect auto-skips each round, score frozen after timeout
- Reconnection restores active status and syncs current state

#### Cellar Club Core (Weeks 11–13)
- Club creation with auto-generated invite code and first season
- Join via 6-digit code or invite link
- Email verification required for club operations (Section 7.2)
- Free tier: max 1 club. Pro: unlimited
- Admin can update settings, remove members, archive club
- Members can leave voluntarily (historical scores preserved)

#### Season & Approval (Weeks 12–13)
- Game tagging to club (post-completion)
- Admin approval workflow with push notification
- Approved games contribute cumulative scores to season leaderboard
- Season end: final standings snapshot, awards calculation, member notifications
- Awards: Champion, Sharpest Palate (best avg), Iron Stomach (most games)
- Admin can start new season with same or modified settings, or archive club
- Season history preserved and accessible

#### Club Activity Feed (Week 13)
- Activity types: game submitted/approved/rejected, member joined/left/removed, season started/ended
- Paginated feed per club

## API Reference

### Auth (Phase 1)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/signup` | Register |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/social` | Social login |
| POST | `/api/auth/refresh` | Refresh token |
| POST | `/api/auth/password-reset/request` | Request reset |
| POST | `/api/auth/password-reset` | Reset password |
| POST | `/api/auth/logout` | Logout |

### Age Verification (Phase 1)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/age-verify/initiate` | Start verification |
| POST | `/api/auth/age-verify/webhook` | Provider callback |
| GET | `/api/auth/age-verify/status` | Check status |
| POST | `/api/auth/age-verify/manual` | Dev-only manual verify |

### Scanning (Phase 1)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scan/label` | Camera label scan |
| POST | `/api/scan/barcode` | Barcode scan |
| GET | `/api/scan/search?q=` | Text search |
| POST | `/api/scan/confirm/:bottleId` | Confirm bottle |
| POST | `/api/scan/source-notes/:bottleId` | Source notes |
| GET | `/api/scan/taxonomy` | Flavour taxonomy tree |
| GET | `/api/scan/taxonomy/search?q=` | Search flavours |

### Users (Phase 1)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/me` | Get profile |
| PATCH | `/api/users/me` | Update profile |
| PATCH | `/api/users/me/notifications` | Update notification prefs |
| GET | `/api/users/me/export` | Export data (GDPR) |
| POST | `/api/users/me/anonymise` | Anonymise data |
| DELETE | `/api/users/me` | Delete account |

### Games (Phase 1 + 2 + 3)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/games` | Create game |
| POST | `/api/games/join` | Join via game code |
| POST | `/api/games/:id/start` | Start game (host) |
| GET | `/api/games/:id/state` | Get current game state |
| POST | `/api/games/:id/guess` | Submit guess |
| POST | `/api/games/:id/opt-out` | Opt out |
| POST | `/api/games/:id/advance` | Next turn/round (host) |
| POST | `/api/games/:id/auto-skip` | Auto-skip on timer expiry |
| POST | `/api/games/:id/end` | End game (host) |
| GET | `/api/games/:id/results` | Get results |
| POST | `/api/games/:id/guests` | Add guest player |
| DELETE | `/api/games/:id/guests/:guestId` | Remove guest player |
| GET | `/api/games/history` | Game history (Pro only) |
| GET | `/api/games/shared/:shareToken` | View shared results (public) |
| POST | `/api/games/offline-sync` | Sync offline game |

### Bottles (Phase 2)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bottles/:id` | Bottle details (no notes) |
| GET | `/api/bottles/:id/cache` | Bottle + notes for offline cache |

### Cellar Clubs (Phase 3 — NEW)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/clubs` | Create club |
| GET | `/api/clubs` | List user's clubs |
| GET | `/api/clubs/:id` | Get club details |
| PATCH | `/api/clubs/:id` | Update club (admin) |
| POST | `/api/clubs/:id/archive` | Archive club (admin) |
| POST | `/api/clubs/join` | Join via invite code |
| POST | `/api/clubs/:id/leave` | Leave club |
| DELETE | `/api/clubs/:id/members/:userId` | Remove member (admin) |
| POST | `/api/clubs/:id/games/:gameId/tag` | Tag game to club |
| POST | `/api/clubs/:id/games/:gameId/approve` | Approve game (admin) |
| POST | `/api/clubs/:id/games/:gameId/reject` | Reject game (admin) |
| GET | `/api/clubs/:id/games/pending` | Pending games (admin) |
| GET | `/api/clubs/:id/leaderboard` | Season leaderboard |
| GET | `/api/clubs/:id/seasons` | Season history |
| POST | `/api/clubs/:id/seasons/:seasonId/end` | End season (admin) |
| POST | `/api/clubs/:id/seasons` | Start new season (admin) |
| GET | `/api/clubs/:id/activity` | Activity feed |

### WebSocket Events (Phase 3 — NEW)
| Event | Direction | Description |
|-------|-----------|-------------|
| `game:join` | Client → Server | Join game room |
| `game:leave` | Client → Server | Leave game room |
| `game:start` | Client → Server | Host starts game |
| `game:guess` | Client → Server | Submit guess (multi-device) |
| `game:opt-out` | Client → Server | Opt out (multi-device) |
| `game:end` | Client → Server | Host ends game |
| `game:ping` | Client → Server | Heartbeat |
| `game:player-joined` | Server → Room | Player joined lobby |
| `game:player-left` | Server → Room | Player left |
| `game:started` | Server → Room | Game started |
| `game:round-start` | Server → Room | New round with timer |
| `game:player-submitted` | Server → Room | Player submitted guess |
| `game:round-reveal` | Server → Room | Round results (no attribution) |
| `game:my-round-result` | Server → Player | Private result for this player |
| `game:player-opted-out` | Server → Room | Player opted out |
| `game:ended` | Server → Room | Game ended with results |
| `game:player-disconnected` | Server → Room | Player disconnected |
| `game:player-reconnected` | Server → Room | Player reconnected |
| `game:player-frozen` | Server → Room | Player didn't reconnect in time |
| `game:host-disconnected` | Server → Room | Host disconnected (game pauses) |
| `game:guess-result` | Server → Player | Private guess result |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (Redis + phase indicator) |

## Project Structure

```
cincin-backend/
├── .github/workflows/
│   └── ci.yml                      # CI/CD pipeline
├── prisma/
│   ├── schema.prisma               # Database schema (18 models — +1 in Phase 3)
│   ├── migrations/
│   │   ├── 20260309_phase2_core_game/
│   │   │   └── migration.sql
│   │   └── 20260309_phase3_multiplayer_clubs/
│   │       └── migration.sql       # 🆕 Phase 3 migration
│   └── seed.js                     # Sample data (8 bottles, 4 users, 1 club)
├── src/
│   ├── config/
│   │   ├── index.js                # App configuration (+ WS, club settings)
│   │   ├── database.js             # Prisma client singleton
│   │   ├── redis.js                # Redis client + cache helpers
│   │   └── socketServer.js         # 🆕 Socket.io WebSocket server
│   ├── middleware/
│   │   ├── auth.js                 # JWT auth, role & tier checks
│   │   └── errorHandler.js
│   ├── routes/
│   │   ├── auth.js                 # Auth endpoints
│   │   ├── ageVerify.js            # Age verification endpoints
│   │   ├── scan.js                 # Scanning & AI pipeline endpoints
│   │   ├── users.js                # User profile endpoints
│   │   ├── games.js                # Game lifecycle (updated: WS broadcasts)
│   │   ├── bottles.js              # Bottle cache endpoints
│   │   └── cellarClubs.js          # 🆕 Cellar Club endpoints (15 routes)
│   ├── services/
│   │   ├── authService.js          # Sign up, login, tokens
│   │   ├── ageVerifyService.js     # Onfido/Jumio integration
│   │   ├── scanService.js          # Vision AI, note sourcing, taxonomy
│   │   ├── userService.js          # Profile, privacy controls
│   │   ├── gameService.js          # Game creation, gameplay, scoring
│   │   └── cellarClubService.js    # 🆕 Club CRUD, membership, seasons, approval
│   ├── validators/
│   │   ├── auth.js
│   │   ├── game.js
│   │   └── cellarClub.js           # 🆕 Club validation rules
│   ├── utils/
│   │   └── helpers.js
│   ├── app.js                      # Express app (+ clubs route)
│   └── server.js                   # Entry point (+ Socket.io init)
├── .env.example                    # Updated with Phase 3 vars
├── .gitignore
├── package.json                    # v0.3.0, + socket.io dep
├── PHASE3-CHANGELOG.md             # 🆕 This changelog
└── README.md                       # 🆕 This file
```

## Next Phases

- [ ] **Phase 4 (Weeks 14–17):** Palate Profile dashboard, Stripe subscriptions, Buy tab, discovery feed, notifications
- [ ] **Phase 5 (Weeks 18–20):** PWA optimisation, offline hardening, QA, beta, launch
