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
  development placeholder in production.
- Rotate `TOKEN_SECRET` if you suspect exposure (note: this invalidates all active sessions).
- Bind only the dedicated D1/KV resources for this app; never bind unrelated production
  resources.
