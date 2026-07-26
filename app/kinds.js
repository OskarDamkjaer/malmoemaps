// What an icon means, in Swedish.
//
// The basemap draws a few hundred pictograms and never says what any of them
// is. This is the lookup that answers that, keyed by the OpenMapTiles `class`
// and the rawer OSM `subclass` beneath it (subclass wins: "bageri" beats
// "affär"). It is deliberately not exhaustive — an untranslated tag falls
// through and is shown as-is, which is still an answer, and it is obvious in
// the card which entries are missing.
export const KIND_LABEL = {
  // food & drink
  restaurant: 'Restaurang', cafe: 'Café', bar: 'Bar', pub: 'Pub', biergarten: 'Ölträdgård',
  fast_food: 'Snabbmat', ice_cream: 'Glass', bakery: 'Bageri', confectionery: 'Konditori',
  pastry: 'Konditori', butcher: 'Slakteri', deli: 'Delikatesser', beer: 'Öl',
  alcohol_shop: 'Systembolag', wine: 'Vinhandel', food_court: 'Foodcourt', sushi: 'Sushi',

  // shops
  shop: 'Affär', supermarket: 'Livsmedel', grocery: 'Livsmedel', convenience: 'Närbutik',
  mall: 'Galleria', department_store: 'Varuhus', clothes: 'Kläder', clothing_store: 'Kläder',
  shoes: 'Skor', books: 'Bokhandel', newsagent: 'Tidningskiosk', kiosk: 'Kiosk',
  hairdresser: 'Frisör', beauty: 'Skönhet', optician: 'Optiker', jewelry: 'Smycken',
  florist: 'Blomsteraffär', furniture: 'Möbler', hardware: 'Järnhandel', doityourself: 'Byggvaror',
  electronics: 'Elektronik', mobile_phone: 'Mobiltelefoner', bicycle: 'Cykelaffär',
  car: 'Bilhandel', car_repair: 'Bilverkstad', laundry: 'Tvätt', dry_cleaning: 'Kemtvätt',
  gift: 'Presenter', toys: 'Leksaker', sports: 'Sport', second_hand: 'Second hand',
  charity: 'Second hand', pet: 'Djuraffär', tattoo: 'Tatuering', copyshop: 'Kopiering',

  // culture & sights
  museum: 'Museum', gallery: 'Galleri', art_gallery: 'Galleri', artwork: 'Konstverk',
  theatre: 'Teater', cinema: 'Bio', arts_centre: 'Kulturhus', library: 'Bibliotek',
  memorial: 'Minnesmärke', monument: 'Monument', castle: 'Slott', ruins: 'Ruin',
  attraction: 'Sevärdhet', viewpoint: 'Utsiktsplats', information: 'Information',
  zoo: 'Djurpark', aquarium: 'Akvarium', community_centre: 'Föreningslokal',
  nightclub: 'Nattklubb', casino: 'Kasino', music: 'Musik', historic: 'Historisk plats',

  // outdoors
  park: 'Park', garden: 'Trädgård', playground: 'Lekplats', pitch: 'Idrottsplan',
  sports_centre: 'Sporthall', stadium: 'Arena', swimming: 'Simhall', swimming_pool: 'Simhall',
  swimming_area: 'Badplats', beach: 'Strand', dog_park: 'Hundrastgård', picnic_site: 'Picknickplats',
  cemetery: 'Kyrkogård', grave_yard: 'Kyrkogård', allotments: 'Kolonilotter',
  nature_reserve: 'Naturreservat', marina: 'Småbåtshamn', harbor: 'Hamn', harbour: 'Hamn',
  fitness_centre: 'Gym', golf: 'Golf', tennis: 'Tennis', soccer: 'Fotboll', track: 'Löparbana',

  // services & institutions
  hospital: 'Sjukhus', clinic: 'Vårdcentral', doctors: 'Läkarmottagning', dentist: 'Tandläkare',
  pharmacy: 'Apotek', veterinary: 'Veterinär', police: 'Polis', fire_station: 'Brandstation',
  post: 'Post', post_office: 'Post', bank: 'Bank', atm: 'Bankomat', townhall: 'Stadshus',
  town_hall: 'Stadshus', courthouse: 'Domstol', embassy: 'Ambassad', prison: 'Fängelse',
  school: 'Skola', kindergarten: 'Förskola', college: 'Gymnasium', university: 'Universitet',
  childcare: 'Barnomsorg', social_facility: 'Social verksamhet', toilets: 'Toalett',
  drinking_water: 'Dricksvatten', recycling: 'Återvinning', waste_basket: 'Papperskorg',
  shelter: 'Väderskydd', bench: 'Bänk', fountain: 'Fontän', clock: 'Klocka',

  // worship
  place_of_worship: 'Religiös byggnad', church: 'Kyrka', chapel: 'Kapell', cathedral: 'Domkyrka',
  mosque: 'Moské', synagogue: 'Synagoga', christian: 'Kyrka', muslim: 'Moské', jewish: 'Synagoga',

  // getting about (shown, never routed to)
  railway: 'Järnväg', station: 'Station', halt: 'Hållplats', subway: 'Tunnelbana',
  tram_stop: 'Spårvagnshållplats', bus: 'Busshållplats', bus_stop: 'Busshållplats',
  bus_station: 'Bussterminal', ferry_terminal: 'Färjeterminal', aerodrome: 'Flygplats',
  airport: 'Flygplats', parking: 'Parkering', bicycle_parking: 'Cykelparkering',
  bicycle_rental: 'Lånecykel', fuel: 'Bensinstation', charging_station: 'Laddstation',
  car_rental: 'Biluthyrning', taxi: 'Taxi',

  // lodging
  lodging: 'Hotell', hotel: 'Hotell', hostel: 'Vandrarhem', guest_house: 'Gästhus',
  camp_site: 'Camping', campsite: 'Camping',

  // ways and water (from the basemap's own layers)
  motorway: 'Motorväg', trunk: 'Väg', primary: 'Huvudgata', secondary: 'Gata', tertiary: 'Gata',
  minor: 'Gata', residential: 'Gata', living_street: 'Gårdsgata', pedestrian: 'Gågata',
  service: 'Servicegata', unclassified: 'Gata', road: 'Gata', busway: 'Busskörfält',
  footway: 'Gångväg', path: 'Stig', cycleway: 'Cykelväg', steps: 'Trappa',
  river: 'Flod', stream: 'Bäck', canal: 'Kanal', ditch: 'Dike', dock: 'Dockhamn',
  lake: 'Sjö', pond: 'Damm', water: 'Vatten', ocean: 'Hav', swimming_area_water: 'Badplats',

  // places
  city: 'Stad', town: 'Tätort', village: 'By', hamlet: 'Småort', suburb: 'Stadsdel',
  neighbourhood: 'Kvarter', quarter: 'Kvarter', island: 'Ö', islet: 'Holme', locality: 'Plats',
};

// Never returns something blank when the map knows *anything*: a raw OSM tag
// with its underscores taken out beats "Plats" every time.
export function kindLabel(props = {}) {
  const candidates = [props.subclass, props.class, props.kind, props.amenity]
    .filter((v) => typeof v === 'string' && v);
  for (const key of candidates) {
    if (KIND_LABEL[key]) return KIND_LABEL[key];
  }
  const raw = candidates[0];
  return raw ? raw.replace(/_/g, ' ') : null;
}
