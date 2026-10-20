'use strict';
class Actuators {
    constructor(adapter, rows) { this.adapter = adapter; this.rows = rows; this.demands = new Map(); this.timers = new Map(); }
    async write(row, on) {
        const obj = await this.adapter.getForeignObjectAsync(row.stateId);
        if (!obj || obj.type !== 'state' || !obj.common?.write) throw new Error(`${row.id}: Aktor nicht schreibbar`);
        if (row.kind === 'scene') {
            if (!['mixed', 'boolean'].includes(obj.common.type) || obj.common.enabled !== true || !/^system\.adapter\.scenes\.\d+$/.test(obj.common.engine) || !obj.native?.members?.length || obj.native.virtualGroup) throw new Error(`${row.id}: aktive Szene mit Aktionen erforderlich`);
            const alive = await this.adapter.getForeignStateAsync(`${obj.common.engine}.alive`);
            if (alive?.val !== true || alive.q) throw new Error(`${row.id}: Szenenadapter nicht gestartet`);
            if (on) await this.adapter.setForeignStateAsync(row.stateId, { val: true, ack: false });
        } else {
            if (obj.common.type !== 'boolean') throw new Error(`${row.id}: boolescher Schaltausgang erforderlich`);
            await this.adapter.setForeignStateAsync(row.stateId, { val: row.inverted ? !on : on, ack: false });
        }
    }
    async run(event) {
        const flag = { alarm: 'onAlarm', tamper: 'onTamper', panic: 'onPanic' }[event.kind];
        if (!flag) return;
        this.check(await Promise.allSettled(this.rows.filter(r => r.enabled && r[flag] && (event.area === '*' || r.area === '*' || r.area === event.area)).map(async row => {
            if (row.kind === 'scene') return this.write(row, true);
            const key = `${row.id}:${event.area}`; this.demands.set(key, row.id);
            if (this.timers.has(key)) this.adapter.clearTimeout(this.timers.get(key));
            if (row.durationSeconds > 0) this.timers.set(key, this.adapter.setTimeout(() => this.adapter.enqueue(async () => {
                this.timers.delete(key); this.demands.delete(key);
                await this.write(row, [...this.demands.values()].includes(row.id));
            }), row.durationSeconds * 1000));
            await this.write(row, true);
        })));
    }
    check(results) {
        const errors = results.filter(r => r.status === 'rejected');
        if (errors.length) throw new Error(errors.map(r => r.reason.message).join('; '));
    }
    async clear(area) {
        const affected = new Set();
        for (const [key, id] of this.demands) if (area === undefined || key.endsWith(`:${area}`)) {
            affected.add(id); this.demands.delete(key);
            if (this.timers.has(key)) this.adapter.clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        }
        this.check(await Promise.allSettled(this.rows.filter(r => affected.has(r.id)).map(r => this.write(r, [...this.demands.values()].includes(r.id)))));
    }
}
module.exports = { Actuators };
