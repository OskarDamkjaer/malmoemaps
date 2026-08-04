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
import {
  KINDS, MODES, OUTLINE_LAYERS, byKind, chunksOf, graded, metersBetween, shuffled,
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

// The prompt sits along the top, the nametag along the bottom, and the panel
// takes a whole column or a whole sheet depending on the window: padding is
// what keeps the board out from under all of it.
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
    // True between a settled answer and the next question, while the map is
    // showing where the thing was. A tap then is looking, not guessing.
    settling: false,
  };
  reviewing = false;
  clearTimeout(settleTimer);
  // The panel sits along the bottom on a phone, and so does the nametag. Which
  // of them has the bottom edge is a question about the mode, so the mode is on
  // the element and app.css answers it there.
  el('play').dataset.mode = mode;
  enterBlind(map, OUTLINE_LAYERS);
  clearHighlight(map);
  // The opening view, not a cage. Tray mode used to disable pan and zoom on the
  // grounds that you cannot pan with a name in your hand — true of the old wall
  // of nametags, where the map had to hold still for a hundred drop targets,
  // and false now: there is one tag, it is placed as often by tapping as by
  // dragging, and a chunk framed to fit Centrum on a phone is too small a scale
  // to tell two canal bridges apart on. Zooming in is not cheating when there
  // are no labels to read. (The board is drawn by renderRound, which is what
  // knows which name is in hand.)
  frame(chunk, 600);
  if (mode !== 'tray') clearBoard(map);
  el('learn').hidden = true;
  el('play').hidden = false;
  renderRound();
}

/**
 * The slots, and which of them are filled.
 *
 * The board is the run you are in and nothing else: every item of the kind in
 * hand, dashed where it is still open and solid green where something has
 * landed. Showing all four kinds at once would be a wall of rings and tints
 * over a map that is meant to still be readable, and would answer a question
 * nobody asked — you are not choosing between a bridge and a street, you are
 * choosing between the bridges.
 *
 * That applies to what is *finished* too, which it did not use to. Everything
 * placed stayed lit whatever was in hand, on the theory that the round so far
 * is what you eliminate against — but you eliminate within a kind, and by the
 * time the areas were done that theory meant twenty green delområden sitting
 * under the street run, tinting half the city a colour that no longer meant
 * anything. A run starts clean.
 */
function drawBoard(inHand = session.armed) {
  if (!inHand) { clearBoard(map); return 0; }
  const placed = new Set(session.done.map((d) => d.item.name));
  const shown = session.chunk.items.filter((it) => it.kind === inHand.kind);
  return setBoard(map, shown.map((it) => ({
    name: it.name,
    shape: shapeOf(it),
    covers: it.covers,
    point: it.point,
    placed: placed.has(it.name),
  })));
}

/**
 * The board, and the prompt that goes with whether it could be drawn.
 *
 * Street slots come out of the loaded vector tiles, so both what you can see
 * and what the grader can accept depend on the zoom you are at. Rather than
 * leave a street round looking broken at the zoom a whole stadsdel is framed
 * at, the prompt says the one thing that fixes it. The app already talks this
 * way — the layer chips say "zooma in" for the same reason.
 */
function refreshBoard() {
  const drawn = drawBoard();
  const inHand = session.armed;
  const blind = inHand && shapeOf(inHand) === 'line' && !drawn;
  el('prompt').textContent = blind
    ? `Zooma in för att se gatorna — ${session.chunk.label}`
    : `Dra namnet dit det hör hemma — ${session.chunk.label}`;
}

function quitRound() {
  if (!session) return;
  clearTimeout(settleTimer);
  reviewing = false;
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
 * Not `getBounds().contains`, which counts the strip under the prompt bar, the
 * nametag and — on a wide window — the whole column the fact card is about to
 * open in. Revealing an answer *behind the card explaining it* is the failure
 * this exists to avoid, so the test is against the part of the canvas nothing
 * is sitting on top of.
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
  else if (shape === 'line') highlightStreet(map, { lng: item.point[0], lat: item.point[1] }, 60, true);
  else highlightPoint(map, item.point);
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
  const { mode, queue } = session;
  renderTally();
  el('tray').hidden = mode !== 'tray';

  if (!queue.length) { hideFact(); showSummary(); return; }
  // The panel is the question, so it is filled here rather than after an answer.
  showFact(queue[0]);

  if (mode === 'point') {
    el('prompt').textContent = `Var ligger ${queue[0].name}?`;
    return;
  }

  // The name on offer is in hand from the moment it appears — there is only one
  // of it, so there is nothing to choose between and an arming tap would be a
  // tap that exists to be got out of the way. The board lights its kind's slots
  // straight away, which is what tray mode is *for*.
  session.armed = queue[0] ?? null;
  renderTray();
  refreshBoard();
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
    if (!inside || !answerable()) return;
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
  // Either way the panel has just changed height, and something is positioned
  // off that height.
  img.onerror = () => { figure.hidden = true; measurePanel(); };
  img.onload = measurePanel;
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
  measurePanel();
}

/**
 * How tall the panel ended up, for the one thing that has to know: on a phone
 * the nametag sits above it, and how far above depends on whether this name
 * came with a picture and a paragraph. A stylesheet cannot ask that, so the
 * answer is measured and handed over as a custom property.
 */
function measurePanel() {
  const card = el('factcard');
  el('play').style.setProperty('--panel-h', card.hidden ? '0px' : `${card.offsetHeight}px`);
}

function hideFact() {
  el('factcard').hidden = true;
  reviewing = false;
  measurePanel();
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
  // Only ever the review card's way out, now that questions advance themselves.
  el('next').addEventListener('click', hideFact);
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
    if (!answerable()) return;
    const item = session.mode === 'point' ? session.queue[0] : session.armed;
    if (item) answer(item, e.lngLat);
  });

  // A street slot is found in the tiles that are loaded (highlight.js asks the
  // `transportation_name` source what is near the point), so the board is only
  // true of the view it was built at. That did not matter while tray mode was
  // played at a fixed view; now that you can pan and zoom, panning to a street
  // that was off screen has to bring its slot with it — and zooming out past
  // where the source has geometry has to be recoverable by zooming back in.
  map.on('moveend', () => {
    // Not while the card is up: the board behind it belongs to the question
    // just answered, and the easeTo that revealed the answer is itself a move.
    if (session?.mode === 'tray' && el('factcard').hidden) refreshBoard();
  });
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
