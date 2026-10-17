'use strict';

const modes = ['update', 'true', 'false', 'rising', 'falling'];

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

function canReset(mode, current) {
    // Event-driven buttons need no return to idle; a fresh event is required to trigger again.
    if (['update', 'true', 'false'].includes(mode)) return true;
    return mode === 'rising' ? current === false : mode === 'falling' && current === true;
}

module.exports = { modes, value, triggered, canReset };
