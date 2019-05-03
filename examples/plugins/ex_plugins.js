// Test plugin module ----------------------------------------------------------

function dummy(req, res, next) {
    req.dummy = "If you can read this, it works.";
    return next();
}

module.exports = { pre: [dummy] };
