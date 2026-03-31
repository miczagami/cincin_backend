# CinCin Backend API

AI-powered tasting game — Phase 1 Foundation complete.

## Stack

- **Runtime:** Node.js + Express
- **Database:** PostgreSQL + Prisma ORM
- **Cache:** Redis (optional, graceful fallback)
- **Auth:** JWT (access + refresh tokens), bcrypt, Onfido/Jumio age verification
- **AI:** Multi-provider vision API (Anthropic/OpenAI/Google Vision) + LLM tasting note synthesis
- **Validation:** express-validator
- **Security:** helmet, cors, express-rate-limit
- **CI/CD:** GitHub Actions (lint → test → migrate → deploy)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL, JWT_SECRET, and ANTHROPIC_API_KEY

# 3. Set up database
npx prisma generate
npx prisma migrate dev --name init

# 4. Seed sample data (5 AU bottles + full flavour taxonomy)
npm run db:seed

# 5. Start development server
npm run dev
```

The API will be running at `http://localhost:3000`.

For age verification in development, set `AGE_VERIFY_PROVIDER=mock` in `.env`.

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/signup` | Register (email + password) |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/social` | Social login (Google/Apple) |
| POST | `/api/auth/refresh` | Refresh access token |
| POST | `/api/auth/password-reset/request` | Request password reset |
| POST | `/api/auth/password-reset` | Reset password |
| POST | `/api/auth/logout` | Logout |

### Age Verification
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/age-verify/initiate` | Start ID verification session |
| POST | `/api/auth/age-verify/webhook` | Provider callback (Onfido/Jumio) |
| GET | `/api/auth/age-verify/status` | Check verification status |
| POST | `/api/auth/age-verify/manual` | Dev-only manual verify |

### Bottle Scanning & AI Pipeline
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scan/label` | Camera label scan (vision AI) |
| POST | `/api/scan/barcode` | Barcode scan |
| GET | `/api/scan/search?q=` | Manual text search + autocomplete |
| POST | `/api/scan/confirm/:bottleId` | Confirm bottle selection |
| POST | `/api/scan/source-notes/:bottleId` | Trigger tasting note sourcing |
| GET | `/api/scan/taxonomy` | Get flavour taxonomy tree |
| GET | `/api/scan/taxonomy/search?q=` | Search flavours (autocomplete) |

### Users
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/me` | Get profile |
| PATCH | `/api/users/me` | Update profile |
| PATCH | `/api/users/me/notifications` | Update notification prefs |
| GET | `/api/users/me/export` | Export all data (GDPR) |
| POST | `/api/users/me/anonymise` | Anonymise data |
| DELETE | `/api/users/me` | Delete account |

### Games
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/games` | Create game |
| POST | `/api/games/join` | Join via game code |
| POST | `/api/games/:id/start` | Start game (host) |
| POST | `/api/games/:id/guess` | Submit guess |
| POST | `/api/games/:id/opt-out` | Opt out |
| POST | `/api/games/:id/advance` | Next round (host) |
| POST | `/api/games/:id/end` | End game (host) |
| GET | `/api/games/:id/results` | Get results |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (includes Redis status) |

## Project Structure

```
cincin-backend/
├── .github/workflows/
│   └── ci.yml                # CI/CD pipeline
├── prisma/
│   ├── schema.prisma         # Database schema (15 models)
│   └── seed.js               # Sample data seeder
├── src/
│   ├── config/
│   │   ├── index.js          # App configuration
│   │   ├── database.js       # Prisma client singleton
│   │   └── redis.js          # Redis client + cache helpers
│   ├── middleware/
│   │   ├── auth.js           # JWT auth, role & tier checks
│   │   └── errorHandler.js
│   ├── routes/
│   │   ├── auth.js           # Auth endpoints
│   │   ├── ageVerify.js      # Age verification endpoints
│   │   ├── scan.js           # Scanning & AI pipeline endpoints
│   │   ├── users.js          # User profile endpoints
│   │   └── games.js          # Game lifecycle endpoints
│   ├── services/
│   │   ├── authService.js    # Sign up, login, tokens
│   │   ├── ageVerifyService.js # Onfido/Jumio integration
│   │   ├── scanService.js    # Vision AI, note sourcing, taxonomy
│   │   ├── userService.js    # Profile, privacy controls
│   │   └── gameService.js    # Game creation, gameplay, scoring
│   ├── validators/
│   │   ├── auth.js
│   │   └── game.js
│   ├── utils/
│   │   └── helpers.js        # Scoring calc, game codes, etc.
│   ├── app.js                # Express app setup
│   └── server.js             # Entry point
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Phase 1 Foundation — Coverage

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

## Next Phases

- [ ] **Phase 2 (Weeks 5–9):** Pass-the-phone gameplay UI, results screen, offline game support
- [ ] **Phase 3 (Weeks 10–13):** WebSocket multiplayer, Cellar Club routes, seasons, game approval
- [ ] **Phase 4 (Weeks 14–17):** Palate Profile, Stripe subscriptions, Buy tab, notifications
- [ ] **Phase 5 (Weeks 18–20):** PWA optimisation, offline hardening, QA, beta, launch
