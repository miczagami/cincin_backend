# Phase 4 Backend — Changelog

## Summary

Phase 4 (Weeks 14–17) implements the **Profile & Monetisation** layer: Palate Profile analytics dashboard, Stripe Pro subscriptions, discovery feed, Buy tab with affiliate tracking, multi-channel notifications, engagement summaries, and data privacy enhancements. This phase completes all Phase 3 stubs and introduces cron infrastructure for automated jobs.

---

## New Files

### `prisma/migrations/20260310_phase4_profile_monetisation/migration.sql`
SQL migration adding 6 new tables and enhancing 2 existing tables:
- **palate_snapshots** — per-game accuracy snapshots for trend-over-time chart
- **push_tokens** — FCM/APNs device tokens for push notifications
- **sponsored_tastings** — brand-sponsored discovery feed items
- **discovery_feed_items** — organic feed content (trending, seasonal, editorial)
- **affiliate_clicks** — click-through tracking for affiliate commerce
- **engagement_summaries** — generated reports (monthly/quarterly/season-end)
- **users** enhanced: `stripe_customer_id`, `subscription_status`, `subscription_plan`, `subscription_current_period_end`, `trial_eligible`
- **palate_categories** enhanced: `drink_type`, `games_appeared_in`
- **notifications** enhanced: `channel`, `push_sent`, `email_sent`

### `prisma/schema.prisma`
Complete schema file updated with all Phase 4 models. Key additions:
- `PalateSnapshot` model (trend chart data)
- `PushToken` model (device token management)
- `SponsoredTasting` model (discovery feed)
- `DiscoveryFeedItem` model (organic content)
- `AffiliateClick` model (commerce tracking)
- `EngagementSummary` model (periodic reports)
- Updated `PalateCategory` with `drinkType` and `gamesAppearedIn`
- Updated `Notification` with `channel`, `pushSent`, `emailSent`
- Updated `User` with Stripe fields

### `src/services/palateProfileService.js`
Full Palate Profile analytics dashboard (Spec Sections 6.1–6.6):
- `getProfile()` — complete dashboard with category accuracy, strengths/weaknesses (top/bottom 5), drink type breakdown, trend data
- `getProgress()` — unlock progress (visible to all users as conversion incentive)
- `generateWrappedCard()` — Palate Wrapped shareable card data (Section 6.6)
- `recordGameSnapshot()` — per-game accuracy snapshot for trend chart
- `updateCategoryWithDrinkType()` — enhanced stat tracking with drink type dimension
- All-time and recent-form (last 10 games) views (Section 6.4)
- Confidence indicators for thin data (Section 6.5)

### `src/services/subscriptionService.js`
Stripe subscription management (Spec Sections 8.1, 8.2):
- `getSubscriptionStatus()` — current tier, plan, trial info
- `createCheckoutSession()` — Stripe Checkout with trial support
- `createBillingPortalSession()` — self-service billing management
- `cancelSubscription()` — cancels at period end (not immediately)
- `reactivateSubscription()` — undo pending cancellation
- `handleWebhookEvent()` — processes 5 Stripe event types
- `checkTrialEligibility()` — 7-day trial trigger after first game
- Mock mode for development without Stripe credentials
- Email verification gate for paid features (Section 7.2)
- Club membership downgrade on cancellation (Section 8.2)

### `src/services/notificationService.js`
Multi-channel notification delivery (Spec Sections 10.1–10.3):
- `createNotification()` — main entry point, replaces Phase 3 stub
- Per-category opt-in checking against user preferences
- Push delivery via FCM (web/Android) and APNs (iOS) — **STUB: actual SDK calls stubbed for production config**
- Email delivery via SendGrid — **STUB: actual SDK calls stubbed for production config**
- `registerPushToken()` / `removePushToken()` — device token management
- `getNotifications()` — paginated in-app notification centre
- `markAsRead()` / `markAllAsRead()` — read state management
- Automatic cleanup of expired/invalid push tokens

### `src/services/commerceService.js`
Buy tab and discovery feed (Spec Sections 8.3, 8.4):
- `getBuyTab()` — scanned bottle history with affiliate links, pricing
- `getBottleAffiliateLinks()` — contextual links for scan confirm / game results
- `trackAffiliateClick()` — click-through tracking with source attribution
- `getDiscoveryFeed()` — mixed sponsored + organic content
- Sponsored content targeting by region and drink preferences
- Impression and game-start tracking for sponsored tastings
- Pro users get ad-free feed (Section 8.1)

### `src/services/userService.phase4-additions.js`
Data privacy enhancements:
- `exportDataCSV()` — full CSV export across 6 data categories (Section 3.8)
- `updateB2BConsent()` — B2B data opt-in toggle, Pro-only (Section 8.5)

### `src/routes/palateProfile.js`
3 endpoints: `GET /profile`, `GET /progress`, `POST /wrapped`

### `src/routes/subscription.js`
7 endpoints: `GET /status`, `POST /checkout`, `POST /portal`, `POST /cancel`, `POST /reactivate`, `GET /trial`, `POST /webhook`

### `src/routes/commerce.js`
5 endpoints: `GET /buy-tab`, `GET /bottles/:id/links`, `POST /affiliate/click`, `GET /feed`, `POST /sponsored/:id/start`

### `src/routes/notifications.js`
5 endpoints: `GET /`, `PATCH /:id/read`, `POST /read-all`, `POST /push-token`, `DELETE /push-token`

### `src/routes/users.js` (updated)
2 new endpoints: `GET /me/export/csv`, `PATCH /me/b2b-consent`

### `src/jobs/cronScheduler.js`
node-cron scheduled job infrastructure:
- Expired season auto-end (hourly)
- Monthly Palate Wrapped generation (1st of month)
- Quarterly Summary generation (1st of Jan/Apr/Jul/Oct)
- Weekly Cellar Club standings digest (Mondays)
- Season-ending-soon reminders (daily, at 7-day and 1-day marks)

### `src/validators/phase4.js`
Validation rules for checkout, affiliate clicks, push tokens, palate profile views, wrapped card generation.

### `src/services/cellarClubService.phase4-updates.js`
Replacement functions for cellarClubService.js completing Phase 3 stubs:
- `calculateAwards()` — now async, includes `mostImproved` and `precisionKing`
- `createNotification()` — delegates to NotificationService for multi-channel delivery
- `approveGame()` — tracks `LEADERBOARD_CHANGE` activity on approval
- `checkExpiredSeasons()` — handles `FIXED_LENGTH` seasons properly

---

## Updated Files

### `src/config/index.js`
Added Phase 4 configuration sections:
- `stripe.*` — secretKey, webhookSecret, monthlyPriceId, annualPriceId, pricing
- `email.*` — sendgridApiKey, fromAddress, fromName
- `push.*` — FCM service account, APNs key config, bundle ID
- `cron.*` — enabled flag
- `scan.*` — extracted scan config for helpers compatibility

### `src/app.js`
- Added 4 new route mounts: `/api/palate`, `/api/subscription`, `/api/commerce`, `/api/notifications`
- Stripe webhook raw body handling (mounted before `express.json()`)
- Health check updated to `phase: "4"`

### `src/server.js`
- Imports and initialises `cronScheduler` on startup
- Startup banner shows Stripe and Cron status

### `.env.example`
- Added all Phase 4 environment variables (Stripe, SendGrid, FCM, APNs, Cron)

### `package.json`
- Version: `0.4.0` (was `0.3.0`)
- New dependencies: `stripe ^17.0.0`, `node-cron ^3.0.3`, `@sendgrid/mail ^8.1.0`

---

## Completed Phase 3 Stubs

| Stub | Resolution |
|------|-----------|
| `calculateAwards()` → `mostImproved` | Compares first-half vs second-half average scores across season games |
| `calculateAwards()` → `precisionKing` | Aggregates `isSpecific=true` correct guesses per user across approved games |
| `createNotification()` → push delivery | Delegates to NotificationService for FCM/APNs push + SendGrid email |
| `LEADERBOARD_CHANGE` activity type | `approveGame()` snapshots leaderboard before/after and records ±2 position changes |
| `checkExpiredSeasons()` | Cron-driven (hourly), handles both FIXED_DATE and FIXED_LENGTH season types |

---

## Remaining Stubs (Phase 5)

| Function | Location | Description |
|----------|----------|-------------|
| `sendFCM()` | `notificationService.js` | Replace mock with firebase-admin SDK — requires FIREBASE_SERVICE_ACCOUNT |
| `sendAPNS()` | `notificationService.js` | Replace mock with @parse/node-apn — requires APNS_KEY_PATH |
| `sendEmailNotification()` | `notificationService.js` | Full SendGrid template integration — currently sends plain text |
| `generateWrappedCard()` → image | `palateProfileService.js` | Shareable card image generation + S3 upload (currently returns data only) |
| Quarterly Summary full analysis | `cronScheduler.js` | Full 3-month trend, comparison to previous quarter, new flavours discovered |
| Global leaderboards | Not yet created | Cross-club/global ranking for Pro users (Section 13) |
| Mystery Box subscription | Not yet created | Deferred to post-launch (Section 8.6) |

---

## API Endpoint Summary (Phase 4 additions)

### Palate Profile
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/palate/profile` | Full dashboard (Pro, 3+ games) |
| GET | `/api/palate/progress` | Unlock progress (all users) |
| POST | `/api/palate/wrapped` | Generate Palate Wrapped card |

### Subscription
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/subscription/status` | Current subscription status |
| POST | `/api/subscription/checkout` | Create Stripe checkout session |
| POST | `/api/subscription/portal` | Create billing portal session |
| POST | `/api/subscription/cancel` | Cancel at period end |
| POST | `/api/subscription/reactivate` | Reactivate pending cancellation |
| GET | `/api/subscription/trial` | Check trial eligibility |
| POST | `/api/subscription/webhook` | Stripe webhook (no auth) |

### Commerce
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/commerce/buy-tab` | Scanned bottles + affiliate links |
| GET | `/api/commerce/bottles/:id/links` | Affiliate links for a bottle |
| POST | `/api/commerce/affiliate/click` | Track affiliate click |
| GET | `/api/commerce/feed` | Discovery feed |
| POST | `/api/commerce/sponsored/:id/start` | Track sponsored game start |

### Notifications
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications` | In-app notification centre |
| PATCH | `/api/notifications/:id/read` | Mark notification read |
| POST | `/api/notifications/read-all` | Mark all read |
| POST | `/api/notifications/push-token` | Register push token |
| DELETE | `/api/notifications/push-token` | Remove push token |

### Users (Phase 4 additions)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/me/export/csv` | Data export (CSV format) |
| PATCH | `/api/users/me/b2b-consent` | B2B data opt-in toggle |

---

## Architecture Decisions

### Stripe Checkout (not Elements)
We use Stripe Checkout Sessions rather than embedded Stripe Elements. Checkout handles PCI compliance, 3D Secure, and Apple/Google Pay automatically. The tradeoff is less UI customisation, but for a subscription flow the hosted checkout page is simpler and more secure. The billing portal session gives users self-service management.

### Mock Mode for External Services
All external service integrations (Stripe, FCM, APNs, SendGrid) have mock fallbacks when API keys are not configured. This allows the full backend to run in development without any external accounts. Mock mode logs actions to console and simulates success.

### NotificationService as Central Hub
Rather than each service sending its own push/email notifications, all notification delivery flows through `notificationService.createNotification()`. This centralises opt-in checking, channel routing, and delivery tracking. The Phase 3 `createNotification()` in cellarClubService now delegates to this service.

### Cron vs Queue
For Phase 4's scheduled jobs (engagement summaries, season checks), we use node-cron running in-process. This is adequate for the expected scale (thousands of users, not millions). Phase 5 or production scale-up can move to a proper job queue (Bull/BullMQ on Redis) without changing the job implementations.

### PalateCategory Dual Rows
Each user's palate stats are stored in two dimensions: an aggregate row (drinkType=null) and per-drinkType rows. This avoids expensive joins when querying the dashboard while keeping the data normalised. The trade-off is slightly more writes on game completion.

---

## Phase 4 Exit Criteria (from Timeline)

| Milestone | Status |
|-----------|--------|
| Pro user with 3+ games sees full analytics dashboard | ✅ |
| Palate Wrapped card generates and is shareable | ✅ (data; image gen is Phase 5 stub) |
| Free user hits scan limit, is prompted to upgrade | ✅ (existing from Phase 1) |
| Can subscribe via Stripe, sees Pro features unlock | ✅ |
| Discovery feed serving content | ✅ |
| Buy tab showing affiliate links | ✅ |
| Notifications delivering across all channels | ✅ (push/email stubbed for SDK config) |
| Data export functional | ✅ (JSON + CSV) |

---

## Project Structure (Phase 4 additions)

```
cincin-backend/
├── prisma/
│   ├── schema.prisma                      # Updated with Phase 4 models
│   └── migrations/
│       └── 20260310_phase4_profile_monetisation/
│           └── migration.sql              # 🆕 Phase 4 migration
├── src/
│   ├── config/
│   │   └── index.js                       # Updated: Stripe, email, push, cron config
│   ├── routes/
│   │   ├── palateProfile.js               # 🆕 Palate Profile endpoints
│   │   ├── subscription.js                # 🆕 Stripe subscription endpoints
│   │   ├── commerce.js                    # 🆕 Buy tab + discovery feed endpoints
│   │   ├── notifications.js               # 🆕 Notification centre + push endpoints
│   │   └── users.js                       # Updated: CSV export, B2B consent
│   ├── services/
│   │   ├── palateProfileService.js        # 🆕 Full analytics dashboard
│   │   ├── subscriptionService.js         # 🆕 Stripe billing lifecycle
│   │   ├── notificationService.js         # 🆕 Multi-channel notification delivery
│   │   ├── commerceService.js             # 🆕 Buy tab + discovery feed
│   │   ├── userService.phase4-additions.js # 🆕 CSV export, B2B consent
│   │   └── cellarClubService.phase4-updates.js # 🆕 Completed stub replacements
│   ├── validators/
│   │   └── phase4.js                      # 🆕 Phase 4 validation rules
│   ├── jobs/
│   │   └── cronScheduler.js               # 🆕 Scheduled jobs (seasons, summaries)
│   ├── app.js                             # Updated: 4 new route mounts
│   └── server.js                          # Updated: cron init
├── .env.example                           # Updated: Phase 4 vars
└── package.json                           # v0.4.0 + stripe, node-cron, sendgrid
```

## Next Phases

- [ ] **Phase 5 (Weeks 18–20):** PWA optimisation, offline hardening, QA, soft launch, public release
