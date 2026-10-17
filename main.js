'use strict';
const utils = require('@iobroker/adapter-core');
const { Engine } = require('./lib/engine');
const { validate } = require('./lib/config');

class AlarmControl extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: 'alarm-control' });
        this.queue = Promise.resolve(); this.stopping = false; this.sirenTimers = new Map(); this.sounding = new Map();
        this.on('ready', () => this.enqueue(() => this.ready()));
        this.on('stateChange', (id, state) => this.enqueue(() => this.changed(id, state)));
        this.on('unload', callback => this.unload(callback));
    }
    enqueue(fn) {
        this.queue = this.queue.then(() => this.stopping ? undefined : fn()).catch(async error => {
            this.log.error(error.message);
            await this.setStateAsync('info.lastError', { val: error.message, ack: true }).catch(() => {});
        });
    }
    async object(id, type, role, write = false, states) {
        await this.setObjectNotExistsAsync(id, { type: 'state', common: { name: id.split('.').pop(), type, role, read: true, write, ...(states ? { states } : {}) }, native: {} });
    }
    async ready() {
        await this.setStateAsync('info.connection', { val: false, ack: true });
        this.settings = validate(this.config);
        for (const row of [...this.settings.sensors, ...this.settings.sirens]) {
            if (row.enabled && row.stateId.startsWith(`${this.namespace}.`)) throw new Error('Sensoren und Sirenen müssen externe Datenpunkte verwenden');
        }
        await this.object('info.lastError', 'string', 'text');
        await this.object('info.lastEvent', 'string', 'json');
        await this.setStateAsync('info.lastError', { val: '', ack: true });
        await this.setObjectNotExistsAsync('areas', { type: 'channel', common: { name: 'Sicherungsbereiche' }, native: {} });
        for (const a of this.settings.areas) {
            const root = `areas.${a.id}`;
            await this.setObjectNotExistsAsync(root, { type: 'channel', common: { name: a.name || a.id }, native: {} });
            await this.object(`${root}.mode`, 'string', 'state', true, { disarmed: 'Unscharf', home: 'Anwesend', away: 'Abwesend' });
            for (const [key, type, role, write] of [['status', 'string', 'text', false], ['alarm', 'boolean', 'indicator.alarm', false], ['reason', 'string', 'text', false], ['blockedSensors', 'string', 'json', false], ['silence', 'boolean', 'button', true], ['lastAlarm', 'string', 'json', false]]) await this.object(`${root}.${key}`, type, role, write);
        }
        this.engine = new Engine(this.settings, event => this.enqueue(() => this.event(event)));
        // Subscriptions precede the snapshot; subsequent events are serialized after ready.
        for (const id of new Set(this.settings.sensors.filter(s => s.enabled).map(s => s.stateId))) await this.subscribeForeignStatesAsync(id);
        await this.subscribeStatesAsync('areas.*');
        for (const s of this.settings.sensors.filter(s => s.enabled)) this.engine.update(s.stateId, await this.getForeignStateAsync(s.stateId));
        for (const a of this.settings.areas) this.engine.publish(a.id);
        // Startup deliberately disarms all areas and resets configured outputs.
        await this.writeSirens();
        await this.setStateAsync('info.connection', { val: true, ack: true });
    }
    async changed(id, state) {
        if (!this.engine) return;
        if (!id.startsWith(`${this.namespace}.`)) { this.engine.update(id, state); return; }
        if (!state || state.ack) return;
        const match = /^areas\.([a-z][a-z0-9_]*)\.(mode|silence)$/.exec(id.slice(this.namespace.length + 1));
        if (!match || !this.engine.areas.has(match[1])) return;
        const [, area, action] = match;
        if (action === 'silence') {
            if (state.val === true) await this.clearSirenArea(area);
            await this.setStateAsync(`areas.${area}.silence`, { val: false, ack: true });
        } else {
            try {
                this.engine.command(area, state.val);
                await this.setStateAsync('info.lastError', { val: '', ack: true });
            } catch (e) { this.engine.publish(area); throw e; }
        }
    }
    async event(e) {
        if (e.type === 'status') {
            const root = `areas.${e.area}`;
            for (const [key, val] of Object.entries({ mode: e.mode, status: e.phase, alarm: e.alarm, reason: e.reason, blockedSensors: JSON.stringify(e.blocked) })) await this.setStateAsync(`${root}.${key}`, { val, ack: true });
        } else if (e.type === 'clear') await this.clearSirenArea(e.area);
        else if (e.type === 'alarm') {
            await this.setStateAsync(`areas.${e.area}.lastAlarm`, { val: JSON.stringify(e), ack: true });
            await this.setStateAsync('info.lastEvent', { val: JSON.stringify(e), ack: true });
            // Notification failures must not prevent siren operation, or vice versa.
            // Calls may take time; mode commands and siren timers must remain responsive.
            this.notify(e).catch(error => this.enqueue(async () => {
                this.log.error(`Benachrichtigung fehlgeschlagen: ${error.message}`);
                await this.setStateAsync('info.lastError', { val: `Benachrichtigung fehlgeschlagen: ${error.message}`, ack: true });
            }));
            await this.startSirens(e.area);
        }
    }
    async startSirens(area) {
        for (const s of this.settings.sirens.filter(s => s.enabled && (s.area === '*' || s.area === area))) {
            const key = `${s.id}:${area}`;
            this.sounding.set(key, s.id);
            if (this.sirenTimers.has(key)) this.clearTimeout(this.sirenTimers.get(key));
            this.sirenTimers.set(key, this.setTimeout(() => this.enqueue(async () => {
                this.sirenTimers.delete(key); this.sounding.delete(key); await this.writeSirens();
            }), s.durationSeconds * 1000));
        }
        await this.writeSirens();
    }
    async clearSirenArea(area) {
        for (const key of this.sounding.keys()) if (key.endsWith(`:${area}`)) {
            this.clearTimeout(this.sirenTimers.get(key)); this.sirenTimers.delete(key); this.sounding.delete(key);
        }
        await this.writeSirens();
    }
    async writeSirens() {
        const results = await Promise.allSettled(this.settings.sirens.filter(s => s.enabled).map(async s => {
            const obj = await this.getForeignObjectAsync(s.stateId);
            if (!obj || obj.type !== 'state' || obj.common.type !== 'boolean' || !obj.common.write) throw new Error(`${s.id}: Sirene benötigt einen schreibbaren booleschen Datenpunkt`);
            const on = [...this.sounding.values()].includes(s.id);
            await this.setForeignStateAsync(s.stateId, { val: s.inverted ? !on : on, ack: false });
        }));
        const errors = results.filter(r => r.status === 'rejected');
        if (errors.length) throw new Error(errors.map(e => e.reason.message).join('; '));
    }
    async notify(e) {
        const c = this.settings;
        const jobs = [];
        if (c.telegramEnabled) jobs.push(this.sendToAsync(c.telegramInstance, 'send', { text: e.text, ...(c.telegramUser ? { user: c.telegramUser } : {}) }));
        if (c.asteriskEnabled) for (const r of c.recipients.filter(r => r.enabled && (r.area === '*' || r.area === e.area))) jobs.push(this.sendToAsync(c.asteriskInstance, 'dial', { telnr: r.number, text: e.text }));
        const results = await Promise.allSettled(jobs);
        for (const r of results) {
            if (r.status === 'rejected') throw r.reason;
            if (r.value && r.value.error) throw new Error(`Benachrichtigung: ${r.value.error}`);
        }
    }
    unload(callback) {
        this.stopping = true;
        if (this.engine) this.engine.close();
        for (const timer of this.sirenTimers.values()) this.clearTimeout(timer);
        // Drain any write already in flight before resetting the contacts.
        this.queue.then(async () => {
            this.sounding.clear();
            if (this.settings) await this.writeSirens();
            await this.setStateAsync('info.connection', { val: false, ack: true });
        }).catch(e => this.log.error(e.message)).finally(callback);
    }
}

if (module.parent) module.exports = options => new AlarmControl(options);
else new AlarmControl();
