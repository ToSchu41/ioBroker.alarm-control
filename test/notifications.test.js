'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render, placeholders } = require('../lib/notifications');
const { validate, defaults } = require('../lib/config');
const manifest = require('../io-package.json');

test('templates substitute all supported placeholders once without interpreting sensor names', () => {
    const sensor = { id: 'window', name: 'Fenster {bereich}', area: 'haus', zone: 'outside' };
    const c = { ...manifest.native, sensors: [sensor], templateAlarm: placeholders.map(p => `{${p}}`).join('|') };
    const text = render(c, { kind: 'alarm', area: 'haus', sensor: 'window', mode: 'away', state: 'alarm', reason: 'Offen', blocked: ['Tür'], timestamp: 0 }, 'alarm-control.0', [{ config: sensor, enabled: false }]);
    assert.match(text.telegram, /Fenster \{bereich\}\|window\|Haus\|haus\|Alarm\|Abwesend\|Einbruchalarm\|Offen\|Tür/);
    assert.match(text.telegram, /1970-01-01T00:00:00.000Z\|Außen\|alarm-control.0$/);
});
test('0.1.0 configuration gets new defaults without changing original sensor settings', () => {
    const old = { areas: [{ id: 'haus', exitSeconds: 30 }], sensors: [{ id: 'door', enabled: true, area: 'haus', zone: 'outside', stateId: 'knx.0.door', activeValue: 'true', blockArm: true, holdSeconds: 0, entrySeconds: 0, hits: 1, windowSeconds: 30 }], sirens: [], recipients: [], telegramEnabled: false, asteriskEnabled: false };
    const saved = structuredClone(old), result = validate(old);
    assert.deepEqual(old, saved); assert.equal(result.sensors[0].tamperStateId, '');
    assert.equal(result.notifyModeChanges, true); assert.equal(result.templateAlarm, defaults.templateAlarm);
});
test('template typos, reference loops and invalid time zones fail validation', () => {
    const c = manifest.native;
    assert.throws(() => validate({ ...c, templateAlarm: '{sensor_naem}' }), /Platzhalter/);
    assert.throws(() => validate({ ...c, timeZone: 'invalid/timezone' }), /Zeitzone/);
    assert.throws(() => validate({ ...c, panicSceneId: 'knx.0.light' }), /Panikszene/);
    assert.throws(() => validate({ ...c, panicStateId: 'knx.0.*' }), /Platzhalter/);
    assert.equal(validate({ ...c, panicSceneId: 'scene.Panik' }).panicSceneId, 'scene.Panik');
});
test('manifest and package versions match and test buttons require messagebox', () => {
    const pkg = require('../package.json'); const ui = require('../admin/jsonConfig.json');
    assert.equal(pkg.version, manifest.common.version); assert.equal(manifest.common.messagebox, true);
    assert.equal(ui.items.notificationsTab.items.testTelegram.command, 'testTelegram');
    assert.equal(ui.items.notificationsTab.items.testPhone.command, 'testPhone');
    assert.equal(validate(manifest.native).templatePanic, manifest.native.templatePanic);
});
