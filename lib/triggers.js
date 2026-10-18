'use strict';

const modes = ['update', 'true', 'false', 'rising', 'falling'];
const sensorModes = modes.filter(mode => mode !== 'update');

function value(state) {
    if (!state || state.q || ![true, false, 0, 1].includes(state.val)) return null;
    return state.val === true || state.val === 1;
}

function triggered(mode, previous, current) {
    if (current === null) return false;
    if (mode === 'update') return true;
    if (mode === 'true') return current === true;
    if (mode === 'false') return current === false;
    if (mode === 'rising') return previous === false && current === true;
    if (mode === 'falling') return previous === true && current === false;
    return false;
}

function active(mode, current) {
    if (current === null) return null;
    return ['false', 'falling'].includes(mode) ? !current : current;
}

module.exports = { modes, sensorModes, value, triggered, active };
