// Test plugin module ----------------------------------------------------------

function dummy(req, res, next) {
    req.dummy = "If you can read this, it works.";
    return next();
}

function kludger(options, handler) {
    if(handler.$deps !== undefined) {
        handler.func = handler.func.bind({ test: console.log });
    }
}

module.exports = { pre: [dummy], handler: [kludger] };
