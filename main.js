"use strict";

const utils = require("@iobroker/adapter-core");

class AlarmControl extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: "alarm-control" });
        this.detectors = [];
        this.groups = [];
        this.areas = [];
        this.actions = [];
        this.detectorByState = new Map();
        this.pendingDetectorTimers = new Map();
        this.actionTimers = new Set();
        this.activeAlarm = null;
        this.mode = "disarmed";
        this.exitDelayUntil = 0;
        this.entryDelayUntil = 0;
        this.entryTimer = null;
        this.sirenTimer = null;
        this.history = [];
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    parseConfigArray(value, name) {
        try {
            const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            this.log.error(`Konfiguration "${name}" ist kein gültiges JSON: ${error.message}`);
            return [];
        }
    }

    async onReady() {
        this.detectors = this.parseConfigArray(this.config.detectors, "Melder").filter(x => x && x.enabled !== false && x.id && x.stateId);
        this.groups = this.parseConfigArray(this.config.groups, "Meldegruppen").filter(x => x && x.enabled !== false && x.id);
        this.areas = this.parseConfigArray(this.config.areas, "Sicherungsbereiche").filter(x => x && x.enabled !== false && x.id);
        this.actions = this.parseConfigArray(this.config.actions, "Aktionen").filter(x => x && x.enabled !== false && x.id);

        await this.createObjects();
        await this.loadPersistentState();
        await this.rebuildSubscriptions();
        await this.setStateAsync("info.connection", true, true);
        await this.setStateAsync("status.ready", true, true);
        await this.updateStatus();
        this.log.info(`Alarm Control gestartet: ${this.detectors.length} Melder, ${this.groups.length} Meldegruppen, ${this.areas.length} Sicherungsbereiche.`);
    }

    async createObjects() {
        const defs = [
            ["info.connection", "Verbindung", "boolean", "indicator.connected", false],
            ["status.ready", "Bereit", "boolean", "indicator", false],
            ["status.mode", "Alarmmodus", "string", "text", false],
            ["status.modeText", "Alarmmodus Text", "string", "text", false],
            ["status.armed", "Scharf", "boolean", "indicator", false],
            ["status.alarm", "Alarm aktiv", "boolean", "indicator.alarm", false],
            ["status.alarmArea", "Alarmbereich", "string", "text", false],
            ["status.alarmGroup", "Meldegruppe", "string", "text", false],
            ["status.alarmDetector", "Auslösender Melder", "string", "text", false],
            ["status.alarmTime", "Alarmzeit", "string", "date", false],
            ["status.entryDelayActive", "Eintrittsverzögerung", "boolean", "indicator", false],
            ["status.exitDelayActive", "Austrittsverzögerung", "boolean", "indicator", false],
            ["status.openDetectors", "Offene Melder", "string", "json", false],
            ["status.bypassedDetectors", "Umgangene Melder", "string", "json", false],
            ["status.lastEvent", "Letztes Ereignis", "string", "text", false],
            ["status.lastError", "Letzter Fehler", "string", "text", false],
            ["status.history", "Alarmhistorie", "string", "json", false],
            ["status.presence", "Anwesenheit", "string", "text", false],
            ["control.armInternal", "Intern scharf", "boolean", "button", true],
            ["control.armExternal", "Extern scharf", "boolean", "button", true],
            ["control.armVacation", "Urlaub scharf", "boolean", "button", true],
            ["control.disarm", "Unscharf", "boolean", "button", true],
            ["control.acknowledge", "Alarm quittieren", "boolean", "button", true],
            ["control.reset", "Alarm zurücksetzen", "boolean", "button", true],
            ["control.panic", "Panikalarm", "boolean", "button", true],
            ["control.testAlarm", "Testalarm", "boolean", "button", true],
            ["control.silenceSiren", "Sirene ausschalten", "boolean", "button", true]
        ];
        for (const [id, name, type, role, write] of defs) {
            await this.setObjectNotExistsAsync(id, {
                type: "state",
                common: { name, type, role, read: true, write, def: type === "boolean" ? false : "" },
                native: {}
            });
        }
    }

    async loadPersistentState() {
        const oldMode = await this.getStateAsync("status.mode");
        if (this.config.restoreModeAfterRestart && oldMode && ["disarmed", "internal", "external", "vacation"].includes(oldMode.val)) {
            this.mode = oldMode.val;
        }
        const historyState = await this.getStateAsync("status.history");
        try { this.history = JSON.parse(historyState?.val || "[]"); } catch { this.history = []; }
    }

    async rebuildSubscriptions() {
        this.unsubscribeForeignStates("*");
        this.subscribeStates("control.*");
        this.detectorByState.clear();
        for (const detector of this.detectors) {
            const list = this.detectorByState.get(detector.stateId) || [];
            list.push(detector);
            this.detectorByState.set(detector.stateId, list);
            this.subscribeForeignStates(detector.stateId);
        }
        if (this.config.residentsEnabled && this.config.residentsStateId) {
            this.subscribeForeignStates(this.config.residentsStateId);
            const state = await this.getForeignStateAsync(this.config.residentsStateId);
            if (state) await this.handleResidents(state.val);
        }
    }

    async onStateChange(id, state) {
        if (!state) return;
        if (id.startsWith(`${this.namespace}.control.`) && !state.ack && state.val === true) {
            const command = id.split(".").pop();
            await this.setStateAsync(`control.${command}`, false, true);
            await this.handleCommand(command);
            return;
        }
        if (id === this.config.residentsStateId) {
            await this.handleResidents(state.val);
            return;
        }
        const detectors = this.detectorByState.get(id);
        if (!detectors) return;
        for (const detector of detectors) await this.evaluateDetector(detector, state);
        await this.updateOpenDetectors();
    }

    async handleCommand(command) {
        switch (command) {
            case "armInternal": return this.arm("internal");
            case "armExternal": return this.arm("external");
            case "armVacation": return this.arm("vacation");
            case "disarm": return this.disarm("Manuell unscharf");
            case "acknowledge": return this.acknowledge();
            case "reset": return this.resetAlarm();
            case "panic": return this.triggerAlarm({ name: "Panikalarm", id: "panic" }, null, null, true);
            case "testAlarm": return this.triggerAlarm({ name: "Testalarm", id: "test" }, null, null, true, true);
            case "silenceSiren": return this.silenceSiren();
        }
    }

    valueInList(value, csv) {
        const normalized = String(value).toLowerCase();
        return String(csv || "").split(",").map(x => x.trim().toLowerCase()).includes(normalized);
    }

    async handleResidents(value) {
        let presence = "unknown";
        if (this.valueInList(value, this.config.residentsHomeValues)) presence = "home";
        else if (this.valueInList(value, this.config.residentsVacationValues)) presence = "vacation";
        else if (this.valueInList(value, this.config.residentsAwayValues)) presence = "away";
        await this.setStateAsync("status.presence", presence, true);

        if (presence === "home" && this.config.autoDisarmHome) await this.disarm("Residents: anwesend");
        if (presence === "away" && this.config.autoArmAway && this.mode === "disarmed") await this.arm("external", "Residents: abwesend");
        if (presence === "vacation" && this.config.autoArmVacation && this.mode !== "vacation") await this.arm("vacation", "Residents: länger abwesend");
    }

    groupsForMode(mode) {
        const ids = new Set();
        for (const area of this.areas) {
            const modes = Array.isArray(area.modes) ? area.modes : String(area.modes || "").split(",").map(x => x.trim());
            if (modes.includes(mode)) {
                for (const id of (area.groupIds || [])) ids.add(id);
            }
        }
        return ids;
    }

    async arm(mode, reason = "Manuell scharf") {
        const open = await this.getOpenDetectors(mode);
        const blocking = open.filter(x => (x.armBehavior || "block") === "block");
        if (blocking.length) {
            const text = `Scharfschaltung verhindert. Offen: ${blocking.map(x => x.name).join(", ")}`;
            await this.setError(text);
            await this.addHistory("arm_failed", text);
            return;
        }
        this.mode = mode;
        const delay = Math.max(0, Number(this.config.defaultExitDelay) || 0);
        this.exitDelayUntil = Date.now() + delay * 1000;
        await this.setStateAsync("status.exitDelayActive", delay > 0, true);
        await this.addHistory("armed", `${reason}: ${mode}`);
        await this.updateStatus();
        if (delay > 0) {
            const timer = this.setTimeout(async () => {
                this.exitDelayUntil = 0;
                await this.setStateAsync("status.exitDelayActive", false, true);
                await this.updateStatus();
            }, delay * 1000);
            this.actionTimers.add(timer);
        }
    }

    async disarm(reason = "Unscharf") {
        this.mode = "disarmed";
        this.exitDelayUntil = 0;
        this.cancelEntryDelay();
        await this.silenceSiren();
        await this.setStateAsync("status.exitDelayActive", false, true);
        await this.addHistory("disarmed", reason);
        await this.updateStatus();
    }

    isDetectorArmed(detector) {
        if (this.mode === "disarmed") return detector.alwaysActive === true;
        if (Date.now() < this.exitDelayUntil) return false;
        const activeGroups = this.groupsForMode(this.mode);
        return activeGroups.has(detector.groupId);
    }

    compare(value, detector) {
        const expected = detector.value;
        switch (detector.condition || "true") {
            case "true": return value === true || value === 1 || value === "true";
            case "false": return value === false || value === 0 || value === "false";
            case "eq": return String(value) === String(expected);
            case "neq": return String(value) !== String(expected);
            case "gt": return Number(value) > Number(expected);
            case "lt": return Number(value) < Number(expected);
            case "between": return Number(value) >= Number(detector.min) && Number(value) <= Number(detector.max);
            case "contains": return String(value).includes(String(expected));
            case "regex":
                try { return new RegExp(String(expected)).test(String(value)); } catch { return false; }
            default: return Boolean(value);
        }
    }

    async evaluateDetector(detector, state) {
        if (!this.isDetectorArmed(detector) || !this.compare(state.val, detector)) {
            const timer = this.pendingDetectorTimers.get(detector.id);
            if (timer) this.clearTimeout(timer);
            this.pendingDetectorTimers.delete(detector.id);
            return;
        }
        const delay = Math.max(0, Number(detector.triggerDelaySeconds) || 0);
        if (delay && !this.pendingDetectorTimers.has(detector.id)) {
            const timer = this.setTimeout(async () => {
                this.pendingDetectorTimers.delete(detector.id);
                const current = await this.getForeignStateAsync(detector.stateId);
                if (current && this.compare(current.val, detector) && this.isDetectorArmed(detector)) {
                    await this.processDetectorAlarm(detector, current.val);
                }
            }, delay * 1000);
            this.pendingDetectorTimers.set(detector.id, timer);
        } else if (!delay) {
            await this.processDetectorAlarm(detector, state.val);
        }
    }

    async processDetectorAlarm(detector, value) {
        if (this.activeAlarm && detector.retrigger !== true) return;
        const group = this.groups.find(x => x.id === detector.groupId);
        const area = this.areas.find(x => (x.groupIds || []).includes(detector.groupId) && (Array.isArray(x.modes) ? x.modes : String(x.modes || "").split(",")).includes(this.mode));
        if (detector.entryDelayed === true && !this.activeAlarm) {
            return this.startEntryDelay(detector, group, area, value);
        }
        await this.triggerAlarm(detector, group, area, false, false, value);
    }

    async startEntryDelay(detector, group, area, value) {
        if (this.entryTimer) return;
        const seconds = Math.max(0, Number(detector.entryDelaySeconds) || Number(this.config.defaultEntryDelay) || 0);
        if (!seconds) return this.triggerAlarm(detector, group, area, false, false, value);
        this.entryDelayUntil = Date.now() + seconds * 1000;
        await this.setStateAsync("status.entryDelayActive", true, true);
        await this.addHistory("entry_delay", `${detector.name}: ${seconds} Sekunden`);
        this.entryTimer = this.setTimeout(async () => {
            this.entryTimer = null;
            this.entryDelayUntil = 0;
            await this.setStateAsync("status.entryDelayActive", false, true);
            if (this.mode !== "disarmed") await this.triggerAlarm(detector, group, area, false, false, value);
        }, seconds * 1000);
    }

    cancelEntryDelay() {
        if (this.entryTimer) this.clearTimeout(this.entryTimer);
        this.entryTimer = null;
        this.entryDelayUntil = 0;
        this.setState("status.entryDelayActive", false, true);
    }

    async triggerAlarm(detector, group, area, force = false, test = false, value = null) {
        if (!force && !this.isDetectorArmed(detector)) return;
        const now = new Date();
        this.activeAlarm = {
            detectorId: detector.id,
            detectorName: detector.name || detector.id,
            groupId: group?.id || "",
            groupName: group?.name || "",
            areaId: area?.id || "",
            areaName: area?.name || "",
            mode: this.mode,
            value,
            test,
            time: now.toISOString()
        };
        await this.setStateAsync("status.alarm", true, true);
        await this.setStateAsync("status.alarmArea", this.activeAlarm.areaName, true);
        await this.setStateAsync("status.alarmGroup", this.activeAlarm.groupName, true);
        await this.setStateAsync("status.alarmDetector", this.activeAlarm.detectorName, true);
        await this.setStateAsync("status.alarmTime", this.activeAlarm.time, true);
        await this.addHistory(test ? "test_alarm" : "alarm", `${this.activeAlarm.detectorName}${this.activeAlarm.areaName ? ` / ${this.activeAlarm.areaName}` : ""}`);
        await this.executeAlarmActions(area, group, detector, test);
        await this.updateStatus();
    }

    actionIdsFor(area, group) {
        const ids = new Set();
        for (const id of (area?.actionIds || [])) ids.add(id);
        for (const id of (group?.actionIds || [])) ids.add(id);
        return [...ids];
    }

    async executeAlarmActions(area, group, detector, test) {
        let ids = this.actionIdsFor(area, group);
        if (!ids.length && (detector.id === "panic" || detector.id === "test")) ids = this.actions.map(x => x.id);
        for (const id of ids) {
            const action = this.actions.find(x => x.id === id);
            if (!action || (!test && action.testOnly)) continue;
            const delay = Math.max(0, Number(action.delaySeconds) || 0);
            if (delay) {
                const timer = this.setTimeout(() => this.executeAction(action), delay * 1000);
                this.actionTimers.add(timer);
            } else await this.executeAction(action);
        }
    }

    replacePlaceholders(text) {
        const a = this.activeAlarm || {};
        const values = {
            detector: a.detectorName || "",
            group: a.groupName || "",
            area: a.areaName || "",
            mode: a.mode || this.mode,
            time: a.time || new Date().toISOString(),
            value: a.value == null ? "" : String(a.value)
        };
        return String(text || "").replace(/\{(detector|group|area|mode|time|value)\}/g, (_, key) => values[key]);
    }

    castValue(value, type) {
        if (type === "boolean") return value === true || String(value).toLowerCase() === "true" || String(value) === "1";
        if (type === "number") return Number(value);
        if (type === "json") {
            try { return JSON.parse(value); } catch { return value; }
        }
        return value;
    }

    async executeAction(action) {
        try {
            if (action.type === "telegram") {
                const instance = action.instance || this.config.telegramInstance;
                const payload = { text: this.replacePlaceholders(action.text || "ALARM: {detector} / {area}") };
                const user = action.user || this.config.telegramUser;
                if (user) payload.user = user;
                this.sendTo(instance, "send", payload);
            } else if (action.type === "asterisk") {
                if ((action.asteriskMode || this.config.asteriskMode) === "sendTo") {
                    let payload;
                    try { payload = JSON.parse(this.replacePlaceholders(action.payload || this.config.asteriskPayload)); }
                    catch { payload = this.replacePlaceholders(action.payload || this.config.asteriskPayload); }
                    this.sendTo(action.instance || this.config.asteriskInstance, action.command || this.config.asteriskCommand || "call", payload);
                } else {
                    const stateId = action.stateId || this.config.asteriskStateId;
                    if (!stateId) throw new Error("Kein Asterisk-Datenpunkt konfiguriert");
                    await this.setForeignStateAsync(stateId, this.castValue(this.replacePlaceholders(action.value ?? "true"), action.valueType || "boolean"), false);
                }
            } else if (["state", "siren", "light", "scene"].includes(action.type)) {
                if (!action.stateId) throw new Error(`Kein Datenpunkt für Aktion ${action.name || action.id}`);
                await this.setForeignStateAsync(action.stateId, this.castValue(this.replacePlaceholders(action.value ?? "true"), action.valueType || "boolean"), false);
                const offSeconds = action.type === "siren"
                    ? Math.min(Number(action.offAfterSeconds) || Number(this.config.maxSirenSeconds) || 180, Number(this.config.maxSirenSeconds) || 180)
                    : Number(action.offAfterSeconds) || 0;
                if (offSeconds > 0) {
                    const timer = this.setTimeout(async () => {
                        await this.setForeignStateAsync(action.stateId, this.castValue(action.offValue ?? "false", action.valueType || "boolean"), false);
                    }, offSeconds * 1000);
                    this.actionTimers.add(timer);
                    if (action.type === "siren") this.sirenTimer = timer;
                }
            }
            await this.addHistory("action", action.name || action.id);
        } catch (error) {
            await this.setError(`Aktion ${action.name || action.id}: ${error.message}`);
        }
    }

    async silenceSiren() {
        if (this.sirenTimer) this.clearTimeout(this.sirenTimer);
        this.sirenTimer = null;
        for (const action of this.actions.filter(x => x.type === "siren" && x.stateId)) {
            try {
                await this.setForeignStateAsync(action.stateId, this.castValue(action.offValue ?? "false", action.valueType || "boolean"), false);
            } catch (error) {
                await this.setError(`Sirene ausschalten: ${error.message}`);
            }
        }
    }

    async acknowledge() {
        if (!this.activeAlarm) return;
        await this.addHistory("acknowledged", this.activeAlarm.detectorName);
        await this.silenceSiren();
    }

    async resetAlarm() {
        await this.silenceSiren();
        this.activeAlarm = null;
        await this.setStateAsync("status.alarm", false, true);
        await this.setStateAsync("status.alarmArea", "", true);
        await this.setStateAsync("status.alarmGroup", "", true);
        await this.setStateAsync("status.alarmDetector", "", true);
        await this.addHistory("reset", "Alarm zurückgesetzt");
        await this.updateStatus();
    }

    async getOpenDetectors(mode = this.mode) {
        const activeGroups = this.groupsForMode(mode);
        const result = [];
        for (const detector of this.detectors) {
            if (!activeGroups.has(detector.groupId) && !detector.alwaysActive) continue;
            const state = await this.getForeignStateAsync(detector.stateId);
            if (state && this.compare(state.val, detector)) result.push(detector);
        }
        return result;
    }

    async updateOpenDetectors() {
        const open = await this.getOpenDetectors(this.mode === "disarmed" ? "external" : this.mode);
        await this.setStateAsync("status.openDetectors", JSON.stringify(open.map(x => ({ id: x.id, name: x.name, stateId: x.stateId }))), true);
        await this.setStateAsync("status.bypassedDetectors", JSON.stringify(open.filter(x => x.armBehavior === "bypass").map(x => ({ id: x.id, name: x.name }))), true);
    }

    modeText() {
        return ({disarmed:"Unscharf", internal:"Intern scharf", external:"Extern scharf", vacation:"Urlaub", alarm:"Alarm"})[this.activeAlarm ? "alarm" : this.mode] || this.mode;
    }

    async updateStatus() {
        await this.setStateAsync("status.mode", this.mode, true);
        await this.setStateAsync("status.modeText", this.modeText(), true);
        await this.setStateAsync("status.armed", this.mode !== "disarmed", true);
        await this.setStateAsync("status.alarm", Boolean(this.activeAlarm), true);
        await this.updateOpenDetectors();
    }

    async addHistory(type, message) {
        const item = { time: new Date().toISOString(), type, message };
        this.history.unshift(item);
        this.history = this.history.slice(0, Math.max(10, Number(this.config.historyLimit) || 100));
        await this.setStateAsync("status.history", JSON.stringify(this.history), true);
        await this.setStateAsync("status.lastEvent", `${item.time} | ${type} | ${message}`, true);
    }

    async setError(message) {
        this.log.warn(message);
        await this.setStateAsync("status.lastError", message, true);
        await this.addHistory("error", message);
    }

    onUnload(callback) {
        try {
            for (const timer of this.pendingDetectorTimers.values()) this.clearTimeout(timer);
            for (const timer of this.actionTimers) this.clearTimeout(timer);
            if (this.entryTimer) this.clearTimeout(this.entryTimer);
            if (this.sirenTimer) this.clearTimeout(this.sirenTimer);
            this.setState("info.connection", false, true);
            this.setState("status.ready", false, true);
            callback();
        } catch {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = options => new AlarmControl(options);
} else {
    new AlarmControl();
}
