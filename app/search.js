// Search — 4,168 entries, matched in the browser, no request anywhere.
//
// The index is built ahead of time (scripts/build-search.mjs): one entry per
// searchable thing, each with a point and the district it sits in. All this
// file does is decide which entries a few typed letters mean, and it does it
// with a scored substring match rather than a fuzzy library, because the thing
// being searched is a street name you already half-remember: "kungs" should put
// Kungsgatan first, and "möllan" should not quietly match Mölledalsvägen.
//
// Selecting a result pans and drops a pin. It does not route, and there is no
// "directions" button hiding behind it.
import { Marker } from './vendor/maplibre-gl.mjs';
import { highlightSearchResult } from './highlight.js';

const CAT_LABEL = {
  stadsdel: 'Stadsdel', neighbourhood: 'Område', district: 'Delområde', part: 'Kvarter',
  street: 'Gata', landmark: 'Landmärke', poi: 'Plats',
  food: 'Mat', culture: 'Kultur', transit: 'Station', cycling: 'Cykel',
};

// Swedish sorts å ä ö after z, but a search box should treat them as their
// bare vowels: typing "malardalen" must still find Mälardalen.
const fold = (s) => s.toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae');

let entries = [];
let pin = null;

function score(entry, needle) {
  const hay = entry.folded;
  const at = hay.indexOf(needle);
  if (at < 0) return -1;
  // Prefix beats word-start beats anywhere; shorter names and better-ranked
  // entries break the ties. Rank comes from the index (1 = most prominent).
  let s = at === 0 ? 1000 : (hay[at - 1] === ' ' || hay[at - 1] === '-' ? 700 : 400);
  s -= Math.min(hay.length, 40);
  s -= (entry.rank ?? 5) * 8;
  if (['landmark', 'district', 'stadsdel', 'neighbourhood', 'part'].includes(entry.cat)) s += 60;
  return s;
}

function search(query, limit = 20) {
  const needle = fold(query.trim());
  if (needle.length < 2) return [];
  const hits = [];
  for (const e of entries) {
    const s = score(e, needle);
    if (s >= 0) hits.push({ e, s });
  }
  hits.sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name, 'sv'));
  return hits.slice(0, limit).map((h) => h.e);
}

export function initSearch(map) {
  const form = document.getElementById('searchform');
  const input = document.getElementById('q');
  const clear = document.getElementById('clear');
  const list = document.getElementById('results');
  let active = -1;
  let shown = [];

  fetch('/data/search.json')
    .then((r) => r.json())
    .then((data) => {
      entries = data.map((e) => ({ ...e, folded: fold(e.name) }));
      input.disabled = false;
    })
    .catch((err) => {
      console.error('search index', err);
      input.placeholder = 'Sökregistret kunde inte laddas';
      input.disabled = true;
    });

  function render(results) {
    shown = results;
    active = -1;
    list.replaceChildren();
    if (!results.length) {
      list.hidden = input.value.trim().length < 2;
      if (!list.hidden) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'Inget hittat';
        list.append(li);
      }
      return;
    }
    for (const [i, e] of results.entries()) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = e.name;
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = CAT_LABEL[e.cat] ?? '';
      const where = document.createElement('span');
      where.className = 'where';
      // A street name alone is ambiguous in a city with three Kyrkogatan; the
      // district is what makes the list decidable.
      where.textContent = e.cat === 'district' ? '' : (e.district ?? '');
      li.append(name, kind, where);
      li.addEventListener('click', () => choose(i));
      list.append(li);
    }
    list.hidden = false;
  }

  function highlight(i) {
    for (const [j, li] of [...list.children].entries()) {
      li.setAttribute('aria-selected', String(j === i));
    }
    active = i;
    list.children[i]?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const e = shown[i];
    if (!e) return;
    pin?.remove();
    pin = new Marker({ color: '#b8562b' }).setLngLat(e.point).addTo(map);
    // Areas and streets are extents, not points; a landmark is a point.
    // Zooming to a sensible level for each beats one flyTo for everything.
    // Each area category is shown at the zoom where its own level is the one
    // being named, so a search lands you on the level you searched for.
    const zoom = { stadsdel: 11.5, neighbourhood: 12.8, district: 13.8, part: 15.5 }[e.cat]
      ?? (e.cat === 'street' ? 15.5 : 16);
    map.flyTo({ center: e.point, zoom: Math.max(map.getZoom(), zoom), speed: 1.4, essential: true });
    // The shape can only be collected once the tiles it lives in have arrived,
    // which is after the flight, not before it.
    map.once('idle', () => highlightSearchResult(map, e));
    list.hidden = true;
    input.blur();
  }

  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    render(search(input.value));
  });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!shown.length) return;
      highlight((active + (ev.key === 'ArrowDown' ? 1 : shown.length - 1) + shown.length) % shown.length);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      choose(active >= 0 ? active : 0);
    } else if (ev.key === 'Escape') {
      list.hidden = true;
      input.blur();
    }
  });

  form.addEventListener('submit', (ev) => ev.preventDefault());

  clear.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    list.hidden = true;
    pin?.remove();
    pin = null;
    input.focus();
  });

  input.addEventListener('focus', () => { if (shown.length) list.hidden = false; });
  map.on('movestart', () => { if (document.activeElement !== input) list.hidden = true; });
}
