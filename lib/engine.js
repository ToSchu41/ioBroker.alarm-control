'use strict';
const { active } = require('./config');

class Engine {
    constructor(config, emit, clock = { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) }) {
        this.config = config; this.emit = emit; this.clock = clock; this.closed = false;
        this.areas = new Map(config.areas.map(a => [a.id, { config: a, mode: 'disarmed', phase: 'disarmed', alarm: false, reason: '', exit: null, entry: null }]));
        this.sensors = new Map(config.sensors.filter(s => s.enabled).map(s => [s.id, { config: s, value: null, hits: [], hold: null }]));
    }
    publish(id) {
        const a = this.areas.get(id);
        this.emit({ type: 'status', area: id, mode: a.mode, phase: a.phase, alarm: a.alarm, reason: a.reason, blocked: this.blockers(id, a.mode === 'disarmed' ? 'away' : a.mode) });
    }
    included(s, mode) { return mode === 'away' || (mode === 'home' && s.config.zone === 'outside'); }
    blockers(id, mode) {
        return [...this.sensors.values()].filter(s => s.config.area === id && this.included(s, mode) && (s.value === null || (s.config.blockArm && s.value))).map(s => s.config.name || s.config.id);
    }
    cancel(obj, key) { if (obj[key] !== null) this.clock.clear(obj[key]); obj[key] = null; }
    clearSensors(id) {
        for (const s of this.sensors.values()) if (s.config.area === id) { this.cancel(s, 'hold'); s.hits = []; }
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
            if (blocked.length) throw new Error(`Nicht bereit: ${blocked.join(', ')}`);
            if (![...this.sensors.values()].some(s => s.config.area === id && this.included(s, mode))) throw new Error('Keine aktiven Sensoren in diesem Modus');
        }
        this.cancel(a, 'exit'); this.cancel(a, 'entry'); this.clearSensors(id);
        a.mode = mode; a.alarm = false; a.reason = '';
        if (mode === 'disarmed') {
            a.phase = 'disarmed'; this.emit({ type: 'clear', area: id }); this.publish(id); return;
        }
        a.phase = 'exit'; this.publish(id);
        const arm = () => {
            a.exit = null;
            if (this.blockers(id, mode).length) {
                a.mode = 'disarmed'; a.phase = 'disarmed'; a.reason = 'Scharfschaltung abgebrochen: Sensor offen oder unbekannt'; this.publish(id); return;
            }
            a.phase = 'armed'; this.publish(id);
            for (const s of this.sensors.values()) if (s.config.area === id && s.value && this.included(s, mode)) this.hit(s);
        };
        if (a.config.exitSeconds) a.exit = this.clock.set(arm, a.config.exitSeconds * 1000); else arm();
    }
    update(stateId, state) {
        if (this.closed) return;
        for (const s of this.sensors.values()) {
            if (s.config.stateId !== stateId) continue;
            const previous = s.value; s.value = active(s.config, state);
            if (s.value !== true) this.cancel(s, 'hold');
            const a = this.areas.get(s.config.area);
            if (s.value === true && previous !== true && ['armed', 'entry'].includes(a.phase) && this.included(s, a.mode)) this.hit(s);
            this.publish(s.config.area);
        }
    }
    hit(s) {
        const qualify = () => {
            s.hold = null;
            const a = this.areas.get(s.config.area);
            if (!s.value || !['armed', 'entry'].includes(a.phase)) return;
            const now = this.clock.now();
            s.hits = s.hits.filter(t => now - t <= s.config.windowSeconds * 1000);
            s.hits.push(now);
            if (s.hits.length < s.config.hits) return;
            s.hits = [];
            if (!s.config.entrySeconds) return this.alarm(s);
            // A second event cannot extend an existing entry countdown.
            if (a.entry !== null) return;
            a.phase = 'entry'; a.reason = s.config.name || s.config.id; this.publish(s.config.area);
            a.entry = this.clock.set(() => { a.entry = null; this.alarm(s); }, s.config.entrySeconds * 1000);
        };
        if (s.config.holdSeconds) s.hold = this.clock.set(qualify, s.config.holdSeconds * 1000); else qualify();
    }
    alarm(s) {
        const a = this.areas.get(s.config.area);
        if (a.alarm || a.mode === 'disarmed') return;
        this.cancel(a, 'entry'); this.clearSensors(s.config.area);
        a.alarm = true; a.phase = 'alarm'; a.reason = s.config.name || s.config.id;
        this.publish(s.config.area);
        this.emit({ type: 'alarm', area: s.config.area, sensor: s.config.id, text: `Alarm ${a.config.name || a.config.id}: ${a.reason}`, timestamp: this.clock.now() });
    }
    close() {
        this.closed = true;
        for (const [id, a] of this.areas) { this.cancel(a, 'exit'); this.cancel(a, 'entry'); this.clearSensors(id); }
    }
}
module.exports = { Engine };
