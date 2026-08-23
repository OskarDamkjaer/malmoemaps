# Plan 02 — The day ends on a map

**Goal.** After the fifth photograph, the summary stops being only a list: the
map behind it shows all five rounds at once — every guess, every answer, a line
between them, numbered 1–5 — and tapping a summary row frames that pair.

**Touches.** `app/photos.js`, `app/photos.mjs`, `app/index.html`
(`#photosummary` markup), `app/app.css` (summary layout), `test/photos.test.mjs`,
`DECISIONS.md`.

**Depends on.** Plan 01 landed.

## Steps

1. **Keep the guess.** Today `commit()` pushes `{ photo, result }` and the guess
   lives only in `session.guess`, which the next photo overwrites. Push the
   guess too: `session.done.push({ photo, result, guess: session.guess })`.

2. **A pure helper, so the geometry is testable.** In `app/photos.mjs`:
   `summaryBounds(done)` → the `[[w, s], [e, n]]` bounding box of every guess
   and answer point, or `null` for an empty day. Nothing DOM- or map-shaped in
   it. Test it in `test/photos.test.mjs`: two known pairs give the expected
   box; empty gives `null`.

3. **Draw the day.** In `finishDay()`, after `leaveBlind(map)` (which it already
   calls): replace the single-pair shapes with all five pairs through the
   existing `photo-answer` source — one LineString, one `guess` circle and one
   `answer` circle per round, the answer carrying an `n` property (1-based).
   Then `fitBounds(summaryBounds(session.done), …)` with the same padding
   philosophy as `frameResult` (panel-aware, phone-aware) and a `maxZoom` near
   12.5 — this is a city overview, not a rooftop inspection.

4. **Numbers on the answers.** Add a `symbol` layer `photo-num` over the answer
   circles, `text-field: ['get', 'n']`, small, haloed. **The blind rule applies:**
   no layer that draws text may exist while a day is running
   (`test/blind.test.mjs` must stay green). So create this layer lazily in
   `finishDay` (after `leaveBlind`) and remove it in `startDay`/`quitDay` if
   present — never let it exist during play.

5. **Rows that focus.** Render each summary row as a `<button>`:
   `1 · 1963 · 412 m · 8 412 p` (round, year, distance, points — the data is
   already in `session.done`). Clicking reframes that pair: extract the
   fit-bounds-two-points logic from `frameResult` into a helper that both the
   reveal and the row handler call. Keep the panel itself: score headline,
   `Dag N`, `Klart` — the map stays pannable and zoomable behind it.

6. **Mobile.** The summary panel follows the existing sheet-along-the-bottom
   pattern; make sure its max height leaves map visible above it (the pairs
   must not render underneath the sheet — that is what the padding is for).

## Acceptance

- Play a full day → after the fifth `Se dagen`, the map shows five numbered
  guess→answer pairs; each row click frames its pair; `Klart` returns to the
  start door and clears the shapes.
- `node --test 'test/*.test.mjs'` green, including the new `summaryBounds`
  tests and the unchanged blind test.
- No regression to the single-pair reveal mid-day (it uses the same source).

## Docs

- `DECISIONS.md`: one dated bullet — **The day ends on a map** — the summary
  was a list of words about a map; now it is the map. Two sentences suffice.
- `README.md`: leave for plan 06.
