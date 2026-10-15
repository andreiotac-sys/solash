# Booking validation investigation

## Verified paths and cause

The main booking form called `hasConflict`, then displayed `buildReservationWarning` for a legal holiday or interval outside `getWorkWindowsForDate`; the administrator could confirm. `handleMoveAppointment`, shared by drag, timeline drop, shift, and free-segment move, instead rejected an outside-hours interval immediately. Personal blocks were hard-blocked outside hours. Free-slot and long-press creation open the same form; monthly selection sets the form's date. The reported September 8, 2026 16:00–19:00 example fits a configured Tuesday 08:00–21:00 window, including a 13:00–14:00 break. The actual browser `localStorage` settings on the affected production device were not accessible, so the cause of that specific historical alert cannot be proven. A new device can have different hours because settings are per browser.

`src/lib/scheduling.ts` now centralizes weekday calculation, duration/time parsing, configured windows, and overlap checks. Dates are interpreted as calendar dates in UTC for weekday calculation; appointment values remain Bucharest wall-clock date/time, so no conversion to UTC occurs during booking. A break creates two windows; a booking must fit entirely inside one. An explicit day off removes all windows. Public holidays remain advisory warnings and do not silently close a day. `Anulata` rows do not block, and an edit ignores its own ID. Personal blocks are active appointment rows and block overlaps. Half-open intervals permit a booking to start exactly when another ends. Invalid or past-midnight intervals are rejected.

The form always rejects a true overlap before any warning confirmation. It warns about outside hours and displays the configured windows. Move/drag presents an explicit outside-hours confirmation after conflict checking. Existing statuses are preserved when opening an edit. The previous one-time migration that disabled all breaks was removed. No database records or schema were changed.

## Limits and follow-up

The shared client validator cannot prevent two independent devices from saving the same interval concurrently. A database-backed atomic conflict rule is still required, and any schema/policy change needs owner approval. The live device's schedule must be inspected with the owner to resolve the exact production report. Offline queued changes need conflict reconciliation. No production booking was used as a test fixture.

`tests/scheduling.test.mjs` covers opening/closing boundaries, September 8, breaks/multiple windows, day off, holiday behavior, active/cancelled/self conflicts, reschedule, custom durations, personal blocks, weekday and daylight-saving dates, supported entry-point equivalence, overrides versus conflicts, adjacency, and invalid input. These are deterministic unit tests; a real authenticated mobile workflow test remains outstanding.
