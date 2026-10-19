# API smoke tests

End-to-end checks of the API against a real Postgres database: auth and email
verification, password flows, age verification (mock provider), scanning,
pass-the-phone and multi-device games (over Socket.io), Cellar Clubs, and the
security rejections (forged social login, unsigned Stripe webhooks).

The suites start the Express + Socket.io server in-process on a random port.
`globalSetup.js` **resets** the database (`prisma migrate reset`) and runs the
seed before every run, so it refuses to start unless the database name ends in
`_test`.

```bash
createdb cincin_test
DATABASE_URL=postgresql://USER:PASS@localhost:5432/cincin_test npm run test:integration
```

Unit tests (no database) run with `npm test`. CI runs both — see
`.github/workflows/ci.yml`.
