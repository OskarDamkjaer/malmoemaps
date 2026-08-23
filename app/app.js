// The app: one map, locked north-up, and two things to do with it.
//
// This used to be a reference map and is now a way to learn the city, which is
// a smaller change than it sounds: the map is the same map. What changed is
// which of its two modes you land in.
//
//   Öva      — the front door. Rounds of names to place on a map with every
//              label taken off it (learn.js, blind.js, rounds.mjs).
//   Utforska — the old reference map, unchanged: search, layer chips, tap
//              anything to find out what it is. It is where you go to learn the
//              names before being asked for them, so it is a study aid rather
//              than a leftover.
//
// Everything the two modes disagree about is in `setMode` below, and it is
// mostly about what the map is allowed to tell you.
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
import { CATEGORIES, DEFAULT_ON, categoryMinzoom } from './categories.mjs';
import {
  addDataLayers, isCategoryOn, onFeatureClick, restoreCategories, setCategoryVisible,
} from './layers.js';
import { clearHighlight } from './highlight.js';
import { initSearch } from './search.js';
import {
  escapeLearn, hidePicker, initLearn, isPlaying, showPicker,
} from './learn.js';
import {
  escapePhotos, hidePhotoStart, initPhotos, isPlayingPhotos, showPhotoStart,
} from './photos.js';

const boot = document.getElementById('boot');
const bootmsg = document.getElementById('bootmsg');
const VIEW_KEY = 'malmo:view';
const LAYERS_KEY = 'malmo:layers';

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

// Which chips were on, same bargain: the map you left is the map you come back
// to. An unreadable value means the default set, never a crash on boot.
function savedCategories() {
  try {
    const ids = JSON.parse(localStorage.getItem(LAYERS_KEY));
    if (Array.isArray(ids)) return ids.filter((id) => CATEGORIES.some((c) => c.id === id));
  } catch { /* corrupt or blocked storage is not worth a failure */ }
  return DEFAULT_ON;
}

function rememberCategories() {
  try {
    localStorage.setItem(LAYERS_KEY, JSON.stringify(CATEGORIES.filter((c) => isCategoryOn(c.id)).map((c) => c.id)));
  } catch { /* private mode; forgetting is fine */ }
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
  // Before the layers exist, so a restored category is added visible rather
  // than added hidden and flipped a frame later.
  restoreCategories(savedCategories());
  try {
    await addDataLayers(map);
  } catch (err) {
    // The basemap is the map; the layers on top failing should not blank it.
    console.error('layers', err);
  }
  boot.classList.add('done');
  initSearch(map);
  buildChips();
  try {
    await initLearn(map, { onExplore: () => setMode('explore') });
  } catch (err) {
    // No quiz is a broken learning app, so unlike the layers this is worth
    // saying out loud rather than falling back to a map with nothing to do.
    fail('Övningarna kunde inte laddas', err);
    return;
  }
  try {
    await initPhotos(map, { onExplore: () => setMode('explore') });
  } catch (err) {
    // Unlike the quiz, this one is survivable: Förr is a second thing to do
    // rather than the thing the app is for, so a missing game.json costs you the
    // tab and nothing else. The tab is hidden rather than left to throw when
    // pressed.
    console.error('photos', err);
    for (const tab of document.querySelectorAll('.modetab[data-mode="photos"]')) tab.hidden = true;
  }
  setMode('learn');
});

// ---- the three modes -------------------------------------------------------
// Study chrome and being-asked chrome are never both on screen. The search bar
// is the reason this is a hard switch rather than a soft one: a text box that
// answers "var ligger Sofielund?" is not a feature you leave within reach of
// someone being asked exactly that — and it would date a photograph for them
// too, so Förr wants it gone for the same reason Öva does.
//
// Every panel every mode owns is named here, including both front doors —
// splitting "which mode are we in" across three files is how two of them
// eventually end up on screen together. The two asking modes are the same case
// as far as the explore chrome is concerned, which is what `asking` is: there is
// nothing here that is true of Öva and not of Förr.
function setMode(mode) {
  const asking = mode !== 'explore';
  document.getElementById('searchbar').hidden = asking;
  document.getElementById('layers').hidden = asking;
  document.getElementById('tolearn').hidden = asking;
  // Both front doors go down first, so the one being opened is the only one that
  // can be up regardless of which one we came from.
  hidePicker();
  hidePhotoStart();
  if (!asking) return;
  hideCard();
  showLayers(false);
  // Both front doors carry the tab strip, so both have to agree about which one
  // is current — the one you are looking at and the one you are not.
  for (const tab of document.querySelectorAll('.modetab')) {
    if (tab.dataset.mode === mode) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  if (mode === 'photos') showPhotoStart();
  else showPicker();
}

// The way back from studying. It returns you to Öva rather than to whichever
// front door you left from: leaving for the map is a study trip, and the quiz is
// what the app is for.
document.getElementById('tolearn').addEventListener('click', () => setMode('learn'));

// One handler for every tab in either front door — the markup is duplicated
// because the two panels are siblings, but the behaviour is not.
for (const tab of document.querySelectorAll('.modetab')) {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
}

// ---- layer chips -----------------------------------------------------------
// One chip per category, in the order categories.mjs lists them, stacked in a
// panel behind one button. Closed by default: the map is the app, and a menu of
// fourteen things along the bottom of a phone is a menu you read past every
// time you look at the city.
//
// Closed is `hidden`, not "scrolled away" or "0 % opacity" — the chips leave
// the tab order and the accessibility tree with the pixels, which is the same
// rule the map obeys about what you can tap.
const chipRow = document.getElementById('chips');
const layerToggle = document.getElementById('layerstoggle');
// A list, not a Map: `Map` in this file is MapLibre's.
const chips = [];

// The category's own icon, drawn from the path data it carries. Inline SVG
// rather than an <img>: it inherits the chip's colour, and there is no
// thirteenth request to make offline.
function chipIcon(cat) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', cat.icon);
  svg.append(path);
  return svg;
}

function buildChips() {
  for (const cat of CATEGORIES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.style.setProperty('--chip', cat.color);
    chip.setAttribute('aria-pressed', String(isCategoryOn(cat.id)));
    chip.append(chipIcon(cat), document.createTextNode(cat.label));
    chip.addEventListener('click', () => {
      const now = !isCategoryOn(cat.id);
      setCategoryVisible(map, cat.id, now);
      chip.setAttribute('aria-pressed', String(now));
      rememberCategories();
      // A chip that is on shows what it stands for. Where its data only exists
      // deeper in — POIs are in the tiles from z14 and nowhere earlier — the
      // map goes there rather than the chip greying out and waiting for you to
      // work out why nothing happened.
      const floor = categoryMinzoom(cat);
      if (now && map.getZoom() < floor) map.easeTo({ zoom: floor, duration: 700 });
      updateChips();
    });
    chips.push({ cat, chip });
    chipRow.append(chip);
  }
  updateChips();
  map.on('zoomend', updateChips);
}

// Opening a chip zooms to where it can draw, so this is now only for the
// categories restored from last time: the view comes back as you left it, and
// a chip that was on at z11 still has to admit it is holding nothing.
function updateChips() {
  const zoom = map.getZoom();
  for (const { cat, chip } of chips) {
    chip.toggleAttribute('data-waiting', isCategoryOn(cat.id) && zoom < categoryMinzoom(cat));
  }
}

function showLayers(open) {
  chipRow.hidden = !open;
  layerToggle.setAttribute('aria-expanded', String(open));
}

layerToggle.addEventListener('click', () => showLayers(chipRow.hidden));

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
// Identifying what you tapped is the study mode's whole trick, and it is the
// one thing an asking mode must never do: there the same tap is an answer, and
// the map is not allowed to grade it by naming it. Förr needs this at least as
// badly as Öva — a card reading "Södergatan" under your pin would answer half
// the question outright.
const busy = () => isPlaying() || isPlayingPhotos();
onFeatureClick(map, showCard, busy);
map.on('click', (e) => { if (!e._handled && !busy()) hideCard(); });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // A round or a day in progress owns Escape outright: it has its own stack of
  // things to back out of, and dismissing the explore card underneath it would
  // be dismissing something that is not on screen. Only one of these can be
  // running, so the order between them decides nothing.
  if (escapeLearn() || escapePhotos()) return;
  hideCard();
  // Escape out of the layer panel lands back on the button that opened it,
  // rather than at the top of the page.
  if (!chipRow.hidden) {
    showLayers(false);
    layerToggle.focus();
  }
});

// ---- offline ---------------------------------------------------------------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('sw:', err));
}
