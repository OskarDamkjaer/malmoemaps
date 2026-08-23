// Förr: five photographs a day, and for each one the two questions the picture
// is actually asking — what year, and where.
//
// The same split as learn.js and rounds.mjs: the rules live in photos.mjs and can
// be tested without a browser, and everything here is the map, the DOM and the
// timers. What it borrows from the quiz it borrows outright — `enterBlind` and
// `leaveBlind`, `metersBetween` — because the two modes should not drift on what
// a blind map is or how far apart two points are.
//
// ---- what is different from a round ------------------------------------------
//
// Öva grades a tap right or wrong and moves on. Here a tap is only half an
// answer, and neither half is committed until you say so. That one difference
// drives most of the shape of this file:
//
//   * The pin is draggable in the sense that tapping again moves it. You are
//     allowed to change your mind about a photograph, because reading a
//     photograph is a thing you do slowly — you spot the tram lines, then the
//     spire behind them, and the second one moves your guess.
//   * So there is a **Gissa** button, and until it is pressed nothing is scored.
//     `learn.js` needs no such thing: there, the tap *is* the answer.
//   * And the score is a number rather than a verdict. See photos.mjs for why
//     this is the one place in the app where being close counts.
import { enterBlind, leaveBlind } from './blind.js';
import { clearHighlight } from './highlight.js';
import {
  MAX_SCORE,
  scored, dayNumber, dayOf, cycleLength,
  scoreOf, bestScore, daysPlayed, recordDay,
} from './photos.mjs';

const DATA = '/data/game.json';

let map = null;
let game = null;
let leaveToExplore = null;

// One object, so quitting is one assignment — the same reason learn.js keeps its
// session in one place.
let session = null;

export const isPlayingPhotos = () => session !== null;

const el = (id) => document.getElementById(id);

// ---- the pin and the answer --------------------------------------------------
// Its own source rather than highlight.js's. That file routes every shape
// through one GeoJSON source set by `setShape`, on the reasonable theory that
// there is only ever one selection — and here there are three things on screen
// at once (where you said, where it was, and the line between them), two of
// which have to survive the third being added. Sharing the source would mean
// teaching highlight.js about a mode it otherwise knows nothing about.
const SRC = 'photo-answer';

function addAnswerLayers() {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  // The line first, so it runs under both ends rather than across them.
  map.addLayer({
    id: 'photo-line',
    type: 'line',
    source: SRC,
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: {
      'line-color': '#b4462a',
      'line-width': 2,
      'line-dasharray': [2, 2],
      'line-opacity': 0.9,
    },
  });
  // Where the photograph was actually taken.
  map.addLayer({
    id: 'photo-answer',
    type: 'circle',
    source: SRC,
    filter: ['==', ['get', 'role'], 'answer'],
    paint: {
      'circle-radius': 8,
      'circle-color': '#b4462a',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#fff',
    },
  });
  // Where you said. Hollow, so the two are told apart by shape and not only by
  // colour — this is the one moment the app makes you compare two dots.
  map.addLayer({
    id: 'photo-guess',
    type: 'circle',
    source: SRC,
    filter: ['==', ['get', 'role'], 'guess'],
    paint: {
      'circle-radius': 7,
      'circle-color': '#fff',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#2f6f4f',
    },
  });
}

function setAnswerShapes(features) {
  map.getSource(SRC)?.setData({ type: 'FeatureCollection', features });
}

const point = (coords, role) => ({
  type: 'Feature', properties: { role }, geometry: { type: 'Point', coordinates: coords },
});

function drawGuess() {
  setAnswerShapes(session.guess ? [point(session.guess, 'guess')] : []);
}

function drawResult(photo) {
  setAnswerShapes([
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [session.guess, photo.point] } },
    point(session.guess, 'guess'),
    point(photo.point, 'answer'),
  ]);
}

// ---- the view ----------------------------------------------------------------
// The whole municipality, because the answer could be anywhere in it and the
// mode has no chunk to frame to. The extent comes from the map's own maxBounds,
// which app.js already set from config/bbox.json — asking the map is one fewer
// file to serve and one fewer copy of the same four numbers to keep in step.
// Padding matches learn.js's `frame`, and for the same reason: the photograph
// takes a column or a sheet depending on the window, and the city has to stay
// out from under it.
function frameCity(duration) {
  const wide = map.getCanvas().clientWidth >= 700;
  map.fitBounds(map.getMaxBounds(), {
    padding: { top: 76, bottom: wide ? 96 : 300, left: 26, right: wide ? 360 : 26 },
    duration,
  });
}

/** Both dots on screen at once, so the miss is a thing you can see. */
function frameResult(photo) {
  const wide = map.getCanvas().clientWidth >= 700;
  const [a, b] = [session.guess, photo.point];
  map.fitBounds([
    [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
    [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  ], {
    padding: { top: 90, bottom: wide ? 110 : 320, left: 40, right: wide ? 380 : 40 },
    // A guess forty metres out should not put you on a rooftop.
    maxZoom: 15.5,
    duration: 600,
  });
}

// ---- the day -----------------------------------------------------------------
function startDay(day) {
  const queue = dayOf(game.photos, day);
  if (!queue.length) return;
  session = {
    day,
    queue,
    at: 0,
    done: [],
    // Where you have said, or null until you first tap. Nothing is scored until
    // Gissa, so this moves as often as you like.
    guess: null,
    year: null,
    // True once the round is scored and the answer is on the map: taps then are
    // looking, not guessing. Same idea as learn.js's `settling`, but it ends on
    // a button rather than on a timer — there is something to read here.
    settled: false,
  };
  addAnswerLayers();
  setAnswerShapes([]);
  enterBlind(map, []);
  clearHighlight(map);
  frameCity(600);
  el('photostart').hidden = true;
  el('photoplay').hidden = false;
  renderShot();
}

function quitDay() {
  if (!session) return;
  leaveBlind(map);
  setAnswerShapes([]);
  session = null;
  el('photoplay').hidden = true;
  el('photosummary').hidden = true;
  showPhotoStart();
}

const current = () => session?.queue[session.at] ?? null;

/** Is a tap on the map a guess right now? */
const answerable = () => !!session && !session.settled && !!current();

function placeGuess(lngLat) {
  session.guess = [lngLat.lng, lngLat.lat];
  drawGuess();
  renderAsk();
}

// ---- answering ---------------------------------------------------------------
function commit() {
  const photo = current();
  if (!photo || session.settled || !session.guess) return;

  const result = scored({ photo, year: session.year, point: session.guess });
  session.done.push({ photo, result });
  session.settled = true;

  drawResult(photo);
  frameResult(photo);
  renderResult(photo, result);
}

function nextPhoto() {
  session.at += 1;
  session.guess = null;
  session.settled = false;
  setAnswerShapes([]);
  if (session.at >= session.queue.length) { finishDay(); return; }
  frameCity(500);
  renderShot();
}

function finishDay() {
  const total = session.done.reduce((sum, d) => sum + d.result.total, 0);
  recordDay(session.day, total);
  renderSummary(total);
}

// ---- chrome ------------------------------------------------------------------
const sv = (n) => n.toLocaleString('sv-SE');

/** The photograph, and the two controls that answer it. */
function renderShot() {
  const photo = current();
  if (!photo) return;

  el('photoprompt').textContent = `Bild ${session.at + 1} av ${session.queue.length}`;
  renderTally();

  const img = el('shotimage');
  img.src = photo.image;
  // The caption is the answer, so the alt text cannot be it. What a blind user
  // gets here is the honest thing: this is a photograph you are being asked to
  // date and place, and its description arrives once you have.
  img.alt = 'Historiskt fotografi från Malmö. Beskrivningen visas när du har gissat.';

  el('shotask').hidden = false;
  el('shotresult').hidden = true;

  // Mid-range, so the slider opens somewhere honest rather than on an edge that
  // reads as a hint.
  session.year = Math.round((game.minYear + game.maxYear) / 2);
  const slider = el('yearpick');
  slider.min = game.minYear;
  slider.max = game.maxYear;
  slider.value = session.year;
  renderYear();
  renderAsk();
}

function renderYear() {
  el('yearvalue').textContent = session.year;
}

/** The button says what is still missing, so nobody presses it and wonders. */
function renderAsk() {
  const ready = !!session.guess;
  const btn = el('photoguess');
  btn.disabled = !ready;
  btn.textContent = ready ? 'Gissa' : 'Peka på kartan först';
}

function renderTally() {
  const so = session.done.reduce((sum, d) => sum + d.result.total, 0);
  el('phototally').textContent = sv(so);
}

/** How far off, in the two units the round is scored in. */
function renderResult(photo, result) {
  el('shotask').hidden = true;
  el('shotresult').hidden = false;
  renderTally();

  const off = Math.abs(result.years);
  el('resultyear').textContent = off === 0
    ? `${photo.year} — precis rätt år`
    : `${photo.year} — du sa ${session.year}, ${off} år ${result.years > 0 ? 'för sent' : 'för tidigt'}`;

  const m = Math.round(result.meters);
  el('resultplace').textContent = m < 1000
    ? `${m} m från platsen`
    : `${(m / 1000).toFixed(1)} km från platsen`;

  el('resultpoints').textContent = `${sv(result.total)} p — ${sv(result.yearPoints)} för året, ${sv(result.placePoints)} för platsen`;

  // What it is a photograph of. This is the payoff and it is why the mode is
  // worth playing twice: the caption is a sentence about Malmö you did not know.
  el('resultplacename').textContent = photo.place ?? '';
  el('resultplacename').hidden = !photo.place;
  el('resultcaption').textContent = photo.caption ?? '';
  el('resultcaption').hidden = !photo.caption;

  // Always shown, never only in a footer. Half the set is CC BY, which requires
  // it, and a photograph is someone's work either way.
  el('resultcredit').textContent = photo.credit;
  const source = el('resultsource');
  source.href = photo.source;

  el('photonext').textContent = session.at + 1 >= session.queue.length ? 'Se dagen' : 'Nästa bild';
}

function renderSummary(total) {
  el('photoplay').hidden = true;
  el('photosummary').hidden = false;
  leaveBlind(map);
  setAnswerShapes([]);

  el('summaryscore').textContent = `${sv(total)} / ${sv(MAX_SCORE)}`;
  el('summaryday').textContent = `Dag ${session.day}`;

  const list = el('photosummarylist');
  list.replaceChildren(...session.done.map(({ photo, result }) => {
    const li = document.createElement('li');
    const year = document.createElement('span');
    year.className = 'sumyear';
    year.textContent = photo.year;
    const where = document.createElement('span');
    where.className = 'sumplace';
    where.textContent = photo.place ?? '—';
    const pts = document.createElement('span');
    pts.className = 'sumpoints';
    pts.textContent = sv(result.total);
    li.append(year, where, pts);
    return li;
  }));
}

// ---- the front door ----------------------------------------------------------
function renderStart() {
  const day = dayNumber();
  const played = scoreOf(day);
  el('photoday').textContent = `Dag ${day}`;
  el('photosub').textContent = played === null
    ? `Fem fotografier, ${game.minYear}–${game.maxYear}. Gissa år och plats.`
    : `Du har spelat idag: ${sv(played)} av ${sv(MAX_SCORE)}.`;

  const days = daysPlayed();
  el('photostats').textContent = days
    ? `Bästa dagen ${sv(bestScore())} · ${days} ${days === 1 ? 'dag' : 'dagar'} spelade`
    : `${game.photos.length} fotografier · ${cycleLength(game.photos)} dagar innan någon återkommer`;

  el('photobegin').textContent = played === null ? 'Spela dagens fem' : 'Spela igen';
}

// ---- wiring ------------------------------------------------------------------
export async function initPhotos(mapInstance, { onExplore }) {
  map = mapInstance;
  leaveToExplore = onExplore;
  game = await fetch(DATA).then((r) => r.json());

  el('photobegin').addEventListener('click', () => startDay(dayNumber()));
  el('photoquit').addEventListener('click', quitDay);
  el('photoguess').addEventListener('click', commit);
  el('photonext').addEventListener('click', nextPhoto);
  el('photosummarydone').addEventListener('click', quitDay);
  el('photoexplore').addEventListener('click', () => leaveToExplore?.());

  const slider = el('yearpick');
  slider.addEventListener('input', () => {
    if (!session) return;
    session.year = Number(slider.value);
    renderYear();
  });

  // Tapping the photograph gets it out of the way, because on a phone the thing
  // you are studying and the thing you are answering on want the same screen.
  el('shottoggle').addEventListener('click', () => {
    el('shot').classList.toggle('folded');
  });

  map.on('click', (e) => {
    if (!session) return;
    e._handled = true;
    if (answerable()) placeGuess(e.lngLat);
  });
}

/** Escape, while a day is running. One layer: the day itself. */
export function escapePhotos() {
  if (!session) return false;
  quitDay();
  return true;
}

export function showPhotoStart() {
  renderStart();
  el('photostart').hidden = false;
}

export function hidePhotoStart() {
  el('photostart').hidden = true;
  el('photoplay').hidden = true;
  el('photosummary').hidden = true;
}
