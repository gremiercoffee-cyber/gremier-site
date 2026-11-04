// Server-side checks for the address pieces a customer sends with an order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickAddress, addressColumns, cleanPlace } from '../supabase/functions/_shared/delivery-address.ts';

test('keeps the typed street, the selected place and the details apart, and drops anything else', () => {
  const out = pickAddress({
    address_entered: 'רבי עקיבא 5', delivery_fee: 0, payment_link_code: 'x',
    address_place: { source: 'google', id: 'ChIJ1234567890abc', label: 'Rabbi Akiva St 5, Beitar Illit', precision: 'building', locality: 'Beitar Illit', extra: 1 },
    address_details: { apartment: '12', floor: 'ground', entrance: 'B', instructions: '<b>Call</b> on arrival', other: 'x' },
  });
  assert.deepEqual(Object.keys(out).sort(), ['address_details', 'address_entered', 'address_place']);
  assert.equal(out.address_place.id, 'ChIJ1234567890abc'); assert.equal(out.address_place.confirmed, true); assert.equal(out.address_place.extra, undefined);
  assert.deepEqual(out.address_details, { apartment: '12', floor: 'ground', entrance: 'B', instructions: 'bCall/b on arrival' });
});

test('an approximate result stays unconfirmed unless the customer confirmed it; bad places are dropped', () => {
  assert.equal(cleanPlace({ source: 'google', id: 'ChIJ1234567890abc', precision: 'approximate' }).confirmed, false);
  assert.equal(cleanPlace({ source: 'google', id: 'ChIJ1234567890abc', precision: 'approximate', confirmed: true }).confirmed, true);
  assert.equal(cleanPlace({ source: 'google', id: 'bad id!' }), null);
  assert.equal(cleanPlace({ source: 'pin', lat: 51.5, lng: -0.1, confirmed: true }), null);   // outside the area
  assert.deepEqual(cleanPlace({ source: 'pin', lat: 31.6961234567, lng: 35.1144, confirmed: true, at: '2026-11-04T10:00:00Z' }), { source: 'pin', lat: 31.696123, lng: 35.1144, confirmed: true, at: '2026-11-04T10:00:00.000Z' });
});

test('job columns are only set when the order has them (old orders stay untouched)', () => {
  assert.deepEqual(addressColumns({ city_en: 'Jerusalem' }), {});
  assert.deepEqual(Object.keys(addressColumns({ address_place: { source: 'google', id: 'ChIJ1234567890abc', precision: 'building' }, address_details: { floor: '3' } })), ['delivery_location', 'delivery_details']);
});
