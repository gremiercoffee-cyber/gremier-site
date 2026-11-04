import test from 'node:test'; import assert from 'node:assert';
import { shippingSetByAdmin, adminShippingInfo } from '../supabase/functions/_shared/link-shipping.ts';
test('admin-set shipping is never priced again', () => {
  assert.equal(shippingSetByAdmin({ delivery_info: { shipping_set_by_admin: true, delivery_type: 'pickup' } }), true);
  assert.equal(shippingSetByAdmin({ items: [{ category: 'delivery_fee', price: 30 }] }), true);
  assert.equal(shippingSetByAdmin({ items: [{ category: 'bottles' }], delivery_info: { delivery_type: 'regular', server_priced: true } }), false);
  assert.deepEqual(adminShippingInfo({ delivery_info: { shipping_set_by_admin: true, delivery_type: 'regular', city_en: 'Jerusalem', delivery_fee: 59, evil: '<x>' } }),
    { shipping_set_by_admin: true, delivery_type: 'regular', city_en: 'Jerusalem', delivery_fee: 59 });
  assert.deepEqual(adminShippingInfo({ delivery_info: {} }), {});
});
