'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
// Boundary mock: no ioBroker installation or physical outputs are used.
class Adapter {
    constructor() { this.handlers = {}; this.writes = []; this.messages = []; this.clock = new Map(); this.seq = 0; this.namespace = 'alarm-control.0'; this.log = { error() {} }; }
    on(event, fn) { this.handlers[event] = fn; }
    setTimeout(fn) { const id = ++this.seq; this.clock.set(id, fn); return id; }
    clearTimeout(id) { this.clock.delete(id); }
    async getForeignObjectAsync() { return { type: 'state', common: { type: 'boolean', write: true } }; }
    async setForeignStateAsync(id, state) { this.writes.push({ id, ...state }); }
    async setStateAsync() {}
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
    const a = fixture(); Object.assign(a.settings, { telegramEnabled: true, telegramUser: 'Tobias', asteriskEnabled: true });
    a.settings.recipients = [{ enabled: true, area: '*', number: '+491234' }, { enabled: false, area: '*', number: '+495678' }, { enabled: true, area: 'garage', number: '+499999' }];
    await a.notify({ area: 'haus', text: 'Alarm Haus' });
    assert.deepEqual(a.messages, [{ instance: 'telegram.0', command: 'send', message: { text: 'Alarm Haus', user: 'Tobias' } }, { instance: 'asterisk.0', command: 'dial', message: { text: 'Alarm Haus', telnr: '+491234' } }]);
});
