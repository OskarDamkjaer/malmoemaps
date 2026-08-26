# Working in this repo

`README.md` is the spec and `DECISIONS.md` is the rationale. This file is only
the things that are quicker to be told than to find out.

## Tests skip; they do not fail

```
node --test 'test/*.test.mjs'       # the whole suite — no runner, no config
node --test test/blind.test.mjs     # one file
node --test --watch 'test/*.test.mjs'
```

**Read the skip count, not just the failures.** 32 of 51 tests skip on a fresh
checkout, because `build/` and `data/` are gitignored and every test that reads
them stands down with a message instead of failing. A green run is not
necessarily a run.

What each tier needs:

- **`build/style.json`** — `node scripts/build-style.mjs`. One fetch of OSM
  Liberty at a pinned commit, a few seconds, network only. Unskips
  `style.test.mjs` and `blind.test.mjs`. `.claude/hooks/session-start.sh` does
  this automatically in web sessions.
- **`build/data/*.geojson` + `learn.json`** — unskips `areas.test.mjs` and most
  of `rounds.test.mjs`.
- **`data/cache/malmo.pmtiles`** — unskips `streets.test.mjs`.
- **A browser + `playwright-core`** — unskips `smoke.test.mjs`, the headless
  boot of the app. The repo has no `package.json`, so the module is resolved
  from a temp install.

The last two need `osmium`, Java 21 and a 772 MB OSM extract, and the hosts
they download from are blocked in a web sandbox. **A web session can fetch them
instead**: `node scripts/fetch-dev-assets.mjs` downloads a pinned release asset
that carries `build/data/`, `data/cache/malmo.pmtiles`, `app/glyphs/` and
`app/sprite/` — everything except `build/style.json`, which the hook builds
directly. It is a no-op when present and verifies a checksum.
`.claude/hooks/session-start.sh` calls both, so a web session should reach 51
passing and 0 skipped without running the pipeline (the smoke test still needs
`playwright-core`, which the sandbox preinstalls). **Do not try to run the data
pipeline there** — `build-site.mjs` included, which FATALs on the missing inputs
before it reaches anything worth testing.

## Finding things

`README.md` is long; `grep -n '^## ' README.md` gives you the map. *Layout*
has the directory tree and the app's file-by-file inventory, *Building the data*
and *Building and running the app* list every script with its inputs and
outputs, *Tests* explains what each test is defending.

`DECISIONS.md` is dated rationale bullets and **never names files** — don't grep
it for them.

## Removing a concept

Grep `test/` along with `app/` and `scripts/`, and try the singular as well as
the plural. The tests assert against module internals — layer ids,
`metadata.level`, `metadata.role` — so a concept usually has an assertion
somewhere that a sweep of `app/` will not find. That is what happened with
`test/area-levels.test.mjs`: it kept asserting `metadata.category === 'parts'`
after the categories were deleted, and had to be updated to assert `undefined`
instead.

Read whole files rather than slicing them. Nothing here is over 800 lines, and
`app/app.css` and `app/layers.js` in particular cost more in probing than they
would have in one read.

## Conventions

- **No framework, no bundler, no linter, no `package.json`, no `node_modules`.**
  The browser loads the ES modules as written. Don't add a dependency.
- **Comments are prose and load-bearing.** They say *why*, in full sentences, in
  the voice of the surrounding file. Match that rather than trimming to a
  one-liner. UI strings and user-facing errors are Swedish.
- **Docs lead, code follows.** README and DECISIONS get rewritten for the state
  the project is moving to, and the code catches up after.
- **Commits** are `Topic: a lowercase clause`, often with an em dash, plus a
  prose body explaining the reasoning. `git log` is the house style guide.
- **The container's git identity is `user.name=Claude`.** Commit with
  `-c user.name=… -c user.email=…` so the authorship matches the rest of the
  history.
