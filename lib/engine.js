'use strict';
const { active } = require('./config');

class Engine {
    constructor(config, emit, clock = { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) }) {
        this.config = config; this.emit = emit; this.clock = clock; this.closed = false; this.panicActive = false;
        this.areas = new Map(config.areas.map(a => [a.id, { config: a, mode: 'disarmed', phase: 'disarmed', alarm: false, tamperLatched: false, reason: '', exit: null, entry: null, entrySensor: null, pending: new Map() }]));
        this.sensors = new Map(config.sensors.map(s => [s.id, { config: s, enabled: s.enabled, value: null, tamper: s.tamperStateId ? null : false, hits: [], hold: null, alarm: false }]));
    }
    sensorStatus(s) {
        if (!s.enabled) return 'disable';
        if (s.tamper) return 'tamper';
        if (s.value === null || s.tamper === null) return 'unknown';
        if (s.alarm) return 'alarm';
        if (s.hold !== null) return 'pending';
        return s.value ? 'active' : 'normal';
    }
    publish(id) {
        const a = this.areas.get(id);
        const mode = a.mode === 'disarmed' ? 'away' : a.mode;
        const blocked = this.blockers(id, mode);
        const sensors = [...this.sensors.values()].filter(s => s.config.area === id);
        this.emit({ type: 'status', area: id, mode: a.mode, phase: a.phase, alarm: a.alarm, tamper: sensors.some(s => s.tamper === true), reason: a.reason, blocked,
            ready: !a.alarm && !blocked.length && sensors.some(s => this.included(s, mode)),
            disabled: sensors.filter(s => !s.enabled).map(s => s.config.name || s.config.id) });
        for (const s of sensors) this.emit({ type: 'sensor', area: id, sensor: s.config.id, enabled: s.enabled, status: this.sensorStatus(s), tamper: s.tamper === true, fault: s.tamper === null || (s.enabled && s.value === null) });
    }
    info(kind, id, extra = {}) {
        const a = this.areas.get(id);
        this.emit({ type: 'info', kind, area: id, mode: a.mode, state: a.phase, timestamp: this.clock.now(), ...extra });
    }
    included(s, mode) { return s.enabled && (mode === 'away' || (mode === 'home' && s.config.zone === 'outside')); }
    blockers(id, mode) {
        const result = [];
        for (const s of this.sensors.values()) {
            if (s.config.area !== id) continue;
            const name = s.config.name || s.config.id;
            if (s.config.tamperStateId && s.tamper !== false) result.push(`${name} (${s.tamper ? 'Sabotage' : 'Sabotagekontakt unbekannt'})`);
            else if (this.included(s, mode) && (s.value === null || (s.config.blockArm && s.value))) result.push(`${name} (${s.value === null ? 'unbekannt' : 'offen/aktiv'})`);
        }
        return result;
    }
    cancel(obj, key) { if (obj[key] !== null) this.clock.clear(obj[key]); obj[key] = null; }
    clearSensors(id) {
        for (const s of this.sensors.values()) if (s.config.area === id) { this.cancel(s, 'hold'); s.hits = []; }
    }
    clearAlarm(id) {
        const a = this.areas.get(id); a.alarm = false; a.tamperLatched = false; a.reason = '';
        for (const s of this.sensors.values()) if (s.config.area === id) s.alarm = false;
    }
    command(id, mode) {
        const a = this.areas.get(id);
        if (!a || !['disarmed', 'home', 'away'].includes(mode)) throw new Error('Ungültiger Bereich oder Modus');
        if (mode !== 'disarmed' && a.mode !== 'disarmed') {
            if (mode === a.mode) return;
            throw new Error('Vor Moduswechsel zuerst unscharf schalten');
        }
        if (mode !== 'disarmed') {
            const blocked = this.blockers(id, mode);
            const hasSensors = [...this.sensors.values()].some(s => s.config.area === id && this.included(s, mode));
            if (blocked.length || !hasSensors || a.alarm) {
                const reason = blocked.length ? `Nicht bereit: ${blocked.join(', ')}` : a.alarm ? 'Gespeicherten Alarm zuerst zurücksetzen' : 'Keine aktiven Sensoren in diesem Modus';
                this.info('blocked', id, { requestedMode: mode, blocked, reason }); throw new Error(reason);
            }
        }
        const changed = a.mode !== mode;
        this.cancel(a, 'exit'); this.cancel(a, 'entry'); a.entrySensor = null; a.pending.clear(); this.clearSensors(id); a.mode = mode;
        if (mode === 'disarmed') {
            const unsafe = [...this.sensors.values()].some(s => s.config.area === id && s.config.tamperStateId && s.tamper !== false);
            if (!a.tamperLatched || !unsafe) this.clearAlarm(id);
            a.phase = a.alarm ? 'alarm' : 'disarmed';
            if (!a.alarm) this.emit({ type: 'clear', area: id });
            this.publish(id);
            if (changed) this.info('disarmed', id, { reason: a.alarm ? 'Sabotagealarm bleibt gespeichert: Kontakt aktiv oder unbekannt' : '' });
            return;
        }
        a.reason = ''; a.phase = 'exit'; this.publish(id); this.info('arming', id);
        const arm = () => {
            a.exit = null;
            const blocked = this.blockers(id, mode);
            if (blocked.length || ![...this.sensors.values()].some(s => s.config.area === id && this.included(s, mode))) {
                a.mode = 'disarmed'; a.phase = 'disarmed'; a.reason = 'Scharfschaltung abgebrochen';
                this.publish(id); this.info('blocked', id, { requestedMode: mode, blocked, reason: blocked.length ? a.reason : 'Keine aktiven Sensoren in diesem Modus' }); return;
            }
            a.phase = 'armed'; this.publish(id); this.info('armed', id);
            for (const s of this.sensors.values()) if (s.config.area === id && s.value && this.included(s, mode)) this.hit(s);
        };
        if (a.config.exitSeconds) a.exit = this.clock.set(arm, a.config.exitSeconds * 1000); else arm();
    }
    reset(id) {
        const a = this.areas.get(id);
        if (!a || a.mode !== 'disarmed') throw new Error('Zum Zurücksetzen zuerst unscharf schalten');
        if ([...this.sensors.values()].some(s => s.config.area === id && s.config.tamperStateId && s.tamper !== false)) throw new Error('Sabotagekontakt aktiv oder unbekannt; Zurücksetzen nicht möglich');
        this.clearAlarm(id); a.phase = 'disarmed'; this.emit({ type: 'clear', area: id }); this.publish(id); this.info('reset', id);
    }
    setEnabled(id, enabled, silent = false) {
        const s = this.sensors.get(id);
        if (!s || typeof enabled !== 'boolean') throw new Error('Sensor-enable erwartet true oder false');
        if (s.enabled === enabled) return;
        s.enabled = enabled; this.cancel(s, 'hold'); s.hits = [];
        const a = this.areas.get(s.config.area);
        if (!enabled && a.pending.delete(id)) this.scheduleEntry(s.config.area);
        if (enabled && s.value && this.included(s, a.mode) && ['armed', 'entry'].includes(a.phase)) this.hit(s);
        this.publish(s.config.area);
        if (!silent) this.info('sensorChanged', s.config.area, { sensor: id, state: enabled ? 'enabled' : 'disable' });
    }
    update(stateId, state) {
        if (this.closed) return;
        for (const s of this.sensors.values()) {
            let touched = false;
            if (s.config.stateId === stateId) {
                touched = true;
                const previous = s.value; s.value = active(s.config, state);
                if (s.value !== true) this.cancel(s, 'hold');
                const a = this.areas.get(s.config.area);
                if (s.value === true && previous !== true && ['armed', 'entry'].includes(a.phase) && this.included(s, a.mode)) this.hit(s);
            }
            if (s.config.tamperStateId && s.config.tamperStateId === stateId) {
                touched = true;
                const previous = s.tamper; s.tamper = active({ activeValue: s.config.tamperActiveValue || 'true' }, state);
                if (s.tamper === true && previous !== true) this.alarm(s, 'tamper');
                else if (s.tamper === false && previous === true) this.info('tamperRestored', s.config.area, { sensor: s.config.id });
            }
            if (touched) this.publish(s.config.area);
        }
    }
    hit(s) {
        const qualify = () => {
            s.hold = null;
            const a = this.areas.get(s.config.area);
            if (!s.value || !this.included(s, a.mode) || !['armed', 'entry'].includes(a.phase)) return;
            const now = this.clock.now();
            s.hits = s.hits.filter(t => now - t <= s.config.windowSeconds * 1000); s.hits.push(now);
            if (s.hits.length < s.config.hits) { this.publish(s.config.area); return; }
            s.hits = [];
            if (!s.config.entrySeconds) return this.alarm(s);
            // Keep each sensor's first deadline; later events can shorten but never extend it.
            if (!a.pending.has(s.config.id)) a.pending.set(s.config.id, now + s.config.entrySeconds * 1000);
            this.scheduleEntry(s.config.area); this.publish(s.config.area);
        };
        if (s.config.holdSeconds) s.hold = this.clock.set(qualify, s.config.holdSeconds * 1000); else qualify();
    }
    scheduleEntry(id) {
        const a = this.areas.get(id);
        this.cancel(a, 'entry'); a.entrySensor = null;
        const next = [...a.pending].sort((left, right) => left[1] - right[1])[0];
        if (!next) { if (!a.alarm) { a.phase = 'armed'; a.reason = ''; } return; }
        const s = this.sensors.get(next[0]);
        a.phase = 'entry'; a.entrySensor = next[0]; a.reason = s.config.name || s.config.id;
        a.entry = this.clock.set(() => { a.entry = null; a.entrySensor = null; if (s.enabled) this.alarm(s); }, Math.max(0, next[1] - this.clock.now()));
    }
    alarm(s, kind = 'alarm') {
        const a = this.areas.get(s.config.area);
        if (kind === 'tamper' ? a.tamperLatched : a.alarm || a.mode === 'disarmed' || !s.enabled) return;
        this.cancel(a, 'exit'); this.cancel(a, 'entry'); a.entrySensor = null; a.pending.clear(); this.clearSensors(s.config.area);
        if (kind === 'tamper') a.tamperLatched = true;
        a.alarm = true; a.phase = 'alarm'; a.reason = s.config.name || s.config.id; s.alarm = true;
        this.publish(s.config.area);
        this.emit({ type: 'alarm', kind, area: s.config.area, sensor: s.config.id, mode: a.mode, state: 'alarm', text: `${kind === 'tamper' ? 'Sabotage' : 'Alarm'} ${a.config.name || a.config.id}: ${a.reason}`, timestamp: this.clock.now() });
    }
    panic() {
        if (this.panicActive || this.closed) return;
        this.panicActive = true; this.emit({ type: 'panic', kind: 'panic', area: '*', state: 'panic', timestamp: this.clock.now() });
    }
    resetPanic() {
        if (!this.panicActive) return;
        this.panicActive = false; this.emit({ type: 'panicReset', kind: 'panicReset', area: '*', state: 'normal', timestamp: this.clock.now() });
    }
    close() {
        this.closed = true;
        for (const [id, a] of this.areas) { this.cancel(a, 'exit'); this.cancel(a, 'entry'); this.clearSensors(id); }
    }
}
module.exports = { Engine };
