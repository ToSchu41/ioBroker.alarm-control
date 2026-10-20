'use strict';
const utils = require('@iobroker/adapter-core');
const { Engine } = require('./lib/engine');
const { validate, active } = require('./lib/config');
const { render, templates } = require('./lib/notifications');
const panic = require('./lib/panic');
const { Actuators } = require('./lib/actuators');

class AlarmControl extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: 'alarm-control' });
        this.queue = Promise.resolve(); this.stopping = false; this.initialized = false;
        this.sirenTimers = new Map(); this.sounding = new Map(); this.history = []; this.testsRunning = new Set(); this.testTimes = new Map();
        this.on('ready', () => this.enqueue(() => this.ready()));
        this.on('stateChange', (id, state) => this.enqueue(() => this.changed(id, state)));
        this.on('message', message => { this.message(message).catch(error => this.log.error(error.message)); });
        this.on('unload', callback => this.unload(callback));
    }
    enqueue(fn) {
        this.queue = this.queue.then(() => this.stopping ? undefined : fn()).catch(error => this.report(error));
    }
    async report(error) {
        this.log.error(error.message);
        await this.setStateAsync('info.lastError', { val: error.message, ack: true }).catch(() => {});
    }
    async object(id, type, role, write = false, states) {
        await this.setObjectNotExistsAsync(id, { type: 'state', common: { name: id.split('.').pop(), type, role, read: true, write, ...(states ? { states } : {}) }, native: {} });
    }
    async channel(id, name) { await this.setObjectNotExistsAsync(id, { type: 'channel', common: { name }, native: {} }); }
    async put(id, val) { await this.setStateChangedAsync(id, { val, ack: true }); }
    async ready() {
        await this.object('info.lastError', 'string', 'text');
        await this.setStateAsync('info.connection', { val: false, ack: true });
        if (this.config.messageTemplateVersion !== 2) {
            // Explicit release migration to the message wording requested by the owner.
            const native = { ...templates, messageTemplateVersion: 2 };
            await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, { native });
            Object.assign(this.config, native);
        }
        this.settings = validate(this.config);
        const c = this.settings;
        const externalIds = [...c.sensors.flatMap(s => [s.stateId, s.tamperStateId]), ...c.sirens.filter(s => s.enabled).map(s => s.stateId), ...c.actuators.map(r => r.stateId), c.panicStateId];
        this.actuators = new Actuators(this, c.actuators);
        if (externalIds.some(id => id.startsWith(`${this.namespace}.`))) throw new Error('Sensoren, Sabotagekontakte, Panikeingang und Sirenen müssen externe Datenpunkte verwenden');
        for (const key of ['lastEvent', 'eventHistory']) await this.object(`info.${key}`, 'string', 'json');
        await this.object('info.testResult', 'string', 'text');
        await this.put('info.lastError', '');
        try { const saved = JSON.parse((await this.getStateAsync('info.eventHistory'))?.val || '[]'); if (Array.isArray(saved)) this.history = saved.slice(-c.historyLimit); } catch { this.history = []; }
        await this.channel('panic', 'Panik');
        await this.object('panic.trigger', 'boolean', 'button', true);
        await this.object('panic.reset', 'boolean', 'button', true);
        await this.object('panic.active', 'boolean', 'indicator.alarm');
        await this.object('panic.sceneStatus', 'string', 'text', false, { idle: 'Noch nicht angefordert', not_configured: 'Keine Szene konfiguriert', requested: 'Aktivierung angefordert', error: 'Anforderung fehlgeschlagen' });
        await this.object('panic.sceneLastResult', 'string', 'json');
        await this.put('panic.sceneStatus', c.panicSceneId ? 'idle' : 'not_configured');
        for (const key of ['trigger', 'reset', 'active']) await this.put(`panic.${key}`, false);
        await this.channel('areas', 'Sicherungsbereiche');
        const enabled = new Map(), silentModes = new Map();
        for (const a of c.areas) {
            const root = `areas.${a.id}`;
            await this.channel(root, a.name || a.id);
            await this.object(`${root}.mode`, 'string', 'state', true, { disarmed: 'Unscharf', home: 'Anwesend', away: 'Abwesend' });
            await this.object(`${root}.silentAlarm`, 'boolean', 'switch.enable', true);
            const savedSilent = await this.getStateAsync(`${root}.silentAlarm`);
            silentModes.set(a.id, typeof savedSilent?.val === 'boolean' ? savedSilent.val : a.silentAlarm);
            for (const [key, type, role, write] of [['status', 'string', 'text', false], ['alarm', 'boolean', 'indicator.alarm', false], ['tamper', 'boolean', 'indicator.alarm', false], ['ready', 'boolean', 'indicator', false], ['reason', 'string', 'text', false], ['blockedSensors', 'string', 'json', false], ['disabledSensors', 'string', 'json', false], ['silence', 'boolean', 'button', true], ['reset', 'boolean', 'button', true], ['lastAlarm', 'string', 'json', false]]) await this.object(`${root}.${key}`, type, role, write);
            await this.put(`${root}.silence`, false); await this.put(`${root}.reset`, false);
            await this.channel(`${root}.sensors`, 'Sensoren');
            for (const s of c.sensors.filter(s => s.area === a.id)) {
                const sensorRoot = `${root}.sensors.${s.id}`;
                await this.channel(sensorRoot, s.name || s.id);
                await this.object(`${sensorRoot}.enable`, 'boolean', 'switch.enable', true);
                await this.object(`${sensorRoot}.status`, 'string', 'text', false, { disable: 'Deaktiviert', normal: 'Normal', active: 'Offen / aktiv', unknown: 'Unbekannt', pending: 'Mindestaktivdauer läuft', alarm: 'Alarm gespeichert', tamper: 'Sabotage' });
                await this.object(`${sensorRoot}.tamper`, 'boolean', 'indicator.alarm');
                await this.object(`${sensorRoot}.fault`, 'boolean', 'indicator.maintenance');
                const saved = await this.getStateAsync(`${sensorRoot}.enable`);
                enabled.set(s.id, typeof saved?.val === 'boolean' ? saved.val : s.enabled);
            }
        }
        this.engine = new Engine(c, event => {
            // Capture bypasses at event time, rather than when a delayed send runs.
            event.disabled = event.disabled || [...this.engine.sensors.values()].filter(s => s.config.area === event.area && !s.enabled).map(s => s.config.name || s.config.id);
            this.enqueue(() => this.event(event));
        });
        for (const [id, value] of silentModes) this.engine.setSilentAlarm(id, value, true);
        for (const [id, value] of enabled) this.engine.setEnabled(id, value, true);
        const inputIds = new Set([...c.sensors.flatMap(s => [s.stateId, s.tamperStateId]), c.panicStateId].filter(Boolean));
        for (const id of inputIds) await this.subscribeForeignStatesAsync(id);
        await this.subscribeStatesAsync('areas.*'); await this.subscribeStatesAsync('panic.*');
        // Reset outputs first; active sabotage circuits in the snapshot can then raise a fresh alarm.
        await this.writeSirens();
        for (const id of inputIds) this.updateInput(id, await this.getForeignStateAsync(id), true);
        for (const a of c.areas) this.engine.publish(a.id);
        this.initialized = true;
        await this.put('info.connection', true);
    }
    updateInput(id, state, initial = false) {
        if (id === this.settings.panicStateId) {
            const previous = this.panicInput;
            this.panicInput = panic.value(state);
            // A persisted startup value is a baseline, not a new button press.
            if (!initial && panic.triggered(this.settings.panicTriggerMode, previous, this.panicInput)) this.engine.panic();
        } else this.engine.update(id, state);
    }
    async changed(id, state) {
        if (!this.initialized) return;
        if (!id.startsWith(`${this.namespace}.`)) { this.updateInput(id, state); return; }
        if (!state || state.ack) return;
        const local = id.slice(this.namespace.length + 1);
        if (['panic.trigger', 'panic.reset'].includes(local)) {
            try {
                if (state.val === true) {
                    if (local === 'panic.trigger') this.engine.panic();
                    else {
                        if (this.settings.panicStateId && !panic.canReset(this.settings.panicTriggerMode, this.panicInput)) throw new Error('Panikeingang aktiv oder unbekannt; für die konfigurierte Flanke zuerst in Ruhelage bringen');
                        this.engine.resetPanic();
                    }
                }
            } finally { await this.put(local, false); }
            return;
        }
        const sensorMatch = /^areas\.([a-z][a-z0-9_]*)\.sensors\.([a-z][a-z0-9_]*)\.enable$/.exec(local);
        if (sensorMatch) {
            const s = this.engine.sensors.get(sensorMatch[2]);
            if (!s || s.config.area !== sensorMatch[1]) return;
            try { this.engine.setEnabled(s.config.id, state.val); }
            finally { await this.put(local, s.enabled); }
            return;
        }
        const match = /^areas\.([a-z][a-z0-9_]*)\.(mode|silence|reset|silentAlarm)$/.exec(local);
        if (!match || !this.engine.areas.has(match[1])) return;
        const [, area, action] = match;
        if (action === 'silentAlarm') {
            try { this.engine.setSilentAlarm(area, state.val); }
            finally { await this.put(local, this.engine.areas.get(area).silentAlarm); }
            return;
        }
        if (action !== 'mode') {
            try {
                if (state.val === true) {
                    if (action === 'silence') await this.clearSirenArea(area);
                    else this.engine.reset(area);
                }
            } finally { await this.put(local, false); }
        } else {
            try { this.engine.command(area, state.val); await this.put('info.lastError', ''); }
            catch (error) { this.engine.publish(area); throw error; }
        }
    }
    async event(e) {
        if (e.type === 'status') {
            const values = { mode: e.mode, silentAlarm: e.silentAlarm, status: e.phase, alarm: e.alarm, tamper: e.tamper, ready: e.ready, reason: e.reason, blockedSensors: JSON.stringify(e.blocked), disabledSensors: JSON.stringify(e.disabled) };
            for (const [key, val] of Object.entries(values)) await this.put(`areas.${e.area}.${key}`, val);
            return;
        }
        if (e.type === 'sensor') {
            for (const [key, val] of Object.entries({ enable: e.enabled, status: e.status, tamper: e.tamper, fault: e.fault })) await this.put(`areas.${e.area}.sensors.${e.sensor}.${key}`, val);
            return;
        }
        if (e.type === 'clear') { await this.settle([this.clearSirenArea(e.area), ...(!e.sirensOnly && this.actuators ? [this.actuators.clear(e.area)] : [])]); return; }
        if (e.type === 'panicReset') { await this.put('panic.active', false); await this.settle([this.clearSirenArea('*'), ...(this.actuators ? [this.actuators.clear('*')] : [])]); }
        if (e.type === 'alarm') await this.put(`areas.${e.area}.lastAlarm`, JSON.stringify(e));
        if (e.type === 'panic') await this.put('panic.active', true);
        this.history.push(e); this.history = this.history.slice(-this.settings.historyLimit);
        await this.put('info.lastEvent', JSON.stringify(e)); await this.put('info.eventHistory', JSON.stringify(this.history));
        this.dispatchNotification(e);
        if (e.type === 'alarm' && this.engine.areas.get(e.area).alarm) {
            const actions = this.actuators ? [this.actuators.run(e)] : [];
            if (e.kind !== 'tamper' || this.settings.tamperSirens) actions.push(this.startSirens(e.area));
            await this.settle(actions);
        }
        if (e.type === 'panic' && this.engine.panicActive) {
            // Scene, sirens and notifications are independent of each other's failures.
            const actions = [this.activatePanicScene()];
            if (this.actuators) actions.push(this.actuators.run(e));
            if (this.settings.panicSirens) actions.push(this.startSirens('*'));
            const results = await Promise.allSettled(actions);
            const errors = results.filter(r => r.status === 'rejected');
            if (errors.length) throw new Error(errors.map(r => r.reason.message).join('; '));
        }
    }
    async settle(actions) {
        const results = await Promise.allSettled(actions);
        const errors = results.filter(r => r.status === 'rejected');
        if (errors.length) throw new Error(errors.map(r => r.reason.message).join('; '));
    }
    dispatchNotification(e) {
        this.notify(e).catch(error => this.enqueue(() => this.report(new Error(`Benachrichtigung fehlgeschlagen: ${error.message}`))));
    }
    async activatePanicScene() {
        const id = this.settings.panicSceneId;
        if (!id) { await this.put('panic.sceneStatus', 'not_configured'); return; }
        const result = { id, timestamp: new Date().toISOString() };
        try {
            const obj = await this.getForeignObjectAsync(id);
            // Scenes use 'mixed' to represent the additional state 'uncertain'.
            if (!obj || obj.type !== 'state' || !['boolean', 'mixed'].includes(obj.common?.type) || !obj.common.write) throw new Error('Panikszene benötigt einen schreibbaren scene-Datenpunkt vom Typ boolean oder mixed');
            if (obj.common.enabled !== true) throw new Error('Panikszene ist nicht aktiviert (common.enabled)');
            if (!/^system\.adapter\.scenes\.\d+$/.test(obj.common.engine)) throw new Error('Panikszene ist keiner gültigen scenes-Instanz zugeordnet');
            if (!Array.isArray(obj.native?.members) || !obj.native.members.length || obj.native.virtualGroup) throw new Error('Panikszene muss eine Szene mit Aktionen sein, keine leere Szene oder virtuelle Gruppe');
            const alive = await this.getForeignStateAsync(`${obj.common.engine}.alive`);
            if (active({ activeValue: 'true' }, alive) !== true) throw new Error(`Szenenadapter ${obj.common.engine} ist nicht erreichbar oder nicht gestartet`);
            // Always write a command, including when the scene already reports true.
            await this.setForeignStateAsync(id, { val: true, ack: false });
            result.status = 'requested'; result.engine = obj.common.engine;
            await this.put('panic.sceneStatus', 'requested');
            await this.put('panic.sceneLastResult', JSON.stringify(result));
        } catch (error) {
            result.status = 'error'; result.error = error.message;
            await this.put('panic.sceneStatus', 'error');
            await this.put('panic.sceneLastResult', JSON.stringify(result));
            throw new Error(`Panikszene ${id}: ${error.message}`);
        }
    }
    async startSirens(area) {
        if (area !== '*' && this.engine?.areas?.get(area)?.silentAlarm) return;
        for (const s of this.settings.sirens.filter(s => s.enabled && (area === '*' || s.area === '*' || s.area === area))) {
            const key = `${s.id}:${area}`; this.sounding.set(key, s.id);
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
            const on = [...this.sounding].some(([key, id]) => id === s.id && (key.endsWith(':*') || !this.engine?.areas?.get(key.split(':')[1])?.silentAlarm));
            await this.setForeignStateAsync(s.stateId, { val: s.inverted ? !on : on, ack: false });
        }));
        const errors = results.filter(r => r.status === 'rejected');
        if (errors.length) throw new Error(errors.map(e => e.reason.message).join('; '));
    }
    async notify(e, channel) {
        const c = this.settings, kind = e.kind || 'alarm';
        const urgent = ['alarm', 'tamper', 'panic'].includes(kind);
        if (!channel) {
            if (['armed', 'disarmed', 'reset', 'panicReset', 'silentChanged'].includes(kind) && !c.notifyModeChanges) return;
            if (kind === 'arming' && !c.notifyArming) return;
            if (kind === 'blocked' && !c.notifyBlocked) return;
            if (kind === 'sensorChanged' && !c.notifySensorChanges) return;
        }
        const text = render(c, e, this.namespace, this.engine ? [...this.engine.sensors.values()] : []);
        const jobs = [];
        if (c.telegramEnabled && channel !== 'phone') jobs.push({ name: 'Telegram', run: () => this.sendToAsync(c.telegramInstance, 'send', { text: text.telegram, ...(c.telegramUser ? { user: c.telegramUser } : {}) }) });
        if (c.asteriskEnabled && channel !== 'telegram' && (urgent || channel === 'phone')) {
            const numbers = new Set();
            for (const r of c.recipients.filter(r => r.enabled && (e.area === '*' || r.area === '*' || r.area === e.area))) {
                const number = r.number.replace(/[ ()/-]/g, '');
                if (numbers.has(number)) continue;
                numbers.add(number);
                jobs.push({ name: `Telefonempfänger ${r.id}`, run: () => this.sendToAsync(c.asteriskInstance, 'dial', { telnr: number, text: text.phone }) });
            }
        }
        if (channel && !jobs.length) throw new Error(channel === 'telegram' ? 'Telegram ist nicht aktiviert' : 'Telefonie ist deaktiviert oder es gibt keine aktivierten Telefonnummern');
        const results = await Promise.allSettled(jobs.map(job => this.withTimeout(job.run, job.name, channel || urgent ? 120000 : 15000)));
        const errors = results.flatMap((r, i) => r.status === 'rejected' ? [`${jobs[i].name}: ${r.reason.message}`] : r.value?.error ? [`${jobs[i].name}: ${r.value.error}`] : []);
        if (errors.length) throw new Error(errors.join('; '));
        return jobs.length;
    }
    async withTimeout(run, name, ms) {
        let timer;
        try { return await Promise.race([Promise.resolve().then(run), new Promise((_, reject) => { timer = this.setTimeout(() => reject(new Error(`${name}: keine Bestätigung innerhalb ${ms / 1000}s`)), ms); })]); }
        finally { this.clearTimeout(timer); }
    }
    async message(message) {
        if (!message?.callback || !['testTelegram', 'testPhone'].includes(message.command)) return;
        let response;
        try {
            if (!this.initialized || this.stopping) throw new Error('Adapter ist nicht bereit. Einstellungen zuerst speichern.');
            const command = message.command;
            if (this.testsRunning.has(command) || Date.now() - (this.testTimes.get(command) || 0) < 10000) throw new Error('Test läuft bereits oder wurde vor weniger als 10 Sekunden gestartet');
            this.testsRunning.add(command); this.testTimes.set(command, Date.now());
            try {
                const count = await this.notify({ kind: 'test', area: '*', state: 'normal', timestamp: Date.now() }, command === 'testTelegram' ? 'telegram' : 'phone');
                const text = `Test an ${count} Empfänger/Kanal angefordert. Zustellung bzw. Gespräch bitte am Endgerät prüfen.`;
                await this.put('info.testResult', text); response = { result: text };
            } finally { this.testsRunning.delete(command); }
        } catch (error) { response = { error: error.message }; await this.put('info.testResult', error.message); }
        this.sendTo(message.from, message.command, response, message.callback);
    }
    unload(callback) {
        this.stopping = true; this.initialized = false;
        if (this.engine) this.engine.close();
        for (const timer of this.sirenTimers.values()) this.clearTimeout(timer);
        this.queue.then(async () => {
            this.sounding.clear(); await this.settle([...(this.settings ? [this.writeSirens()] : []), ...(this.actuators ? [this.actuators.clear()] : [])]);
            await this.put('info.connection', false);
        }).catch(e => this.log.error(e.message)).finally(callback);
    }
}

if (module.parent) module.exports = options => new AlarmControl(options);
else new AlarmControl();
