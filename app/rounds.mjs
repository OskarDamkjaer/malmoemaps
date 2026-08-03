// What can be learned, and what counts as knowing it.
//
// There is one quiz. It used to be six — a round per category, each with its own
// shape, its own tolerance and its own idea of how to cut itself up — and that
// was a menu of six things to practise rather than one thing to learn. A city is
// not learned a category at a time: standing on Föreningsgatan you want to know
// that this is Möllevången, that the bridge down there is Petribron and that the
// park is Pildammsparken, and those are three categories and one piece of
// knowledge.
//
// So the quiz is the city, cut geographically, and a chunk mixes whatever kinds
// of thing happen to be in that part of town. What used to be a round is now a
// *kind*, and a kind is a property of the item rather than of the game:
//
//   shape  — an area is placed by landing inside it, a point by landing near it,
//            a street by landing on it. Nothing else is needed: the answer is
//            the geometry the map already has.
//   near   — how close counts, for the kinds that are graded by distance.
//
// Both modes hand you one name at a time, in the order `byKind` sets, and they
// are the same question asked twice:
//
//   'tray'  — the name comes with its slots: every place in the chunk it could
//             go, lit on the map, with the ones you have already placed lit
//             green. You can see what is left, so the last few in a kind are
//             answered by elimination; that is the easy direction, and it is
//             where you start.
//   'point' — one name and a bare map, tap where it is. Nothing to eliminate
//             against, so this is the direction that says whether you know it.
//
// Tray mode is played at a fixed view (you cannot pan with a name in your
// hand). Point mode leaves the map yours — zooming in to be sure is not
// cheating when the labels are gone.

/**
 * The kinds of thing the quiz can ask about.
 *
 * `near` is a floor, not the whole rule (see `graded`): a drop also has to be
 * nearer the answer than to anything else in the chunk, which is what stops
 * "somewhere in Västra Hamnen" from counting for all four of the landmarks
 * standing there.
 *
 * The declaration order is load-bearing: it is the order a round asks in (see
 * `byKind`) and the order the picker lists a chunk's contents in, so the two
 * cannot disagree about what comes first. It runs biggest thing to smallest —
 * the delområden are the frame everything else gets described against, the
 * through-roads cut that frame up, and the broar and landmärken are points you
 * hang on the result.
 */
// Both forms are written out because Swedish does not make plurals by adding a
// letter — delområde/delområden, bro/broar, gata/gator — and the picker says
// "14 delområden · 1 bro · 2 gator" under every chunk.
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

export const MODES = ['tray', 'point'];

/**
 * A round runs one kind at a time: every delområde, then every gata, then the
 * broar, then the landmärken.
 *
 * The first version asked in whatever order the names came out, and mixing the
 * kinds cost more than it looked like it would. What you are doing when you
 * place a delområde is not what you are doing when you place a bridge — one is
 * "which of these outlines is it", the other is "where on the water is it" —
 * and alternating between them means starting over on every question. Grouped,
 * a run of one kind builds: the board lights the same set of slots for a dozen
 * questions in a row, what you have already placed stays on screen next to what
 * you have not, and the last few in a kind genuinely do go by elimination.
 *
 * Stable, so whatever order the caller already put the items in survives inside
 * each kind — tray mode hands this a shuffle, point mode hands it
 * progress.mjs's spaced repetition, and both keep their idea of what to ask
 * first *within* a kind.
 */
export function byKind(items) {
  return [...items].sort((a, b) => KIND_IDS.indexOf(a.kind) - KIND_IDS.indexOf(b.kind));
}

/**
 * Fisher–Yates, because `sort(() => Math.random() - 0.5)` is not a shuffle: it
 * asks the comparator for an inconsistent answer and leaves items near where
 * they started. "In a random order" is now the documented behaviour of a round
 * rather than a nicety, so it should be the real thing.
 */
export function shuffled(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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
 * Now the tray holds one name at a time, so nothing has to fit on a screen at
 * all and the only thing left to be afraid of is length. A chunk is a sitting;
 * past a couple of hundred questions it is a syllabus, and the honest fix for
 * that would be cutting the chunks finer rather than raising this. Centrum is
 * the one that tests it, at 120 — twenty delområden, fifty-odd streets, and
 * almost every bridge and landmark in the city. That is a long round and it is
 * meant to be: it is also the part of town where knowing the names is worth
 * the most.
 */
export const MAX_CHUNK = 200;

/**
 * The city, cut into playable pieces: one per stadsdel.
 *
 * A stadsdel is a line the city already has and a line people already think in,
 * and — the reason it is not cut any finer — it is big enough that a street
 * running through five delområden is inside one chunk with room to be seen end
 * to end. Chunks are uneven as a result (Rosengård has 13 names, Centrum 120),
 * which is honest: those parts of town are not the same size either.
 *
 * Chunks are derived from the items, never listed: a delområde that moves
 * stadsdel moves chunk without anyone editing this file. Nothing is stored
 * against a chunk id (progress is per name — see progress.mjs), so the cut can
 * change between builds without costing anyone what they have learned.
 */
export function chunksOf(items) {
  const byStadsdel = new Map();
  for (const it of items) {
    const k = it.stadsdel ?? 'Övriga';
    if (!byStadsdel.has(k)) byStadsdel.set(k, []);
    byStadsdel.get(k).push(it);
  }

  return [...byStadsdel]
    .sort((a, b) => a[0].localeCompare(b[0], 'sv'))
    .map(([stadsdel, all]) => ({ id: stadsdel, label: stadsdel, items: all }));
}

/**
 * Was this drop right, and if not, what does the map want to say about it?
 *
 * One function for all three shapes, because "how close is close enough" is the
 * only rule in this app that decides anything, and it should be readable in one
 * place rather than spread across the two modes that call it.
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
