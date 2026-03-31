# CinCin Backend — Phase 2: Core Game

## Overview

Node.js + Express backend for the CinCin AI tasting game. Phase 2 adds the complete pass-the-phone gameplay loop, results screen, offline game support, and game history.

## API Endpoints

### Auth (Phase 1 ✅)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/signup` | Register with email/password |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/social` | Google/Apple social login |
| POST | `/api/auth/refresh` | Refresh access token |
| POST | `/api/auth/password-reset/request` | Request password reset |
| POST | `/api/auth/password-reset` | Reset password with token |
| POST | `/api/auth/logout` | Logout |

### Age Verification (Phase 1 ✅)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/age-verify/initiate` | Start verification |
| POST | `/api/auth/age-verify/webhook` | Provider callback |
| GET | `/api/auth/age-verify/status` | Check verification status |
| POST | `/api/auth/age-verify/manual` | Dev-only manual verify |

### Scanning & AI Pipeline (Phase 1 ✅)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scan/label` | Camera label scan |
| POST | `/api/scan/barcode` | Barcode scan |
| GET | `/api/scan/search?q=` | Manual text search |
| POST | `/api/scan/confirm/:bottleId` | Confirm bottle selection |
| POST | `/api/scan/source-notes/:bottleId` | Trigger tasting note sourcing |
| GET | `/api/scan/taxonomy` | Get flavour taxonomy tree |
| GET | `/api/scan/taxonomy/search?q=` | Search flavours (autocomplete) |

### Users (Phase 1 ✅)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/me` | Get profile |
| PATCH | `/api/users/me` | Update profile |
| PATCH | `/api/users/me/notifications` | Update notification prefs |
| GET | `/api/users/me/export` | Export all data (GDPR) |
| POST | `/api/users/me/anonymise` | Anonymise data |
| DELETE | `/api/users/me` | Delete account |

### Bottles (Phase 2 🆕)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bottles/:id` | Get bottle details (no notes) |
| GET | `/api/bottles/:id/cache` | Get bottle + notes for offline cache |

### Games (Phase 1 ✅ + Phase 2 🆕)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/games` | Create game (now supports guestPlayerNames) |
| POST | `/api/games/join` | Join via game code |
| POST | `/api/games/:id/start` | Start game (host) |
| GET | `/api/games/:id/state` | 🆕 Get current game state (turn info, claimed notes) |
| POST | `/api/games/:id/guess` | Submit guess (now supports guest players) |
| POST | `/api/games/:id/opt-out` | Opt out (now supports guest players) |
| POST | `/api/games/:id/advance` | Next turn/round (host) — now handles pass-the-phone turns |
| POST | `/api/games/:id/auto-skip` | 🆕 Auto-skip on timer expiry |
| POST | `/api/games/:id/end` | End game (host) |
| GET | `/api/games/:id/results` | Get results (now includes guest players) |
| POST | `/api/games/:id/guests` | 🆕 Add guest player to pass-the-phone game |
| DELETE | `/api/games/:id/guests/:guestId` | 🆕 Remove guest player from lobby |
| GET | `/api/games/history` | 🆕 Game history (Pro only) |
| GET | `/api/games/shared/:shareToken` | 🆕 View shared results (public, no auth) |
| POST | `/api/games/offline-sync` | 🆕 Sync offline game to server |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (includes Redis status) |

## Project Structure

```
cincin-backend/
├── .github/workflows/
│   └── ci.yml                  # CI/CD pipeline
├── prisma/
│   ├── schema.prisma           # Database schema (17 models — +2 in Phase 2)
│   ├── migrations/
│   │   └── 20260309_phase2_core_game/
│   │       └── migration.sql   # 🆕 Phase 2 migration
│   └── seed.js                 # Sample data (7 bottles, 3 test users, expanded taxonomy)
├── src/
│   ├── config/
│   │   ├── index.js            # App configuration (updated with Phase 2 settings)
│   │   ├── database.js         # Prisma client singleton
│   │   └── redis.js            # Redis client + cache helpers
│   ├── middleware/
│   │   ├── auth.js             # JWT auth, role & tier checks
│   │   └── errorHandler.js
│   ├── routes/
│   │   ├── auth.js             # Auth endpoints
│   │   ├── ageVerify.js        # Age verification endpoints
│   │   ├── scan.js             # Scanning & AI pipeline endpoints
│   │   ├── users.js            # User profile endpoints
│   │   ├── games.js            # Game lifecycle endpoints (major Phase 2 update)
│   │   └── bottles.js          # 🆕 Bottle cache endpoints
│   ├── services/
│   │   ├── authService.js      # Sign up, login, tokens
│   │   ├── ageVerifyService.js # Onfido/Jumio integration
│   │   ├── scanService.js      # Vision AI, note sourcing, taxonomy
│   │   ├── userService.js      # Profile, privacy controls
│   │   └── gameService.js      # Game creation, gameplay, scoring (major Phase 2 update)
│   ├── validators/
│   │   ├── auth.js
│   │   └── game.js             # Updated with Phase 2 validation rules
│   ├── utils/
│   │   └── helpers.js          # Scoring calc, game codes, stats (Phase 2 additions)
│   ├── app.js                  # Express app setup (updated with bottles route)
│   └── server.js               # Entry point
├── .env.example                # Updated with Phase 2 vars
├── .gitignore
├── package.json
└── README.md
```

## Phase 1 Foundation — Coverage ✅

### Architecture & Infra (Weeks 1–2) ✅
- Database schema: 15 models across all 9 domains
- API scaffolding: Express routes, services, validators, middleware
- Environment config: `.env.example` with all required variables
- Redis config: session caching, cache helpers, graceful fallback
- CI/CD: GitHub Actions pipeline (lint → test → migrate → deploy)

### Auth & Age Verification (Weeks 2–3) ✅
- Email/password signup + login with bcrypt
- Google/Apple social login flow
- JWT access + refresh tokens with session management
- Password reset flow
- Age verification SDK integration (Onfido + Jumio providers)
- Modular provider pattern — swap providers without touching routes
- Mock provider for development/testing
- Webhook callback processing (pass/fail + DOB only, no ID images stored)
- Region-dependent age requirements (AU/NZ 18+, US 21+)

### AI Pipeline v1 (Weeks 1–4) ✅
- Multi-provider vision API (Anthropic Claude, OpenAI GPT-4o, Google Vision)
- Label recognition → bottle identification with confidence scoring
- Confidence states: HIGH (≥80%), MEDIUM (50–79%), LOW (<50%), NONE
- Bottle matching engine (exact match, fuzzy match, scoring, alternatives)
- Barcode scan with database lookup
- Manual text search with autocomplete
- Tasting note sourcing engine (producer > critic > AI-synthesised priority)
- LLM-powered note synthesis for bottles with thin coverage
- Note deduplication with highest-tier retention
- Flavour taxonomy data model (curated tree, 8 top-level categories)
- Taxonomy search for guess autocomplete
- Scan confirmation screen data (reveal-proof — notes never exposed)
- Free-tier scan limit enforcement (5/month) with monthly reset
- Seed data: 5 AU bottles, 35+ tasting notes, full taxonomy tree

## Phase 2 Core Game — Coverage ✅

### Bottle Scanning UI Backend (Week 5–6) ✅
- All three scan methods already implemented in Phase 1
- Added: `GET /api/bottles/:id` for bottle detail view
- Added: `GET /api/bottles/:id/cache` for offline caching with tasting notes

### Game Setup (Week 5–6) ✅
- Pass-the-phone game creation with guest player names
- Guest player model — non-account participants in pass-the-phone games
- Add/remove guest players in lobby (`POST/DELETE /api/games/:id/guests`)
- Game configuration enforcement (free tier gets defaults, Pro gets custom)
- Share token generation at game creation for results sharing

### Pass-the-Phone Gameplay Loop (Week 6–8) ✅
- Turn tracking — `currentTurnOrder` and `currentTurnPlayerId` on game model
- Sequential turn advancement through ordered player list (registered + guests)
- Interstitial data — claimed notes list without player attribution (Section 3.1.1)
- `GET /api/games/:id/state` — full game state for rendering gameplay UI
- Guess evaluation engine (3-pass):
  1. Exact match (case-insensitive)
  2. Generic category match via taxonomy parent-child relationships
  3. AI evaluation for synonyms, regional terms, alt spellings (Anthropic/OpenAI)
- Scoring engine: generic/specific × producer/critic tiers (Appendix B)
- Opt-out mechanic for both registered and guest players (Section 4.5)
- Auto-skip endpoint for timer expiry (0 points, Section 4.4)
- Round timer warning at 10 seconds (client-side, config provided)
- Game end conditions: all opted out, all notes claimed, max rounds, host ended
- Competitive mode: claimed notes locked out from other players

### Results Screen (Week 8–9) ✅
- Full tasting note reveal with source tier tags (producer/critic/AI)
- Per-player guess breakdown with round numbers
- Unified leaderboard (registered + guest players sorted by score)
- Comparison overlay data (hits, misses, unclaimed notes)
- Bottle info with affiliate links
- Share via token: `GET /api/games/shared/:shareToken` (public, no auth)
- Game stats calculation (MVP, accuracy, precision leader)
- Play-again flow (client creates new game with same bottle)

### Offline Game Support (Week 8–9) ✅
- `GET /api/bottles/:id/cache` — bottle + notes for encrypted client storage
- `POST /api/games/offline-sync` — queue offline game for server-side replay
- Offline sync queue model with status tracking (PENDING → PROCESSING → COMPLETED/FAILED)
- Offline game replay engine — processes rounds and guesses sequentially
- Marks synced games with `createdOffline` flag and `syncedAt` timestamp

### Game History (Phase 2) ✅
- `GET /api/games/history` — paginated game history (Pro only, Section 13)
- Returns: bottle, score, rank, total players, date for each game

### Palate Profile Updates (Phase 2) ✅
- After every game, each registered player's palate stats are updated
- Categorises guesses by generic flavour category via taxonomy
- Upserts accuracy data per category per user
- Foundation for Phase 4 Palate Profile dashboard

## Next Phases

- [ ] **Phase 3 (Weeks 10–13):** WebSocket real-time multiplayer, Cellar Club routes, seasons, game approval
- [ ] **Phase 4 (Weeks 14–17):** Palate Profile dashboard, Stripe subscriptions, Buy tab, notifications
- [ ] **Phase 5 (Weeks 18–20):** PWA optimisation, offline hardening, QA, beta, launch
