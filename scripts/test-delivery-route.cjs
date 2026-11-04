// Route planner + address picker: Maps links, stop limits, unresolved addresses, coordinate parsing.
const { test } = require('node:test'), assert = require('node:assert/strict');
const R = require('../admin-route.js');
const P = require('../address-picker.js');

const g = (id, address, extra = {}) => ({ key: id, name: id, address, place: { source: 'google', id: 'ChIJ' + id.padEnd(12, 'x'), label: address, precision: 'building', confirmed: true }, ...extra });
const params = (url) => new URL(url).searchParams;

test('builds an api=1 driving link: origin = current location, waypoints in order, last stop is the destination', () => {
  const stops = [g('a', 'Rabbi Akiva 5, Beitar Illit'), g('b', 'HaRav Kook 10, Jerusalem'), g('c', 'Nahal Dolev 3, Beit Shemesh')];
  const r = R.buildMapsUrl({ stops, end: 'last' });
  assert.equal(r.error, null);
  const p = params(r.url);
  assert.equal(p.get('api'), '1'); assert.equal(p.get('travelmode'), 'driving');
  assert.equal(p.get('origin'), null);   // Maps uses the phone's location
  assert.equal(p.get('destination'), 'Nahal Dolev 3, Beit Shemesh');
  assert.equal(p.get('destination_place_id'), 'ChIJcxxxxxxxxxxx');
  assert.equal(p.get('waypoints'), 'Rabbi Akiva 5, Beitar Illit|HaRav Kook 10, Jerusalem');
  assert.equal(p.get('waypoint_place_ids'), 'ChIJaxxxxxxxxxxx|ChIJbxxxxxxxxxxx');
  assert.equal(p.get('dir_action'), null);   // route preview, not straight into navigation
  assert.match(r.url, /%7C/);                // separators encoded
});

test('encodes Hebrew and never sends apartment, floor or instructions to Maps', () => {
  const s = g('h', 'רבי עקיבא 5, ביתר עילית', { details: { apartment: '12', floor: '3', entrance: 'B', instructions: 'Call on arrival' } });
  const r = R.buildMapsUrl({ stops: [s], end: 'last' });
  assert.equal(params(r.url).get('destination'), 'רבי עקיבא 5, ביתר עילית');
  assert.doesNotMatch(r.url, /[֐-׿ ]/);   // raw Hebrew / spaces are percent-encoded
  assert.doesNotMatch(decodeURIComponent(r.url), /Apt|Floor|Entrance|Call on arrival/);
  assert.equal(R.detailsLine(s.details), 'Apt 12 · Floor 3 · Entrance B · Call on arrival');
});

test('custom start, return to start and a separate finish', () => {
  const start = { text: 'Gremier, Beitar Illit', placeId: 'ChIJstartxxxxxx' }, end = { text: 'Supplier, Jerusalem', placeId: 'ChIJendxxxxxxxx' };
  const stops = [g('a', 'A 1'), g('b', 'B 2')];
  const back = params(R.buildMapsUrl({ origin: start, stops, end: 'return' }).url);
  assert.equal(back.get('origin'), 'Gremier, Beitar Illit'); assert.equal(back.get('origin_place_id'), 'ChIJstartxxxxxx');
  assert.equal(back.get('destination'), 'Gremier, Beitar Illit'); assert.equal(back.get('waypoints'), 'A 1|B 2');
  const sep = params(R.buildMapsUrl({ origin: start, stops, end: 'custom', endTarget: end }).url);
  assert.equal(sep.get('destination_place_id'), 'ChIJendxxxxxxxx'); assert.equal(sep.get('waypoints'), 'A 1|B 2');
  assert.match(R.buildMapsUrl({ stops, end: 'return' }).error, /start location/);
});

test('stop limits: 9 after the origin; a separate or return finish leaves 8; never drops stops', () => {
  const nine = Array.from({ length: 9 }, (_, i) => g('s' + i, 'Street ' + i));
  assert.equal(R.buildMapsUrl({ stops: nine, end: 'last' }).error, null);
  assert.match(R.buildMapsUrl({ stops: nine, end: 'custom', endTarget: { text: 'x', placeId: null } }).error, /up to 8 stops plus the finish.*selected 9.*Remove 1/);
  const ten = [...nine, g('s9', 'Street 9')];
  const r = R.buildMapsUrl({ stops: ten, end: 'last' });
  assert.equal(r.url, undefined); assert.match(r.error, /up to 9 stops/);
});

test('Android opens the Maps app; long routes do not fall back to a browser that would cut stops', () => {
  const short = R.buildMapsUrl({ stops: [g('a', 'A'), g('b', 'B')], end: 'last' });
  assert.match(short.intent, /^intent:\/\/www\.google\.com\/maps\/dir\/\?api=1.*#Intent;scheme=https;package=com\.google\.android\.apps\.maps;S\.browser_fallback_url=https%3A%2F%2Fwww\.google\.com/);
  const long = R.buildMapsUrl({ stops: Array.from({ length: 6 }, (_, i) => g('s' + i, 'S' + i)), end: 'last' });
  assert.equal(long.middle, 5);
  assert.doesNotMatch(long.intent, /browser_fallback_url=https%3A%2F%2Fwww\.google\.com/);
});

test('unresolved or unconfirmed addresses cannot be routed; pins and store coordinates can', () => {
  assert.equal(R.navTarget({ address: 'Old text address' }), null);
  assert.equal(R.navTarget({ address: 'Kanfei Nesharim', place: { source: 'google', id: 'ChIJxxxxxxxxxxxx', precision: 'approximate', confirmed: false } }), null);
  assert.deepEqual(R.navTarget({ address: 'Kanfei Nesharim', place: { source: 'google', id: 'ChIJxxxxxxxxxxxx', precision: 'approximate', confirmed: true } }), { text: 'Kanfei Nesharim', placeId: 'ChIJxxxxxxxxxxxx' });
  assert.deepEqual(R.navTarget({ place: { source: 'pin', lat: 31.69, lng: 35.12, confirmed: true } }), { text: '31.69,35.12', placeId: null });
  assert.deepEqual(R.navTarget({ coords: { lat: 31.7, lng: 35.1 } }), { text: '31.7,35.1', placeId: null });
  const r = R.buildMapsUrl({ stops: [g('a', 'A'), { key: 'old', name: 'Cohen', address: 'Somewhere' }], end: 'last' });
  assert.match(r.error, /Cohen.*no confirmed location/);
  // Mixed stops: waypoint_place_ids only when every middle stop has one.
  const mixed = params(R.buildMapsUrl({ stops: [g('a', 'A'), { key: 'p', name: 'Pin', place: { source: 'pin', lat: 31.1, lng: 35.1, confirmed: true } }, g('c', 'C')], end: 'last' }).url);
  assert.equal(mixed.get('waypoints'), 'A|31.1,35.1'); assert.equal(mixed.get('waypoint_place_ids'), null);
});

test('planner stops come from manual jobs, website orders and stores', () => {
  const manual = R.stopFromJob({ id: 'j1', date: '2026-11-04', delivery_type: 'private', private_name: 'Levi (WhatsApp)', private_address: 'Rabbi Akiva 5', delivery_location: { source: 'google', id: 'ChIJxxxxxxxxxxxx', precision: 'building' }, delivery_details: { apartment: '4' } });
  assert.equal(manual.name, 'Levi (WhatsApp)'); assert.equal(manual.details.apartment, '4'); assert.ok(R.navTarget(manual));
  const web = R.stopFromJob({ id: 'j2', date: '2026-11-04', delivery_type: 'private', private_name: 'Dana', private_address: 'Old text', website_order_id: 'o' }, { order_number: 77, delivery_info: { address_place: { source: 'google', id: 'ChIJyyyyyyyyyyyy', precision: 'building' }, address_details: { floor: 'ground' } } });
  assert.equal(web.orderNumber, 77); assert.equal(web.details.floor, 'ground'); assert.equal(R.navTarget(web).placeId, 'ChIJyyyyyyyyyyyy');
  const legacy = R.stopFromJob({ id: 'j3', date: '2026-11-04', delivery_type: 'private', private_name: 'Old', private_address: 'Some street' });
  assert.equal(R.navTarget(legacy), null);   // flagged for review, never guessed
  const store = R.stopFromJob({ id: 'j4', date: '2026-11-04', delivery_type: 'store', store_name: 'Good Store' }, null, { public_address: 'Main 1', public_city: 'Jerusalem', lat: 31.78, lng: 35.2 });
  assert.equal(R.navTarget(store).text, '31.78,35.2');
});

test('address picker helpers: Maps links / coordinates, and what counts as ready', () => {
  assert.deepEqual(P.parseCoords('https://www.google.com/maps/place/x/@31.705123,35.112345,17z'), { lat: 31.705123, lng: 35.112345 });
  assert.deepEqual(P.parseCoords('31.7, 35.1'), { lat: 31.7, lng: 35.1 });
  assert.deepEqual(P.parseCoords('https://maps.google.com/?q=31.71,35.11'), { lat: 31.71, lng: 35.11 });
  assert.equal(P.parseCoords('Rabbi Akiva 5'), null);
  assert.equal(P.placeReady(null), false);
  assert.equal(P.placeReady({ source: 'google', precision: 'building' }), true);
  assert.equal(P.placeReady({ source: 'google', precision: 'approximate' }), false);
  assert.equal(P.placeReady({ source: 'google', precision: 'approximate', confirmed: true }), true);
  assert.equal(P.placeReady({ source: 'pin', lat: 1, lng: 1, confirmed: false }), false);
});
