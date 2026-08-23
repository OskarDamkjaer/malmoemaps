// The sweep behind game/photos.json: every photograph that could be a question,
// with the evidence for and against, laid out for a hand pass.
//
// Förr asks you to date a photograph and say where it was taken, so a candidate
// has to carry two things: a year that means *when the shutter opened*, and a
// place precise enough to grade a tap against. This script finds the ones that
// do. It does not decide anything — it writes game/photo-candidates.md, sorted
// ja / ? / nej by a rule, so what the hand pass reads is a shortlist rather than
// fifteen thousand rows.
//
// Same shape and purpose as learn/core-candidates.md and areas/elevated.md: the
// evidence in one table, the decision somewhere else, and the table regenerable
// so nothing is researched twice.
//
// ---- two archives, because neither one is a century -------------------------
//
// **K-samsök** (scripts/lib/ksamsok.mjs) holds Malmö before 2000 and nothing
// after it. Its openly-licensed material is structurally old — Public Domain
// Mark and age are the same fact — so on its own the game is a quiz about a city
// with no cars in it, thickest around 1900 and gone by 1975. It has thousands of
// photographs per decade from the 1880s to the 1990s and **no coordinates at
// all**, so its records are placed by matching the description against names the
// quiz already holds geometry for.
//
// **Wikimedia Commons** (scripts/lib/commons.mjs) is the mirror image: almost
// nothing before 2000, then hundreds a year, and every one of them geotagged by
// the camera that took it. No geocoding, no name matching, no inference. It is
// also where the things that *happened* are — Malmöfestivalen, the Eurovision
// final, Turning Torso going up — and where the photographs with people in them
// are, which the museum's street views mostly are not.
//
// The split is at 2000 because that is where each archive stops being able to
// help: Commons has seven usable photographs from before it, and K-samsök has
// almost none after.
//
// Commons is taken from **geosearch only**, never by walking categories. The
// category graph leaks: "People of Malmö" at depth two reaches individual
// people and then photographs of them taken anywhere in the world, and
// "Eurovision Song Contest 2024" returns files from 2004. A coordinate inside
// the bbox is a fact; category membership is somebody's filing decision. So
// categories are read as a *label* — what a photograph is of — and never as
// evidence that it is of Malmö.
//
// Usage: node scripts/propose-photos.mjs [--out FILE] [--target N] [--refresh]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { photographs as ksamsokPhotographs } from './lib/ksamsok.mjs';
import { geotagged, licenseOk } from './lib/commons.mjs';
import { imageUrl } from './lib/carlotta.mjs';
import { distance } from './lib/geo.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

const outFile = arg('--out', 'game/photo-candidates.md');
const TARGET = Number(arg('--target', 250));
const REFRESH = has('--refresh');

// Where one archive stops being able to help and the other starts. See header.
const SPLIT = 2000;
const FROM = 1880;

/**
 * How many photographs each decade should contribute.
 *
 * Not flat, and not proportional to what the archives hold. Proportional would
 * be a quiz about 1900 — a third of everything placeable is from that one decade
 * — and flat would spend as much of the set on the 1880s as on the 2010s, when
 * there is far more of Malmö that people actually remember in the second.
 *
 * So it ramps. Counted per year rather than per decade the skew is steeper than
 * it looks: the 120 years before 2000 get about 1.2 photographs each, the 26
 * years after get about 3.9. A player should meet the 1890s often enough to
 * learn what 1890 looks like, and meet the last twenty-five years often enough
 * that the game is about the city they live in.
 *
 * **The 1970s to the 1990s are a hole, and it is the archives' rather than
 * this file's.** Placeable supply runs to hundreds a decade until 1970 and then
 * falls off a cliff: 19 from the 1970s, **1** from the 1980s, 12 from the 1990s.
 * Malmö Museer's openly-licensed material is old because Public Domain Mark and
 * age are the same fact, and Commons barely existed before digital cameras —
 * it has seven usable photographs from the whole of the twentieth century's last
 * quarter. Those three decades are set to what can actually be had rather than
 * to what would be nice, and the report prints supply beside quota so a thin row
 * reads as a fact about Malmö's archives instead of a bug.
 *
 * A decade that still cannot fill hands the remainder to the others rather than
 * shrinking the set — see `balanced`.
 */
const QUOTA = {
  1880: 8, 1890: 10, 1900: 12, 1910: 12, 1920: 12, 1930: 12, 1940: 14, 1950: 14,
  1960: 14, 1970: 12, 1980: 4, 1990: 10, 2000: 28, 2010: 42, 2020: 32,
};

const decadeOf = (year) => Math.floor(year / 10) * 10;

// ---- what a photograph is of -------------------------------------------------
// Read off the Commons category string and the K-samsök description. Only ever
// a label on the row and a nudge in the sort — the hand pass decides.
const SUBJECTS = [
  [/festival|konsert|concert|eurovision|musik|karneval/i, 'musik'],
  [/demonstration|protest|manifestation|pride|strejk/i, 'demonstration'],
  [/fotboll|football|match|derby|idrott|sport|handboll/i, 'sport'],
  [/marknad|torgdag|folkliv|gatuliv|folksamling|publik|crowd|people|barn|arbetare/i, 'folkliv'],
  [/bygge|byggnation|construction|uppförande|rivning|nybygge/i, 'bygge'],
  [/spårvagn|tram|buss|tåg|train|järnväg|hamn|färja/i, 'trafik'],
];
const subjectsOf = (text) => SUBJECTS.filter(([re]) => re.test(text)).map(([, s]) => s);

// Things that make a photograph a poor question. Flags rather than filters,
// because a regex is worse at this than a person looking at the picture — which
// is why the candidates table carries thumbnails.
const FLAGS = [
  [/\brepro\b/i, 'repro'],
  [/porträtt|porträt/i, 'porträtt'],
  [/interiör|inomhus|indoor/i, 'interiör'],
  [/ateljé/i, 'ateljé'],
];
const flagsFor = (text) => FLAGS.filter(([re]) => re.test(text)).map(([, f]) => f);

// The one exception, refused outright rather than flagged: a map or a drawing is
// not a photograph, and no hand pass would ever keep one. Left as a "?" it gets
// picked anyway wherever supply is thin — a 1973 land-use plan reached the game
// that way, because the 1970s had thirteen rows to choose from and a flag only
// costs a row its place in the queue.
const NOT_A_PHOTOGRAPH = /^karta\b|\bkarta över|ritning|plan över|\bmap of\b|coat of arms|\blogo\b|affisch|poster\b/i;

// A Swedish letter. JavaScript's `\b` is built from ASCII `\w`, so `/\bMalmö\b/`
// does not match "Malmö" — the boundary lands in the middle of the word. Hence
// the test written out.
const LETTER = /[A-Za-zÅÄÖåäöÜüÉé]/;

/**
 * Names the text mentions that the quiz already knows where to find.
 *
 * Longest first, so "Södra Förstadsgatan" is not reported as "Förstadsgatan".
 * Four characters is the floor: shorter names are substrings of ordinary Swedish
 * ("Hamn", "Torg") and would match half the archive.
 *
 * Whole words only. Without that, "Hindbyvägen" reads as the delområde Hindby
 * and the photograph is pinned to a housing estate half a kilometre from the
 * road it is of — a quiet failure, because both names are real places near each
 * other.
 */
function placesIn(text, names) {
  return names.filter((name) => {
    if (name.length <= 4) return false;
    let from = 0;
    for (;;) {
      const at = text.indexOf(name, from);
      if (at < 0) return false;
      const before = at > 0 ? text[at - 1] : '';
      const after = text[at + name.length] ?? '';
      if (!LETTER.test(before) && !LETTER.test(after)) return true;
      from = at + 1;
    }
  });
}

// ---- the sweep ---------------------------------------------------------------
const json = async (f) => JSON.parse(await readFile(f, 'utf8'));
const learn = await json('build/data/learn.json');
const { bbox } = await json('config/bbox.json');
// Photographs somebody has already looked at and thrown away. Without this a
// re-run proposes them again, and they look exactly as good the second time —
// the reason they were rejected was visible in the picture, not in the metadata
// this script can see. Same contract as `pinned` in build-images.mjs: a hand
// judgement survives the machine changing its mind.
const rejected = await json('game/rejected.json').catch(() => ({}));
const byName = new Map(learn.items.map((it) => [it.name, it]));
const names = learn.items.map((it) => it.name).sort((a, b) => b.length - a.length);

const inBbox = ([lon, lat]) => lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north;

/** The nearest thing the quiz has a name for, if it is near enough to be what
 *  the photograph is of. A label for the reveal, never the answer — the answer
 *  is the coordinate the camera recorded. */
function nearestNamed(point) {
  let best = null;
  for (const it of learn.items) {
    const d = distance(point, it.point);
    if (!best || d < best.d) best = { d, name: it.name };
  }
  return best && best.d <= 400 ? best.name : null;
}

console.log('reading K-samsök…');
const historic = await ksamsokPhotographs({ from: FROM, to: SPLIT - 1, refresh: REFRESH });
console.log(`  ${historic.length} records`);
console.log('reading Commons…');
const modern = await geotagged(bbox, { refresh: REFRESH });
console.log(`  ${modern.length} geotagged files`);

const rows = [];

for (const rec of historic) {
  const hits = placesIn(rec.description, names);
  const place = hits[0] ?? null;
  const item = place ? byName.get(place) : null;
  const text = `${rec.description} ${rec.title}`;
  rows.push({
    ...rec,
    hits,
    place,
    point: item?.point ?? null,
    how: item ? 'namn i beskrivningen' : null,
    subjects: subjectsOf(text),
    flags: flagsFor(text),
    caption: rec.description.replace(/\s+/g, ' ').trim(),
    thumbUrl: rec.thumbnail ? imageUrl(rec.thumbnail) : null,
  });
}

for (const rec of modern) {
  const text = `${rec.description} ${rec.title} ${rec.categories}`;
  rows.push({
    ...rec,
    hits: [],
    place: rec.point && inBbox(rec.point) ? nearestNamed(rec.point) : null,
    how: 'koordinat i filen',
    subjects: subjectsOf(text),
    flags: flagsFor(text),
    caption: (rec.description || rec.title).replace(/\s+/g, ' ').trim(),
    thumbUrl: rec.image,
  });
}

// ---- judging ------------------------------------------------------------------
for (const row of rows) {
  const why = [];
  let verdict = 'ja';

  if (rejected[row.id]) { verdict = 'nej'; why.push('bortvald i granskningen'); }
  if (!row.year) { verdict = 'nej'; why.push('inget år'); }
  if (!row.image) { verdict = 'nej'; why.push('ingen bild'); }
  if (!row.point) { verdict = 'nej'; why.push('ingen plats'); }
  else if (!inBbox(row.point)) { verdict = 'nej'; why.push('utanför Malmö'); }

  if (row.source === 'commons') {
    // An allowlist, not a blocklist: an unrecognised licence is refused, because
    // the failure mode of guessing is publishing somebody's photograph without
    // the right to.
    if (!licenseOk(row.license)) { verdict = 'nej'; why.push(`licens: ${row.license || 'okänd'}`); }
    // CC BY and CC BY-SA both require it, and there is no way to write the
    // credit line without it.
    if (!row.artist) { verdict = 'nej'; why.push('ingen fotograf angiven'); }
    // A coordinate says where the camera was, not what it was pointed at. A
    // photograph of a seed-vault storage box, taken in an office in Malmö and
    // geotagged there, is a perfectly good file and an impossible question. If
    // nothing about it mentions Malmö or a place the map knows, somebody should
    // look before it ships.
    else if (verdict === 'ja' && !/malmö/i.test(`${row.caption} ${row.categories ?? ''}`) && !row.place) {
      verdict = '?';
      why.push('geotaggad i Malmö men nämner inte staden');
    }
  } else if (row.hits.length > 1 && verdict === 'ja') {
    // "Stortorget mot Södergatan" — the commonest shape there is, and which of
    // the two the camera stood in is a judgement rather than a lookup.
    verdict = '?';
    why.push(`${row.hits.length} platser nämns`);
  }

  if (NOT_A_PHOTOGRAPH.test(row.caption) || NOT_A_PHOTOGRAPH.test(row.title ?? '')) {
    verdict = 'nej';
    why.push('karta, ritning eller affisch — inte ett fotografi');
  }
  if (row.flags.length && verdict === 'ja') { verdict = '?'; why.push(row.flags.join(', ')); }
  row.verdict = verdict;
  row.why = why;
}

// ---- dedup --------------------------------------------------------------------
// Both archives arrive in bursts. A building shoot lands as five K-samsök
// records with the same description and year; a Flickr upload lands as
// twenty-four photographs of one Malmöfestivalen concert, all at the same
// coordinate, all by the same photographer. The key collapses both: who, when,
// and the first few long words of what.
const stem = (row) => `${row.artist ?? ''}|${row.year}|${row.caption.toLowerCase()
  .replace(/[^a-zåäö ]/g, ' ').split(/\s+/).filter((w) => w.length > 3).slice(0, 4).join(' ')}`;

const seen = new Set();
for (const row of rows) {
  if (row.verdict === 'nej') continue;
  const key = stem(row);
  if (seen.has(key)) { row.verdict = 'nej'; row.why.push('dubblett'); continue; }
  seen.add(key);
}

// ---- balancing ----------------------------------------------------------------
// Two caps and a quota.
//
// The caps are per place *and decade* rather than per place, and that is the one
// rule here written for this game specifically. Stortorget in 1890 and
// Stortorget in 1960 are not the same question — the whole point of Förr is that
// the year is half the answer, and the same square seventy years apart is the
// clearest way the game can say so. Capping per place alone kept three
// Stortorgets and all of them from the 1890s, because the archive is deepest
// where it is oldest.
// Both scale with the target, because they are about *proportion* — how much of
// one sitting a single place may be — rather than about absolute numbers. At 250
// they come out as 2 and 8, which is where they were tuned; asking for twice the
// set with the same caps starves the decades that come later in the fill.
const PER_DECADE = Math.max(2, Math.round(TARGET / 170));
const PER_PLACE = Math.max(8, Math.round(TARGET / 40));

/**
 * Fill each decade to its quota, best rows first, and hand any shortfall to the
 * neighbouring decades rather than shrinking the set.
 *
 * "Best" is: a photograph with people or an event in it beats an empty street,
 * and anything the rule is unsure about goes last. That preference is the only
 * place in this file where the game's taste shows — a picture of a crowd at
 * Möllevångstorget in 1974 is a better question than another facade, because
 * there is more in it to date it by.
 */
function balanced(list, target) {
  const rank = (r) => (r.verdict === 'ja' ? 0 : 100)
    + (r.subjects.length ? -10 : 0)
    + (r.flags.length ? 5 : 0);

  const pools = new Map();
  for (const r of list) {
    const d = decadeOf(r.year);
    if (!pools.has(d)) pools.set(d, []);
    pools.get(d).push(r);
  }
  for (const pool of pools.values()) pool.sort((a, b) => rank(a) - rank(b) || a.year - b.year);

  const decades = Object.keys(QUOTA).map(Number).sort((a, b) => a - b);
  const scale = target / Object.values(QUOTA).reduce((a, b) => a + b, 0);
  const want = new Map(decades.map((d) => [d, Math.round(QUOTA[d] * scale)]));

  const picked = [];
  const perPlace = new Map();
  const perDecade = new Map();
  const take = (decade, n) => {
    const pool = pools.get(decade) ?? [];
    let took = 0;
    for (const r of pool) {
      if (took >= n) break;
      if (r.taken) continue;
      const slot = `${r.place ?? r.id}|${decade}`;
      if ((perDecade.get(slot) ?? 0) >= PER_DECADE) continue;
      if (r.place && (perPlace.get(r.place) ?? 0) >= PER_PLACE) continue;
      perDecade.set(slot, (perDecade.get(slot) ?? 0) + 1);
      if (r.place) perPlace.set(r.place, (perPlace.get(r.place) ?? 0) + 1);
      r.taken = true;
      picked.push(r);
      took += 1;
    }
    return took;
  };

  let shortfall = 0;
  for (const d of decades) shortfall += want.get(d) - take(d, want.get(d));
  // A thin decade — the 1880s, or the 2020s once they run out — should not cost
  // the set its size. Spread what it could not fill across the rest, richest
  // first, and go round until nothing more can be had.
  for (let pass = 0; pass < 4 && shortfall > 0; pass++) {
    const order = decades.filter((d) => (pools.get(d) ?? []).some((r) => !r.taken))
      .sort((a, b) => (pools.get(b)?.length ?? 0) - (pools.get(a)?.length ?? 0));
    if (!order.length) break;
    const each = Math.max(1, Math.ceil(shortfall / order.length));
    for (const d of order) {
      if (shortfall <= 0) break;
      shortfall -= take(d, Math.min(each, shortfall));
    }
  }
  return picked.sort((a, b) => a.year - b.year);
}

const shortlist = rows.filter((r) => r.verdict !== 'nej');
const chosen = balanced(shortlist, TARGET);

// ---- the table ----------------------------------------------------------------
const tally = (list) => ({
  ja: list.filter((r) => r.verdict === 'ja').length,
  '?': list.filter((r) => r.verdict === '?').length,
  nej: list.filter((r) => r.verdict === 'nej').length,
});
const all = tally(rows);

const out = [];
out.push('# Fotokandidater');
out.push('');
out.push('Genererad av `scripts/propose-photos.mjs`. Rader att döma av för hand —');
out.push('det som överlever hamnar i `game/photos.json`, och en rad som någon har');
out.push('tittat på och godkänt får `"reviewed": true`.');
out.push('');
out.push(`Två arkiv: **K-samsök** (Malmö Museer m.fl., ${FROM}–${SPLIT - 1}, plats ur beskrivningen)`);
out.push(`och **Wikimedia Commons** (${SPLIT}–, koordinat ur filen).`);
out.push(`${rows.length} poster lästa, ${all.ja} ja, ${all['?']} ?, ${all.nej} nej —`);
out.push(`**${chosen.length} valda** för fördelningen nedan.`);
out.push('');

out.push('## Fördelning');
out.push('');
out.push('`utbud` är hur många rader som klarade reglerna och alltså gick att välja');
out.push('mellan. Där `valda` är mindre än `kvot` är det utbudet som tog slut —');
out.push('1970- till 1990-talen är ett hål i arkiven, inte i skriptet.');
out.push('');
out.push('| årtionde | kvot | utbud | valda | källa | med folk/händelse |');
out.push('|---|--:|--:|--:|---|--:|');
for (const d of Object.keys(QUOTA).map(Number).sort((a, b) => a - b)) {
  const list = chosen.filter((r) => decadeOf(r.year) === d);
  const supply = shortlist.filter((r) => decadeOf(r.year) === d).length;
  const src = [...new Set(list.map((r) => (r.source === 'commons' ? 'Commons' : 'K-samsök')))].join(' + ') || '—';
  const short = list.length < QUOTA[d] ? ' ⚠' : '';
  out.push(`| ${d}s | ${QUOTA[d]} | ${supply} | ${list.length}${short} | ${src} | ${list.filter((r) => r.subjects.length).length} |`);
}
out.push(`| **allt** | | **${shortlist.length}** | **${chosen.length}** | | **${chosen.filter((r) => r.subjects.length).length}** |`);
out.push('');

for (const [heading, list] of [
  ['Valda', chosen],
  ['Övriga som klarade reglerna', shortlist.filter((r) => !r.taken)],
]) {
  out.push(`## ${heading}`);
  out.push('');
  out.push(`${list.length} rader.`);
  out.push('');
  out.push('| bild | år | plats | vad | hur | licens | fotograf | beskrivning | id |');
  out.push('|---|--:|---|---|---|---|---|---|---|');
  for (const r of list.slice(0, heading === 'Valda' ? Infinity : 400)) {
    const desc = r.caption.replace(/\|/g, '\\|').slice(0, 100);
    const note = r.why.length ? ` <br>*${r.why.join('; ')}*` : '';
    const place = r.hits.length > 1 ? r.hits.slice(0, 3).join(' / ') : (r.place ?? '—');
    // The thumbnail inline, because the commonest reason to reject a row cannot
    // be seen in the metadata: the archives are full of interiors, trade-fair
    // stands and copy work that read like street addresses until you look.
    const thumb = r.thumbUrl ? `![](${r.thumbUrl})` : '—';
    out.push(`| ${thumb} | ${r.year ?? '—'} | ${place} | ${r.subjects.join(', ') || '—'} | ${r.how ?? '—'}`
      + ` | ${r.license} | ${r.artist ?? '—'} | ${desc}${note} | [${r.id}](${r.source_url}) |`);
  }
  out.push('');
}

await mkdir('game', { recursive: true });
await writeFile(outFile, `${out.join('\n')}\n`);

// A starter photos.json, so the hand pass edits a file rather than types one.
// Nothing is marked reviewed — that is what the hand pass adds once it has
// looked at the picture and agreed with the pin.
const draftFile = outFile.replace(/[^/]+$/, 'photos.draft.json');
const draft = {};
for (const r of chosen) {
  draft[r.id] = {
    year: r.year,
    point: r.point,
    place: r.place,
    caption: r.caption,
    credit: r.source === 'commons'
      ? `Foto: ${r.artist} · ${r.license} · Wikimedia Commons`
      : `Foto: ${r.artist ?? 'okänd'} / Malmö Museer · ${r.license}`,
    source: r.source_url,
    origin: r.source,
    lowres: r.image,
    ...(r.subjects.length ? { subjects: r.subjects } : {}),
    // Carried through so the hand pass has somewhere to start: these are the
    // rows the rule was unsure about and the reason it was unsure. Delete the
    // field when you have looked and are happy.
    ...(r.verdict === '?' ? { check: r.why.join('; ') } : {}),
  };
}
await writeFile(draftFile, `${JSON.stringify(draft, null, 2)}\n`);

console.log(`\npropose-photos → ${outFile}`);
console.log(`                 ${draftFile} (${Object.keys(draft).length} rader att granska)`);
console.log(`  lästa    ${rows.length}  (K-samsök ${historic.length}, Commons ${modern.length})`);
console.log(`  klarade  ${shortlist.length}`);
console.log(`  valda    ${chosen.length}, varav ${chosen.filter((r) => r.subjects.length).length} med folk eller händelse`);
for (const d of Object.keys(QUOTA).map(Number).sort((a, b) => a - b)) {
  const list = chosen.filter((r) => decadeOf(r.year) === d);
  const supply = shortlist.filter((r) => decadeOf(r.year) === d).length;
  const short = list.length < QUOTA[d] ? `  ⚠ utbudet tog slut (${supply} fanns)` : '';
  console.log(`    ${d}s ${String(list.length).padStart(3)}/${String(QUOTA[d]).padStart(2)} ${'█'.repeat(list.length)}${short}`);
}
