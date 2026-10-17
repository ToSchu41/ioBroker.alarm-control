'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../lib/engine');
const { validate, active } = require('../lib/config');
const defaults = require('../io-package.json').native;

function fixture(overrides = {}) {
    let now = 0, seq = 0;
    const timers = new Map(), events = [];
    const clock = { now: () => now, set: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; }, clear: id => timers.delete(id) };
    const sensor = { id: 'window', name: 'Fenster', area: 'haus', zone: 'outside', stateId: 'knx.0.window', activeValue: 'true', enabled: true, blockArm: true, holdSeconds: 0, hits: 1, windowSeconds: 30, entrySeconds: 0, ...overrides };
    const config = validate({ ...defaults, areas: defaults.areas.map(a => ({ ...a, exitSeconds: 0 })), sensors: [sensor] });
    const engine = new Engine(config, e => events.push(e), clock);
    const update = (val, q = 0) => engine.update(sensor.stateId, { val, q });
    const tick = ms => {
        const end = now + ms;
        while (true) {
            const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at; timers.delete(next[0]); next[1].fn();
        }
        now = end;
    };
    const alarms = () => events.filter(e => e.type === 'alarm');
    return { engine, config, events, update, tick, alarms, timers };
}

test('unknown, bad-quality and open contacts prevent arming', () => {
    const f = fixture();
    assert.throws(() => f.engine.command('haus', 'away'), /Nicht bereit/);
    f.update(false, 0x80); assert.throws(() => f.engine.command('haus', 'away'));
    f.update(true); assert.throws(() => f.engine.command('haus', 'away'));
    f.update(false); f.engine.command('haus', 'away');
    assert.equal(f.engine.areas.get('haus').phase, 'armed');
});
test('home mode ignores inside sensors and areas stay independent', () => {
    const f = fixture({ zone: 'inside' });
    f.config.sensors.push({ ...f.config.sensors[0], id: 'door', zone: 'outside', stateId: 'knx.0.door' });
    const events = [];
    const e = new Engine(f.config, event => events.push(event));
    e.update('knx.0.door', { val: false }); e.command('haus', 'home');
    e.update('knx.0.window', { val: true });
    assert.equal(events.filter(x => x.type === 'alarm').length, 0);
    e.update('knx.0.door', { val: true });
    assert.equal(events.filter(x => x.type === 'alarm').length, 1);
    assert.equal(e.areas.get('garage').alarm, false); e.close();
});
test('duplicate telegrams do not count; expired hits are discarded', () => {
    const f = fixture({ hits: 2, windowSeconds: 5 });
    f.update(false); f.engine.command('haus', 'away');
    f.update(true); f.update(true); assert.equal(f.alarms().length, 0);
    f.tick(6000); f.update(false); f.update(true); assert.equal(f.alarms().length, 0);
    f.update(false); f.update(true); assert.equal(f.alarms().length, 1);
    f.update(false); f.update(true); assert.equal(f.alarms().length, 1);
});
test('hold rejects short pulses and requires continuous valid activity', () => {
    const f = fixture({ holdSeconds: 2 });
    f.update(false); f.engine.command('haus', 'away');
    f.update(true); f.tick(1000); f.update(false); f.tick(3000);
    assert.equal(f.alarms().length, 0);
    f.update(true); f.tick(1000); f.update(null); f.tick(2000);
    assert.equal(f.alarms().length, 0);
    f.update(true); f.tick(2000); assert.equal(f.alarms().length, 1);
});
test('entry countdown is not extended and survives contact closing', () => {
    const f = fixture({ entrySeconds: 10 });
    f.update(false); f.engine.command('haus', 'away');
    f.update(true); f.tick(9000); f.update(false); f.update(true); f.update(false);
    f.tick(1000); assert.equal(f.alarms().length, 1);
});
test('disarm cancels entry, hold and hit memory', () => {
    const f = fixture({ entrySeconds: 10 });
    f.update(false); f.engine.command('haus', 'away'); f.update(true);
    f.engine.command('haus', 'disarmed'); f.tick(20000);
    assert.equal(f.alarms().length, 0); assert.equal(f.timers.size, 0);
});
test('exit delay rechecks open contacts', () => {
    const f = fixture(); f.engine.areas.get('haus').config.exitSeconds = 5;
    f.update(false); f.engine.command('haus', 'away'); f.update(true); f.tick(5000);
    assert.equal(f.engine.areas.get('haus').mode, 'disarmed'); assert.equal(f.alarms().length, 0);
});
test('restart begins disarmed; close cancels timers', () => {
    const f = fixture({ holdSeconds: 2 });
    assert.equal(f.engine.areas.get('haus').mode, 'disarmed');
    f.update(false); f.engine.command('haus', 'away'); f.update(true); f.engine.close(); f.tick(10000);
    assert.equal(f.alarms().length, 0); assert.equal(f.timers.size, 0);
});
test('invalid configuration and overlapping outputs are rejected', () => {
    const f = fixture();
    assert.throws(() => validate({ ...f.config, areas: [f.config.areas[0], f.config.areas[0]] }));
    assert.throws(() => validate({ ...f.config, sensors: [{ ...f.config.sensors[0], hits: 1.5 }] }));
    assert.throws(() => validate({ ...f.config, sirens: [{ ...defaults.sirens[0], enabled: true, stateId: 'knx.0.window' }] }));
    assert.equal(active({ activeValue: 'false' }, { val: false }), true);
    assert.equal(active({ activeValue: 'true' }, { val: 'true' }), null);
    assert.equal(active({ activeValue: 'true' }, { val: 1 }), null);
    assert.equal(active({ activeValue: '1' }, { val: true }), null);
});
