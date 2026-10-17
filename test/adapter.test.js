'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
// Boundary mock: no ioBroker installation or physical outputs are used.
class Adapter {
    constructor() { this.handlers = {}; this.writes = []; this.messages = []; this.states = new Map(); this.objects = new Map(); this.foreign = new Map(); this.subscriptions = []; this.replies = []; this.clock = new Map(); this.seq = 0; this.namespace = 'alarm-control.0'; this.log = { error() {} }; }
    on(event, fn) { this.handlers[event] = fn; }
    setTimeout(fn) { const id = ++this.seq; this.clock.set(id, fn); return id; }
    clearTimeout(id) { this.clock.delete(id); }
    async getForeignObjectAsync() { return { type: 'state', common: { type: 'boolean', write: true } }; }
    async setForeignStateAsync(id, state) { this.writes.push({ id, ...state }); }
    async setStateAsync(id, state) { this.states.set(id, state); }
    async setStateChangedAsync(id, state) { this.states.set(id, state); }
    async setObjectNotExistsAsync(id, object) { if (!this.objects.has(id)) this.objects.set(id, object); }
    async getStateAsync(id) { return this.states.get(id) || null; }
    async getForeignStateAsync(id) { return this.foreign.get(id) || null; }
    async subscribeForeignStatesAsync(id) { this.subscriptions.push(id); }
    async subscribeStatesAsync() {}
    sendTo(from, command, message, callback) { this.replies.push({ from, command, message, callback }); }
    async sendToAsync(instance, command, message) { this.messages.push({ instance, command, message }); return {}; }
}
Module._load = function (id, ...args) { return id === '@iobroker/adapter-core' ? { Adapter } : original.call(this, id, ...args); };
const create = require('../main');
Module._load = original;
const defaults = require('../io-package.json').native;
function fixture() {
    const a = create();
    a.settings = structuredClone(defaults);
    a.settings.sirens[0].enabled = true; a.settings.sirens[0].stateId = 'knx.0.siren';
    return a;
}
test('shared siren remains on until all demanding areas clear', async () => {
    const a = fixture();
    await a.startSirens('haus'); await a.startSirens('garage'); await a.clearSirenArea('haus');
    assert.equal(a.writes.at(-1).val, true);
    await a.clearSirenArea('garage'); assert.equal(a.writes.at(-1).val, false);
    assert.equal(a.clock.size, 0);
});
test('siren expiry switches contact off and inversion is respected', async () => {
    const a = fixture(); a.settings.sirens[0].inverted = true;
    await a.startSirens('haus'); assert.equal(a.writes.at(-1).val, false);
    [...a.clock.values()][0](); await a.queue;
    assert.equal(a.writes.at(-1).val, true);
});
test('both siren writes are attempted when one output fails', async () => {
    const a = fixture(); a.settings.sirens[1].enabled = true; a.settings.sirens[1].stateId = 'knx.0.siren2';
    a.getForeignObjectAsync = async id => id.endsWith('siren') ? null : { type: 'state', common: { type: 'boolean', write: true } };
    await assert.rejects(() => a.startSirens('haus'));
    assert.equal(a.writes[0].id, 'knx.0.siren2'); assert.equal(a.writes[0].val, true);
});
test('notifications use documented commands and only enabled matching recipients', async () => {
    const a = fixture(); Object.assign(a.settings, { telegramEnabled: true, telegramUser: 'Tobias', asteriskEnabled: true, templateAlarm: 'Alarm {bereich}', templatePhone: 'Alarm {bereich}' });
    a.settings.recipients = [{ enabled: true, area: '*', number: '+491234' }, { enabled: false, area: '*', number: '+495678' }, { enabled: true, area: 'garage', number: '+499999' }];
    await a.notify({ area: 'haus', text: 'Alarm Haus' });
    assert.deepEqual(a.messages, [{ instance: 'telegram.0', command: 'send', message: { text: 'Alarm Haus', user: 'Tobias' } }, { instance: 'asterisk.0', command: 'dial', message: { text: 'Alarm Haus', telnr: '+491234' } }]);
});

test('informational messages never place telephone calls', async () => {
    const a = fixture(); Object.assign(a.settings, { telegramEnabled: true, asteriskEnabled: true });
    a.settings.recipients = [{ id: 'one', enabled: true, area: '*', number: '+491234' }];
    await a.notify({ kind: 'armed', area: 'haus', mode: 'away', state: 'armed' });
    assert.equal(a.messages.length, 1); assert.equal(a.messages[0].command, 'send');
    assert.match(a.messages[0].message.text, /Haus.*aktiviert.*Abwesend/);
});
test('failed arming notification names open sensors and requested mode', async () => {
    const a = fixture(); a.settings.telegramEnabled = true;
    await a.notify({ kind: 'blocked', area: 'haus', requestedMode: 'home', state: 'disarmed', blocked: ['Küchenfenster (offen/aktiv)'] });
    assert.match(a.messages[0].message.text, /Küchenfenster/); assert.match(a.messages[0].message.text, /Anwesend/);
});
test('phone test selects all enabled recipients across areas and deduplicates numbers', async () => {
    const a = fixture(); Object.assign(a.settings, { asteriskEnabled: true, telegramEnabled: true });
    a.settings.recipients = [{ id: 'one', enabled: true, area: 'haus', number: '+49 1234' }, { id: 'duplicate', enabled: true, area: 'garage', number: '+491234' }, { id: 'two', enabled: true, area: 'garage', number: '+495678' }];
    const count = await a.notify({ kind: 'test', area: '*' }, 'phone');
    assert.equal(count, 2); assert.equal(a.messages.length, 2);
    assert.ok(a.messages.every(m => m.command === 'dial' && /Test/.test(m.message.text)));
    assert.equal(a.writes.length, 0);
});
test('test buttons reply with result and prevent repeated sends', async () => {
    const a = fixture(); a.initialized = true; a.settings.telegramEnabled = true;
    const message = { from: 'system.adapter.admin.0', command: 'testTelegram', callback: { id: 1 } };
    await a.message(message); assert.match(a.replies[0].message.result, /Test/);
    await a.message(message); assert.match(a.replies[1].message.error, /10 Sekunden/);
    assert.equal(a.messages.length, 1);
    assert.equal(a.writes.length, 0);
});
test('disabled test channel reports an error instead of false success', async () => {
    const a = fixture(); a.initialized = true;
    await a.message({ from: 'admin.0', command: 'testPhone', callback: {} });
    assert.match(a.replies[0].message.error, /Telefonie/);
});

test('missing adapter callback produces a bounded timeout without blocking control queue', async () => {
    const a = fixture();
    const pending = a.withTimeout(() => new Promise(() => {}), 'Telegram', 15000);
    let commandRan = false; a.enqueue(async () => { commandRan = true; }); await a.queue;
    assert.equal(commandRan, true);
    [...a.clock.values()][0]();
    await assert.rejects(() => pending, /keine Bestätigung/); assert.equal(a.clock.size, 0);
});
test('telegram failure does not skip requested phone calls', async () => {
    const a = fixture(); Object.assign(a.settings, { asteriskEnabled: true, telegramEnabled: true });
    a.settings.recipients = [{ id: 'one', enabled: true, area: '*', number: '+491234' }];
    a.sendToAsync = async (instance, command) => { a.messages.push(command); if (command === 'send') throw new Error('offline'); return {}; };
    await assert.rejects(() => a.notify({ kind: 'alarm', area: 'haus' }), /offline/);
    assert.deepEqual(a.messages, ['send', 'dial']); assert.equal(a.clock.size, 0);
});
test('panic activates scene and all sirens; resetting an area cannot clear panic demand', async () => {
    const a = fixture(); a.settings.panicSceneId = 'scene.0.panic'; a.settings.sirens[0].area = 'garage';
    a.engine = { panicActive: true, sensors: new Map() };
    await a.event({ type: 'panic', kind: 'panic', area: '*', timestamp: 0 });
    assert.ok(a.writes.some(w => w.id === 'scene.0.panic' && w.val && !w.ack));
    assert.ok(a.writes.some(w => w.id === 'knx.0.siren' && w.val));
    await a.clearSirenArea('haus'); assert.equal(a.writes.at(-1).val, true);
    await a.event({ type: 'panicReset', kind: 'panicReset', area: '*' });
    assert.equal(a.writes.at(-1).val, false); assert.equal(a.states.get('panic.active').val, false);
});
test('a broken panic scene does not prevent siren activation', async () => {
    const a = fixture(); a.settings.panicSceneId = 'scene.0.missing'; a.engine = { panicActive: true, sensors: new Map() };
    a.getForeignObjectAsync = async id => id.startsWith('scene.') ? null : { type: 'state', common: { type: 'boolean', write: true } };
    await assert.rejects(() => a.event({ type: 'panic', kind: 'panic', area: '*' }), /Panikszene/);
    assert.equal(a.writes.at(-1).val, true);
});
test('upgrade creates sensor objects, keeps config and restores persisted enable', async () => {
    const a = fixture(); a.config = structuredClone(defaults);
    const sensor = { id: 'window', name: 'Fenster', enabled: true, area: 'haus', zone: 'outside', stateId: 'knx.0.window', activeValue: 'true', blockArm: true, holdSeconds: 0, entrySeconds: 0, hits: 1, windowSeconds: 30, tamperStateId: 'knx.0.tamper' };
    a.config.sensors = [sensor];
    a.states.set('areas.haus.sensors.window.enable', { val: false, ack: true });
    a.foreign.set('knx.0.window', { val: true }); a.foreign.set('knx.0.tamper', { val: false });
    await a.ready();
    // Events may enqueue more work while ready is running; let the queue drain.
    await a.queue;
    assert.equal(a.objects.get('areas.haus.sensors.window').type, 'channel');
    assert.equal(a.states.get('areas.haus.sensors.window.status').val, 'disable');
    assert.equal(a.engine.sensors.get('window').enabled, false);
    assert.deepEqual(a.config.sensors, [sensor]);
    assert.ok(a.subscriptions.includes('knx.0.tamper'));
    assert.equal(a.states.get('areas.haus.mode').val, 'disarmed'); a.engine.close();
});
test('enable and panic writes are acknowledged and invalid values restored', async () => {
    const a = fixture(); a.config = structuredClone(defaults);
    a.config.sensors = [{ id: 'door', enabled: true, area: 'haus', zone: 'outside', stateId: 'knx.0.door', activeValue: 'true', blockArm: true, holdSeconds: 0, entrySeconds: 0, hits: 1, windowSeconds: 30 }];
    a.foreign.set('knx.0.door', { val: false }); await a.ready(); await a.queue;
    await a.changed('alarm-control.0.areas.haus.sensors.door.enable', { val: false, ack: false }); await a.queue;
    assert.deepEqual(a.states.get('areas.haus.sensors.door.enable'), { val: false, ack: true });
    await assert.rejects(() => a.changed('alarm-control.0.areas.haus.sensors.door.enable', { val: 'false', ack: false }));
    assert.equal(a.states.get('areas.haus.sensors.door.enable').val, false);
    a.settings.panicSirens = false;
    await a.changed('alarm-control.0.panic.trigger', { val: true, ack: false }); await a.queue;
    assert.equal(a.states.get('panic.active').val, true); assert.equal(a.states.get('panic.trigger').val, false);
    a.engine.close();
});
