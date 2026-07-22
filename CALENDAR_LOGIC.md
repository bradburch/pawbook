# Booking Calendar Logic (portable)

A self-contained specification + reference implementation of the booking
calendar's **date arithmetic** and **capacity / conflict engine**. Copy the two
code blocks below into any TypeScript project (they have zero external
dependencies) and the accompanying rules explain _why_ they work the way they
do.

Originally extracted from `@brad-paws/shared` (`util/dates.ts` +
`booking/capacity.ts`) — a pet-boarding scheduler. Rename the service types to
suit your domain.

---

## 1. The core modeling decision

**Booking dates are abstract calendar days, not instants.**

A date like `2026-06-07` means "the June 7th business day", _not_ a moment in
time. To do arithmetic on these without a timezone silently shifting them, we
anchor every date string to **UTC midnight** via `Date.UTC(...)`. All day/night
math is then integer arithmetic over `MS_PER_DAY`.

Consequences:

- **DST-immune.** Adding a day is always `+86_400_000` ms; no 23- or 25-hour
  days can creep in because we never touch a real local timezone during
  arithmetic.
- **Runtime-independent.** Works identically on a server running in UTC and in a
  browser running in any zone. The runtime's local timezone is only consulted
  when _displaying_ dates or asking "what day is it right now" (see
  `getPacificDateStr`).

**`endDate` is exclusive — it is the checkout day, with no overnight.**

A stay from `Jun 7` → `Jun 12` occupies the nights of the 7th, 8th, 9th, 10th,
and 11th = **5 nights**. The 12th is checkout. This is why:

- `nightsBetween(checkIn, checkOut)` is a plain subtraction.
- Every range loop iterates `for (date = start; date < endExclusive; ...)`.
- The last _occupied_ night is `addDays(endExclusive, -1)`.

Pick one convention and hold it everywhere; mixing inclusive/exclusive ends is
the #1 source of off-by-one booking bugs.

---

## 2. Date utilities (dependency-free)

Everything below depends only on `parseDateUtc`, `addDays`, and `MS_PER_DAY`.
Drop this in as `dates.ts`.

```ts
/** Milliseconds in one day. */
export const MS_PER_DAY = 86_400_000;

/** The business timezone. All "local" date math/formatting routes through this. */
export const BUSINESS_TZ = 'America/Los_Angeles'; // change to your business's zone

/** Split a `YYYY-MM-DD` (or ISO `YYYY-MM-DDTHH:MM:SS…`) into `[year, monthIndex, day]`. */
function ymd(dateStr: string): [number, number, number] {
  const [year, month, day] = dateStr.split('T')[0].split('-').map(Number);
  return [year, month - 1, day]; // month is 0-based for Date.*
}

/**
 * Parse a `YYYY-MM-DD` string to the UTC milliseconds of that calendar date at
 * midnight. This anchoring is what makes all downstream arithmetic timezone-
 * neutral. Every other helper here builds on it.
 */
export function parseDateUtc(dateStr: string): number {
  return Date.UTC(...ymd(dateStr));
}

/**
 * Add `days` (may be negative) to a `YYYY-MM-DD` date, returning `YYYY-MM-DD`.
 * Pure calendar arithmetic, DST-immune. The one stepper used everywhere.
 */
export function addDays(dateStr: string, days: number): string {
  return new Date(parseDateUtc(dateStr) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The single source of truth for counting nights in a booking.
 * `checkIn` is the inclusive first night; `checkOutExclusive` is checkout (no
 * overnight). Jun 7 → Jun 12 = 5 nights. DST-immune.
 */
export function nightsBetween(checkIn: string, checkOutExclusive: string): number {
  return Math.round((parseDateUtc(checkOutExclusive) - parseDateUtc(checkIn)) / MS_PER_DAY);
}

/**
 * Today (or `date`) as a `YYYY-MM-DD` string in the BUSINESS timezone. Use this
 * — not the runtime's local/UTC date — for every "is this in the past / what
 * day is it" check, so a booking near midnight resolves to the correct business
 * day. `en-CA` locale yields `YYYY-MM-DD`.
 */
export function getBusinessDateStr(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: BUSINESS_TZ });
}
```

> The original also ships `addMonths` (with end-of-month clamping),
> `parseLocalDate`, `parseDateToUtcNoon`, `dateToStr`, `hoursUntilStart` (for
> cancellation-fee windows), and `parseSqliteUtc`. They're independent of the
> capacity engine — copy them only if you need month-stepping, display
> formatting, or SQLite-timestamp parsing.

---

## 3. Domain model & rules

The example domain has two **pool kinds** (`boarding`, `housesit`) that draw
capacity from their own service, plus timed request types and an admin block.
Capacity is **per service, not tenant-wide**: each pool-drawing service
carries its own cap, and one service's occupancy is invisible to another
service's cap check — a full "Standard boarding" doesn't block "VIP boarding"
on the same day.

| Type                | Span        | Capacity rule                                                                                                                              |
| ------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `boarding`-kind      | multi-night | **per-service cap** — `MaxConcurrentPets` pets/day for THIS service; `null` = unlimited. Other services' occupancy invisible to the check.     |
| `housesit`-kind      | multi-night | **per-service cap** — `MaxConcurrentPets` pets/day for THIS service; `null` = unlimited. May overlap boarding ≤ 1 day (tenant-wide, see below).  |
| `walk` / `check-in` | single-day  | unlimited; only a `blocked` day stops it                                                                                                        |
| `blocked`           | any span    | **hard stop** — nothing else may share the day                                                                                                  |

Two subtleties worth internalizing before porting:

1. **Capacity is measured in pets, not bookings, and is scoped to the
   requesting service.** A single 2-pet booking fills _two_ of that
   service's daily slots — for boarding-kind AND housesit-kind — but leaves
   every other service's pool untouched. Every capacity/conflict function takes
   a `CapacityRequest` carrying the service's own `serviceType`, `kind`, and
   `cap` so a multi-pet request is checked against the actual remaining room in
   its own pool.

2. **Bookend sharing (soft boundaries).** The check-in day and checkout day of a
   booking are "boundary" days. A new booking's _endpoint_ may land on an
   existing booking's boundary day even if that day looks full — because one
   booking is arriving as the other departs. **`blocked` days get no boundary**
   (a hard block is never shareable). This rule, like the house-sit/boarding
   overlap rule below, is structural and stays **tenant-wide/global** — it
   isn't scoped per service.

---

## 4. Capacity + conflict engine (dependency-free)

Drop this in as `capacity.ts`. It imports only `addDays` and `DATE_RE` from
`dates.ts`. Capacity is now **per service** (a `PoolKind` plus the caller's
own `serviceType` and `cap`), not a tenant-wide ceiling — see §3 above.

```ts
import { addDays, DATE_RE } from './dates.js';

// Single source of truth for the booking calendar's capacity + conflict rules,
// shared between the web client (calendar UX) and the web server (validation).
//
// Capacity is PER SERVICE and measured in PETS: each pool-drawing service carries its own cap
// (MaxConcurrentPets, for boarding-kind AND housesit-kind); a `null` cap is UNLIMITED (auto
// pass-through) and is never compared. A booking with three pets consumes three units. Other
// services' occupancy is invisible to a request's cap check. Admin-blocked dates always block.
// The house-sit/boarding ≤1-day overlap rule stays TENANT-WIDE (all boarding-kind services): it
// models the sitter's physical absence, not a pool.
// Boundary (bookend) sharing: the start/end day of an existing booking may be
// shared by a new booking's endpoint, EXCEPT for blocked events.

export type PoolKind = 'boarding' | 'housesit';

/** A normalized all-day calendar event for capacity building. `end_date` is exclusive. */
export type CapacityEvent = {
  start_date: string;
  end_date?: string;
  kind: PoolKind | 'blocked';
  /** Pool identity — the service's slug. Required unless kind='blocked'. */
  serviceType?: string;
  /**
   * Number of pets the event covers — capacity is measured in PETS for every pool kind, so a
   * 3-pet booking fills 3 slots. Defaults to 1. Blocked events (binary) ignore it.
   */
  petCount?: number;
};

export type DayCapacity = {
  /** Occupancy per service, in PETS (boarding-kind and housesit-kind alike). */
  byService: Map<string, number>;
  /** ALL boarding-kind pets on this day — drives the structural house-sit rule only. */
  boardingTotal: number;
  blocked: number;
  isBoundary: boolean;
};

/** What the caller wants to book, carrying its own service's cap. */
export type CapacityRequest = {
  serviceType: string;
  kind: PoolKind;
  /** The service's MaxConcurrentPets; null = unlimited. */
  cap: number | null;
  /** Pets in this request; default 1. */
  petCount?: number;
};

const emptyDay = (): DayCapacity => ({
  byService: new Map(),
  boardingTotal: 0,
  blocked: 0,
  isBoundary: false,
});

/** Units a request/event occupies in its own pool: always its pet count (min 1). Capacity is
 * measured in PETS for every pool kind — a booking with three pets consumes three units. */
const unitsOf = (petCount: number | undefined): number => Math.max(1, petCount ?? 1);

/** Build a per-day capacity map from normalized events (end date exclusive). */
export function buildCapacity(events: CapacityEvent[]): Map<string, DayCapacity> {
  const byDate = new Map<string, DayCapacity>();
  const getOrCreate = (dateStr: string): DayCapacity => {
    let state = byDate.get(dateStr);
    if (!state) {
      state = emptyDay();
      byDate.set(dateStr, state);
    }
    return state;
  };

  for (const event of events) {
    const start = event.start_date;
    const end = event.end_date || event.start_date;
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) continue;

    // Blocked events get no boundary — no bookend sharing.
    if (event.kind !== 'blocked') {
      getOrCreate(start).isBoundary = true;
      getOrCreate(end).isBoundary = true;
    }

    for (let d = start; d < end; d = addDays(d, 1)) {
      const day = getOrCreate(d);
      if (event.kind === 'blocked') {
        day.blocked += 1;
        continue;
      }
      const units = unitsOf(event.petCount);
      const key = event.serviceType ?? '';
      day.byService.set(key, (day.byService.get(key) ?? 0) + units);
      if (event.kind === 'boarding') day.boardingTotal += units;
    }
  }

  return byDate;
}

/**
 * Can a request NOT occupy this day in isolation? A block is always a hard stop. Otherwise the
 * request is governed only by its OWN service's cap over its OWN service's occupancy; a `null`
 * cap never blocks (auto pass-through). Cross-service interaction (a house-sit may not overlap
 * occupied boarding by more than one day) is enforced at the range level, not here.
 */
export function dayBlocksRequest(day: DayCapacity, request: CapacityRequest): boolean {
  if (day.blocked >= 1) return true;
  if (request.cap === null) return false;
  const units = unitsOf(request.petCount);
  return (day.byService.get(request.serviceType) ?? 0) + units > request.cap;
}

export function rangeHasConflict(
  startDate: string,
  endDateExclusive: string,
  request: CapacityRequest,
  capacityByDate: Map<string, DayCapacity>,
): boolean {
  const requestEnd = addDays(endDateExclusive, -1); // last occupied night
  const units = unitsOf(request.petCount);
  let houseSitBoardingOverlapDays = 0;

  // A request for more units than its own cap can NEVER fit — not even on an empty calendar,
  // where the day-by-day walk below has nothing to inspect. Enforcing it here keeps the engine
  // correct standalone (the single source of truth), so callers need no separate isolation check.
  if (request.cap !== null && units > request.cap) return true;

  for (let date = startDate; date < endDateExclusive; date = addDays(date, 1)) {
    const day = capacityByDate.get(date);
    if (!day) continue;

    // Structural rule (TENANT-WIDE): a house-sit may overlap existing boarding — on ANY
    // boarding-kind service — by at most one day. Models the sitter's absence, not a pool.
    if (request.kind === 'housesit' && day.boardingTotal > 0) {
      houseSitBoardingOverlapDays += 1;
      if (houseSitBoardingOverlapDays > 1) return true;
    }

    if (!dayBlocksRequest(day, request)) continue;

    const isRequestEndpoint = date === startDate || date === requestEnd;
    if (isRequestEndpoint && day.isBoundary) continue;

    // Soft bookend: an unavailable (non-blocked) endpoint is allowed when the next day has
    // room for this request — the existing booking is ending here.
    if (isRequestEndpoint && day.blocked === 0) {
      const next = capacityByDate.get(addDays(date, 1));
      if (!next || !dayBlocksRequest(next, request)) continue;
    }

    return true;
  }

  return false;
}

/** Walks/check-ins only conflict with fully-blocked days. */
export function walkHasConflict(date: string, capacityByDate: Map<string, DayCapacity>): boolean {
  return (capacityByDate.get(date)?.blocked ?? 0) >= 1;
}

export interface Opening {
  startDate: string; // YYYY-MM-DD
  endDate?: string; // exclusive checkout, for range services only
}

/**
 * Scan the prebuilt capacity map for available slots between `from` (inclusive) and `to`
 * (inclusive candidate start dates), returning up to `limit` openings. Reuses
 * rangeHasConflict / walkHasConflict — NO new rules. Range requests carry a full
 * CapacityRequest; `timed` requests (walk/check-in style) are single-day, block-only.
 */
export function findOpenings(
  capacity: Map<string, DayCapacity>,
  opts:
    | { request: CapacityRequest; from: string; to: string; nights?: number; limit?: number }
    | { timed: true; from: string; to: string; limit?: number },
): Opening[] {
  const limit = opts.limit ?? 3;
  const result: Opening[] = [];

  for (
    let start = opts.from;
    start <= opts.to && result.length < limit;
    start = addDays(start, 1)
  ) {
    if ('timed' in opts) {
      if (!walkHasConflict(start, capacity)) {
        result.push({ startDate: start });
      }
    } else {
      const nights = Math.max(1, opts.nights ?? 1);
      const end = addDays(start, nights);
      if (!rangeHasConflict(start, end, opts.request, capacity)) {
        result.push({ startDate: start, endDate: end });
      }
    }
  }

  return result;
}
```

---

## 5. Usage

```ts
import { buildCapacity, rangeHasConflict, walkHasConflict, findOpenings } from './capacity';

// 1. Build the map ONCE from your existing bookings (end dates exclusive). Each event carries
//    the service it belongs to — capacity is tallied per service, not globally.
const capacity = buildCapacity([
  {
    start_date: '2026-06-07',
    end_date: '2026-06-12',
    kind: 'boarding',
    serviceType: 'standard-boarding',
    petCount: 1,
  },
  { start_date: '2026-06-10', end_date: '2026-06-11', kind: 'blocked' },
]);

// 2. Validate a new multi-night boarding request (endDate exclusive). `cap` comes from
//    the requested service's own MaxConcurrentPets (null = unlimited).
const conflict = rangeHasConflict(
  '2026-06-13',
  '2026-06-15',
  { serviceType: 'standard-boarding', kind: 'boarding', cap: 2, petCount: 2 },
  capacity,
);

// 3. Validate a single-day walk.
const walkBlocked = walkHasConflict('2026-06-20', capacity);

// 4. Suggest the next few openings for that same service.
const openings = findOpenings(capacity, {
  request: { serviceType: 'standard-boarding', kind: 'boarding', cap: 2 },
  from: '2026-06-13',
  to: '2026-07-13',
  nights: 2,
  limit: 3,
});
```

**Client + server share this exact code.** In the origin repo the React calendar
UI and the server-side booking validator both import these functions, so the
grid a user sees can never disagree with the answer the server gives — the rules
live in exactly one place. Keep it that way: build thin adapters around these
primitives, never re-derive the rules.

---

## 6. Port checklist

- [ ] Set `BUSINESS_TZ` to your business's timezone.
- [ ] Rename request/booking types to your domain; keep `blocked` (or an
      equivalent hard-stop) if you need admin holds.
- [ ] Decide whether capacity is per-service (as here) or tenant-wide; if
      tenant-wide, drop `serviceType`/`byService` and go back to flat counters.
- [ ] Keep **`endDate` exclusive** end-to-end, or convert at your API boundary.
- [ ] Capacity here is measured in pets (`unitsOf` returns `petCount`). If your
      unit is bookings, simplify `unitsOf` to always return `1`.
- [ ] Port the date helpers you actually use; the engine only needs `addDays`
      and `DATE_RE`.
- [ ] Write tests for the boundary cases: back-to-back bookings sharing a
      checkout/check-in day, a 2-pet request against a 1-slot-remaining day, a
      house-sit overlapping boarding by exactly 1 vs 2 days, and two different
      services on the same day each staying within their own cap.
