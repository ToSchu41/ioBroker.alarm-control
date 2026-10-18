'use strict';

const { modes, value, triggered } = require('./triggers');

function canReset(mode, current) {
    // Event-driven buttons need no return to idle; a fresh event is required to trigger again.
    if (['update', 'true', 'false'].includes(mode)) return true;
    return mode === 'rising' ? current === false : mode === 'falling' && current === true;
}

module.exports = { modes, value, triggered, canReset };
