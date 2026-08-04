// The quiz: the map as the thing you point at.
//
// One quiz, cut into chunks of one part of town each, and a chunk mixes
// whatever is there — delområden, gator, broar, landmärken, asked a kind at a
// time. One question, one name at a time: here is what this place is, now point
// at it.
//
// What decides right and wrong is not in here: rounds.mjs holds the rule and
// the tolerances, blind.js takes the words off the map, progress.mjs remembers
// which names you keep missing. This file is the loop between them and the
// chrome around it.
//
// Two behaviours are deliberate and easy to mistake for bugs:
//
//   Two strikes, then the answer. A third guess at a name you have no idea
//   about is not learning, it is stabbing at the map. The second miss flies you
//   to the right place, outlines it and tells you about it — and is recorded as
//   'helped', which is neither right nor wrong but does mean you will be asked
//   again sooner. Strikes are counted per session, not per name: replaying a
//   chunk is meant to be a second chance, not a shorter fuse.
//
//   The panel is the question, not the prize. It used to be the reward for a
//   correct placement — the app has your attention at that moment, spend it on
//   the fact rather than on a tick — and it is now up the whole time, saying
//   what the thing is and showing its picture while you look for it. The point
//   of the app was never the scoring; it is that "Sofielund" ends up attached
//   to a place *and* to something about the place, and a name you were told
//   about and then had to go and find gets both halves in one go. It also means
//   no question is a blank: you are never asked for a name you have been given
//   nothing to hang on to.
//
//   Nothing waits for a button. A settled answer outlines itself on the map and
//   the next name arrives a beat later, because the reading is already done.
//
// There used to be a second mode — "dra ut alla", which lit every slot the name
// could go in and asked you to choose among them. It is gone, and rounds.mjs
// says why; what went with it here was a tray, a drag ghost, a board of slots
// that had to be redrawn on every pan, and a `mode` threaded through every
// function in this file.
import {
  KINDS, OUTLINE_LAYERS, STREET_ZOOM, byKind, chunksOf, graded, metersBetween,
} from './rounds.mjs';
import {
  forgetEverything, inAskingOrder, progressOf, record,
} from './progress.mjs';
import { enterBlind, leaveBlind } from './blind.js';
import {
  clearHighlight, districtAt, highlightCovers, highlightPoint, highlightStreet,
  streetAt,
} from './highlight.js';

const DATA = '/data/learn.json';

let map = null;
let items = null;
let leaveToExplore = null;
// The chunk in progress, or null. Everything about a session lives here and
// nowhere else, so quitting is one assignment.
let session = null;
// The beat between a settled answer and the next question, during which the map
// is showing you where the thing actually was and taps are not guesses.
let settleTimer = 0;
// The panel is showing a name from the summary rather than the one being asked.
// Only reachable once the round is over, and the one thing Escape backs out of.
let reviewing = false;

export const isPlaying = () => session !== null;

const shapeOf = (item) => KINDS[item.kind].shape;

// ---- geometry --------------------------------------------------------------
// Tolerances are written in metres but felt in fingertips, so the grader needs
// to know what a pixel is worth at the zoom you are actually playing at.
//
// Measured off the map rather than derived from the zoom. The derived version
// was wrong by a factor of 128 — it used the 256-pixel tile constant against
// MapLibre's 512-pixel tiles — which made every pixel worth about four
// centimetres and the pixel floor in `graded` unreachable. The whole point of
// that floor is that it is the thing standing between a 120 m tolerance and a
// dare, and it had never once fired. Asking the map to project two points and
// telling us how far apart they are cannot be wrong in that way.
function metersPerPixel() {
  const c = map.getCenter();
  const origin = map.project(c);
  const across = map.unproject([origin.x + 100, origin.y]);
  return metersBetween([c.lng, c.lat], [across.lng, across.lat]) / 100;
}

/**
 * The view a chunk is played at.
 *
 * Computed from what is in the chunk rather than read off a zoom ladder: chunks
 * are cut by stadsdel and then by size, so they are not all the same size and a
 * fixed zoom would show half of one and a tenth of another. Areas contribute
 * their whole extent (`bbox`), not their label point — you answer by tapping
 * inside the polygon, so the polygon is what has to be on screen.
 */
function boundsOf(chunk) {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  const swallow = (lon, lat) => {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  };
  for (const it of chunk.items) {
    if (it.bbox) { swallow(it.bbox[0], it.bbox[1]); swallow(it.bbox[2], it.bbox[3]); }
    else swallow(it.point[0], it.point[1]);
  }
  return [[w, s], [e, n]];
}

// The prompt sits along the top and the panel takes a whole column or a whole
// sheet depending on the window: padding is what keeps the chunk out from under
// both.
function frame(chunk, duration) {
  // The #factcard breakpoint in app.css, asked of the canvas rather than the
  // window because the canvas is the thing being padded.
  const wide = map.getCanvas().clientWidth >= 700;
  map.fitBounds(boundsOf(chunk), {
    padding: {
      top: 76,
      bottom: wide ? 96 : 320,
      left: 26,
      right: wide ? 360 : 26,
    },
    // A chunk of three things a hundred metres apart should not put you on a
    // rooftop; the point of the blind map is that you can still see the city
    // around the answer.
    maxZoom: 15,
    duration,
  });
}

/**
 * What the map found where you dropped, expressed in the target's own terms.
 *
 * The three shapes answer three different questions and all three are already
 * answered elsewhere: an area asks which delområde the point is in, a street
 * asks what street you are standing on, and a point asks what is nearest.
 * Distance to the *answer* is carried separately, because "700 m fel" is the
 * useful thing to say even when what you actually hit was something else.
 *
 * Candidates are drawn from the chunk and filtered to the target's own kind, so
 * a bridge is never graded against the landmark standing next to it.
 */
function hitAt(target, lngLat) {
  const point = [lngLat.lng, lngLat.lat];
  const shape = shapeOf(target);
  const candidates = session.chunk.items.filter((it) => shapeOf(it) === shape);

  if (shape === 'area') {
    const inside = districtAt(point);
    if (!inside) return null;
    const item = candidates.find((it) => it.covers?.includes(inside));
    return item ? { name: item.name } : null;
  }

  if (shape === 'line') {
    const near = Math.max(KINDS[target.kind].near, 26 * metersPerPixel());
    const street = streetAt(map, lngLat, near);
    if (!street) return null;
    return {
      name: street.properties.name,
      distance: 0,
      targetDistance: metersBetween(point, target.point),
    };
  }

  let best = null;
  for (const it of candidates) {
    const d = metersBetween(point, it.point);
    if (!best || d < best.distance) best = { name: it.name, distance: d };
  }
  return best && { ...best, targetDistance: metersBetween(point, target.point) };
}

// ---- the session -----------------------------------------------------------
const el = (id) => document.getElementById(id);

function startSession(chunk) {
  session = {
    chunk,
    // A kind at a time (byKind), and inside a kind whatever progress.mjs says
    // you are worst at.
    queue: byKind(inAskingOrder(chunk.items)),
    done: [],
    // Misses so far this session, by name. On the item it would outlive the
    // session — the items are the fetched data, shared by every chunk that
    // holds them — and "En gång till" would start you on your last strike.
    strikes: new Map(),
    // True between a settled answer and the next question, while the map is
    // showing where the thing was. A tap then is looking, not guessing.
    settling: false,
  };
  reviewing = false;
  clearTimeout(settleTimer);
  enterBlind(map, OUTLINE_LAYERS);
  clearHighlight(map);
  // The opening view, not a cage: pan and zoom stay on, because zooming in to
  // be sure is not cheating when there are no labels to read, and a chunk
  // framed to fit Centrum on a phone is too small a scale to tell two canal
  // bridges apart on.
  frame(chunk, 600);
  el('learn').hidden = true;
  el('play').hidden = false;
  renderRound();
}

function quitRound() {
  if (!session) return;
  clearTimeout(settleTimer);
  reviewing = false;
  leaveBlind(map);
  clearHighlight(map);
  session = null;
  el('play').hidden = true;
  el('factcard').hidden = true;
  el('summary').hidden = true;
  showPicker();
}

// ---- answering -------------------------------------------------------------
/**
 * Is a tap on the map a guess right now?
 *
 * It is not during the beat after a settled answer, when the map is showing you
 * where the thing was and the next name has not arrived; and it is not while a
 * name from the summary is on the panel, because that round is over. Both used
 * to be covered by "is the card hidden", which stopped meaning anything when
 * the card became the question.
 */
const answerable = () => !!session && !session.settling && !reviewing
  && !!session.queue.length;

/**
 * One attempt at one name. The only path from a tap to the store.
 */
function answer(item, lngLat) {
  // A street tap at this zoom finds nothing in the tiles to grade against (see
  // renderPrompt), so it is not a miss — it is a question that has not been
  // asked yet. Costing someone a strike for the app's own blind spot is how two
  // strikes and the answer turns into "the streets are broken".
  if (shapeOf(item) === 'line' && map.getZoom() < STREET_ZOOM) {
    say('Zooma in för att svara på gator.', 'wrong');
    return;
  }

  const hit = hitAt(item, lngLat);
  const verdict = graded({ item, hit, metersPerPixel: metersPerPixel() });

  if (verdict.right) {
    record(item.name, 'right');
    finish(item, 'right');
    return;
  }

  // First miss says nothing but "not there" — being told what you *did* hit is
  // how the second guess gets to be an informed one.
  const strikes = (session.strikes.get(item.name) ?? 0) + 1;
  session.strikes.set(item.name, strikes);
  if (strikes < 2) {
    say(missText(verdict), 'wrong');
    return;
  }
  record(item.name, 'helped');
  finish(item, 'helped');
}

function missText(verdict) {
  if (verdict.hitName) return `Nej — det där är ${verdict.hitName}.`;
  if (verdict.distance != null) {
    const d = verdict.distance;
    return d > 1200
      ? `Nej — ${(d / 1000).toFixed(1)} km bort.`
      : `Nej — ${Math.round(d / 10) * 10} m bort.`;
  }
  return 'Nej — försök igen.';
}

/**
 * The name is settled, right or shown. Reveal the shape, say what it is, and
 * take it out of the round.
 */
function finish(item, outcome) {
  session.done.push({ item, outcome });
  session.queue = session.queue.filter((q) => q.name !== item.name);
  renderTally();
  reveal(item);
  say(outcome === 'right' ? `Rätt — ${item.name}` : `${item.name} ligger här.`, outcome);
  // The panel already said everything there is to say about this name — it has
  // been saying it since the question opened — so there is nothing to stop for
  // and nothing to dismiss. The pause is for the outline that has just appeared
  // on the map, and it is longer when the map is telling you something you did
  // not know.
  session.settling = true;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(nextQuestion, outcome === 'right' ? 750 : 2200);
}

/**
 * Is this spot somewhere you can actually see it?
 *
 * Not `getBounds().contains`, which counts the strip under the prompt bar and —
 * on a wide window — the whole column the fact card is sitting in. Revealing an
 * answer *behind the card explaining it* is the failure this exists to avoid,
 * so the test is against the part of the canvas nothing is on top of.
 */
function inView(point) {
  const canvas = map.getCanvas();
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  // Matches the #factcard breakpoint in app.css: below it the card is a sheet
  // along the bottom, above it a column down the right.
  const wide = w >= 700;
  const { x, y } = map.project(point);
  return x >= 24 && x <= w - (wide ? 350 : 24)
    && y >= 86 && y <= h - (wide ? 24 : 240);
}

function reveal(item) {
  const shape = shapeOf(item);
  if (shape === 'area') highlightCovers(map, item.covers ?? [item.name]);
  // By name. Asking for the street nearest the item's own point lit up whatever
  // crossed it there, because that point is a junction — see highlight.js. If
  // the tiles for it are not loaded there is nothing to draw, and a ring at the
  // point at least says where to look.
  else if (shape === 'line') {
    if (!highlightStreet(map, item.name, item.point)) highlightPoint(map, item.point);
  } else highlightPoint(map, item.point);
  // Move only when there is something to move for. Flying to every answer takes
  // the view out from under someone who panned there on purpose; never moving
  // means being told "så här ligger det" about a place off the edge of the
  // screen. So: if you can already see it, stay put.
  if (!inView(item.point)) map.easeTo({ center: item.point, duration: 500 });
}

// ---- chrome ----------------------------------------------------------------
function renderTally() {
  el('tally').textContent = `${session.done.length} / ${session.chunk.items.length}`;
}

function renderRound() {
  renderTally();
  if (!session.queue.length) { hideFact(); showSummary(); return; }
  // The panel is the question, so it is filled here rather than after an answer.
  showFact(session.queue[0]);
  renderPrompt();
}

/**
 * What you are being asked, and — for the streets — whether you can be.
 *
 * A street is graded by looking up what you tapped in the loaded vector tiles,
 * and `transportation_name` does not carry ordinary street names below
 * STREET_ZOOM. Framed to fit a stadsdel, a chunk opens below it: the map would
 * take a perfectly good tap on Södergatan and mark it wrong, having found no
 * street there at all. So the round says the one thing that fixes it, which is
 * a fact about the zoom and gives nothing away about the answer. The layer
 * chips already talk this way.
 */
function renderPrompt() {
  const item = session.queue[0];
  if (!item) return;
  const blind = shapeOf(item) === 'line' && map.getZoom() < STREET_ZOOM;
  el('prompt').textContent = blind
    ? 'Zooma in för att se gatorna'
    : `Var ligger ${item.name}?`;
}

let sayTimer = 0;
function say(text, tone) {
  const box = el('verdict');
  box.dataset.tone = tone;
  // Unhidden first, then filled: a live region that is mutated while hidden is
  // not announced, and "Nej — 400 m bort" is exactly the sort of thing that has
  // to reach someone who is not looking at that corner of the screen.
  box.hidden = false;
  box.textContent = text;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => { box.hidden = true; }, 2600);
}

// ---- the fact --------------------------------------------------------------
// What the app is actually for. Everything above is the excuse to show this at
// the moment the name has just become a place.

/**
 * The picture, if the item has one.
 *
 * `image` is a path on this origin, never a remote URL: the app makes no
 * third-party requests at runtime and works on a train, and a card that is
 * blank offline would fail exactly when the app is most used. Whatever fills
 * this field has to be downloaded by the build and cached by the service
 * worker like everything else.
 *
 * `credit` is not optional decoration. A photograph is someone's, and this repo
 * shows its attributions rather than burying them, so an item carrying an image
 * carries who made it and under what licence.
 */
function showPicture(item) {
  const figure = el('factfigure');
  const img = el('factimage');
  if (!item.image) { figure.hidden = true; img.removeAttribute('src'); return; }

  img.src = item.image;
  img.alt = `Foto: ${item.name}`;
  // A picture that will not load leaves no frame behind. The likeliest cause is
  // a first run that went offline before the service worker finished, which is
  // not worth a broken-image icon on the one card the app exists to show.
  img.onerror = () => { figure.hidden = true; };
  el('factcredit').textContent = item.credit ?? '';
  el('factcredit').hidden = !item.credit;
  figure.hidden = false;
}
/**
 * The panel, in its two states.
 *
 * With no `outcome` it is **the question**: the name you are being asked for,
 * what it is, its picture and what is known about it, sitting there the whole
 * time you are looking for it. That is a different bargain from the one this
 * card used to make — it was the reward for placing something, shown once the
 * name had just become a place — and it is a deliberate trade. Read-then-place
 * means you are never asked for a name you have been told nothing about, and
 * the picture has the whole question to work on you rather than two seconds
 * after you no longer need it.
 *
 * With an `outcome` it is **the review**, reached from the summary once the
 * round is over: same contents, plus how it went and a way back. That is the
 * only path that still has a button, because it is the only one where there is
 * a decision to make about what happens next.
 */
function showFact(item, outcome = null) {
  const asking = outcome === null;
  el('factname').textContent = item.name;
  el('factmeta').textContent = item.meta ?? '';
  el('factmeta').hidden = !item.meta;
  showPicture(item);
  const text = el('facttext');
  text.textContent = item.about ?? '';
  text.hidden = !item.about;
  const src = el('factsource');
  src.hidden = !item.source;
  if (item.source) src.href = item.source;

  el('factverdict').hidden = asking;
  if (!asking) {
    el('factverdict').textContent = outcome === 'right' ? 'Rätt' : 'Så här ligger det';
    el('factverdict').dataset.tone = outcome;
  }
  el('next').hidden = asking;
  el('factcard').classList.toggle('asking', asking);
  el('factcard').hidden = false;
  if (!asking) { el('next').textContent = 'Klart'; el('next').focus(); }
}

function hideFact() {
  el('factcard').hidden = true;
  reviewing = false;
}

/**
 * On to the next name.
 *
 * Reached on a timer rather than by a button. The old flow put a card between
 * every question and the next one and asked you to dismiss it, which is a tap
 * that exists only to admit you have finished reading — and there is nothing
 * left to read, because the panel said it all before you answered. What the
 * pause is for is the map: the answer has just been outlined, and going
 * straight on would take it away before it registered. Longer when you were
 * shown the answer than when you found it, because those are different amounts
 * of looking.
 */
function nextQuestion() {
  clearTimeout(settleTimer);
  if (!session) return;
  session.settling = false;
  clearHighlight(map);
  if (!session.queue.length) { hideFact(); showSummary(); return; }
  // No re-framing. The opening view is a starting point, and snapping back to
  // it every question would hand the zoom control back with one hand and take
  // it away with the other — including the zoom you needed to see a street at
  // all.
  renderRound();
}

// ---- summary ---------------------------------------------------------------
function showSummary() {
  const { chunk, done } = session;
  const right = done.filter((d) => d.outcome === 'right').length;
  el('summaryhead').textContent = `${right} av ${done.length} på egen hand`;
  const list = el('summarylist');
  list.replaceChildren();
  for (const { item, outcome } of done) {
    const li = document.createElement('li');
    li.dataset.outcome = outcome;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.append(item.name);
    // Every card again, in one list: the round is over, and the one you want a
    // second look at is rarely the one that was last on screen.
    btn.addEventListener('click', () => { reviewing = true; showFact(item, outcome); });
    li.append(btn);
    list.append(li);
  }
  el('summarysub').textContent = chunk.items.length === done.length
    ? 'Rundan är klar.' : 'Avbruten runda.';
  el('summary').hidden = false;
}

// ---- picker ----------------------------------------------------------------
// The front door. One row per part of town, with a bar saying how much of it
// you can already place, because "what should I do next" should be answerable
// by looking rather than by remembering.
function renderPicker() {
  const list = el('roundlist');
  list.replaceChildren();

  const chunks = chunksOf(items);
  const all = progressOf(items);
  el('learnsub').textContent = `${all.known} av ${all.total} namn sitter.`;

  for (const chunk of chunks) list.append(chunkRow(chunk));
}

// What a chunk is made of, said in the order the kinds are declared: "14
// delområden · 3 landmärken · 2 gator". A chunk is a part of town rather than a
// category, so what is in it is not guessable from its name.
function composition(chunk) {
  const counts = new Map();
  for (const it of chunk.items) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
  return Object.keys(KINDS)
    .filter((k) => counts.has(k))
    .map((k) => {
      const n = counts.get(k);
      return `${n} ${n === 1 ? KINDS[k].label : KINDS[k].plural}`;
    })
    .join(' · ');
}

function chunkRow(chunk) {
  const { known, total } = progressOf(chunk.items);
  const row = document.createElement('div');
  row.className = 'chunk';

  const label = document.createElement('div');
  label.className = 'chunkname';
  label.append(chunk.label);
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = `${known} / ${total}`;
  label.append(count);

  const what = document.createElement('p');
  what.className = 'what';
  what.textContent = composition(chunk);

  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('i');
  fill.style.width = `${total ? (known / total) * 100 : 0}%`;
  bar.append(fill);

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'start';
  start.textContent = 'Peka ut';
  start.setAttribute('aria-label', `Peka ut i ${chunk.label}`);
  start.addEventListener('click', () => startSession(chunk));

  row.append(label, what, bar, start);
  return row;
}

// ---- wiring ----------------------------------------------------------------
export async function initLearn(mapInstance, { onExplore }) {
  map = mapInstance;
  leaveToExplore = onExplore;
  items = await fetch(DATA).then((r) => r.json()).then((d) => d.items);

  el('quit').addEventListener('click', quitRound);
  // Only ever the review card's way out, now that questions advance themselves.
  el('next').addEventListener('click', hideFact);
  el('summaryagain').addEventListener('click', () => {
    const { chunk } = session;
    el('summary').hidden = true;
    startSession(chunk);
  });
  el('summarydone').addEventListener('click', quitRound);
  el('toexplore').addEventListener('click', () => leaveToExplore?.());
  el('forget').addEventListener('click', () => {
    forgetEverything();
    renderPicker();
  });

  // The map answers the quiz only while a chunk is running; outside that it
  // belongs to the explore mode, which has its own click handler and its own
  // idea of what a tap means.
  map.on('click', (e) => {
    if (!session) return;
    e._handled = true;
    if (answerable()) answer(session.queue[0], e.lngLat);
  });

  // Whether a street question can be answered at all depends on the zoom, and
  // the zoom is yours to change mid-question, so the prompt has to keep up:
  // zoom in and "Zooma in för att se gatorna" becomes the question, zoom back
  // out and it becomes the warning again.
  map.on('moveend', () => { if (answerable()) renderPrompt(); });
}

/**
 * Escape, while a round is running.
 *
 * Backs out one layer at a time rather than quitting outright, and there is
 * exactly one layer left to back out of: a name opened from the summary. The
 * panel itself is no longer something you escape — it is the question, and
 * escaping the question is escaping the round.
 */
export function escapeLearn() {
  if (!session) return false;
  if (reviewing) { hideFact(); return true; }
  quitRound();
  return true;
}

/** The front door: shown at boot, and again on the way back from Utforska. */
export function showPicker() {
  renderPicker();
  el('learn').hidden = false;
}

/** Leaving for the explore map. */
export function hidePicker() {
  el('learn').hidden = true;
}
