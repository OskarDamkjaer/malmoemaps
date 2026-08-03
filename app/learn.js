// The quiz: the map as a board you place names on.
//
// One quiz, cut into chunks of one part of town each, and a chunk mixes
// whatever is there — delområden, gator, broar, landmärken, asked a kind at a
// time. Two modes, one question, and both hand you one name at a time. In
// 'tray' mode the map shows you every slot that name could go in, so the ones
// you have already placed are there to eliminate against; in 'point' mode it
// shows you nothing. Tray is recognition, point is recall — the same names
// played twice, in the order that makes them learnable.
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
//   The card comes on success, not on failure. The point of the app is not to
//   score you; it is that "Sofielund" ends up attached to a place *and* to
//   something about the place. So a correct placement is the moment the app has
//   your attention, and it spends it on the fact rather than on a tick.
import {
  KINDS, MODES, OUTLINE_LAYERS, byKind, chunksOf, graded, shuffled,
} from './rounds.mjs';
import {
  forgetEverything, inAskingOrder, progressOf, record,
} from './progress.mjs';
import { enterBlind, leaveBlind } from './blind.js';
import {
  clearBoard, clearHighlight, districtAt, highlightCovers, highlightPoint,
  highlightStreet, setBoard,
} from './highlight.js';

const DATA = '/data/learn.json';

let map = null;
let items = null;
let leaveToExplore = null;
// The chunk in progress, or null. Everything about a session lives here and
// nowhere else, so quitting is one assignment.
let session = null;

export const isPlaying = () => session !== null;

const shapeOf = (item) => KINDS[item.kind].shape;

// ---- geometry --------------------------------------------------------------
const M_PER_DEG_LAT = 111320;
const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

function metersBetween(a, b) {
  return Math.hypot((a[0] - b[0]) * mPerDegLon(b[1]), (a[1] - b[1]) * M_PER_DEG_LAT);
}

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
 * their whole extent (`bbox`), not their label point — in tray mode you drop
 * onto the polygon, so the polygon is what has to be on screen.
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

// The tray sits along the bottom and the prompt along the top, and both are
// over the map: padding is what keeps the board out from under them.
function frame(chunk, mode, duration) {
  map.fitBounds(boundsOf(chunk), {
    padding: {
      top: 76, bottom: mode === 'tray' ? 112 : 96, left: 26, right: 26,
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
    const street = highlightStreet(map, lngLat, near);
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

function startSession(chunk, mode) {
  session = {
    chunk,
    mode,
    // Both modes ask one name at a time and both ask a kind at a time; they
    // differ only in what decides the order inside a kind. Point mode asks what
    // progress.mjs says you are worst at, which is the whole point of a mode
    // with nothing to eliminate against. Tray mode shuffles, because there it
    // would be a tell: the slots are on the map, and always being handed the
    // one you keep missing first is a hint about which slot it is.
    queue: byKind(mode === 'point' ? inAskingOrder(chunk.items) : shuffled(chunk.items)),
    done: [],
    // Misses so far this session, by name. On the item it would outlive the
    // session — the items are the fetched data, shared by every chunk that
    // holds them — and "En gång till" would start you on your last strike.
    strikes: new Map(),
    armed: null,
  };
  enterBlind(map, OUTLINE_LAYERS);
  clearHighlight(map);
  frame(chunk, mode, 600);
  // Tray mode is played on a fixed board: you cannot pan with a name in your
  // hand, and a round where the answer can be scrolled off screen is a round
  // about scrolling. (The board itself is drawn by renderRound, which is what
  // knows which name is in hand.)
  if (mode === 'tray') lockMap(true); else clearBoard(map);
  el('learn').hidden = true;
  el('play').hidden = false;
  renderRound();
}

function lockMap(locked) {
  const handlers = ['dragPan', 'scrollZoom', 'boxZoom', 'doubleClickZoom', 'touchZoomRotate'];
  for (const h of handlers) (locked ? map[h].disable() : map[h].enable());
}

/**
 * The slots, and which of them are filled.
 *
 * What is drawn depends on what you are holding: pick up a bridge and every
 * bridge in the chunk lights up, pick up a delområde and every delområde does.
 * Showing all four kinds at once would be a wall of rings and tints over a map
 * that is meant to still be readable, and would answer a question nobody asked
 * — you are not choosing between a bridge and a street, you are choosing
 * between the bridges.
 *
 * Everything already placed stays lit and green whatever is in hand, because
 * that is the round so far and it is the thing you eliminate against.
 */
function drawBoard(inHand = session.armed) {
  const placed = new Set(session.done.map((d) => d.item.name));
  const shown = session.chunk.items.filter(
    (it) => placed.has(it.name) || (inHand && it.kind === inHand.kind),
  );
  setBoard(map, shown.map((it) => ({
    name: it.name,
    shape: shapeOf(it),
    covers: it.covers,
    point: it.point,
    placed: placed.has(it.name),
  })));
}

function quitRound() {
  if (!session) return;
  lockMap(false);
  leaveBlind(map);
  clearHighlight(map);
  clearBoard(map);
  session = null;
  el('play').hidden = true;
  el('factcard').hidden = true;
  el('summary').hidden = true;
  showPicker();
}

// ---- answering -------------------------------------------------------------
/**
 * One attempt at one name. The only path from a tap to the store.
 */
function answer(item, lngLat) {
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
  const { mode } = session;
  session.done.push({ item, outcome });
  session.queue = session.queue.filter((q) => q.name !== item.name);

  reveal(item);
  if (mode === 'tray') {
    // Straight on to the next name: one gesture per question, and the board
    // redraws around whatever is in hand now.
    renderRound();
    say(outcome === 'right' ? `Rätt — ${item.name}` : `${item.name} ligger här.`, outcome);
    // The tray keeps its rhythm: a card per name would be 119 interruptions in
    // a round of Centrum. The facts are all still there, one tap away in the
    // summary, once the placing is over.
    if (!session.queue.length) setTimeout(showSummary, 700);
    return;
  }
  showFact(item, outcome);
}

function reveal(item) {
  const shape = shapeOf(item);
  if (shape === 'area') highlightCovers(map, item.covers ?? [item.name]);
  else if (shape === 'line') highlightStreet(map, { lng: item.point[0], lat: item.point[1] }, 60, true);
  else highlightPoint(map, item.point);
  // Tray mode holds the board still — flying to each answer would undo the
  // fixed view the mode is played on.
  if (session.mode === 'point') map.easeTo({ center: item.point, duration: 500 });
}

// ---- chrome ----------------------------------------------------------------
function renderTally() {
  el('tally').textContent = `${session.done.length} / ${session.chunk.items.length}`;
}

function renderRound() {
  const { mode, queue } = session;
  renderTally();
  el('tray').hidden = mode !== 'tray';

  if (mode === 'point') {
    el('prompt').textContent = queue.length ? `Var ligger ${queue[0].name}?` : 'Klart.';
    if (!queue.length) showSummary();
    return;
  }

  // The name on offer is in hand from the moment it appears — there is only one
  // of it, so there is nothing to choose between and an arming tap would be a
  // tap that exists to be got out of the way. The board lights its kind's slots
  // straight away, which is what tray mode is *for*.
  session.armed = queue[0] ?? null;
  el('prompt').textContent = `Dra namnet dit det hör hemma — ${session.chunk.label}`;
  renderTray();
  drawBoard();
}

/**
 * One name, at the bottom of the screen.
 *
 * It used to be all of them — the whole chunk laid out as a wall of nametags —
 * and at 104 names that wall covered the city it was asking about. Which was
 * the bug: the elimination the mode is built around is supposed to happen *on
 * the map*, between the slots you can see filling up, and instead the map was
 * the thing hidden behind the list. One at a time gives the round back its
 * board, and gives the tray a job it can do in the space it has.
 */
function renderTray() {
  const tray = el('tray');
  tray.replaceChildren();
  const item = session.queue[0];
  if (!item) return;

  // A button, so it is focusable and announced as the thing you are being
  // asked about; but nothing hangs off its click, because it is already in
  // hand and there is nothing for a second gesture to do.
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'nametag armed';
  chip.textContent = item.name;
  chip.dataset.name = item.name;
  armDragging(chip, item);
  tray.append(chip);
}

/**
 * Dragging a name onto the map — or just tapping the map, which places it too.
 *
 * Pointer events rather than HTML5 drag-and-drop, which does not exist on
 * touch. Holding and dragging moves a ghost under your finger and drops where
 * you let go. Tapping the map does the same thing without the ghost, because
 * the name is in hand already (renderRound), and one-handed on a phone that is
 * the better of the two.
 *
 * The dragging is the affordance rather than the mechanism, then: it is what
 * makes the tag look like something you put somewhere. Nothing here has to
 * arm, disarm or suppress the click it generates, which is three pieces of
 * bookkeeping that went away with the wall of tags.
 */
function armDragging(chip, item) {
  let ghost = null;
  let moved = false;
  let from = null;

  // Putting the name down, however it ends: the ghost goes, and the board goes
  // back to showing the slots for whatever is in hand.
  const drop = () => {
    ghost?.remove();
    ghost = null;
    chip.classList.remove('lifted');
    if (session) drawBoard();
  };

  chip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    chip.setPointerCapture(e.pointerId);
    moved = false;
    from = [e.clientX, e.clientY];
  });

  chip.addEventListener('pointermove', (e) => {
    if (!chip.hasPointerCapture(e.pointerId) || !from) return;
    // Distance from where the finger went down, not `movementX` — which is not
    // reliably reported for touch pointers, and this is a phone app first. A
    // drag that never registered as one would silently become a tap.
    if (!moved && Math.hypot(e.clientX - from[0], e.clientY - from[1]) < 6) return;
    moved = true;
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.className = 'ghost';
      ghost.textContent = item.name;
      document.body.append(ghost);
      chip.classList.add('lifted');
      // The name is now in hand, so the map shows where it could go. Once, on
      // the move that starts the drag — the board is a source rebuild, not
      // something to redo sixty times a second.
      drawBoard(item);
    }
    ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  });

  chip.addEventListener('pointerup', (e) => {
    drop();
    if (!moved) return;

    // Let go over the app's own chrome and nothing happens — the tray and the
    // prompt bar sit *on top of* the map, so a drop there is geometrically on
    // the canvas and would otherwise be graded as a guess at the bottom edge of
    // the screen. Dropping a name back where you picked it up has to mean
    // changing your mind.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (under?.closest('#tray, #playbar, #factcard, #summary')) return;

    const rect = map.getCanvas().getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right
      && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) return;
    answer(item, map.unproject([e.clientX - rect.left, e.clientY - rect.top]));
  });

  chip.addEventListener('pointercancel', drop);
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
function showFact(item, outcome) {
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
  el('factverdict').textContent = outcome === 'right' ? 'Rätt' : 'Så här ligger det';
  el('factverdict').dataset.tone = outcome;
  // Reached two ways: as the reward at the end of a point-mode question, where
  // it leads on to the next name, and from the summary, where the round is
  // already over and there is nothing to go on to.
  el('next').textContent = session?.queue.length ? 'Nästa' : 'Klart';
  el('factcard').hidden = false;
  el('next').focus();
}

function hideFact() {
  el('factcard').hidden = true;
  if (session) clearHighlight(map);
}

function nextQuestion() {
  hideFact();
  if (!session) return;
  if (!session.queue.length) { showSummary(); return; }
  frame(session.chunk, session.mode, 400);
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
    // The facts nobody stopped to read during a tray round are all here.
    btn.addEventListener('click', () => { showFact(item, outcome); });
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

  const actions = document.createElement('div');
  actions.className = 'modes';
  for (const mode of MODES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode';
    btn.textContent = mode === 'tray' ? 'Dra ut alla' : 'Peka ut';
    btn.addEventListener('click', () => startSession(chunk, mode));
    actions.append(btn);
  }

  row.append(label, what, bar, actions);
  return row;
}

// ---- wiring ----------------------------------------------------------------
export async function initLearn(mapInstance, { onExplore }) {
  map = mapInstance;
  leaveToExplore = onExplore;
  items = await fetch(DATA).then((r) => r.json()).then((d) => d.items);

  el('quit').addEventListener('click', quitRound);
  el('next').addEventListener('click', nextQuestion);
  el('summaryagain').addEventListener('click', () => {
    const { chunk, mode } = session;
    el('summary').hidden = true;
    startSession(chunk, mode);
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
    if (session.mode === 'point') {
      const item = session.queue[0];
      if (item && el('factcard').hidden) answer(item, e.lngLat);
      return;
    }
    if (session.armed) answer(session.armed, e.lngLat);
  });
}

/**
 * Escape, while a round is running.
 *
 * Backs out one layer at a time rather than quitting outright: the card over
 * the round, then the round itself. Quitting from a card you opened to read
 * would lose the round you were in the middle of.
 */
export function escapeLearn() {
  if (!session) return false;
  if (!el('factcard').hidden) { hideFact(); return true; }
  if (!el('summary').hidden) { quitRound(); return true; }
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
