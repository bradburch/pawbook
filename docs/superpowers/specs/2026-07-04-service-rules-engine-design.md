# Per-service booking rules (questions + constraints) — design

**Date:** 2026-07-04
**Status:** Approved (pending spec review)
**Branch target:** off `main`

## Problem

Services (`boarding`, `housesitting`, `daycare`, `walk`, `checkin`, defined in
`server/lib/services.ts` `SERVICE_CATALOG`) currently only carry price/duration
config (`TenantServiceOptions`) and an on/off flag (`TenantServices`). There is no
way for a sitter to ask service-specific intake questions ("is your dog
crate-trained?" for boarding vs. "which plants need watering?" for house-sitting)
or to set booking-level limits ("boarding requires at least 2 nights"). A repo-wide
search confirms zero existing machinery for this: no `question`/`CustomField`
concept anywhere in schema, API, admin UI, or the widget, and `BookingRequests`
has no free-text/answer column.

## Goals

1. Each service gets an admin-editable list of **questions** (text / yes-no /
   number / single-select), each optionally required, with type-appropriate
   validation (min/max for number, options list for select, optional regex
   pattern for text).
2. Each service gets optional **booking-level constraints**: min/max nights
   (range-shaped services only) and min/max pet count (all services).
   Unset = no constraint, matching the existing `MaxStayNights`-style
   null-is-unlimited convention already used on `Tenants`.
3. The customer answers questions in the widget at booking time; answers persist
   with the booking. Constraints are enforced both client-side (inline feedback)
   and server-side (authoritative, via one shared pure-function set — no
   client/server validation drift).
4. Editing or removing a question later must not corrupt or crash access to past
   bookings that reference it.

## Non-goals

- Cross-question conditional logic ("only ask Y if X was answered a certain
  way") — explicitly out of scope; rules are flat per-service.
- Pricing or availability effects from answers (e.g. a surcharge for a "yes"
  answer) — validation/gating only, no pricing engine changes.
- A generic form-builder UI framework — this is one fixed set of field types
  (text/yes-no/number/select), not user-defined field types.
- Per-answer analytics/reporting — not needed today; revisit storage shape if it
  becomes a requirement (see Alternatives).

## Alternatives considered

**Normalized tables** (`ServiceQuestions` + `BookingAnswers`, one row per
question/answer, FKs to `TenantServices`/`BookingRequests`) — mirrors how
`TenantServiceOptions` already models per-service config, and would be
SQL-queryable per-answer. Rejected for now: it's two new tables, a migration,
and joins added to both the admin GET and the booking-submit path, for data that
is tenant-authored (low volume, edited rarely) and never queried across tenants
today. The chosen approach (below) can migrate to normalized tables later
without changing the widget-facing question shape, if per-answer analytics ever
becomes a real need.

**Chosen: JSON columns.** `Questions` is stored as a JSON array on
`TenantServices`; `Answers` as a JSON object on `BookingRequests`. This matches
how tenant-level settings already work (flat columns on `Tenants`, e.g.
`AccentColor`, `MaxStayNights`) rather than side tables, and keeps validation as
plain pure functions in `src/shared/` per this repo's existing pattern
(`src/shared/booking/capacity.ts`, `server/lib/validation.ts`).

## Design

### 1. Schema

New migration `migrations/0005_service_rules.sql` (+ `sql/schema.sql` updated in
lockstep, per project convention):

```sql
ALTER TABLE TenantServices ADD COLUMN Questions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE TenantServices ADD COLUMN MinNights INTEGER;      -- NULL = no minimum
ALTER TABLE TenantServices ADD COLUMN MaxNights INTEGER;      -- NULL = no maximum
ALTER TABLE TenantServices ADD COLUMN MinPetCount INTEGER;    -- NULL = no minimum
ALTER TABLE TenantServices ADD COLUMN MaxPetCount INTEGER;    -- NULL = no maximum

ALTER TABLE BookingRequests ADD COLUMN Answers TEXT NOT NULL DEFAULT '{}';
```

No CHECK constraints are added on these columns (SQLite can't `ALTER` a CHECK —
integer range/shape validity is enforced entirely at the admin route, same as
`MaxStayNights` today).

### 2. Shared question/validation types

New file `src/shared/booking/service-rules.ts`, exported from
`src/shared/index.ts`:

```ts
export type ServiceQuestion = {
  id: string; // stable id (assigned server-side on save), used as the Answers key
  label: string;
  type: 'text' | 'yesno' | 'number' | 'select';
  required: boolean;
  min?: number; // type: 'number'
  max?: number; // type: 'number'
  pattern?: string; // type: 'text', optional regex
  options?: string[]; // type: 'select'
};

export type ServiceConstraints = {
  minNights: number | null;
  maxNights: number | null;
  minPetCount: number | null;
  maxPetCount: number | null;
};

// Returns an error message, or null if the answer is valid for this question.
export function validateAnswer(
  question: ServiceQuestion,
  value: string | undefined,
): string | null;

// Validates a full answer set against a service's questions in one pass.
// Returns the first error found, or null.
export function validateAnswers(
  questions: ServiceQuestion[],
  answers: Record<string, string>,
): string | null;

// Checked at submit time against the actual booking (nights only meaningful for
// range-shaped services; pass null when not applicable).
export function validateServiceConstraints(
  constraints: ServiceConstraints,
  booking: { nights: number | null; petCount: number },
): string | null;
```

These are pure, zero-dependency functions (consistent with the rest of
`src/shared/`) — the widget calls them for inline feedback, `bookings.ts` calls
the *same* functions as the authoritative check.

### 3. Repo layer (`server/db/repo.ts`)

- `listServices` SELECT expands to include the five new columns; `Questions` is
  `JSON.parse`'d into `ServiceQuestion[]` before returning (repo boundary hides
  the TEXT-column representation from callers, same as every other typed
  return in this file).
- `setServiceEnabled` is renamed to `setServiceConfig` and takes the full
  per-service config in one upsert:
  ```ts
  setServiceConfig(db, tenantId, serviceType, {
    enabled: boolean;
    questions: ServiceQuestion[];
    minNights: number | null;
    maxNights: number | null;
    minPetCount: number | null;
    maxPetCount: number | null;
  })
  ```
  Same `ON CONFLICT (TenantId, ServiceType) DO UPDATE` shape as today, one more
  write path is not warranted for five related columns that always save
  together from the same admin form section.
- `TenantService` type (`server/types.ts`) gains `Questions: ServiceQuestion[]`,
  `MinNights/MaxNights/MinPetCount/MaxPetCount: number | null`.

### 4. Admin route (`server/routes/admin.ts`)

- `ServiceBody` gains `questions?: QuestionBody[]` and the four constraint
  fields, mirroring the existing `OptionBody` pattern.
- Validation, added to the existing `for (const svc of services)` loop:
  - Each question: non-empty `label`; `type` one of the four; for `number`,
    `min`/`max` (if present) are integers and `min <= max`; for `select`,
    `options` is a non-empty string array; for `text`, `pattern` (if present)
    compiles as a `RegExp` (wrapped in try/catch — reject with 400 rather than
    persisting an invalid pattern that would throw at answer-validation time).
  - Constraints reuse the existing `isNullableLimit` helper (already imported
    in this file) against `DEFENSIVE_MAX_NIGHTS` for nights and
    `DEFENSIVE_MAX_PET_COUNT` for pet count — identical shape to how
    `maxStayNights`/`maxBoardingPets` are validated today. Additionally reject
    when both bounds are set and `min > max`.
- On save, call `setServiceConfig` instead of `setServiceEnabled`, passing
  through `questions` (defaulting to `[]`) and the four constraint fields
  (defaulting to `null`) alongside the existing `enabled`/options write.
- `GET /:slug/admin/settings` service mapping adds `questions` and the four
  constraint fields to each service entry (same object that already carries
  `label`/`hasDuration`/`options`).

### 5. Public config (`server/routes/public.ts`)

`GET /:slug/config` service mapping adds `questions` and the four constraint
fields to each enabled service's entry, so the widget has everything it needs to
render and validate without a second request.

### 6. Booking submission (`server/routes/bookings.ts`)

- `POST /:slug/bookings` body gains `answers?: Record<string, string>`.
- After resolving `service` (now carrying `Questions`/constraints) and before
  the existing date/capacity checks:
  - `validateAnswers(service.Questions, body.answers ?? {})` → 400 with the
    message on failure.
  - `validateServiceConstraints({ minNights: service.MinNights, maxNights: service.MaxNights, minPetCount: service.MinPetCount, maxPetCount: service.MaxPetCount }, { nights: shape === 'range' ? nightsBetween(start, end) : null, petCount: pets })`
    → 400 on failure. Placed alongside the existing `validateBoardingRange` /
    `validateSingleDate` call since both are pre-insert request validation.
- `insertBookingRequest` row gains `answers: Record<string,string>`; repo
  `JSON.stringify`s it into the `Answers` column.
- `GET /:slug/bookings/mine` (and any future admin booking-detail view) may
  surface `answers` alongside existing fields — not required for v1 since no
  such view currently renders booking detail beyond the summary already
  returned; if/when one exists, unknown question ids (because a tenant edited
  or removed a question after the booking was made) render as "(question
  removed)" rather than erroring, since `Answers` is plain JSON with no FK to
  `Questions`.

### 7. Admin UI (`app/admin/sections/ServicesSection.tsx`)

Each service block gains two subsections:

- **Questions**: repeatable list, add/remove/reorder via up/down buttons (no
  drag-and-drop — YAGNI). Each row: label input, type select
  (Text/Yes-No/Number/Single-choice), required checkbox, and type-specific
  extras shown conditionally (min/max for Number, comma-separated options for
  Select, an optional small "pattern" field for Text).
- **Booking limits**: Min/Max nights (shown only when `SERVICE_CATALOG[type].shape === 'range'`)
  and Min/Max pet count (all services). Blank = no limit, same UX as the
  existing rate/duration inputs which already tolerate blank.

Both save through the existing single PUT-on-save flow — no new "unsaved
changes" state machine.

### 8. Widget (`app/embed/`)

- `app/shared-ui/api.ts` config type gains `questions`/constraints per service
  entry; `App.tsx`'s config-loaded state picks them up automatically since it
  already holds the full config response.
- When a service is selected, render its questions below the existing
  `selectedPets` picker (`App.tsx:~289`) via a small type→component switch
  (text input / yes-no toggle / number input / select) driven entirely by the
  `ServiceQuestion[]` data — no per-tenant custom code paths.
- Call `validateAnswers`/`validateServiceConstraints` (imported from
  `src/shared/`) for inline "fix this" feedback; submit stays disabled while
  any required question is unanswered or a constraint is violated, same gating
  style already used for date/service selection.
- Submit includes `answers` in the `POST /:slug/bookings` body.

## Error handling

- Invalid question definition (bad type, `min > max`, empty options list,
  invalid regex) → 400 from the admin route with a specific message, same
  style as existing `SettingsBody` validation.
- Invalid/missing required answer at booking time → 400 naming the question.
- Booking-level constraint violation (nights or pet count out of range) → 400
  naming the constraint, alongside existing date/capacity 400s.
- Orphaned answers (question removed after booking) never error — they're
  inert JSON with no FK, surfaced as "(question removed)" wherever booking
  detail is ever rendered.

## Testing

Following this repo's convention — shared pure-logic tests live under
`server/__tests__/` and import from `../../src/shared/index.js` (see
`server/__tests__/capacity.test.ts`), not colocated in `src/shared/`:

- `server/__tests__/service-rules.test.ts`: `validateAnswer`/`validateAnswers`
  per type including boundary cases (number exactly at min/max,
  required-but-empty, invalid regex match, unlisted select option);
  `validateServiceConstraints` for nights/pet-count boundaries and the "both
  null → always passes" case.
- `server/__tests__/admin.test.ts` additions: PUT rejects malformed
  questions/constraints and persists valid ones (round-trip through GET).
- `server/__tests__/booking-flow.test.ts` additions: POST rejects a missing
  required answer and a constraint violation with 400, and persists valid
  `Answers` correctly on success.

## Files touched

- `migrations/0005_service_rules.sql` (new) + `sql/schema.sql`.
- `src/shared/booking/service-rules.ts` (new) + `src/shared/index.ts` export.
- `server/types.ts` — `TenantService` gains the five new fields.
- `server/db/repo.ts` — `listServices` column expansion + JSON parse;
  `setServiceEnabled` → `setServiceConfig`.
- `server/routes/admin.ts` — `ServiceBody`/`SettingsBody` types, validation,
  `GET`/`PUT` `/:slug/admin/settings`.
- `server/routes/public.ts` — `GET /:slug/config` service mapping.
- `server/routes/bookings.ts` — `POST /:slug/bookings` answers + constraint
  validation, `insertBookingRequest` call.
- `app/admin/sections/ServicesSection.tsx` — Questions + booking-limits UI.
- `app/shared-ui/api.ts` — config type additions.
- `app/embed/App.tsx` — dynamic question rendering (near the existing
  `selectedPets` picker, ~line 289) + inline validation + `answers` added to
  the `POST /:slug/bookings` body (~line 196).
- Tests: `server/__tests__/service-rules.test.ts` (new), additions to
  `admin.test.ts` and `booking-flow.test.ts`.

## Open questions

None outstanding. Decisions locked: JSON-column storage; flat per-service rules
(no cross-question conditionals); field types limited to
text/yes-no/number/select; constraints limited to min/max nights + min/max pet
count; orphaned answers are inert, never erroring.
