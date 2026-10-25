import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Run the real Worker shopping code and SQL against SQLite. Only the paid model is stubbed.
const bundled = await build({ entryPoints: ['worker/shopping.ts'], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'model-fixture', setup(b) {
  b.onLoad({ filter: /[\\/]worker[\\/]ai\.ts$/ }, () => ({ contents: 'export function getProvider() { return globalThis.shoppingTestProvider; }', loader: 'js' }));
} }] });
const shopping = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const identity = await build({ entryPoints: ['shared/shopping.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { isShoppingChat, shoppingSections, PURCHASE_VISIBLE_MS } = await import(`data:text/javascript;base64,${Buffer.from(identity.outputFiles[0].text).toString('base64')}`);
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE usage_log (purpose TEXT, created_at TEXT);');
  db.exec(readFileSync('migrations/0041_shopping.sql', 'utf8'));
  db.exec(readFileSync('migrations/0047_shopping_purchase_time.sql', 'utf8'));
  const prepare = sql => {
    let binds = [];
    return {
      bind(...values) { binds = values; return this; },
      async first() { return db.prepare(sql).get(...binds) ?? null; },
      async all() { return { results: db.prepare(sql).all(...binds) }; },
      async run() { const r = db.prepare(sql).run(...binds); return { meta: { changes: Number(r.changes) } }; },
    };
  };
  return { DB: { prepare, async batch(statements) { db.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; } catch(e) { db.exec('ROLLBACK'); throw e; } } }, db };
}
const cfg = { enabled: true, chat: 'Wife', chat_id: '972500000000@c.us' };
const message = overrides => ({ account: 'personal', chat: 'Wife', chatId: cfg.chat_id, isGroup: false, fromMe: false, text: 'milk, eggs, tomatoes', messageId: crypto.randomUUID(), t: Date.now() / 1000, ...overrides });

test('wife-only gate rejects other conversations, groups, business account and missing identity', () => {
  assert.equal(isShoppingChat(cfg, message({})), true);
  for (const overrides of [{ chatId: 'other@c.us' }, { isGroup: true }, { chatId: '123@g.us', isGroup: false }, { account: 'business' }, { chatId: undefined }, { isGroup: undefined }]) assert.equal(isShoppingChat(cfg, message(overrides)), false);
  assert.equal(isShoppingChat({ ...cfg, enabled: false }, message({})), false);
  assert.equal(isShoppingChat({ ...cfg, chat_id: '' }, message({ chat: 'Wife from work' })), false);
  assert.equal(isShoppingChat({ ...cfg, chat_id: '' }, message({ fromMe: true })), true);
});

test('multiple lists, edits, checking off, deletion and re-purchase work independently', async () => {
  const env = setup();
  assert.equal((await shopping.shoppingState(env)).lists[0].id, 'store');
  const pharmacy = await shopping.saveShoppingList(env, { name: 'Pharmacy' });
  await shopping.addShoppingItems(env, undefined, [{ name: 'Milk', quantity: '2 cartons' }]);
  assert.equal((await shopping.addShoppingItems(env, 'Store', [{ name: ' milk ' }])).added, 0);
  await shopping.addShoppingItems(env, pharmacy.id, [{ name: 'Milk' }]);
  let state = await shopping.shoppingState(env);
  const item = state.lists[0].items[0];
  await shopping.updateShoppingItem(env, item.id, { quantity: '3 cartons', notes: 'Whole milk', checked: true });
  await shopping.addShoppingItems(env, 'store', [{ name: 'Milk' }]);
  state = await shopping.shoppingState(env);
  assert.equal(state.lists[0].items.length, 2);
  assert.equal(state.lists[0].items.find(i => i.id === item.id).quantity, '3 cartons');
  await assert.rejects(shopping.updateShoppingItem(env, item.id, { checked: false }), /already on this list/);
  await shopping.deleteShoppingItem(env, state.lists[0].items.find(i => !i.checked).id);
  await shopping.updateShoppingItem(env, item.id, { checked: false });
  await assert.rejects(shopping.deleteShoppingList(env, 'store'), /Keep the main/);
  await shopping.deleteShoppingList(env, pharmacy.id);
  assert.equal((await shopping.shoppingState(env)).lists.length, 1);
  env.db.close();
});

test('both spouses, plain English/Hebrew lists, message retries and completed purchases', async () => {
  const env = setup();
  await shopping.saveShoppingConfig(env, cfg);
  let calls = 0;
  globalThis.shoppingTestProvider = { async complete(req) { calls++; assert.match(req.system, /plain grocery list qualifies/); return JSON.stringify({ items: JSON.parse(req.prompt).new_message.text.includes('חלב') ? [{ name: 'חלב', quantity: '2' }, { name: 'ביצים' }] : [{ name: 'milk', quantity: '2 cartons' }, { name: 'eggs' }, { name: 'tomatoes' }] }); } };
  const m = message({});
  assert.equal((await shopping.captureShopping(env, m)).added, 3);
  assert.equal((await shopping.captureShopping(env, m)).duplicate, true);
  assert.equal(calls, 1);
  const item = (await shopping.shoppingState(env)).lists[0].items[0];
  await shopping.updateShoppingItem(env, item.id, { checked: true });
  await shopping.captureShopping(env, m);
  assert.equal((await shopping.shoppingState(env)).lists[0].items.length, 3);
  await shopping.captureShopping(env, message({ fromMe: true, text: 'חלב\nביצים' }));
  assert.equal((await shopping.shoppingState(env)).lists[0].items.length, 5);
  for (const overrides of [{ account: 'business' }, { chatId: 'other@c.us' }, { isGroup: true }, { t: Date.now()/1000 - 3*3600 }]) assert.equal((await shopping.captureShopping(env, message(overrides))).handled, false);
  assert.equal(calls, 2);
  env.db.close();
});

test('non-shopping adds nothing; cheap checks are uncapped; model failures retry durably', async () => {
  const env = setup();
  await shopping.saveShoppingConfig(env, cfg);
  globalThis.shoppingTestProvider = { async complete() { return '{"items":[]}'; } };
  assert.equal((await shopping.captureShopping(env, message({ text: 'I already bought milk' }))).handled, false);
  assert.equal((await shopping.shoppingState(env)).lists[0].items.length, 0);
  env.AI_DAILY_CAP = 1;
  env.db.exec("INSERT INTO usage_log VALUES ('shopping_triage', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
  assert.equal((await shopping.captureShopping(env, message({}))).handled, false);
  globalThis.shoppingTestProvider = { async complete() { throw new Error('offline'); } };
  assert.equal((await shopping.captureShopping(env, message({}))).queued, true);
  assert.equal((await shopping.shoppingState(env)).pending, 1);
  env.db.exec('DELETE FROM usage_log');
  await shopping.processPendingShopping(env);
  assert.equal((await shopping.shoppingState(env)).pending, 1);
  globalThis.shoppingTestProvider = { async complete() { return '{"items":[{"name":"milk"}]}'; } };
  await shopping.processPendingShopping(env);
  assert.equal((await shopping.shoppingState(env)).pending, 0);
  assert.equal((await shopping.shoppingState(env)).lists[0].items.length, 1);
  await shopping.saveShoppingConfig(env, { ...cfg, enabled: false });
  assert.equal((await shopping.captureShopping(env, message({}))).handled, false);
  env.db.close();
});

test('exact chat name is pinned to one ID and rejects another chat with the same display name', async () => {
  const env = setup();
  await shopping.saveShoppingConfig(env, { ...cfg, chat_id: '' });
  globalThis.shoppingTestProvider = { async complete() { return '{"items":[]}'; } };
  await shopping.captureShopping(env, message({ text: 'hello' }));
  assert.equal((await shopping.shoppingConfig(env)).chat_id, cfg.chat_id);
  assert.equal((await shopping.captureShopping(env, message({ chatId: 'other@c.us' }))).handled, false);
  env.db.close();
});

test('purchases stay recent for exactly 24 hours; edits and repeated checks do not restart the window',async t=>{
 const start=Date.parse('2026-10-18T13:00:00Z');t.mock.timers.enable({apis:['Date'],now:start});const env=setup();
 await shopping.addShoppingItems(env,'store',[{name:'Milk'}]);
 const get=async()=>(await shopping.shoppingState(env)).lists[0].items[0];let item=await get();assert.equal(item.checked_at,null);
 await shopping.updateShoppingItem(env,item.id,{checked:true});item=await get();assert.equal(item.checked_at,new Date(start).toISOString());
 t.mock.timers.setTime(start+23*3600000);await shopping.updateShoppingItem(env,item.id,{quantity:'2',notes:'Updated after purchase'});await shopping.updateShoppingItem(env,item.id,{checked:true});item=await get();assert.equal(Date.parse(item.checked_at),start);
 assert.equal(shoppingSections([item],start+PURCHASE_VISIBLE_MS-1).recent.length,1);
 const archived=shoppingSections([item],start+PURCHASE_VISIBLE_MS);assert.equal(archived.recent.length,0);assert.equal(archived.archived.length,1);
 assert.equal((await shopping.shoppingState(env)).lists[0].items.length,1,'archive preserves the record');
 t.mock.timers.setTime(start+25*3600000);await shopping.updateShoppingItem(env,item.id,{checked:false});item=await get();assert.equal(item.checked_at,null);assert.equal(shoppingSections([item]).needed.length,1);
 await shopping.updateShoppingItem(env,item.id,{checked:true});item=await get();assert.equal(Date.parse(item.checked_at),start+25*3600000);assert.equal(shoppingSections([item]).recent.length,1);env.db.close();
});
test('existing checked items get their historical timestamp rather than a fresh 24-hour window',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/0041_shopping.sql','utf8'));
 db.prepare("INSERT INTO shopping_items(id,list_id,name,normalized_name,checked,source,created_at,updated_at) VALUES('old','store','Eggs','eggs',1,'manual','2026-10-01','2026-10-02')").run();
 db.exec(readFileSync('migrations/0047_shopping_purchase_time.sql','utf8'));
 const item=db.prepare("SELECT * FROM shopping_items WHERE id='old'").get();assert.equal(item.checked_at,'2026-10-02');assert.equal(shoppingSections([item],Date.parse('2026-10-18')).archived.length,1);db.close();
});
