// K-samsök — Riksantikvarieämbetet's aggregator, and through it Malmö Museer.
//
// This is where Malmö before about 2000 is. Malmö Museer alone publish ~360 000
// photographs; filtered to Malmö, dated, and licensed in a way that permits this
// use, there are thousands per decade from the 1880s to the 1990s. What it
// cannot give at any price is a coordinate — `geoDataExists=j` returns zero
// across the entire collection — so placing a record is the caller's problem.
//
// Three things about this data are traps, and every one of them fails silently.
// They are the reason this file exists rather than a URL:
//
//   **The year is not the first year in the record.** A record carries several
//   `pres:context` blocks — Fotograferad, Tillverkad, Förvärvad, Ägd — each with
//   its own timeLabel, and Förvärvad is when the museum *bought* it. Measured
//   across 2 000 records, taking the first one found was off by a median of 84
//   years and a maximum of 124: it dates an 1865 photograph to 1949. Only
//   `Fotograferad` is read, and a record without one is dropped rather than
//   guessed at.
//
//   **The description is the only field that says where.** `pres:content` looks
//   like it should — it is where a street address sits in some records — but it
//   is mostly accession numbers and the credit boilerplate "Foto: X / Malmö
//   museum". Matching place names against it makes every one of eleven thousand
//   photographs a photograph of Malmö Museer: 208 false hits per 2 000 records,
//   against 9 when only the description is read. So content is read for the
//   photographer and for nothing else.
//
//   **The licence index wants a full URI.** `mediaLicense="License#pdmark"`,
//   which is how the documentation writes it, matches nothing — and does not
//   error, it returns totalHits 0.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const API = 'https://kulturarvsdata.se/ksamsok/api';
const CACHE = 'data/cache/ksamsok';
const PAGE = 500;

// x-api=test is what Riksantikvarieämbetet documents for development. A real key
// is free; set KSAMSOK_KEY before running this in anger.
const KEY = process.env.KSAMSOK_KEY ?? 'test';

export const LICENSE = {
  pdmark: 'http://kulturarvsdata.se/resurser/license#pdmark',
  by: 'http://kulturarvsdata.se/resurser/license#by',
  cc0: 'http://kulturarvsdata.se/resurser/license#cc0',
};
// What goes on the card. PD Mark asks for nothing; CC BY asks for attribution
// and gets it either way, because a photograph is someone's work.
export const LICENSE_LABEL = {
  pdmark: 'Public Domain Mark',
  by: 'CC BY 4.0',
  cc0: 'CC0',
};

const decode = (s) => s
  ?.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

// Regex rather than an XML parser, for the reason the rest of this pipeline
// does it: no dependencies, and the presentation schema is flat and stable
// (pres:version 1.3.0 on every record).
const tag = (s, name) => {
  const m = s.match(new RegExp(`<pres:${name}[^>]*>([\\s\\S]*?)</pres:${name}>`));
  return m ? decode(m[1].trim()) : null;
};

/**
 * The one context that says when the shutter opened. See the header.
 *
 * Malmö Museer label their contexts; Riksantikvarieämbetet and a few others do
 * not — their records carry a single unlabelled context holding a timeLabel like
 * "1949-01-01 00:00:00 - 1949-12-31 00:00:00". Requiring the label outright
 * dropped 1 854 records, which is most of what either archive has from the
 * 1990s, so an unlabelled context is accepted when it is the *only* one. That
 * proviso is the whole safety of it: the danger this function exists to avoid is
 * reading Förvärvad instead of Fotograferad, and a record with one context has
 * no wrong one to pick.
 */
function photographed(record) {
  const contexts = [...record.matchAll(/<pres:context>([\s\S]*?)<\/pres:context>/g)].map((m) => m[1]);
  for (const c of contexts) {
    if (tag(c, 'event') === 'Fotograferad') {
      return { time: tag(c, 'timeLabel'), place: tag(c, 'placeLabel') };
    }
  }
  const dated = contexts.filter((c) => tag(c, 'timeLabel'));
  if (contexts.length === 1 && dated.length === 1) {
    return { time: tag(dated[0], 'timeLabel'), place: tag(dated[0], 'placeLabel') };
  }
  return null;
}

/**
 * A year, or nothing.
 *
 * 98 % of records carry a single four-digit year and the rest are ranges. Three
 * years or less is averaged — "1905-1906" is a photograph somebody can date, and
 * the scoring curve cannot tell one year from the next anyway. Wider than that
 * is not a question with an answer.
 */
export function yearOf(timeLabel) {
  if (!timeLabel) return null;
  const years = [...timeLabel.matchAll(/\b(1[89]\d\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
  if (!years.length) return null;
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  if (hi - lo > 3) return null;
  return Math.round((lo + hi) / 2);
}

/**
 * The photographer, from the credit boilerplate in `pres:content`.
 *
 * Reads "…, Foto: Ragnar Küller / Malmö museum" with accession numbers in front.
 * "Okänd fotograf" is a real and common value, kept as it is — an unknown
 * photographer is a fact about the photograph, not a gap to paper over.
 */
export function photographerOf(content) {
  const m = (content ?? '').match(/Foto:\s*([^/]+?)\s*(?:\/|$)/);
  if (!m) return null;
  const who = m[1].trim();
  return who && !/^ok[äa]nd/i.test(who) ? who : 'Okänd fotograf';
}

async function fetchPage(query, start, refresh) {
  const params = new URLSearchParams({
    'x-api': KEY,
    method: 'search',
    query,
    hitsPerPage: String(PAGE),
    startRecord: String(start),
    recordSchema: 'presentation',
  });
  const name = Buffer.from(`${query}|${start}`).toString('base64url').slice(-40);
  const file = `${CACHE}/${name}.xml`;
  if (!refresh) {
    try { return await readFile(file, 'utf8'); } catch { /* not cached yet */ }
  }
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`K-samsök ${res.status} ${res.statusText}`);
  const xml = await res.text();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, xml);
  return xml;
}

function parse(xml, license) {
  return [...xml.matchAll(/<pres:item[\s\S]*?<\/pres:item>/g)].map(([record]) => {
    const shot = photographed(record);
    const src = Object.fromEntries(
      [...record.matchAll(/<pres:src type="(\w+)">([^<]+)<\/pres:src>/g)].map((m) => [m[1], decode(m[2])]),
    );
    const content = tag(record, 'content') ?? '';
    const uri = tag(record, 'entityUri');
    return {
      source: 'ksamsok',
      id: uri?.replace('http://kulturarvsdata.se/', '') ?? tag(record, 'id'),
      title: tag(record, 'itemLabel') ?? '',
      year: yearOf(shot?.time),
      // The archive has none. The caller places these.
      point: null,
      description: tag(record, 'description') ?? '',
      content,
      placeLabel: shot?.place ?? null,
      artist: photographerOf(content),
      license: LICENSE_LABEL[license],
      source_url: uri,
      image: src.lowres ?? null,
      thumbnail: src.thumbnail ?? null,
    };
  });
}

/**
 * Every openly-licensed photograph of Malmö in a year range.
 *
 * Not restricted to Malmö Museer: they hold most of it, but Kulturen and
 * Riksantikvarieämbetet hold several hundred of the recent material and the
 * whole point of widening the range is to reach that.
 */
export async function photographs({ from, to, licenses = ['pdmark', 'by', 'cc0'], refresh = false } = {}) {
  const out = [];
  for (const license of licenses) {
    const query = `itemType=foto AND placeName=Malmö`
      + ` AND mediaLicense="${LICENSE[license]}"`
      + ` AND fromTime>=${from} AND toTime<=${to}`;
    const first = await fetchPage(query, 1, refresh);
    const total = Number(first.match(/<totalHits>(\d+)<\/totalHits>/)?.[1] ?? 0);
    out.push(...parse(first, license));
    for (let start = 1 + PAGE; start <= total; start += PAGE) {
      out.push(...parse(await fetchPage(query, start, refresh), license));
    }
  }
  return out;
}
