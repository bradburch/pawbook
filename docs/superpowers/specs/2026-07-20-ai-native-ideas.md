# AI-native Pawbook — ideas

**Date:** 2026-07-20
**Status:** Ideas — for discussion
**Companions:** `2026-07-18-premium-features-path.md`, `2026-07-19-oss-proprietary-split.md`

How could Pawbook be "AI native," and how could AI agents work within the
project? Three horizons, from zero-product-change outward. Every idea names
the seam it plugs into, a build-cost tier (S/M/L), and its OSS-vs-premium
placement per the split doc's boundary test (_removing it must leave a product
a solo sitter would still happily run_ → premium; otherwise OSS).

One fact anchors all of this: **a customer-facing Pawbook MCP server already
exists in the wild**, built by a third party against the public API — sitters'
customers checking availability and booking through Claude today. The
architecture already supports agents; the question is how far to lean in.

## Horizon A — AI at the edges (no product change)

Agents interact with Pawbook as it stands. The work is making the existing
surface legible to them.

### A1. Agent-readable site contract (llms.txt + JSON-LD)

- **For whom:** customers using any AI assistant; the sitter gets bookings
  from clients who never opened the widget.
- **What:** serve `/llms.txt` describing the public API per tenant (config,
  availability, identify/verify, bookings) with worked examples; add JSON-LD
  (`LocalBusiness` + `Service` + offers) to the landing page and embed host
  page so crawlers and agents discover services, prices, and the API root.
- **Seam:** `server/index.ts` (a static route beside `LANDING_HTML`, which is
  script-free under `LOCKED_CSP` — JSON-LD is a `<script type="application/ld+json">`
  and needs a CSP carve-out or lives only on `/embed/*` under `EMBEDDABLE_CSP`);
  data from `GET /api/:slug/config`.
- **Cost:** S. **Placement:** OSS — it documents the MIT API surface.

### A2. Hosted booking MCP server per tenant (managed version of the wild one)

- **For whom:** the sitter — "flip a switch, your clients can book from
  Claude/any MCP client," zero setup, same rules as the widget.
- **What:** a separate Worker (Agents SDK) at `mcp.<hosted-domain>/:slug`
  exposing check-availability / get-quote / request-booking / my-bookings
  tools. It authenticates customers by driving the existing email-code flow
  (`POST /api/:slug/identify` + `verify`, `server/routes/auth.ts`) and calls
  the public API, so `src/shared/booking/` capacity + service rules are
  enforced by the same server code as everything else.
- **Seam:** the public JSON API only; no repo changes (architecture C→B from
  the premium doc). **Cost:** M. **Placement:** premium (managed
  convenience; self-hosters keep the API and the right to run their own —
  the wild server proves it works).

### A3. Structured booking data for agents

- **What:** small additive polish to the public API so agents fail less:
  machine-readable validation errors (which rule from `service-rules.ts`
  rejected the request and why), an explicit `nextAvailable` hint on
  conflicts, idempotency keys on `POST /api/:slug/bookings`.
- **Seam:** `server/routes/bookings.ts`, error shapes from
  `src/shared/booking/service-rules.ts` / `capacity.ts`.
- **Cost:** S. **Placement:** OSS — better API errors help every client.

## Horizon B — AI features in the product (premium-worker candidates)

All follow the premium doc's architecture B: a closed premium Worker behind an
optional `PREMIUM` binding; forwarding routes are the only public-repo change.

### B1. Sitter-admin MCP server (new)

- **For whom:** the sitter, from any AI client: "confirm this weekend's
  bookings," "block next week," "who still owes me money?"
- **What:** a hosted MCP Worker (variant of A2) that holds the sitter's admin
  JWT (`server/routes/admin-auth.ts`) and wraps the admin API — bookings
  list and status (`POST /api/:slug/admin/bookings/:id/status`), blocked
  dates (`POST /api/:slug/admin/blocked`), payments, customers, analytics.
  Tools mirror routes one-to-one; no new server logic.
- **Cost:** M. **Placement:** premium (managed); the admin API it wraps stays
  MIT, so a self-hoster can build their own.

### B2. AI drafting — booking replies and client messages

- **What:** "draft a reply" on a booking request; "summarize this client's
  history" on a customer. Per the premium doc's sketch:
  `/api/:slug/admin/ai/draft` (JWT + entitlement) forwards context to the
  premium worker, which calls **Workers AI** (cheap, data stays in
  Cloudflare) for summaries and the **Claude API** for prose worth editing.
  Output is always a draft the sitter sends herself.
- **Seam:** one forwarding route in `server/routes/admin.ts`; context from
  `BookingRequests`, `EndUsers`, `Payments`. **Cost:** M. **Placement:**
  premium (removing it leaves the product whole).

### B3. Intake summarization — Answers JSON → sitter brief

- **What:** `BookingRequests.Answers` is freeform JSON keyed to per-service
  intake questions; multi-pet, multi-question requests are a wall of text.
  Generate a one-paragraph brief per booking ("Two dogs, one on meds at 8am,
  gate code 4411, reactive to bikes") shown on the booking card and in the
  confirmation email to the sitter.
- **Seam:** `BookingRequests.Answers` + `EndUserPets.Notes`; surfaces in the
  admin Bookings section and `server/lib` email templates. **Cost:** S (a
  constrained summarize call — the easiest real AI feature here).
  **Placement:** premium.

### B4. Smart scheduling suggestions

- **What:** the shared engine already knows capacity, conflicts, and per-day
  load. Add suggestions on top: gap-filling ("Tuesday has one walk — nudge
  regulars who usually book Tuesdays"), capacity warnings ("boarding is 90%
  booked over the holidays; consider raising the rate or blocking intake"),
  and quiet-week detection from `BookingRequests` history.
- **Seam:** reads via existing admin bookings/analytics endpoints
  (`GET /api/:slug/admin/analytics`); math builds on
  `src/shared/booking/capacity.ts` outputs. Deterministic parts could be OSS
  analytics; the LLM-phrased advice is premium. **Cost:** M–L.

### B5. AI onboarding copilot

- **What:** the setup wizard (`app/admin/SetupWizard.tsx`) already applies
  presets (`app/admin/presets.ts`). Add a free-text step — "describe your
  business" — and have a model map it onto the preset vocabulary: services,
  rates, capacity limits, pet types, intake questions. Output is a
  pre-filled wizard the sitter reviews, applied through the **existing**
  settings/services APIs (`PUT /api/:slug/admin/settings`,
  `POST /api/:slug/admin/services`, `POST /api/:slug/admin/pet-types`) — the
  model proposes, the same validated endpoints dispose.
- **Cost:** M. **Placement:** premium feature, OSS-shaped seam (the wizard
  and presets stay MIT).

### B6. Voice/SMS agent intake

- **What:** a phone number per tenant; an agent answers, checks availability,
  and files a booking _request_ (never a confirmation) via the public API,
  then texts the customer the widget link to verify their email. Highest
  wow, highest cost, and dependent on telephony vendors.
- **Seam:** public API only, like A2. **Cost:** L. **Placement:** premium.

## Horizon C — AI-native operation (agents as first-class actors)

### C1. Ops/anomaly agent for the owner

- **What:** the invariant-sweep follow-up from the branch reviews, done by an
  agent on a schedule: orphaned `GCalEventId`s (event deleted in Google but
  booking active), failed sync writes, expired `ProviderConnections` tokens,
  stale `AllowedSitters` invites never completed, pending bookings older
  than N days. Reports to the owner console or email; fixes nothing
  autonomously at first.
- **Seam:** `server/routes/owner.ts` (a read-only sweep endpoint) or a
  scheduled Worker reading via admin APIs; tables `BookingRequests`,
  `ProviderConnections`, `AllowedSitters`. **Cost:** M. **Placement:** the
  sweep endpoint is OSS-worthy (self-hosters have the same rot); the managed
  agent that watches it is hosted-operational/premium.

### C2. Agents as attributed actors (the schema gap)

Today an agent-made booking is indistinguishable from a widget booking. If
agents become normal actors, attribution is the missing primitive — see the
safety section below (migration `0016` candidate).

### C3. Repo-level agents (already the norm here)

Development itself is AI-native: spec-first docs in `docs/superpowers/specs/`,
subagent delegation in `CLAUDE.md`, the `running-pawbook` skill. Worth
extending with a CI review agent gated on the same invariants the docs name
(tenant scoping, repo.ts exclusivity) — S cost, OSS, and it protects
everything above.

## Agent safety

- **Autonomy boundary — already right by design.** Bookings are
  request→sitter-confirm (`Status 'pending'` until
  `POST …/bookings/:id/status`); nothing an agent does on the customer path
  can commit the sitter. Keep that: agents may _request_, _query_, and
  _draft_ autonomously; anything state-changing on the admin side
  (confirm/decline, block dates, record payments, edit services) should
  require an explicit human confirmation in the AI client, even though the
  API token technically permits it. AI drafts are never auto-sent.
- **Tenant isolation.** Agents get no new trust: they enter through the same
  slug-scoped routes as browsers, so `tenantMiddleware` + repo.ts scoping
  hold. The rule for any MCP/premium worker: it holds a token _for one
  tenant_ and speaks only the public/admin HTTP API — never a DB binding
  (this is the premium doc's invariant restated for agents).
- **Rate limits.** Agents retry enthusiastically. `LoginCodes` already has
  attempt limits; the public availability/booking endpoints and any MCP
  worker need per-tenant request budgets before agent traffic is invited.
- **Audit trail — one column short.** `BookingRequests` already records
  everything about _what_ was requested; it doesn't record _who typed it_.
  Proposal: a nullable `Source TEXT` (`NULL` = widget, else `'mcp'`,
  `'voice'`, `'admin-import'`, …) — migration `0016_booking_source.sql` +
  `sql/schema.sql` + repo cols, matching the null-is-default convention.
  Cheap now, impossible to backfill later, and it gives the sitter a
  "booked via Claude" badge plus the data to judge agent quality. The same
  idea applies to admin actions if B1 ships (who confirmed: sitter or her
  agent?).

## Recommended first step

**A1 + A3, then harden the path A2 formalizes: llms.txt + structured errors
now, the hosted booking MCP next.** Argument: the wild MCP server is proof of
demand that arrived unprompted — customers already want to book through
agents, and the public API already safely supports it (request-only,
tenant-scoped, same shared rules). A1/A3 are small, pure-OSS, and make every
current and future agent integration better; A2 then converts proven demand
into the first premium feature with **zero public-repo code** (the premium
doc's "behave like C until B is needed" posture). Slip the `Source` column
(`0016`) in alongside, while agent traffic is still small enough to start the
audit trail clean. B3 (intake briefs) is the best first _in-product_ AI
feature when the premium worker exists: smallest prompt surface, obvious
sitter value, no autonomy risk.
