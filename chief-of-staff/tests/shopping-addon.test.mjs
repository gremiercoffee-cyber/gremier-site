import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('add-on forwards bare lists in both directions before generic filters; other chats and groups stay excluded', async () => {
  const events = [];
  const listeners = new Map();
  const window = { addEventListener: (name, fn) => listeners.set(name, fn), postMessage() {} };
  const context = { window, location: { origin: 'https://web.whatsapp.com' }, console, Date,
    setInterval() {}, setTimeout() {}, clearTimeout() {}, cosActionable() { return false; },
    chrome: { runtime: { id: 'test', async sendMessage(msg) {
      events.push(msg);
      if (msg.type === 'shopping-config') return { enabled: true, chat: 'Wife', chat_id: '972500000000@c.us' };
      if (msg.type === 'shopping') return { handled: true, added: 3 };
      return {};
    } } },
  };
  vm.runInNewContext(readFileSync('whatsapp-addon/content.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const emit = message => listeners.get('message')({ source: window, data: { source: 'cos-reader', kind: 'message', message } });
  const base = { chat: 'Wife', chatId: '972500000000@c.us', sender: 'Wife', text: 'milk\neggs\ntomatoes', messageId: 'm1', isGroup: false, fromMe: false, t: Date.now()/1000 };
  emit(base);
  emit({ ...base, fromMe: true, messageId: 'm2', text: 'חלב, ביצים' });
  emit({ ...base, chatId: 'someoneelse@c.us', messageId: 'm3' });
  emit({ ...base, chatId: '123@g.us', isGroup: true, messageId: 'm4' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.filter(e => e.type === 'shopping').length, 2);
  assert.deepEqual(events.filter(e => e.type === 'shopping').map(e => e.payload.fromMe), [false, true]);
  assert.equal(events.some(e => e.type === 'incoming'), false);
  assert.equal(events.filter(e => e.type === 'replied').length, 1);
});
