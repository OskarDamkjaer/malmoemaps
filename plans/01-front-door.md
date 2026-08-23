# Plan 01 — The front door is Förr

**Goal.** Opening the app lands on Förr. Öva is one tab away and fully working.
Copy, title and manifest stop claiming the app is a name-learning quiz.

**Touches.** `app/app.js`, `app/index.html`, `app/manifest.webmanifest`,
`app/photos.mjs` (comment only), `app/app.css` (only if the id rename below is
done), `DECISIONS.md`, one status note in `README.md`.

**Does not touch.** `photos.js` game logic, `learn.js`/`rounds.mjs`, `sw.js`
(no file-list changes; the code cache is stale-while-revalidate, so edits flow
without a version bump), any test file.

## Steps

1. **Boot mode.** In `app/app.js`'s `map.on('load')`, change `setMode('learn')`
   to `setMode('photos')`.

2. **Swap the two failure attitudes.** Today `initLearn` failing is fatal
   (`fail(...)` + `return`) and `initPhotos` failing merely hides its tab.
   Invert them: Förr *is* the app now, so a missing `game.json` is the failure
   worth saying out loud; a missing `learn.json` costs a tab and nothing else
   (hide every `.modetab[data-mode="learn"]`, log to console). Update the
   comment above that block — it currently explains the opposite priority.

3. **The way back from Utforska.** The floating `#tolearn` button's handler
   becomes `setMode('photos')`, and its label/icon copy reads "Förr" rather
   than "Öva". Rename the id to `tohome` if you like — it is referenced in
   `app.js`, `index.html` and `app.css`; grep before renaming. Update the
   comment above the handler: it currently says the button returns to Öva
   "because the quiz is what the app is for", which is now false.

4. **Tab order.** In both front doors (`#learn` and `#photostart`), put the
   Förr tab first. The `aria-current="page"` default in the static markup
   belongs on the Förr tab of `#photostart`. (`setMode` already keeps
   `aria-current` truthful at runtime; this is about the pre-JS state.)

5. **Title and meta.** `<title>` → `Förr — gamla Malmö`; meta description →
   `Fem fotografier av Malmö, varje dag. Gissa år och plats. Fungerar offline.`
   `manifest.webmanifest`: `name` → `Förr — gamla Malmö`, `short_name` →
   `Förr`. Icons and theme colour stay as they are. (Final wording is the
   owner's call — these are proposals, flag them in the PR description.)

6. **Honest credit on the Förr door.** The intro in `#photostart` says
   "Fem fotografier ur Malmö Museers samlingar" — but everything after 1999
   comes from Wikimedia Commons. Rewrite to credit both, e.g.
   `Fem fotografier om dagen: Malmö Museer före 2000, Wikimedia Commons efter.
   Gissa vilket år de togs och var fotografen stod. Samma fem för alla, hela dagen.`

7. **Fix the stale corpus comment in `app/photos.mjs`.** The comment above
   `yearScore` still describes the corpus as running "1880 to the mid-1970s" —
   that predates the Commons half. It runs 1881–2026, tilted recent (see
   README / `game/SOURCES.md`). Re-check the decay rationale while there and
   say so in the comment: with a recent-tilted corpus a mid-slider shrug is
   typically 40–70 years out, so the steep decay still separates knowing from
   shrugging. Comment-only change; do not touch the constant.

## Acceptance

- `node scripts/serve.mjs` → opening `http://127.0.0.1:8080/` lands on the
  Förr door; both tabs switch doors; Utforska's back button returns to Förr.
- Dev tools → Application → Manifest shows the new name.
- `node --test 'test/*.test.mjs'` — green, unchanged.
- Hide-`learn`-tab path: temporarily rename `build/data/learn.json`, reload,
  confirm the app still boots to Förr with the Öva tab gone. Restore the file.

## Docs

- `DECISIONS.md`: one dated bullet — **The front door is Förr** — reversing the
  front-door half of "The app is for learning the city, not for looking things
  up" (2026-08-03). Note that the quiz stays reachable and that plan 04
  extracts it; keep it short, the series overview carries the context.
- `README.md`: do **not** rewrite (that is plan 06). Add a short status note
  near the top: mid-migration, Förr is the front door, see `plans/`.
