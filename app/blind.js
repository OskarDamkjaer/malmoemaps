// The blind map: the same city with every word taken off it.
//
// This is the load-bearing idea of the whole app. A quiz played on the map as
// it normally draws is not a test of whether you know where Sofielund is, it is
// a test of whether you can read "SOFIELUND" — and the reading test is so much
// easier that it hides the fact that you failed the other one.
//
// So the rule is one line and has no exceptions: **while a round is running, no
// layer that draws text is visible.** Not "the names of the thing being asked
// about" — every name. Two reasons for the bluntness:
//
//   1. Names leak sideways. Petribron is a bridge, but it is also a street
//      name; Möllevångstorget is a square, a POI label and half a delområde.
//      A rule that hides "the category being quizzed" would have to know all
//      of that, and would be wrong quietly.
//   2. It is testable. "Which symbol layers are visible during a round?" has
//      one right answer — none — and test/blind.test.mjs asks the real style
//      for it, so a label layer added next year fails there instead of showing
//      up as a free answer.
//
// What is left is a city you can still navigate by: coastline, water, parks,
// the road network, buildings, and — the one thing added rather than removed —
// the delområde boundaries, forced on at every zoom instead of only inside
// their own band of the ladder. They are the slots the area names go in, so
// they are the question rather than the answer.

/** Layer types that can put a word on the map. */
const TEXTUAL = new Set(['symbol']);

/**
 * The layers a round has to hide, from a style's layer list.
 *
 * Pure and map-free so the test can hand it build/style.json plus the app's own
 * layers and get the same answer the running app gets. `keep` is the quiz's
 * outlines, which are never symbol layers today but are excluded anyway: the
 * function should be right about what it is asked, not right by luck.
 */
export function blindedLayerIds(layers, keep = []) {
  const kept = new Set(keep);
  return layers
    .filter((l) => TEXTUAL.has(l.type) && !kept.has(l.id))
    .map((l) => l.id);
}

// What the map looked like before the round, so leaving puts it back exactly.
// A Map rather than a re-render: the alternative is re-adding the style, which
// would drop the pmtiles archive out of memory and cost the user a reload.
let restore = null;

const zoomRange = (layer) => [layer.minzoom ?? 0, layer.maxzoom ?? 24];

/**
 * Take every word off the map and light up the shapes being asked about.
 *
 * Idempotent by construction: entering twice without leaving would record the
 * blinded state as the state to restore, so the second call refuses.
 */
export function enterBlind(map, outline = []) {
  if (restore) return;
  const layers = map.getStyle().layers;
  restore = { hidden: [], zooms: [] };

  for (const id of blindedLayerIds(layers, outline)) {
    if (!map.getLayer(id)) continue;
    const was = map.getLayoutProperty(id, 'visibility') ?? 'visible';
    if (was === 'none') continue;
    restore.hidden.push(id);
    map.setLayoutProperty(id, 'visibility', 'none');
  }

  // The outlines are the question, so they are drawn wherever you are: the
  // delområde boundaries normally start at z13.4, but a chunk played at z12.6
  // needs them at z12.6.
  for (const id of outline) {
    const layer = layers.find((l) => l.id === id);
    if (!layer || !map.getLayer(id)) continue;
    restore.zooms.push([id, ...zoomRange(layer)]);
    map.setLayerZoomRange(id, 0, 24);
    map.setLayoutProperty(id, 'visibility', 'visible');
  }
}

/** Put the words back. */
export function leaveBlind(map) {
  if (!restore) return;
  for (const [id, min, max] of restore.zooms) {
    if (map.getLayer(id)) map.setLayerZoomRange(id, min, max);
  }
  for (const id of restore.hidden) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
  }
  restore = null;
}
