# Förr-first: plan series overview

The app stops being a quiz with a photo game attached and becomes **Förr** — a
TimeGuessr narrowed to one municipality — first and foremost. The name-placing
quiz is not deleted and not merely demoted: it is **extracted into its own
self-contained subproject** at `/quiz/`, sharing the map core, so the main app
is small and the quiz can be maintained, ignored, or one day lifted out as one
folder. The curated learning material (`learn/*.json`, `learn/images/`) stays in
the repo untouched — it is the obvious source for a future Anki export, which is
deliberately *not* planned now.

Offline stays a hard principle: the install precaches everything the Förr app
needs, and a **payload budget** checked in the build is the mechanism that
decides how large the photo corpus may grow.

## Target shape

```
/            Förr — the whole app: daily five, archive, practice, Utforska
/quiz/       Öva — the name-placing quiz, self-contained, own entry point
shared/      the map core both entries import: boot, explore chrome, blind,
             highlight, layers, categories, area-levels, search, kinds, geo
```

The one invariant that makes the split work: **every cross-directory import is
relative** (`../shared/geo.mjs`), and the on-disk layout mirrors the URL layout
(`app/`→`/`, `quiz/`→`/quiz/`, `shared/`→`/shared/`). The same relative string
then resolves correctly in the browser (URL resolution) and in Node (build
scripts, tests). Absolute `/…` imports would break Node; `/app/…` URLs do not
exist because `app/` is mounted at `/`.

## The plans, in execution order

| # | plan | mainly touches | depends on |
|---|------|----------------|------------|
| 01 | [Front door flip](01-front-door.md) | `app.js`, `index.html`, manifest, copy | — |
| 02 | [End-of-day summary map](02-summary-map.md) | `photos.js`, `photos.mjs`, `index.html` | 01 |
| 03 | [Archive & practice mode](03-archive-mode.md) | `photos.js`, `photos.mjs`, `index.html` | 02 (same files — land sequentially) |
| 04 | [Quiz subproject extraction](04-quiz-subproject.md) | structural: `shared/`, `quiz/`, `sw.js`, `site.mjs`, tests | 03 |
| 05 | [Corpus growth within budget](05-corpus-budget.md) | `scripts/`, `game/`, review UI | 04 (for the arithmetic) |
| 06 | [Docs pass](06-docs-pass.md) | `README.md`, `DECISIONS.md`, `AGENTS.md` | all of the above |

02 and 03 both edit `photos.js` chrome — do **not** run them in parallel.
05's *human* half (reviewing photographs in `scripts/review/`) can start any
time, today included; only its tooling half waits for 04.

## Running a plan with a cloud agent

One branch + one PR per plan. Suggested prompt:

```
Work on a branch named plan/NN-<name>. Read, in this order: AGENTS.md,
plans/00-overview.md, plans/NN-<name>.md, and DECISIONS.md (conventions and
prior rationale). Implement exactly what the plan says, in the plan's phases.
Run `node --test 'test/*.test.mjs'` — nothing may fail that didn't fail before
the plan. Update README.md / DECISIONS.md only where the plan says to.
If the plan contradicts the code, stop and report instead of improvising.
Open one PR when done.
```

Land plans in the table's order. If a plan lands in a way that drifts from what
was written here, update this file and the later plans before kicking off the
next agent — the plans are only worth what their accuracy is.

## Explicit non-goals (do not let agents add these)

- **Share-result grid / emoji copy-paste.** Considered, not wanted now.
- **Streaks or gamified stats** beyond what `photos.mjs` already stores.
- **Anki export.** Not planned; the curated `learn/` data is simply preserved.
- **Backend, accounts, leaderboards.** The daily game stays a pure function of
  the date; that is why it needs no server.
- **Two-tier photo cache.** Precache-all stays; the budget caps the corpus
  instead. (DECISIONS.md already calls the tiered version a retreat.)
- **Renaming the repo or changing hosting.**

## Pre-step, before plan 01

The entire Förr mode is currently **uncommitted**. Commit it first — every
plan's diff is noise against a dirty tree. Suggested: one commit for the Förr
mode as it stands, matching the repo's log style.
