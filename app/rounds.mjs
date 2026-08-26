// What can be learned, and what counts as knowing it.
//
// There is one quiz, and one question to answer before you can start it: **which
// of these 384 names am I supposed to know?** Everything else here is downstream
// of that.
//
// So the quiz is cut in two — Grunden, the names Malmö expects of anyone who has
// lived here a few years, and Resten, everything else — and then by kind inside
// each half. Eight rounds. `learn/core.json` is where the first cut is decided,
// by hand and against a sentence rather than a formula; `TIERS` below only reads
// the answer.
//
// A *kind* is what a round used to be, and is now a property of the item rather
// than of the game:
//
//   shape  — an area is placed by landing inside it, a point by landing near it,
//            a street by landing on it. Nothing else is needed: the answer is
//            the geometry the map already has.
//   near   — how close counts, for the kinds that are graded by distance.
//
// There is one question — **peka ut**: one name at a time, in the order `byKind`
// sets, on a bare map, tap where it is.
//
// There used to be two. The other one, "dra ut alla", lit up every slot the name
// could go in and asked you to pick among them, on the theory that recognition
// is the easy direction you start with before you can recall. What it actually
// was, once the slots were drawn, was a matching exercise: with the delområden
// outlined and the streets stroked, the map had already narrowed the answer to a
// dozen shapes and the round was about telling those shapes apart rather than
// about knowing where anything is. Two modes also meant every chunk offered a
// choice nobody had the information to make, and half the code in learn.js
// existed to keep the easy half honest. One question, asked properly.
//
// The map is yours while you answer: pan and zoom are on, because zooming in to
// be sure is not cheating when there are no labels to read — and a round now
// opens framed to the whole city, which is nowhere near a scale you could tell
// two canal bridges apart at.

/**
 * The kinds of thing the quiz can ask about.
 *
 * `near` is a floor, not the whole rule (see `graded`): a drop also has to be
 * nearer the answer than to anything else of its kind in the quiz, which is what
 * stops "somewhere in Västra Hamnen" from counting for all four of the landmarks
 * standing there.
 *
 * The declaration order is load-bearing: it is the order a round asks in (see
 * `byKind`) and the order the picker lists its rows in, so the two cannot
 * disagree about what comes first. It runs biggest thing to smallest — the
 * delområden are the frame everything else gets described against, the
 * through-roads cut that frame up, and the broar and landmärken are points you
 * hang on the result.
 */
// Both forms are written out because Swedish does not make plurals by adding a
// letter — delområde/delområden, bro/broar, gata/gator — and the plural is what
// the picker names a row with.
export const KINDS = {
  // The 136 delområden. Their boundaries are the question, so `district-line`
  // is the one layer the blinding is not allowed to take away.
  area: {
    shape: 'area', label: 'delområde', plural: 'delområden', outline: ['district-line'],
  },
  // A street is a line, and the map already knows how to find the one under
  // your finger (highlight.js), so this is the one kind where the answer is not
  // "near a point" but "on the right street".
  street: {
    shape: 'line', label: 'gata', plural: 'gator', near: 40,
  },
  bridge: { shape: 'point', label: 'bro', plural: 'broar', near: 120 },
  landmark: { shape: 'point', label: 'landmärke', plural: 'landmärken', near: 250 },
};

export const KIND_IDS = Object.keys(KINDS);

/** The outline layers the blinding must leave alone. */
export const OUTLINE_LAYERS = [...new Set(
  Object.values(KINDS).flatMap((k) => k.outline ?? []),
)];

/**
 * The zoom the tiles start naming ordinary streets at.
 *
 * `transportation_name` carries motorways and through-roads from z10, and the
 * other three thousand names only from z14 — so below it a street question
 * cannot be answered *or* graded, because the grader finds what you tapped by
 * looking it up in the tiles that happen to be loaded. Framed to fit a whole
 * stadsdel, a chunk opens well under this, which is why the round says so out
 * loud instead of marking correct answers wrong.
 *
 * A fact about the archive rather than a preference, so `test/streets.test.mjs`
 * reads it back out of malmo.pmtiles.
 */
export const STREET_ZOOM = 14;

// ---- distance ----------------------------------------------------------------
// Equirectangular rather than haversine. Over a city fifteen kilometres across
// the difference is centimetres, and every tolerance in this file is a round
// number of metres chosen by feel — so the exact formula is not what decides
// whether a drop counts.
const M_PER_DEG_LAT = 111320;

export function metersBetween(a, b) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((b[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * mPerDegLon, (a[1] - b[1]) * M_PER_DEG_LAT);
}

/**
 * A round runs one kind at a time: every delområde, then every gata, then the
 * broar, then the landmärken.
 *
 * The first version asked in whatever order the names came out, and mixing the
 * kinds cost more than it looked like it would. What you are doing when you
 * place a delområde is not what you are doing when you place a bridge — one is
 * "which of these outlines is it", the other is "where on the water is it" —
 * and alternating between them means starting over on every question. Grouped,
 * a run of one kind builds: a dozen questions in a row are the same act, and by
 * the end of the delområden you are reading the city's outlines rather than
 * working out afresh what you are being asked to do.
 *
 * Stable, so whatever order the caller already put the items in survives inside
 * each kind — progress.mjs's spaced repetition decides what to ask first, and it
 * gets to decide that *within* a kind.
 */
export function byKind(items) {
  return [...items].sort((a, b) => KIND_IDS.indexOf(a.kind) - KIND_IDS.indexOf(b.kind));
}

/**
 * A sanity ceiling, not a design target.
 *
 * This number has been about two different things. It was twenty, so that a
 * tray of nametags fitted a phone screen without scrolling — and that was the
 * wrong thing to optimise, because a twenty-name slice of Centrum is a few
 * blocks and a few blocks cannot hold a street: Amiralsgatan runs the width of
 * the city. So a chunk became a whole stadsdel and this became the cap on one.
 *
 * Now a round holds one name at a time, so nothing has to fit on a screen at
 * all and the only thing left to be afraid of is length. A chunk is a sitting;
 * past a couple of hundred questions it is a syllabus, and the honest fix for
 * that would be cutting the chunks finer rather than raising this. Resten ·
 * Gator is the one that tests it, at 119 — every through-road in Malmö that
 * nobody expects you to name. That is a long round and it is meant to be: it is
 * the round you are never finished with, which is what "Resten" says.
 */
export const MAX_CHUNK = 200;

/**
 * The two halves of the quiz, and the one thing the front door is a choice
 * between.
 *
 * `learn/core.json` decides which names are in Grunden, by hand and against a
 * sentence — *if someone said "jag bor i X" on the phone, would you have to ask
 * where that is?* — and build-learn.mjs stamps the answer onto every item. This
 * file only reads it. Resten is the remainder rather than the whole: the two
 * are disjoint, so nothing is asked of you under two headings.
 */
export const TIERS = [
  {
    id: 'core',
    label: 'Grunden',
    blurb: 'Namnen man förväntas kunna efter några år här.',
    has: (it) => it.core === true,
  },
  {
    id: 'rest',
    label: 'Resten',
    blurb: 'Allt det andra — tunnare ju längre ut du kommer.',
    has: (it) => it.core !== true,
  },
];

/**
 * The quiz, cut into playable pieces: one per half, per kind. Eight rounds.
 *
 * It used to be one chunk per stadsdel, on the argument — still true — that a
 * city is not learned a category at a time: standing on Föreningsgatan, what
 * you want to know is that this is Möllevången, that the bridge is Petribron
 * and that the park is Pildammsparken, and those are three kinds and one piece
 * of knowledge. What that cut could not answer is the question people actually
 * arrive with, which is not "which part of town shall I practise" but **which
 * of these 384 names am I supposed to know at all**. Ten rows all reading "23
 * of 41" say nothing about that; two rows saying "Grunden" and "Resten" say it
 * before you have pressed anything.
 *
 * The mixing did not survive it, and that is the price: a round is one kind
 * now, so it is one act repeated rather than four interleaved. Inside a round
 * that was already true — `byKind` has always grouped the questions by kind,
 * because placing a delområde and placing a bridge are different jobs and
 * alternating between them means starting over every question. The cut has just
 * caught up with the order.
 *
 * Chunks are derived from the items, never listed. Nothing is stored against a
 * chunk id — progress is per name (see progress.mjs) — so a name moving from
 * Resten to Grunden costs nobody what they had learned.
 */
export function chunksOf(items) {
  const chunks = [];
  for (const tier of TIERS) {
    for (const kind of KIND_IDS) {
      const of = items.filter((it) => it.kind === kind && tier.has(it));
      // A kind nobody put in this half is not an empty row on the front door.
      if (!of.length) continue;
      const { plural } = KINDS[kind];
      chunks.push({
        id: `${tier.id}:${kind}`,
        tier: tier.id,
        kind,
        label: plural[0].toUpperCase() + plural.slice(1),
        items: of,
      });
    }
  }
  return chunks;
}

/**
 * Was this drop right, and if not, what does the map want to say about it?
 *
 * One function for all three shapes, because "how close is close enough" is the
 * only rule in this app that decides anything, and it should be readable in one
 * place rather than restated per kind at each call site.
 *
 * `hit` is what the map found at the drop point: for an area, the item whose
 * polygon contains it; for the others, the nearest item and its distance.
 *
 * The pixel floor matters more than it looks. Zoomed out to a whole stadsdel,
 * 250 m is a handful of pixels, which is not a tolerance but a dare — so the
 * floor is whatever 26 screen pixels are worth at the zoom you are playing at,
 * and the metre figures in KINDS are what it can never be *tighter* than.
 */
export function graded({ item, hit, metersPerPixel = 0 }) {
  const kind = KINDS[item.kind];
  if (!kind) throw new Error(`no such kind: ${item.kind}`);

  if (kind.shape === 'area') {
    if (hit?.name === item.name) return { right: true };
    return { right: false, hitName: hit?.name ?? null };
  }

  const tolerance = Math.max(kind.near ?? 0, 26 * metersPerPixel);
  if (!hit) return { right: false, hitName: null, distance: null };
  const right = hit.name === item.name && hit.distance <= tolerance;
  return {
    right,
    hitName: right ? null : hit.name,
    // Reported from the answer, not from whatever was nearest: "400 m fel" is
    // about you and the thing you were asked for.
    distance: hit.targetDistance ?? null,
  };
}
