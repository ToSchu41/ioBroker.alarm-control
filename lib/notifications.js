'use strict';

const templates = {
    templateAlarm: 'Alarm in {bereich}: {sensor_name} ({zone}). Zustand: {zustand}. {zeit}',
    templateTamper: 'Sabotage in {bereich}: {sensor_name}. Zustand: {zustand}. {zeit}',
    templatePanic: 'PANIK ausgelöst! {zeit}',
    templateArming: '{bereich}: Aktivierung läuft ({modus}). Deaktivierte Sensoren: {deaktivierte_sensoren}',
    templateArmed: '{bereich}: Anlage aktiviert ({modus}). Deaktivierte Sensoren: {deaktivierte_sensoren}',
    templateDisarmed: '{bereich}: Anlage deaktiviert. {grund}',
    templateBlocked: '{bereich}: Aktivierung verhindert ({modus}). {grund}. Blockierende Sensoren: {offene_sensoren}',
    templateSensorChanged: '{bereich}: Sensor {sensor_name} ist {zustand}.',
    templateTamperRestored: '{bereich}: Sabotagekontakt von {sensor_name} wieder normal. Gespeicherten Alarm zurücksetzen.',
    templateReset: '{bereich}: Alarm zurückgesetzt.',
    templatePanicReset: 'Panik zurückgesetzt. {zeit}',
    templateTest: 'Testnachricht von {instanz}. {zeit}',
    templatePhone: '{ereignis} {bereich}. {sensor_name}. {grund}'
};
const keys = { alarm: 'templateAlarm', tamper: 'templateTamper', panic: 'templatePanic', arming: 'templateArming', armed: 'templateArmed', disarmed: 'templateDisarmed', blocked: 'templateBlocked', sensorChanged: 'templateSensorChanged', tamperRestored: 'templateTamperRestored', reset: 'templateReset', panicReset: 'templatePanicReset', test: 'templateTest' };
const labels = { alarm: 'Einbruchalarm', tamper: 'Sabotagealarm', panic: 'Panik', arming: 'Aktivierung läuft', armed: 'Aktiviert', disarmed: 'Deaktiviert', blocked: 'Aktivierung verhindert', sensorChanged: 'Sensor geändert', tamperRestored: 'Sabotagekontakt normal', reset: 'Alarm zurückgesetzt', panicReset: 'Panik zurückgesetzt', test: 'Test' };
const states = { disarmed: 'Unscharf', home: 'Anwesend', away: 'Abwesend', armed: 'Scharf', exit: 'Ausgangsverzögerung', entry: 'Eingangsverzögerung', alarm: 'Alarm', panic: 'Panik', normal: 'Normal', enabled: 'Aktiviert', disable: 'Deaktiviert' };
const placeholders = ['sensor_name', 'sensor_id', 'bereich', 'bereich_id', 'zustand', 'modus', 'ereignis', 'grund', 'offene_sensoren', 'deaktivierte_sensoren', 'zeit', 'datum', 'timestamp', 'zone', 'instanz'];

function render(config, event, namespace, sensors = []) {
    const kind = event.kind || 'alarm';
    const area = config.areas.find(a => a.id === event.area);
    const sensor = config.sensors.find(s => s.id === event.sensor);
    const date = new Date(event.timestamp ?? Date.now());
    const disabled = sensors.filter(s => s.config.area === event.area && !s.enabled).map(s => s.config.name || s.config.id);
    const data = {
        sensor_name: sensor ? sensor.name || sensor.id : '', sensor_id: event.sensor || '',
        bereich: area ? area.name || area.id : 'Alle Bereiche', bereich_id: event.area || '*',
        zustand: states[event.state] || event.state || labels[kind] || kind,
        modus: states[event.requestedMode || event.mode] || '', ereignis: labels[kind] || kind,
        grund: event.reason || '', offene_sensoren: (event.blocked || []).join(', ') || 'keine',
        deaktivierte_sensoren: (event.disabled || disabled).join(', ') || 'keine',
        zeit: date.toLocaleString('de-DE', { timeZone: config.timeZone || 'Europe/Berlin' }),
        datum: date.toLocaleDateString('de-DE', { timeZone: config.timeZone || 'Europe/Berlin' }),
        timestamp: date.toISOString(), zone: sensor ? sensor.zone === 'inside' ? 'Innen' : 'Außen' : '', instanz: namespace
    };
    const substitute = text => text.replace(/\{([a-z_]+)\}/g, (match, key) => Object.hasOwn(data, key) ? String(data[key]) : match);
    return { telegram: substitute(config[keys[kind]] ?? templates[keys[kind]] ?? templates.templateAlarm), phone: substitute(config.templatePhone ?? templates.templatePhone) };
}
module.exports = { templates, placeholders, render };
