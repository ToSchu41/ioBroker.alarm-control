'use strict';

function validate(config) {
    const c = structuredClone(config);
    const fail = message => { throw new Error(message); };
    const ids = (rows, label) => {
        if (!Array.isArray(rows)) fail(`${label}: Tabelle fehlt`);
        const seen = new Set();
        for (const row of rows) {
            if (!/^[a-z][a-z0-9_]*$/.test(row.id) || seen.has(row.id)) fail(`${label}: ID muss eindeutig sein (a-z, 0-9, _)`);
            seen.add(row.id);
        }
        return seen;
    };
    const areas = ids(c.areas, 'Bereiche');
    if (!areas.size) fail('Mindestens ein Bereich erforderlich');
    ids(c.sensors, 'Sensoren'); ids(c.sirens, 'Sirenen'); ids(c.recipients, 'Empfänger');
    const num = (row, key, min, max) => {
        if (!Number.isFinite(row[key]) || row[key] < min || row[key] > max) fail(`${row.id}: ${key} muss zwischen ${min} und ${max} liegen`);
    };
    const area = (row, wildcard = false) => {
        if (!(wildcard && row.area === '*') && !areas.has(row.area)) fail(`${row.id}: unbekannter Bereich`);
    };
    for (const a of c.areas) num(a, 'exitSeconds', 0, 3600);
    for (const s of c.sensors) {
        area(s);
        if (!['inside', 'outside'].includes(s.zone)) fail(`${s.id}: ungültige Zone`);
        if (!s.stateId || typeof s.stateId !== 'string') fail(`${s.id}: Datenpunkt fehlt`);
        if (!['true', 'false', '1', '0'].includes(s.activeValue)) fail(`${s.id}: ungültiger Aktivwert`);
        num(s, 'holdSeconds', 0, 3600); num(s, 'entrySeconds', 0, 3600);
        num(s, 'hits', 1, 100); num(s, 'windowSeconds', 1, 3600);
        if (!Number.isInteger(s.hits)) fail(`${s.id}: hits muss ganzzahlig sein`);
    }
    const outputs = new Set();
    for (const s of c.sirens) {
        area(s, true); num(s, 'durationSeconds', 1, 3600);
        if (!s.stateId) { if (s.enabled) fail(`${s.id}: Datenpunkt fehlt`); continue; }
        if (outputs.has(s.stateId) || c.sensors.some(sensor => sensor.stateId === s.stateId)) fail(`${s.id}: Sirenendatenpunkt doppelt oder als Sensor verwendet`);
        outputs.add(s.stateId);
    }
    for (const r of c.recipients) {
        area(r, true);
        if (r.enabled && !/^[+0-9 ()/-]{3,40}$/.test(r.number)) fail(`${r.id}: Telefonnummer prüfen`);
    }
    if (c.telegramEnabled && !/^telegram\.\d+$/.test(c.telegramInstance)) fail('Telegram-Instanz prüfen');
    if (c.asteriskEnabled && !/^asterisk\.\d+$/.test(c.asteriskInstance)) fail('Asterisk-Instanz prüfen');
    return c;
}

function active(sensor, state) {
    if (!state || state.val === null || state.val === undefined || state.q) return null;
    const values = { true: true, false: false, '1': 1, '0': 0 };
    if (![true, false, 0, 1].includes(state.val)) return null;
    if (typeof state.val !== typeof values[sensor.activeValue]) return null;
    return state.val === values[sensor.activeValue];
}

module.exports = { validate, active };
