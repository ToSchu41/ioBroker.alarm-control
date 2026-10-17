'use strict';
const { templates, placeholders } = require('./notifications');

const defaults = { ...templates, notifyModeChanges: true, notifyArming: false, notifyBlocked: true, notifySensorChanges: true,
    tamperSirens: true, panicSirens: true, panicSceneId: '', panicStateId: '', panicActiveValue: 'true', historyLimit: 100, timeZone: 'Europe/Berlin' };

function validate(config) {
    const c = { ...defaults, ...structuredClone(config) };
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
        s.tamperStateId ??= ''; s.tamperActiveValue ??= 'true';
        area(s);
        if (typeof s.enabled !== 'boolean') fail(`${s.id}: Aktiv muss boolesch sein`);
        if (!['inside', 'outside'].includes(s.zone)) fail(`${s.id}: ungültige Zone`);
        if (!s.stateId || typeof s.stateId !== 'string') fail(`${s.id}: Datenpunkt fehlt`);
        if (!['true', 'false', '1', '0'].includes(s.activeValue)) fail(`${s.id}: ungültiger Aktivwert`);
        if (typeof s.tamperStateId !== 'string' || (s.tamperStateId && !['true', 'false', '1', '0'].includes(s.tamperActiveValue))) fail(`${s.id}: Sabotagekontakt prüfen`);
        if (s.tamperStateId === s.stateId) fail(`${s.id}: Sabotage und Einbruch benötigen getrennte Datenpunkte`);
        num(s, 'holdSeconds', 0, 3600); num(s, 'entrySeconds', 0, 3600);
        num(s, 'hits', 1, 100); num(s, 'windowSeconds', 1, 3600);
        if (!Number.isInteger(s.hits)) fail(`${s.id}: hits muss ganzzahlig sein`);
    }
    const outputs = new Set();
    for (const s of c.sirens) {
        area(s, true); num(s, 'durationSeconds', 1, 3600);
        if (!s.stateId) { if (s.enabled) fail(`${s.id}: Datenpunkt fehlt`); continue; }
        if (outputs.has(s.stateId) || c.sensors.some(sensor => sensor.stateId === s.stateId || sensor.tamperStateId === s.stateId) || s.stateId === c.panicStateId) fail(`${s.id}: Sirenendatenpunkt doppelt oder als Eingang verwendet`);
        outputs.add(s.stateId);
    }
    for (const r of c.recipients) {
        area(r, true);
        if (r.enabled && !/^[+0-9 ()/-]{3,40}$/.test(r.number)) fail(`${r.id}: Telefonnummer prüfen`);
    }
    if (c.telegramEnabled && !/^telegram\.\d+$/.test(c.telegramInstance)) fail('Telegram-Instanz prüfen');
    if (c.asteriskEnabled && !/^asterisk\.\d+$/.test(c.asteriskInstance)) fail('Asterisk-Instanz prüfen');
    for (const key of ['notifyModeChanges', 'notifyArming', 'notifyBlocked', 'notifySensorChanges', 'tamperSirens', 'panicSirens']) if (typeof c[key] !== 'boolean') fail(`${key}: boolescher Wert erforderlich`);
    if (!Number.isInteger(c.historyLimit) || c.historyLimit < 10 || c.historyLimit > 1000) fail('Ereignisanzahl muss zwischen 10 und 1000 liegen');
    for (const key of Object.keys(templates)) {
        if (typeof c[key] !== 'string' || !c[key].trim() || c[key].length > 4000) fail(`${key}: Nachricht muss 1 bis 4000 Zeichen enthalten`);
        for (const match of c[key].matchAll(/\{([a-z_]+)\}/g)) if (!placeholders.includes(match[1])) fail(`${key}: unbekannter Platzhalter ${match[0]}`);
    }
    for (const id of [...c.sensors.flatMap(s => [s.stateId, s.tamperStateId]), ...c.sirens.map(s => s.stateId), c.panicStateId, c.panicSceneId]) {
        if (typeof id !== 'string' || /[*?]/.test(id)) fail('Datenpunkt-IDs müssen konkrete IDs ohne Platzhalter sein');
    }
    if (!['true', 'false', '1', '0'].includes(c.panicActiveValue)) fail('Panik-Aktivwert prüfen');
    if (c.panicStateId && c.sensors.some(s => s.stateId === c.panicStateId || s.tamperStateId === c.panicStateId)) fail('Panik benötigt einen eigenen Eingang');
    if (c.panicSceneId && (!/^scene\.\d+\./.test(c.panicSceneId) || c.sensors.some(s => s.stateId === c.panicSceneId || s.tamperStateId === c.panicSceneId) || c.panicStateId === c.panicSceneId || outputs.has(c.panicSceneId))) fail('Panikszene muss ein separater Datenpunkt des Szenenadapters sein');
    try { new Intl.DateTimeFormat('de-DE', { timeZone: c.timeZone }).format(); } catch { fail('Zeitzone prüfen'); }
    return c;
}

function active(sensor, state) {
    if (!state || state.val === null || state.val === undefined || state.q) return null;
    const values = { true: true, false: false, '1': 1, '0': 0 };
    if (![true, false, 0, 1].includes(state.val)) return null;
    if (typeof state.val !== typeof values[sensor.activeValue]) return null;
    return state.val === values[sensor.activeValue];
}

module.exports = { validate, active, defaults };
