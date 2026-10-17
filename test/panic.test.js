'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { value, triggered, canReset } = require('../lib/panic');
const { validate } = require('../lib/config');
const manifest = require('../io-package.json');

for (const [mode, expected] of Object.entries({ update: 5, true: 2, false: 3, rising: 1, falling: 1 })) {
    test(`panic ${mode} distinguishes matching updates and real edges`, () => {
        let previous = null, count = 0;
        for (const val of [false, false, true, true, false]) {
            const current = value({ val, q: 0 });
            if (triggered(mode, previous, current)) count++;
            previous = current;
        }
        assert.equal(count, expected);
    });
}
test('invalid and bad-quality events cannot trigger panic or invent a rising edge', () => {
    for (const state of [null, { val: null }, { val: 'true' }, { val: 2 }, { val: true, q: 0x80 }]) {
        assert.equal(value(state), null);
        for (const mode of ['update', 'true', 'false', 'rising', 'falling']) assert.equal(triggered(mode, false, value(state)), false);
    }
    assert.equal(triggered('rising', null, true), false);
    assert.equal(triggered('falling', null, false), false);
    assert.equal(value({ val: 0 }), false); assert.equal(value({ val: 1 }), true);
});
test('pulse modes allow resetting latched values; edge modes require their idle state', () => {
    for (const mode of ['update', 'true', 'false']) {
        assert.equal(canReset(mode, true), true); assert.equal(canReset(mode, false), true);
    }
    assert.equal(canReset('rising', false), true); assert.equal(canReset('rising', true), false);
    assert.equal(canReset('falling', true), true); assert.equal(canReset('falling', false), false);
    assert.equal(canReset('rising', null), false); assert.equal(canReset('falling', null), false);
});
test('legacy low-active input configuration migrates to falling edge', () => {
    const old = structuredClone(manifest.native); delete old.panicTriggerMode;
    assert.equal(validate({ ...old, panicActiveValue: 'false' }).panicTriggerMode, 'falling');
    assert.equal(validate({ ...old, panicActiveValue: '0' }).panicTriggerMode, 'falling');
    assert.equal(validate({ ...old, panicActiveValue: 'true' }).panicTriggerMode, 'rising');
    assert.equal(validate({ ...old, panicTriggerMode: 'true' }).panicTriggerMode, 'true');
    assert.throws(() => validate({ ...old, panicTriggerMode: 'bad' }), /Auslöseart/);
});
