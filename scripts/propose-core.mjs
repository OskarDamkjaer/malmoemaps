// The sweep behind learn/core.json: every name in the quiz with the evidence
// for and against calling it core, laid out for a hand pass.
//
// The quiz is split in two — the names Malmö expects you to know, and the rest
// — and that split is a claim about people, not about data. So it is decided by
// hand, in learn/core.json. This script does not decide it. It writes
// learn/core-candidates.md: one row per name, sorted into ja / ? / nej by a
// rule, so what the hand pass reads is a shortlist rather than a blank page.
//
// Same shape and purpose as areas/elevated.md — the evidence in one table, the
// decision somewhere else, and the table regenerable so nothing is researched
// twice.
//
// ---- the rule the pre-sort uses ---------------------------------------------
//
// Core is not the top third of the city. It is the *first* third, read outward
// from Stortorget, and what thins with distance is not the category but the
// grain: how fine a thing you are expected to be able to name out there.
//
//   A  ≲1 km    inside the canal ring — nearly everything. One square
//               kilometre, and the part of town everybody shares.
//   B  ≲2.5 km  the inner city, out to Inre Ringvägen — every area name, the
//               through-roads but not the residential grid, the landmarks that
//               are destinations.
//   C  ≲6 km    the rest of the built city — only names that are *their own*
//               (a delområde no grouping speaks for), and the arteries that
//               reach them.
//   D  beyond   the place, and the road that gets you there. Nothing inside it.
//
// Where the rule and the sentence disagree, the sentence wins — that is what
// the hand pass is for, and it is why the verdicts here are a suggestion in a
// markdown file rather than a `core` field in the build. The known disagreement
// is the broar: band A says "nearly everything" and there are fifteen named
// crossings of the canal ring inside that one kilometre. Nobody knows fifteen
// bridge names. So every bridge comes out as `?` and all nineteen are decided
// by hand.
//
// Usage: node scripts/propose-core.mjs [--out FILE]
import { readFile, writeFile } from 'node:fs/promises';
import { distance } from './lib/geo.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outFile = arg('--out', 'learn/core-candidates.md');

const json = async (f) => JSON.parse(await readFile(f, 'utf8'));

const [learn, areasDoc, streetIndex, landmarksDoc, bridgesDoc, core] = await Promise.all([
  json('build/data/learn.json'),
  json('areas/areas.json'),
  json('data/cache/streets.json'),
  json('landmarks/landmarks.json'),
  json('learn/bridges.json'),
  json('learn/core.json').catch(() => null),
]);

const { items } = learn;

// The same anchor the quiz used to order its chunks by, and for the same
// reason: "the middle of Malmö is Stortorget" is a claim anyone can check.
const centre = items.find((it) => it.name === 'Stortorget')?.point;
if (!centre) {
  console.error('propose-core: Stortorget is gone — there is nothing to measure from');
  process.exit(1);
}

const BANDS = [
  { id: 'A', to: 1000, what: 'innanför kanalen' },
  { id: 'B', to: 2500, what: 'innerstaden, innanför Inre Ringvägen' },
  { id: 'C', to: 6000, what: 'staden innanför Yttre Ringvägen' },
  { id: 'D', to: Infinity, what: 'utanför' },
];

const bandOf = (m) => BANDS.find((b) => m < b.to);

// ---- what each kind knows about itself ---------------------------------------
// Which grouping in areas.json speaks for a delområde, and whether that
// grouping is only the delområde itself under another name. A one-member
// grouping is a *promotion* — an explicit, sourced claim that people say the
// name — so it counts the same as having no name above you at all.
const speaksFor = new Map();
for (const a of areasDoc.areas) {
  for (const d of a.covers ?? []) speaksFor.set(d, { name: a.name, members: a.covers.length });
}

function areaStanding(name) {
  const g = speaksFor.get(name);
  if (!g) return { own: true, note: 'egen (ingen gruppering ovanför)' };
  if (g.members === 1) {
    return g.name === name
      ? { own: true, note: 'egen (befordrad i areas.json)' }
      : { own: true, note: `egen, men kallas ${g.name}` };
  }
  return { own: false, note: `under ${g.name}` };
}

const CLASS = {
  1: 'Motorväg', 2: 'Huvudled', 3: 'Genomfartsgata', 4: 'Huvudgata',
  5: 'Gata', 6: 'Gata', 7: 'Gång- och cykelväg',
};

const streetByName = new Map();
for (const st of streetIndex) {
  const prev = streetByName.get(st.name);
  if (!prev || st.rank < prev.rank) streetByName.set(st.name, st);
}

const tierOf = new Map(landmarksDoc.landmarks.map((l) => [l.name, l.tier]));
const crosses = new Map(bridgesDoc.bridges.map((b) => [b.name, b.over]));

// How long a street reaches, across the diagonal of its extent. A street you
// cannot miss because it crosses the city is a different kind of thing from a
// four-hundred-metre lane, and the rule cannot see that from the class alone.
function reach(bbox) {
  if (!bbox) return null;
  return distance([bbox[0], bbox[1]], [bbox[2], bbox[3]]);
}

function evidenceFor(it) {
  if (it.kind === 'area') {
    const { own, note } = areaStanding(it.name);
    return { own, text: note };
  }
  if (it.kind === 'street') {
    const hit = streetByName.get(it.name);
    const rank = hit?.rank ?? 8;
    const m = reach(it.bbox);
    return { rank, text: `${CLASS[rank] ?? 'Gata'}${m ? `, ${(m / 1000).toFixed(1)} km` : ''}` };
  }
  if (it.kind === 'landmark') {
    const tier = tierOf.get(it.name) ?? 2;
    return { tier, text: tier === 1 ? 'Landmärke (tier 1)' : 'Sevärdhet (tier 2)' };
  }
  return { text: `över ${crosses.get(it.name) ?? '—'}` };
}

/**
 * The rule's guess, per band and per kind. Three answers, and the middle one is
 * the only one that matters: `?` is the row somebody has to read.
 */
function suggest(it, band, ev) {
  // Decided by hand, all nineteen. See the head comment.
  if (it.kind === 'bridge') return band.id === 'A' || band.id === 'B' ? '?' : 'nej';

  if (band.id === 'A') return 'ja';

  if (it.kind === 'area') {
    // A delområde some grouping speaks for has already been ruled on once, in
    // areas.json, against a stricter bar than this one: Ribersborg is not what
    // anyone answers "var bor du?" with. No need to ask twice.
    if (band.id === 'B') return ev.own ? 'ja' : 'nej';
    return ev.own ? '?' : 'nej';
  }

  if (it.kind === 'street') {
    if (band.id === 'B') return ev.rank <= 4 ? 'ja' : '?';
    if (band.id === 'C') return ev.rank <= 3 ? 'ja' : ev.rank === 4 ? '?' : 'nej';
    return ev.rank === 1 ? 'ja' : ev.rank <= 3 ? '?' : 'nej';
  }

  // landmark
  if (band.id === 'B') return ev.tier === 1 ? 'ja' : '?';
  return ev.tier === 1 ? '?' : 'nej';
}

// ---- the table ---------------------------------------------------------------
const KIND_LABEL = {
  area: 'Delområden', street: 'Gator', bridge: 'Broar', landmark: 'Landmärken',
};
const KIND_ORDER = ['area', 'street', 'bridge', 'landmark'];

// What is already decided, so a regenerated table does not throw away the pass
// that has already been made over it.
const decided = new Map();
if (core) {
  for (const [section, names] of Object.entries(core.core ?? {})) {
    for (const n of names) decided.set(n, section);
  }
}

const rows = items.map((it) => {
  const m = distance(it.point, centre);
  const band = bandOf(m);
  const ev = evidenceFor(it);
  return {
    it,
    band,
    km: m / 1000,
    ev,
    suggested: suggest(it, band, ev),
    inCore: decided.has(it.name),
  };
}).sort((a, b) => KIND_ORDER.indexOf(a.it.kind) - KIND_ORDER.indexOf(b.it.kind)
  || a.km - b.km);

const tally = (list) => {
  const t = { ja: 0, '?': 0, nej: 0 };
  for (const r of list) t[r.suggested] += 1;
  return t;
};

const out = [];
out.push('# Kärnan: kandidater');
out.push('');
out.push('Generated by `node scripts/propose-core.mjs`. **Nothing here decides anything** —');
out.push('`learn/core.json` does. This is the evidence, sorted so the hand pass has a');
out.push('shortlist to argue with rather than 384 blank rows.');
out.push('');
out.push('The question each row is asking:');
out.push('');
out.push('> **If someone said "jag bor i X" or "vi ses vid X" on the phone, would you');
out.push('> have to ask where that is?**');
out.push('');
out.push('If yes, it is not core. Same shape as the *var bor du?* test `areas/areas.json`');
out.push('uses for its promotions, and deliberately about people rather than about data.');
out.push('');
out.push('`ja` / `?` / `nej` is the rule\'s guess from the band and the kind (see the head');
out.push('comment in the script for the rule). `kärna` is what `learn/core.json` actually');
out.push('says today — a `·` there against a `ja` here, or a `✓` against a `nej`, is a');
out.push('place the hand pass overruled the rule. Those are the interesting rows.');
out.push('');

out.push('## Bands');
out.push('');
out.push('| Band | | Namn | ja | ? | nej |');
out.push('|---|---|--:|--:|--:|--:|');
for (const b of BANDS) {
  const list = rows.filter((r) => r.band.id === b.id);
  const t = tally(list);
  const to = b.to === Infinity ? '' : `< ${(b.to / 1000).toFixed(1)} km — `;
  out.push(`| ${b.id} | ${to}${b.what} | ${list.length} | ${t.ja} | ${t['?']} | ${t.nej} |`);
}
const all = tally(rows);
out.push(`| | **allt** | **${rows.length}** | **${all.ja}** | **${all['?']}** | **${all.nej}** |`);
out.push('');

for (const kind of KIND_ORDER) {
  const list = rows.filter((r) => r.it.kind === kind);
  const t = tally(list);
  const chosen = list.filter((r) => r.inCore).length;
  out.push(`## ${KIND_LABEL[kind]}`);
  out.push('');
  out.push(`${list.length} namn · rule says ${t.ja} ja, ${t['?']} ?, ${t.nej} nej`
    + ` · core.json says **${chosen}** (${Math.round((chosen / list.length) * 100)} %)`);
  out.push('');
  out.push('| | kärna | namn | band | km | vad det är |');
  out.push('|---|---|---|---|--:|---|');
  for (const r of list) {
    out.push(`| ${r.suggested} | ${r.inCore ? '✓' : '·'} | ${r.it.name} | ${r.band.id}`
      + ` | ${r.km.toFixed(1)} | ${r.ev.text} |`);
  }
  out.push('');
}

await writeFile(outFile, `${out.join('\n')}\n`);

console.log(`propose-core → ${outFile}`);
for (const b of BANDS) {
  const list = rows.filter((r) => r.band.id === b.id);
  const t = tally(list);
  console.log(`  ${b.id}  ${String(list.length).padStart(3)} namn   ja ${String(t.ja).padStart(3)}`
    + `   ? ${String(t['?']).padStart(3)}   nej ${String(t.nej).padStart(3)}`);
}
const chosen = rows.filter((r) => r.inCore).length;
console.log(`  rule: ${all.ja} ja + ${all['?']} to decide`
  + `   core.json: ${chosen} of ${rows.length} (${Math.round((chosen / rows.length) * 100)} %)`);
