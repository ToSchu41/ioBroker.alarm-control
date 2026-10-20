'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Actuators } = require('../lib/actuators');
const { validate } = require('../lib/config');
const native = require('../io-package.json').native;
function fixture(overrides = {}) {
    const writes = [], timers = new Map(); let seq = 0;
    const adapter = { queue: Promise.resolve(),
        async getForeignObjectAsync(id) { return id.startsWith('scene.') ? { type: 'state', common: { type: 'mixed', enabled: true, write: true, engine: 'system.adapter.scenes.0' }, native: { members: [{}] } } : { type: 'state', common: { type: 'boolean', write: true } }; },
        async getForeignStateAsync() { return { val: true }; },
        async setForeignStateAsync(id, state) { writes.push({ id, ...state }); },
        setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
        enqueue(fn) { this.queue = this.queue.then(fn); }
    };
    const row = { id: 'light', enabled: true, kind: 'switch', stateId: 'knx.0.light', area: '*', inverted: false, durationSeconds: 60, onAlarm: true, onTamper: false, onPanic: true, ...overrides };
    const controller = new Actuators(adapter, [row]);
    return { adapter, row, controller, writes, timers };
}
test('consumer turns on and off after its configured timer', async () => {
    const f = fixture(); await f.controller.run({ kind: 'alarm', area: 'haus' });
    assert.equal(f.writes.at(-1).val, true); const [id, timer] = [...f.timers][0];
    assert.equal(timer.ms, 60000); f.timers.delete(id); timer.fn(); await f.adapter.queue;
    assert.equal(f.writes.at(-1).val, false);
});
test('shared consumer stays on until the final area releases it', async () => {
    const f = fixture(); await f.controller.run({ kind: 'alarm', area: 'haus' }); await f.controller.run({ kind: 'alarm', area: 'garage' });
    await f.controller.clear('haus'); assert.equal(f.writes.at(-1).val, true);
    await f.controller.clear('garage'); assert.equal(f.writes.at(-1).val, false); assert.equal(f.timers.size, 0);
});
test('zero duration waits for reset and unload clears all demands', async () => {
    const f = fixture({ durationSeconds: 0, inverted: true }); await f.controller.run({ kind: 'panic', area: '*' });
    assert.equal(f.writes.at(-1).val, false); assert.equal(f.timers.size, 0);
    await f.controller.clear('haus'); assert.equal(f.controller.demands.size, 1);
    await f.controller.clear(); assert.equal(f.writes.at(-1).val, true);
});
test('event and area filters skip nonmatching actors', async () => {
    const f = fixture({ area: 'garage' }); await f.controller.run({ kind: 'alarm', area: 'haus' });
    await f.controller.run({ kind: 'tamper', area: 'garage' }); assert.equal(f.writes.length, 0);
    await f.controller.run({ kind: 'panic', area: '*' }); assert.equal(f.writes.length, 1);
});
test('scene is retriggered with true and never receives an automatic false', async () => {
    const f = fixture({ kind: 'scene', stateId: 'scene.0.Light', durationSeconds: 0 });
    await f.controller.run({ kind: 'alarm', area: 'haus' }); await f.controller.run({ kind: 'panic', area: '*' }); await f.controller.clear();
    assert.deepEqual(f.writes, [{ id: 'scene.0.Light', val: true, ack: false }, { id: 'scene.0.Light', val: true, ack: false }]);
    assert.equal(f.timers.size, 0);
});
test('one failed actor does not prevent other outputs', async () => {
    const f = fixture(); f.controller.rows.push({ ...f.row, id: 'bad', stateId: 'missing' });
    f.adapter.getForeignObjectAsync = async id => id === 'missing' ? null : { type: 'state', common: { type: 'boolean', write: true } };
    await assert.rejects(() => f.controller.run({ kind: 'alarm', area: 'haus' }), /nicht schreibbar/);
    assert.equal(f.writes[0].val, true);
});
test('new configuration rejects duplicate outputs and timed scenes', () => {
    const f = fixture(); assert.equal(validate({ ...native, actuators: [f.row] }).actuators.length, 1);
    assert.throws(() => validate({ ...native, actuators: [f.row, { ...f.row, id: 'other' }] }), /belegt/);
    assert.throws(() => validate({ ...native, actuators: [{ ...f.row, kind: 'scene', stateId: 'scene.0.x' }] }), /Szenen/);
    assert.deepEqual(validate({ ...native, actuators: undefined }).actuators, []);
});
