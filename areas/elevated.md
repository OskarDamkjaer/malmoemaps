# The 66 elevated delområden

These are the delområden with no name above them. At z12.3–13.4 each one stands
in for itself — the map says "Rörsjöstaden" because that is the best name it
has for that ground.

**The question this file is for: is it the best name people have?**

Not "is it correct" — every name below is the city's own. The question is what
someone *says*. Nobody living in Rådmansvången says Rådmansvången. They say
**Triangeln** — and Triangeln is on no administrative map at all, which is
exactly the kind of name `areas.json` exists to hold. Same shape as Slottsstaden,
which is in no dataset either and is what seven delområden are actually called.

So, going down the list, three things can be true of a row:

1. **It belongs with its neighbours under one name.** Two or three delområden
   that people call one thing. → a grouping in `areas.json`, `covers` listing
   the members. This is the common case and the valuable one.
2. **It is known by another name on its own.** Rådmansvången → Triangeln. → a
   one-member grouping under the name people say. The delområde name doesn't
   disappear; it comes back at z13.4, which is the right place for it.
3. **Nothing — the delområde name is what people say.** Möllevången, Videdal,
   Toftanäs. Then leave it: elevation is already doing the right thing, and this
   row needs no work. Most rows are probably this.

## Two things to be careful of

**A landmark is not an area.** "Vid Triangeln" can mean the station, the mall,
or the neighbourhood, and only the third is a name for where you live. The test
is whether it answers *var bor du?* — not *var ska vi ses?* Triangeln passes;
"vid Mobilia" probably doesn't. Landmarks already have their own list.

**A name needs a source outside the delområde register.** Otherwise a grouping
is just a hunch about which words go together — which is what put Bellevuegården
under "Bellevue" for a while, on the strength of a shared word and nothing else,
1.2 km and one stadsdel away from the place it was supposedly part of. What
counts: Malmö stad's own områden pages, `place=suburb` in OSM, a Skånetrafiken
stop, a tätort in its own right, estate agents selling by that name, Wikipedia
in the present tense. What doesn't: the delområde names themselves.

Living here counts too, and is the one source this file was assembled without.
That is the point of the empty column — write the name and where it comes from,
even if "where it comes from" is you. `_doc.rejected` in `areas.json` keeps the
candidates that were looked at and refused, so nothing gets researched twice.

Then: add the entry to `areas.json`, `node scripts/build-neighbourhoods.mjs`,
and the row leaves this list — the name above it now covers it. Regenerate the
list with the snippet at the bottom.

---

Grouped by stadsdel, largest first, because size is a rough proxy for how much
of the map a missing name costs. km² is ground area.

### Centrum (9)

| delområde | km² | what people say | source |
|---|---|---|---|
| Spillepengen | 1.22 | | |
| Rådmansvången | 0.50 | *Triangeln?* | *the request that started this file — needs a source and an extent* |
| Rörsjöstaden | 0.44 | | |
| Värnhem | 0.38 | | |
| Östervärn | 0.30 | | |
| Ellstorp | 0.21 | | |
| Katrinelund | 0.20 | | |
| Lugnet | 0.19 | | |
| Slussen | 0.18 | | |

### Fosie (10)

| delområde | km² | what people say | source |
|---|---|---|---|
| Lindängen | 1.84 | | |
| Fredriksberg | 0.90 | | |
| Kastanjegården | 0.78 | | |
| Almvik | 0.75 | | |
| Hindby | 0.69 | | |
| Heleneholm | 0.44 | | |
| Nydala | 0.40 | | |
| Eriksfält | 0.37 | | |
| Almhög | 0.34 | | |
| Hermodsdal | 0.25 | | |

### Husie (10)

| delområde | km² | what people say | source |
|---|---|---|---|
| Södra Sallerup | 13.27 | | |
| Riseberga | 2.62 | | |
| Elisedal | 1.58 | | |
| Fortuna Hemgården | 1.47 | | |
| Videdal | 1.10 | | |
| Virentofta | 1.01 | | |
| Toftanäs | 0.62 | | |
| Stenkällan | 0.52 | | |
| Höja | 0.41 | | |
| Almgården | 0.27 | | |

### Hyllie (8)

| delområde | km² | what people say | source |
|---|---|---|---|
| Lindeborg | 1.32 | | |
| Svågertorp | 0.93 | | |
| Bellevuegården | 0.49 | | |
| Holma | 0.35 | | |
| Ärtholmen | 0.29 | | |
| Borgmästaregården | 0.25 | | |
| Gröndal | 0.22 | | |
| Södertorp | 0.17 | | |

### Kirseberg (5)

| delområde | km² | what people say | source |
|---|---|---|---|
| Valdemarsro | 1.09 | | |
| Bulltofta | 1.05 | | |
| Johanneslust | 0.58 | | |
| Håkanstorp | 0.25 | | |
| Rostorp | 0.21 | | |

### Limhamn-Bunkeflo (5)

| delområde | km² | what people say | source |
|---|---|---|---|
| Västra Klagstorp | 6.64 | | |
| Naffentorp | 3.62 | | |
| Vintrie | 2.70 | | |
| Skumparp | 0.54 | | |
| Hyllieby | 0.51 | | |

### Oxie (5)

| delområde | km² | what people say | source |
|---|---|---|---|
| Lockarp | 6.05 | | |
| Käglinge | 4.35 | | |
| Glostorp | 4.35 | | |
| Toarp | 1.63 | | |
| Kristineberg | 1.50 | | |

### Rosengård (4)

| delområde | km² | what people say | source |
|---|---|---|---|
| Östra Kyrkogården | 0.60 | | |
| Västra Kattarp | 0.47 | | |
| Emilstorp | 0.34 | | |
| Persborg | 0.11 | | |

### Södra Innerstaden (5)

| delområde | km² | what people say | source |
|---|---|---|---|
| Flensburg | 0.35 | | |
| Allmänna Sjukhuset | 0.25 | | |
| Annelund | 0.17 | | |
| Södervärn | 0.11 | | |
| Lönngården | 0.10 | | |

### Västra Innerstaden (5)

| delområde | km² | what people say | source |
|---|---|---|---|
| Pildammsparken | 0.52 | | |
| Solbacken | 0.34 | | |
| Dammfri | 0.31 | | |
| Kronborg | 0.15 | | |
| Teatern | 0.10 | | |

---

## Regenerating this list

The tables are derived, the two right-hand columns are not — so re-run this to
see what is left, and paste your answers back in. Needs `build/data`.

```sh
node -e "
const fs = require('fs');
const D = 'build/data';
const districts = JSON.parse(fs.readFileSync(D + '/districts.geojson'));
const stadsdelar = JSON.parse(fs.readFileSync(D + '/stadsdelar.geojson'));
const covered = new Set(JSON.parse(fs.readFileSync(D + '/neighbourhoods.geojson'))
  .features.flatMap((f) => f.properties.covers));
const stadsdelOf = new Map(stadsdelar.features
  .flatMap((f) => f.properties.covers.map((n) => [n, f.properties.name])));
const k = Math.cos(55.6 * Math.PI / 180) * 111.32 * 111.32;
const km2 = (f) => (f.geometry.type === 'MultiPolygon'
  ? f.geometry.coordinates.map((p) => p[0]) : [f.geometry.coordinates[0]])
  .reduce((t, r) => {
    let s = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
    return t + Math.abs(s) / 2 * k;
  }, 0);
const by = {};
for (const f of districts.features) {
  if (f.properties.admin_level !== 10 || covered.has(f.properties.name)) continue;
  (by[stadsdelOf.get(f.properties.name)] ??= []).push({ n: f.properties.name, a: km2(f) });
}
for (const s of Object.keys(by).sort((a, b) => a.localeCompare(b, 'sv'))) {
  console.log('### ' + s + ' (' + by[s].length + ')\n');
  console.log('| delområde | km² | what people say | source |');
  console.log('|---|---|---|---|');
  for (const r of by[s].sort((x, y) => y.a - x.a)) console.log('| ' + r.n + ' | ' + r.a.toFixed(2) + ' | | |');
  console.log();
}
"
```
