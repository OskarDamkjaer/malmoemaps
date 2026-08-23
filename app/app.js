// The app: one map, locked north-up, and one thing to do with it.
//
// This used to be a reference map and is now a way to learn the city, which is
// a smaller change than it sounds: the map is the same map. What changed is
// that the quiz is the front door and the labelled map is the way out of it.
//
//   Öva      — the app. Rounds of names to place on a map with every label
//              taken off it (learn.js, blind.js, rounds.mjs).
//   Utforska — the same map with its words back on: tap anything to find out
//              what it is. It is where you go to learn the names before being
//              asked for them, so it is a study aid rather than a leftover.
//
// Everything the two disagree about is in `setMode` below, and it is only ever
// about what the map is allowed to tell you.
//
// Boot order matters and is the only clever thing here. The basemap is a single
// 13 MB pmtiles archive, so instead of letting the map issue HTTP Range reads
// tile by tile, the whole archive is downloaded once, up front, and handed to
// the pmtiles reader as an in-memory file. Two consequences worth the wait:
// panning and zooming never touch the network again, and "offline" is not a
// separate mode — it is the same code path with the service worker answering.
import {
  Map, GeolocateControl, AttributionControl, ScaleControl, addProtocol,
} from './vendor/maplibre-gl.mjs';
import { addDataLayers, onFeatureClick } from './layers.js';
import { clearHighlight } from './highlight.js';
import {
  escapeLearn, hidePicker, initLearn, isPlaying, showPicker,
} from './learn.js';

const boot = document.getElementById('boot');
const bootmsg = document.getElementById('bootmsg');
const VIEW_KEY = 'malmo:view';

function fail(what, err) {
  console.error(what, err);
  boot.classList.add('failed');
  boot.classList.remove('done');
  bootmsg.textContent = `${what}. ${err?.message ?? ''}`.trim();
}

// ---- basemap archive -------------------------------------------------------
// Progress is reported because 13 MB on a phone is a visible wait exactly once;
// after that the service worker answers and this is instant.
async function loadArchive(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    bootmsg.textContent = total
      ? `Laddar kartan… ${Math.round((got / total) * 100)} %`
      : `Laddar kartan… ${(got / 1048576).toFixed(1)} MB`;
  }
  // A File (not a Blob) because the pmtiles reader keys archives by file name,
  // which is what style.json's `pmtiles://malmo.pmtiles` refers to.
  return new File(chunks, url.split('/').pop());
}

// ---- view persistence ------------------------------------------------------
// A reference map you reopen twenty times a day should not throw away where you
// were looking. Stored locally, like everything else here.
function savedView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY));
    if (v && Number.isFinite(v.lng) && Number.isFinite(v.lat) && Number.isFinite(v.zoom)) return v;
  } catch { /* corrupt or blocked storage is not worth a failure */ }
  return null;
}

function rememberView(map) {
  const c = map.getCenter();
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({
      lng: +c.lng.toFixed(5), lat: +c.lat.toFixed(5), zoom: +map.getZoom().toFixed(2),
    }));
  } catch { /* private mode; forgetting the view is fine */ }
}

// ---- start -----------------------------------------------------------------
let archive;
try {
  const protocol = new pmtiles.Protocol();
  addProtocol('pmtiles', protocol.tile);
  archive = new pmtiles.PMTiles(new pmtiles.FileSource(await loadArchive('/malmo.pmtiles')));
  protocol.add(archive);
} catch (err) {
  fail('Kartdatan kunde inte laddas', err);
  throw err;
}

// MapLibre insists on absolute sprite and glyph URLs, but a style.json that
// hard-codes an origin is a style.json that only works on one host. So the file
// stays relative and the origin is stitched in here, where it is known.
// Plain concatenation, not new URL(): the glyph path carries {fontstack} and
// {range} placeholders that URL() would dutifully percent-encode.
const style = await fetch('/style.json').then((r) => r.json());
style.sprite = location.origin + style.sprite;
style.glyphs = location.origin + style.glyphs;

const header = await archive.getHeader();
const bounds = [[header.minLon, header.minLat], [header.maxLon, header.maxLat]];
const view = savedView();

const map = new Map({
  container: 'map',
  style,
  center: view ? [view.lng, view.lat] : [header.centerLon, header.centerLat],
  zoom: view ? view.zoom : 12.5,
  minZoom: header.minZoom,
  // Two levels of overzoom past the deepest tile: at street level the map stays
  // readable rather than stopping dead at z16.
  maxZoom: header.maxZoom + 2,
  // Panning out of the extract would show empty background, so it is simply not
  // possible. The margin lets the edge of the data reach the edge of the screen.
  maxBounds: [[header.minLon - 0.06, header.minLat - 0.03], [header.maxLon + 0.06, header.maxLat + 0.03]],
  // North-up, always. Not a default the user can lose by accident.
  bearing: 0,
  pitch: 0,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  rollEnabled: false,
  attributionControl: false,
  // Nothing about this map is a third-party service; the "improve this map"
  // link would only be confusing.
  maplibreLogo: false,
  fadeDuration: 120,
});

map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();

// One global, on purpose: being able to poke at the map from the console is
// how the zoom thresholds in build-style.mjs get tuned.
window.map = map;

map.addControl(new AttributionControl({ compact: false }), 'bottom-right');
map.addControl(new ScaleControl({ maxWidth: 96, unit: 'metric' }), 'bottom-left');
map.addControl(new GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
  showAccuracyCircle: true,
  // The cone points where the phone is pointing; the map itself never turns.
  showUserHeading: true,
}), 'bottom-right');

map.on('error', (e) => console.warn('map:', e.error?.message ?? e.error ?? e));
map.on('moveend', () => rememberView(map));

map.on('load', async () => {
  try {
    await addDataLayers(map);
  } catch (err) {
    // The basemap is the map; the layers on top failing should not blank it.
    console.error('layers', err);
  }
  boot.classList.add('done');
  try {
    await initLearn(map, { onExplore: () => setMode('explore') });
  } catch (err) {
    // No quiz is a broken learning app, so unlike the layers this is worth
    // saying out loud rather than falling back to a map with nothing to do.
    fail('Övningarna kunde inte laddas', err);
    return;
  }
  setMode('learn');
});

// ---- the two modes ---------------------------------------------------------
// Study chrome and being-asked chrome are never both on screen, and the hard
// part is the map rather than the panels: while a round is running the map is
// not allowed to name anything, because being told what is under your finger is
// the answer to the question you are being asked.
//
// So this is one function rather than a flag each file reads: which panels are
// up, and whether the way back to the quiz is reachable, are decided in the same
// place, and there is nowhere for them to drift apart.
function setMode(mode) {
  const asking = mode !== 'explore';
  document.getElementById('tolearn').hidden = asking;
  hidePicker();
  if (!asking) return;
  hideCard();
  showPicker();
}

// The way back from studying: leaving for the labelled map is a study trip, and
// the quiz is what you were doing before it.
document.getElementById('tolearn').addEventListener('click', () => setMode('learn'));

// ---- selected feature card -------------------------------------------------
const card = document.getElementById('card');
const cardName = document.getElementById('cardname');
const cardMeta = document.getElementById('cardmeta');
const cardDesc = document.getElementById('carddesc');

export function showCard({ name, meta, description }) {
  cardName.textContent = name;
  cardMeta.textContent = meta ?? '';
  cardMeta.hidden = !meta;
  cardDesc.textContent = description ?? '';
  cardDesc.hidden = !description;
  card.hidden = false;
}

// The card and the shape on the map are one selection: they appear and go away
// together, whichever way you dismiss them.
export function hideCard() {
  card.hidden = true;
  clearHighlight(map);
}

document.getElementById('cardclose').addEventListener('click', hideCard);
// Identifying what you tapped is the study map's whole trick, and it is the one
// thing a round must never do: there the same tap is an answer, and the map is
// not allowed to grade it by naming it.
onFeatureClick(map, showCard, isPlaying);
map.on('click', (e) => { if (!e._handled && !isPlaying()) hideCard(); });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // A round in progress owns Escape outright: it has its own stack of things to
  // back out of, and dismissing the explore card underneath it would be
  // dismissing something that is not on screen.
  if (escapeLearn()) return;
  hideCard();
});

// ---- offline ---------------------------------------------------------------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('sw:', err));
}
