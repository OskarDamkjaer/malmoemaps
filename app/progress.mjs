// What you know, and what you keep getting wrong.
//
// The whole store is one localStorage key of small integers — nothing leaves
// the device here either, and a learning app that phoned home would be a
// stranger kind of app than this one wants to be.
//
// The unit is the *item*, not the chunk: "Sofielund" is a thing you either can
// or cannot place, and it should be asked of you more often until you can. A
// chunk is only a bag of items that happen to be near each other, so a chunk
// has no score of its own — its bar is just how many of its items are known.
//
// Items are keyed by name alone. That used to be impossible: "Limhamn" was two
// questions, the name-in-between and the delområde, and answering one was not
// evidence about the other. With those two levels cut there is one Limhamn, and
// build-learn.mjs enforces that across the whole quiz. Keying by name rather
// than by chunk is what lets the chunk boundaries move — a stadsdel recut, a
// new landmark shifting the west-to-east split — without anyone losing what
// they had learned.
//
// Knowing is deliberately hard to reach and easy to lose: two right answers in
// a row, and one miss takes it away. Placing something correctly once is mostly
// evidence about the last ten seconds.

// v2: keys used to be `roundId|name`. Those entries mean nothing now and there
// is no honest way to migrate them (a `stadsdelar|Centrum` streak is not
// evidence about the delområde Centrum), so they are left behind rather than
// reinterpreted.
const KEY = 'malmo:learned:v2';
const KNOWN_STREAK = 2;

/** Right the last two times in a row, without being shown the answer. */
export const isKnown = (rec) => (rec?.streak ?? 0) >= KNOWN_STREAK;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    // Corrupt or blocked storage means starting over, never a crash on boot.
    return {};
  }
}

function save(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* private mode; forgetting what you learned is not worth a failure */ }
}

let store = load();

export const statOf = (name) => store[name] ?? null;

/**
 * Record an attempt. Three outcomes rather than two: being shown the answer
 * after two misses is not the same as getting it wrong and moving on, and it is
 * certainly not getting it right. It resets the streak but still counts as
 * having met the thing, which is what makes the next question about it come
 * sooner rather than later.
 */
export function record(name, outcome) {
  const rec = store[name] ?? { seen: 0, right: 0, wrong: 0, helped: 0, streak: 0, last: 0 };
  rec.seen += 1;
  rec.last = Date.now();
  if (outcome === 'right') {
    rec.right += 1;
    rec.streak += 1;
  } else {
    rec[outcome === 'helped' ? 'helped' : 'wrong'] += 1;
    rec.streak = 0;
  }
  store[name] = rec;
  save(store);
  return rec;
}

/** How far through a set of items you are: what the bar in the picker draws. */
export function progressOf(items) {
  let known = 0;
  for (const it of items) if (isKnown(statOf(it.name))) known += 1;
  return { known, total: items.length };
}

/**
 * The order to ask in.
 *
 * Weight is what the item costs you, not what it is worth: never met beats met
 * and forgotten beats known, and within each band the one you have missed most
 * comes first. The jitter is there so a chunk is not the same recital every
 * time — enough to shuffle neighbours, never enough to move a known item ahead
 * of an unmet one.
 */
export function inAskingOrder(items) {
  const weigh = (it) => {
    const rec = statOf(it.name);
    if (!rec) return 100;
    if (isKnown(rec)) return 10 - Math.min(9, (Date.now() - rec.last) / 864e5);
    return 40 + (rec.wrong + rec.helped) * 8 - rec.streak * 5;
  };
  return items
    .map((it) => ({ it, w: weigh(it) + Math.random() * 6 }))
    .sort((a, b) => b.w - a.w)
    .map(({ it }) => it);
}

/** Everything this app remembers about you, gone. Offered in the picker. */
export function forgetEverything() {
  store = {};
  save(store);
}
