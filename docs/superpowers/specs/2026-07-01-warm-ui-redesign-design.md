# Warm UI redesign — embed widget + admin dashboard

**Date:** 2026-07-01
**Status:** Approved (direction: "warm modern pet-care", both surfaces)

## Problem

The UI is an unfinished mix of two identities and reads as sloppy:

- **Embed widget:** the sign-in view is the old "Keeper's Ledger" look (Georgia serif,
  paper card) while the booking view is a half-landed rounded/friendly look — three
  typefaces (serif, rounded, mono) compete in one 420px widget. Service cards use raw
  emoji as icons (platform-dependent, uneven). The 2-column service grid orphans the
  fifth card. A selected date range renders as fat tangent circles, not a connected
  range. The 5-dot legend is illegible (cream dot on cream) and the "Tap start date."
  hint floats orphaned. Pet selection is a default-styled `<fieldset>` with default
  checkboxes.
- **Admin dashboard:** a single ~4,000px column of raw stacked forms with no
  navigation or grouping. Labels are 0.68rem mono-uppercase — a ransom-note texture.
  "Save settings" sits mid-page and silently applies only to the sections above it;
  everything below auto-saves — an invisible, confusing boundary. Raw ISO dates with
  jargon ("2028-07-03 → 2028-07-05 (end exclusive)"). `DISCONNECTED` mono chips read
  as errors.

The flows, accessibility work (44px targets, focus-visible, reduced-motion, 16px
mobile inputs), and live preview are sound. This is a visual-identity and layout
redesign, not a rebuild.

## Design system (shared)

- **Typography.** Display: `ui-rounded, 'SF Pro Rounded', … , system-ui` for headings
  and buttons; body: system sans stack. Monospace only inside the admin's embed-snippet
  code boxes. Serif removed everywhere. No webfonts (embed weight + CSP).
- **Palette.** Warm cream page surfaces (`#faf8f3`), white raised cards, pine-navy ink
  `#1c3a4a` for headings and admin primary buttons, sage family (`#9db8a4`,
  wash `#eef3ee`) for neutral accents/hovers, soft red only for destructive/unavailable.
  The tenant accent (`--bp-accent`, runtime) drives all customer-facing actions in the
  widget. Admin marigold `#c77d0a` becomes highlight-only (focus rings, section
  markers); primary admin actions are solid pine-navy for AA contrast.
- **Icons.** New shared `app/shared-ui/icons.tsx`: small inline SVG set, 24px viewBox,
  1.75 stroke, round caps/joins (lucide-style). Service icons: bed (boarding),
  clipboard-check (check-ins), sun (day care), home (house sitting), paw (walks);
  plus chevron-left/right, plus, trash, calendar as needed. Emoji removed from
  `app/embed/services.ts` usage.

## Embed widget (`app/embed/`)

- **One identity across sign-in and booking:** rounded display headings, same card
  chrome, same spacing. Sign-in shows tenant name + one-line pitch; the code step
  styles the input for 6-digit entry.
- **Service picker:** wrapping row of pill-cards (icon + label side by side, ≥44px
  tall). Five items wrap naturally (e.g. 3+2); no orphan full-width card.
- **Calendar:** selected range renders as a connected band — rounded ends in the
  accent color, in-between days a soft accent wash; single-date services keep the
  circle. Day numbers and weekday header in sans (mono dropped). Legend shrinks to
  only states that can appear. The tap hint moves into the calendar title row as a
  live subtitle ("Tap your start date" → "Now tap your end date").
- **Pets:** selectable chips (name + type, real check mark) replacing the default
  fieldset + checkboxes. Semantics stay checkbox-based for a11y (visually-hidden
  input or aria-pressed buttons — implementation's choice, keyboard accessible).
- **Summary/result:** a booking summary card — dates, nights, estimated cost,
  accent CTA. Errors/confirmations restyled consistently.

## Admin dashboard (`app/admin/`)

- **Layout:** cream page; each section a white rounded card with icon + title header;
  content max-width ~760px. Slim sticky topbar: business name, anchor links to
  sections, Sign out.
- **Labels:** normal-case 0.85rem medium sans; mono-uppercase micro-labels removed
  globally.
- **Save model:** editing any field in the settings form marks it dirty and shows a
  sticky bottom bar — "Unsaved changes · [Save]". Instant-apply sections (time off,
  clients, connected apps) say so inline. No API changes; same single PUT.
- **Humanized data:** time-off rows read "Jul 3 – 5, 2028 · 2 nights" (computed
  client-side from the stored end-exclusive dates; storage unchanged). Status chips
  become soft colored pills (green Connected, neutral Not connected, amber Invited).
- **Buttons:** solid pine-navy primary, quiet outline secondary, red-text destructive.

## Constraints

- Zero backend/API/schema changes; zero booking-logic changes.
- Files touched: `app/embed/widget.css`, `app/embed/App.tsx`, `app/embed/Calendar.tsx`,
  `app/embed/services.ts`, `app/admin/admin.css`, `app/admin/App.tsx`, new
  `app/shared-ui/icons.tsx`.
- Preserve all existing a11y affordances (44px touch targets, focus-visible outlines,
  prefers-reduced-motion, 16px inputs under 640px).
- `--bp-accent` remains the only tenant-controlled color; Pawbook owns the neutrals.

## Verification

- Full CI-mirror gate: `npm run typecheck && npm run lint && npm run format &&
  npm test && npm run build`.
- Playwright walkthrough of both surfaces (sign-in, booking with range selection,
  pets + result, admin login, dashboard, dirty-save bar) with screenshots reviewed.
