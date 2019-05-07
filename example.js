var x = new (require("./xpapi.js"))({
    apiPath:     "/api*",
    apiMulti:     true,
    corsOrigins:  ['*'],
    dependencies: "./examples/dependencies.js",
    genDocsPath:  "/docs",
    genLibPath:   "/lib",
    handlerDir:   "./examples/handlers",
    name:         "Example",
    pluginDir:    "./examples/plugins",
    verbosity:    3,
});
