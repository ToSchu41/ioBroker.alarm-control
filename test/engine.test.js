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

test('tamper is immediate while disarmed and cannot be bypassed by disable', () => {
    const f = fixture({ tamperStateId: 'knx.0.tamper', holdSeconds: 20, entrySeconds: 30, hits: 5, enabled: false });
    f.engine.update('knx.0.tamper', { val: true });
    assert.equal(f.alarms().length, 1); assert.equal(f.alarms()[0].kind, 'tamper');
    assert.equal(f.engine.areas.get('haus').mode, 'disarmed');
    assert.equal(f.engine.sensorStatus(f.engine.sensors.get('window')), 'disable');
    f.engine.update('knx.0.tamper', { val: true }); assert.equal(f.alarms().length, 1);
    assert.throws(() => f.engine.reset('haus'), /Sabotagekontakt/);
    f.engine.command('haus', 'disarmed'); assert.equal(f.engine.areas.get('haus').alarm, true);
    f.engine.update('knx.0.tamper', { val: false }); assert.equal(f.engine.areas.get('haus').alarm, true);
    f.engine.reset('haus'); assert.equal(f.engine.areas.get('haus').alarm, false);
    f.engine.update('knx.0.tamper', { val: true }); assert.equal(f.alarms().length, 2);
});
test('unknown tamper blocks arming even for a disabled inside sensor in home mode', () => {
    const f = fixture({ tamperStateId: 'knx.0.tamper', enabled: false, zone: 'inside' });
    f.update(false);
    assert.match(f.engine.blockers('haus', 'home')[0], /Sabotagekontakt unbekannt/);
    assert.throws(() => f.engine.command('haus', 'home'));
    f.engine.update('knx.0.tamper', { val: false }); assert.equal(f.engine.blockers('haus', 'home').length, 0);
});
test('tamper bypasses exit and entry countdowns and can escalate an intrusion alarm', () => {
    const f = fixture({ tamperStateId: 'knx.0.tamper', entrySeconds: 20 });
    f.update(false); f.engine.update('knx.0.tamper', { val: false }); f.engine.command('haus', 'away');
    f.update(true); assert.equal(f.engine.areas.get('haus').phase, 'entry');
    f.engine.update('knx.0.tamper', { val: true }); f.tick(30000);
    assert.equal(f.alarms().length, 1); assert.equal(f.alarms()[0].kind, 'tamper');
    assert.equal(f.timers.size, 0);
});
test('disabling sensor cancels its pending entry but does not clear an existing alarm', () => {
    const f = fixture({ entrySeconds: 10 }); f.update(false); f.engine.command('haus', 'away'); f.update(true);
    f.engine.setEnabled('window', false); f.tick(10000); assert.equal(f.alarms().length, 0);
    assert.equal(f.engine.sensorStatus(f.engine.sensors.get('window')), 'disable');
    f.engine.setEnabled('window', true); f.tick(10000); assert.equal(f.alarms().length, 1);
    f.engine.setEnabled('window', false); assert.equal(f.engine.areas.get('haus').alarm, true);
});
test('blocked commands and exit-delay failures emit informative events', () => {
    const f = fixture(); f.update(true);
    assert.throws(() => f.engine.command('haus', 'away'));
    const first = f.events.find(e => e.kind === 'blocked');
    assert.equal(first.requestedMode, 'away'); assert.match(first.blocked[0], /Fenster/);
    f.update(false); f.engine.areas.get('haus').config.exitSeconds = 5; f.engine.command('haus', 'away');
    assert.equal(f.events.filter(e => e.kind === 'armed').length, 0);
    f.update(true); f.tick(5000); assert.equal(f.events.filter(e => e.kind === 'blocked').length, 2);
});
test('mode info is emitted only for actual completion and disarming', () => {
    const f = fixture(); f.update(false); f.engine.areas.get('haus').config.exitSeconds = 5;
    f.engine.command('haus', 'away'); f.tick(5000); f.engine.command('haus', 'away');
    f.engine.command('haus', 'disarmed'); f.engine.command('haus', 'disarmed');
    assert.equal(f.events.filter(e => e.kind === 'armed').length, 1);
    assert.equal(f.events.filter(e => e.kind === 'disarmed').length, 1);
});
test('panic is latched and must be reset before another activation', () => {
    const f = fixture(); f.engine.panic(); f.engine.panic();
    assert.equal(f.events.filter(e => e.type === 'panic').length, 1);
    f.engine.resetPanic(); f.engine.panic();
    assert.equal(f.events.filter(e => e.type === 'panic').length, 2);
    f.engine.close(); f.engine.resetPanic(); f.engine.panic();
    assert.equal(f.engine.panicActive, false);
});

test('a second delayed sensor can shorten the countdown and disabling it preserves the first deadline', () => {
    const f = fixture({ entrySeconds: 20 });
    const second = { ...f.config.sensors[0], id: 'door', stateId: 'knx.0.door', entrySeconds: 5 };
    f.config.sensors.push(second);
    // Reuse the same simulated clock for an engine containing both sensors.
    const events = [];
    const e = new Engine(f.config, event => events.push(event), f.engine.clock);
    e.update('knx.0.window', { val: false }); e.update('knx.0.door', { val: false }); e.command('haus', 'away');
    e.update('knx.0.window', { val: true }); f.tick(2000); e.update('knx.0.door', { val: true });
    assert.equal(e.areas.get('haus').entrySensor, 'door');
    e.setEnabled('door', false); assert.equal(e.areas.get('haus').entrySensor, 'window');
    f.tick(17999); assert.equal(events.filter(x => x.type === 'alarm').length, 0);
    f.tick(1); assert.equal(events.filter(x => x.type === 'alarm')[0].sensor, 'window');
});

test('shorter sensor deadline triggers at its own time', () => {
    const f = fixture({ entrySeconds: 20 });
    f.config.sensors.push({ ...f.config.sensors[0], id: 'door', stateId: 'knx.0.door', entrySeconds: 5 });
    const events = [], e = new Engine(f.config, event => events.push(event), f.engine.clock);
    e.update('knx.0.window', { val: false }); e.update('knx.0.door', { val: false }); e.command('haus', 'away');
    e.update('knx.0.window', { val: true }); f.tick(2000); e.update('knx.0.door', { val: true }); f.tick(5000);
    assert.equal(events.filter(x => x.type === 'alarm')[0].sensor, 'door');
});
