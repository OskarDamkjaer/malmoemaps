// The area hierarchy: which level of Malmö is on screen at which zoom.
//
// This is the part of the map meant to teach you how the city is put together,
// so it obeys one rule above all others: **exactly one level at a time**. A
// level you can see half of is a level you can't learn. Two earlier attempts
// failed this — zoom buckets by polygon area buried the small central
// districts, and letting levels compete on collision made *which* level you
// were seeing depend on where you'd panned.
//
//   z < 11         Malmö. Just the city.
//   z 11   – 12.3  the ten stadsdelar (Västra Innerstaden, Limhamn-Bunkeflo…)
//   z 12.3 – 13.4  the names in between (Slottsstaden, Sorgenfri, Limhamn…)
//   z ≥ 13.4       all 136 delområden (Västra Sorgenfri, Rönneholm, Ribersborg)
//
// Every level draws its own boundary as well as its own names — an outline you
// can see is what makes a level a division of the city rather than a scatter of
// words. Levels 1 and 3 have no polygons of their own, so their outlines are
// dissolved at build time from the level below (scripts/lib/geo.mjs).
//
// Level 3 is a complete division of the city, but only 31 of its names are its
// own. Where an in-between name exists it is drawn — Slottsstaden over its
// seven delområden — and where none exists the delområde is *elevated*: it
// stands in for itself, so the zoom that used to be blank over Rörsjöstaden now
// says Rörsjöstaden, which is the true answer to "what is this place called?".
// 66 of the 136 are elevated this way; the other 70 are spoken for by a name
// above them, and only appear when level 4 breaks those 31 names apart. That
// break is what the handover at 13.4 now *is*.
//
// (An earlier version left the gaps blank rather than elevate, on the grounds
// that a name at two zooms is a level repeating the level below. Wrong emphasis:
// the repeat is the honest half — Rörsjöstaden has no other name — and the blank
// was the dishonest one, since it read as "nothing here".)
//
// Six of the largest gaps closed differently: in Hyllie, Rosengård, Oxie, Fosie,
// Husie and Kirseberg the in-between name people say is the stadsdel's own name
// at a smaller extent. Five are now curated groupings that say so; the sixth
// could not be. areas.json's _doc.rejected keeps the reasoning.
//
// Below level 4 there is nothing — but *inside* it there is one more grain.
// parts.geojson (Gamla Väster, Erikslust, Fullriggaren, Seved) is drawn with the
// delområden rather than as a fifth rung: these names have no boundary anywhere
// in Malmö, so a level of their own would be words floating over the basemap,
// which is the failure this ladder is built against. Italic, smaller, and on
// their own chip in the layer menu, so the experiment is reversible.
//
// This file is the only place the ladder is written down. app/layers.js draws
// from it, scripts/build-style.mjs caps the basemap's own "Malmö" label at the
// top of it, and test/area-levels.test.mjs holds it to all of the above.

/** The zoom at which each level takes over from the one before it. */
export const TIER = {
  stadsdel: 11,
  neighbourhood: 12.3,
  delomrade: 13.4,
};

/**
 * The ladder itself. `from` is inclusive and `to` exclusive, matching how
 * MapLibre reads minzoom/maxzoom, so the ranges tile the zoom axis with no
 * seam and no overlap.
 */
export const LEVELS = [
  { id: 'kommun', from: 0, to: TIER.stadsdel, example: 'Malmö' },
  { id: 'stadsdel', from: TIER.stadsdel, to: TIER.neighbourhood, example: 'Västra Innerstaden' },
  { id: 'neighbourhood', from: TIER.neighbourhood, to: TIER.delomrade, example: 'Slottsstaden' },
  { id: 'delomrade', from: TIER.delomrade, to: Infinity, example: 'Rönneholm' },
];

/** The one level showing at this zoom. */
export function levelAt(zoom) {
  return LEVELS.find((l) => zoom >= l.from && zoom < l.to) ?? null;
}

const OUTLINE = '#a89880';
const NAME = '#5f574a';
// A shade off the area names: a part is a name inside a name, and the ink says
// so before the size does.
const PART = '#6f6656';
const HALO = 'rgba(248,244,240,0.92)';

const nameStyle = (color, size, extra = {}) => ({
  layout: {
    'text-field': ['get', 'name'],
    'text-font': ['Roboto Medium'],
    'text-size': size,
    'text-letter-spacing': 0.08,
    'text-max-width': 9,
    'text-padding': 3,
    ...extra,
  },
  paint: {
    'text-color': color,
    'text-halo-color': HALO,
    'text-halo-width': 1.5,
  },
});

/**
 * Every layer that draws an area boundary or an area name, in draw order.
 *
 * Each carries `metadata.level` (which rung of the ladder it belongs to) and
 * `metadata.role` ('outline' or 'name'), which is what lets the test ask the
 * only question that matters: at zoom z, which levels are on screen?
 *
 * Two runtime inputs, both filter expressions that can only be built once the
 * data has loaded, and both left permissive here so the ladder can be inspected
 * without a map: `notADistrict` excludes OSM suburb names we already draw from
 * our own data, and `notGrouped` picks out the delområden no curated name
 * claims — the ones elevated to level 3.
 */
export function areaLayers({ notADistrict = true, notGrouped = true } = {}) {
  return [
    // ---- level 1: Malmö ----------------------------------------------------
    // The name itself comes from the basemap's place_city label, which
    // build-style.mjs caps at TIER.stadsdel so it leaves when this level does.
    {
      id: 'kommun-line',
      type: 'line',
      source: 'kommun',
      maxzoom: TIER.stadsdel,
      metadata: { level: 'kommun', role: 'outline' },
      paint: {
        'line-color': OUTLINE,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, TIER.stadsdel, 1.8],
        'line-opacity': 0.75,
      },
    },

    // ---- level 2: the ten stadsdelar ---------------------------------------
    {
      id: 'stadsdel-line',
      type: 'line',
      source: 'stadsdelar',
      minzoom: TIER.stadsdel,
      maxzoom: TIER.neighbourhood,
      metadata: { level: 'stadsdel', role: 'outline' },
      paint: {
        'line-color': OUTLINE,
        'line-width': ['interpolate', ['linear'], ['zoom'], TIER.stadsdel, 1, TIER.neighbourhood, 1.7],
        'line-opacity': 0.65,
      },
    },
    {
      id: 'area-label-stadsdel',
      type: 'symbol',
      source: 'stadsdel-labels',
      minzoom: TIER.stadsdel,
      maxzoom: TIER.neighbourhood,
      metadata: { level: 'stadsdel', role: 'name' },
      ...nameStyle('#7c705f', ['interpolate', ['linear'], ['zoom'], TIER.stadsdel, 12, TIER.neighbourhood, 14], {
        'text-letter-spacing': 0.18,
        'text-transform': 'uppercase',
        'text-max-width': 8,
        // All ten, always: at this zoom they are what the map is saying.
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      }),
    },

    // ---- level 3: the names in between, and the rest standing in ------------
    // 31 curated shapes, and between them the delområden no name covers, drawn
    // here under their own names. Together they tile the city, so the outline
    // matters more at this level than at any other: it is the only thing saying
    // which of the two kinds of name you are looking at — a word that gathers
    // seven delområden, or a word that is one.
    {
      id: 'neighbourhood-line',
      type: 'line',
      source: 'neighbourhoods',
      minzoom: TIER.neighbourhood,
      maxzoom: TIER.delomrade,
      metadata: { level: 'neighbourhood', role: 'outline' },
      paint: {
        'line-color': OUTLINE,
        'line-width': ['interpolate', ['linear'], ['zoom'], TIER.neighbourhood, 1.3, TIER.delomrade, 2],
        'line-opacity': 0.7,
      },
    },
    // Every delområde no grouping claims, drawn at level 3 with its own
    // boundary — the same line as the curated names beside it, because at this
    // zoom it is doing the same job.
    {
      id: 'district-line-elevated',
      type: 'line',
      source: 'districts',
      filter: ['all', ['==', ['get', 'admin_level'], 10], notGrouped],
      minzoom: TIER.neighbourhood,
      maxzoom: TIER.delomrade,
      metadata: { level: 'neighbourhood', role: 'outline' },
      paint: {
        'line-color': OUTLINE,
        'line-width': ['interpolate', ['linear'], ['zoom'], TIER.neighbourhood, 1.3, TIER.delomrade, 2],
        'line-opacity': 0.7,
      },
    },
    {
      id: 'area-label-neighbourhood',
      type: 'symbol',
      source: 'neighbourhood-labels',
      minzoom: TIER.neighbourhood,
      maxzoom: TIER.delomrade,
      metadata: { level: 'neighbourhood', role: 'name' },
      ...nameStyle(NAME, ['interpolate', ['linear'], ['zoom'], TIER.neighbourhood, 12.5, TIER.delomrade, 14], {
        'text-letter-spacing': 0.12,
        'text-transform': 'uppercase',
        // Always drawn — these 31 are what the level is for — but no longer
        // invisible to the collision index: an elevated name that cannot fit
        // beside Slottsstaden should be the one that goes.
        'text-allow-overlap': true,
        'text-ignore-placement': false,
      }),
    },
    // The elevated names, in the same voice as the curated ones: at this zoom
    // "Rörsjöstaden" and "Slottsstaden" are the same kind of answer, and typing
    // one of them smaller would be the map hedging about which it means. They
    // are 66 rather than 31, though, so unlike the curated names they take their
    // turn — largest first, and gone where there is no room.
    {
      id: 'district-label-elevated',
      type: 'symbol',
      source: 'district-labels',
      filter: ['all', ['==', ['get', 'admin_level'], 10], notGrouped],
      minzoom: TIER.neighbourhood,
      maxzoom: TIER.delomrade,
      metadata: { level: 'neighbourhood', role: 'name' },
      ...nameStyle(NAME, ['interpolate', ['linear'], ['zoom'], TIER.neighbourhood, 12.5, TIER.delomrade, 14], {
        'text-letter-spacing': 0.12,
        'text-transform': 'uppercase',
        'symbol-sort-key': ['get', 'rank'],
      }),
    },

    // ---- level 4: all 136 delområden ---------------------------------------
    {
      id: 'district-line',
      type: 'line',
      source: 'districts',
      filter: ['==', ['get', 'admin_level'], 10],
      minzoom: TIER.delomrade,
      metadata: { level: 'delomrade', role: 'outline' },
      paint: {
        'line-color': OUTLINE,
        'line-width': ['interpolate', ['linear'], ['zoom'], TIER.delomrade, 0.9, 16, 1.4],
        'line-opacity': 0.6,
        // Dashed, so the finest division reads as the finest division.
        'line-dasharray': [3, 2],
      },
    },
    {
      id: 'district-label',
      type: 'symbol',
      source: 'district-labels',
      filter: ['==', ['get', 'admin_level'], 10],
      minzoom: TIER.delomrade,
      metadata: { level: 'delomrade', role: 'name' },
      ...nameStyle(NAME, ['interpolate', ['linear'], ['zoom'], TIER.delomrade, 11.5, 15, 12.5, 17, 13.5], {
        // Area only as a tiebreak: at this zoom perhaps a dozen districts are
        // on screen, so nearly all get placed, and the ones that don't are
        // genuinely on top of each other.
        'symbol-sort-key': ['get', 'rank'],
      }),
    },
    // Inside level 4, not below it: the parts. Gamla Väster, Erikslust, Seved,
    // Fullriggaren — names finer than any boundary in Malmö, which is why they
    // have no outline and cannot be a level of their own. They ride along with
    // the delområden instead, italic and a size smaller so the two grains never
    // read as one division, and they answer to a chip of their own ("Kvarter")
    // so they can be turned off the moment they crowd the map. The ladder still
    // ends at four.
    {
      id: 'area-label-part',
      type: 'symbol',
      source: 'parts',
      minzoom: TIER.delomrade,
      metadata: { level: 'delomrade', role: 'name', category: 'parts' },
      ...nameStyle(PART, ['interpolate', ['linear'], ['zoom'], TIER.delomrade, 10, 15, 11, 17, 12], {
        'text-font': ['Roboto Condensed Italic'],
        'text-letter-spacing': 0.02,
        'text-padding': 6,
        // The delområde's own name outranks its parts: where both cannot fit,
        // this is the one that goes.
        'text-optional': true,
      }),
    },

    // An OSM suburb name for something both official divisions missed. After
    // the dedupe there is usually nothing left here — which is the point of
    // keeping it: whatever OSM adds later shows up without a rebuild.
    {
      id: 'area-label-suburb',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['all', ['==', ['get', 'class'], 'suburb'], notADistrict],
      minzoom: TIER.delomrade,
      metadata: { level: 'delomrade', role: 'name' },
      ...nameStyle(NAME, ['interpolate', ['linear'], ['zoom'], TIER.delomrade, 11.5, 17, 13.5], {
        'text-padding': 7,
      }),
    },
  ];
}

/** The area layers drawn at this zoom, by MapLibre's half-open min/max rule. */
export function areaLayersAt(zoom, options) {
  return areaLayers(options).filter((l) => zoom >= (l.minzoom ?? 0) && zoom < (l.maxzoom ?? Infinity));
}
