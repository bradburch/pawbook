# Security Policy

Pawbook handles authentication (signed session tokens, hashed passwords) and multi-tenant data
isolation, so we take security reports seriously.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** to open a private advisory.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (proof of concept if possible).
- Affected version/commit.

We aim to acknowledge reports within a few days and will keep you updated on remediation.

## Scope

Security-relevant areas include:

- Session token signing/verification (`server/lib/token.ts`) and the `TOKEN_SECRET`.
- Password hashing (`server/lib/password.ts`).
- Cross-tenant data isolation (tenant resolution + per-tenant queries).
- The embed loader's `postMessage` handling (`public/embed.js`).
- SQL query construction (`server/db/`).

## Operational guidance for self-hosters

- Always set a strong, unique `TOKEN_SECRET` via `wrangler secret put` — never use the
  development placeholder in production. The Worker refuses to serve (HTTP 503) when
  `TOKEN_SECRET` is unset or left at the known insecure default.
- Rotate `TOKEN_SECRET` if you suspect exposure (note: this invalidates all active sessions).
- Bind only the dedicated D1/KV resources for this app; never bind unrelated production
  resources.

## Known limitations (current release)

These are tracked and slated for upcoming phases. Until then, **do not use this with real
customer data** beyond demos:

- **Customer login codes are returned in the API response, not emailed.** Email delivery
  arrives in Phase 2; until then, end-user email verification provides no real assurance and
  anyone who knows an email can obtain a session for it.
- **No rate limiting / lockout on authentication endpoints.** Admin password login and
  end-user code verification accept unlimited attempts. Add Cloudflare Rate Limiting (or a KV
  attempt counter) before any real-data deployment.
- **Booking confirmation is check-then-insert without a transaction**, so two concurrent
  requests can both pass the availability check and slightly overbook a day. A
  Durable-Object-per-tenant serialization will close this in a later phase.
