var x = new (require("./xapi.js"))({
    corsOrigins: ['*'],
    dependencies: "./dependencies.js",
    genDocsPath: "/docs",
    genLibPath: "/lib",
    handlerDir: "./handlers",
    name: "Example",
    verbosity: 3,
});
