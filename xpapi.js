//##############################################################################
// A simple but capable web API-only framework.
//##############################################################################


//==============================================================================
// The xpapi class is where most of the action happens.
//==============================================================================

class xpapi {

    /* FUNC */ constructor(options) {

        // Set up required modules ---------------------------------------------

        this.ac        = require("ansi-colors");
        this.fs        = require("fs");
        this.monocle   = require("monocle")();
        this.restify   = require("restify");
        this.errors    = require("restify-errors");
        this.cors      = require("restify-cors-middleware");
        this.cookies   = require("restify-cookies");
        this.os        = require("os");
        this.util      = require("util");

        this.sep       = require("path").sep;

        this.version   = "1.2.0";

        this.server    = null;
        this.handlers  = { };
        this.subPaths  = { };

        this.genval     = genval;

        this.config    = {
            apiPath:       "/api",
            apiPort:       8080,
            apiMulti:      false,
            autoload:      true,         // load from handlers automatically
            autoreload:    true,         // reload handlers when changed
            corsOrigins:   false,
            cssUrl:        false,
            dependencies:  false,        // specifies config file mapping sets of dependencies to commands
            genDocsPath:   false,
            handlerDir:    "./handlers",
            handlerFiles:  [ ],
            logger:        null,
            maxBodySize:   2 * 1024 * 1024,
            name:          "Unnamed",
            pluginDir:     "./plugins",
            pluginFiles:   [ ],
            production:    false,
            sessionName:   "xpapiSession",
            uploadDir:     this.os.tmpdir(),
            verbosity:     1,     // 0 = quiet, 1 = warnings, 2 = info, 3 = debug
        };

        // Apply configuration -------------------------------------------------

        if(options !== undefined) {
            for(var k in options) {
                if(this.config[k] === undefined) {
                    this.error("warn", "User defined config key \"" + k + "\" added. Is this what you mean?", "xpapi.main");
                }
                this.config[k] = options[k];
            }
        }

        this.config.handlerDir = this.fs.realpathSync(this.config.handlerDir);
        this.config.pluginDir  = this.fs.realpathSync(this.config.pluginDir);

        if(this.config.verbosity > 0)
            this.outputHeader("Xpapi v" + this.version + " Sane web API engine");

        // Import dependencies for injection if specified ----------------------

        if(this.config.dependencies) {
            this.config.dependencies = require(this.config.dependencies);
        }

        // Prepare handlers and plugins ----------------------------------------

        this.loadHandlers();
        this.initHandlers();

        // Initialize restify --------------------------------------------------

        try {
            this.server = this.restify.createServer({
                strictFormatters: false
            });

            if(this.config.corsOrigins) {
                var corsObj = this.cors({ origins: this.config.corsOrigins });
                this.server.pre(corsObj.preflight);
                this.server.use(corsObj.actual);
            }

            this.loadPlugins();

            this.server.use(this.cookies.parse);
            this.server.use(this.restify.plugins.gzipResponse());

            this.server.use(this.restify.plugins.bodyParser({
                maxBodySize:      this.config.maxBodySize,
                mapParams:        true,
                mapFiles:         true,
                overrideParams:   true,
                uploadDir:        this.config.uploadDir,
                keepExtensions:   false,
                multiples:        true,
                hash:             'sha1',
                rejectUnknown:    true,
                requestBodyOnGet: false,
                maxFieldsSize:    this.config.maxBodySize
            }));

            this.server.use(uploadHandler());

            this.server.listen(this.config.apiPort);

            var modHandler = this.dispatcher.bind(this);
            this.server.post(this.config.apiPath, modHandler);

            if(this.config.genDocsPath) {
                var docsHandler = this.documentation.bind(this);
                this.server.get(this.config.genDocsPath, docsHandler);
            }

        } catch(e) {
            this.error("fatal", "Unable to initialize Restify.", "xpapi.constructor");
        }

        // Set up handler dir watcher if configured ----------------------------

        if(this.config.autoload) {
            var listener = this.loadChangedHandler.bind(this);

            this.monocle.watchDirectory({
                root: this.config.handlerDir,
                listener: listener,
                complete: function() { console.log("Handler autoloading enabled."); }
            });
        }

        this.error("info", "Server has been initialized and is listening to "
            + this.config.apiPath + " on port " + this.config.apiPort + ".",
            "xpapi.constructor");

    }


    //--------------------------------------------------------------------------
    // The dispatcher method is what takes inbound requests, figures out which
    // handlers should deal with them, and shovels data into and out of them.
    //--------------------------------------------------------------------------

    /* FUNC */ dispatcher(req, res, next) {

        // TODO: handle sessions

        // Check for the xpapi request ------------------------------------------

        if(req.params === undefined)
            return this.fling(res, next, 406, "Missing req.params object");

        // Verify required elements and set parameters, if any -----------------

        if(req.params === undefined || typeof req.params != "object"
            || req.params.cmds === undefined || !Array.isArray(req.params.cmds))
            return this.fling(res, next, 406, "Malformed xpapi object");

        var xreq = req.params;

        //----------------------------------------------------------------------
        // The bulk of the work happens here. We loop through xreq.commands and
        // verify that the commands exist, then we validate their arguments. It
        // is important to note that this happens before command execution, and
        // any error results in the rejection of the whole batch.
        //----------------------------------------------------------------------

        for(var c = 0; c < xreq.cmds.length; c++) {

            // Make sure the element has a cmd member --------------------------

            if(xreq.cmds[c].cmd === undefined)
                return this.fling(res, next, 406, "Missing cmd array");

            // Make twiddle the names for apiMulti support ---------------------

            if(this.config.apiMulti)
                xreq.cmds[c].cmd = xreq["*"] + "/" + xreq.cmds[c].cmd;

            var cmd = xreq.cmds[c];

            // Make sure the cmd exists ----------------------------------------

            if(this.handlers[cmd.cmd] === undefined) {
                return this.fling(res, next, 406, "Undefined cmd");
            }

            var def = this.handlers[cmd.cmd];

            // Check for presence of args if required --------------------------

            if(cmd.args === undefined && def.args !== null)
                return this.fling(res, next, 406, "Missing args");

            // Now validate the args, if any -----------------------------------

            for(var arg in def.args) {
                if(def.args[arg] === undefined)
                    return this.fling(res, next, 406, "Unrecognized arg");
                if(def.args[arg].required && cmd.args[arg] === undefined)
                    return this.fling(res, next, 406, "Missing required cmd arg");
                var failed = this.validateCommandArgs(cmd, def);
                if(failed) {
                    return this.fling(res, next, 406, "Invalid arg: " + def.args[arg].errmsg);
                }
            }

        }

        // Finally, execute the commands and return the result -----------------

        var response = {
            cmdCnt:  xreq.cmds.length,
            worked:  0,
            failed:  0,
            aborted: xreq.cmds.length,
            results: [ ]
        };

        for(var c = 0; c < xreq.cmds.length; c++) {
            var cmd = xreq.cmds[c];
            var def = this.handlers[cmd.cmd];

            if(xreq.params && xreq.params.benchmark) {
                var startFunc = new Date();
            }

            if(this.config.dependencies && this.config.dependencies[cmd.cmd]) {
                var result = def.func(req, xreq.cmds[c].args, this.config.dependencies[cmd.cmd]);
            } else {
                var result = def.func(req, xreq.cmds[c].args);
            }

            if(xreq.params && xreq.params.benchmark) {
                var endFunc = new Date();
                result.execTime = endFunc.getTime() - startFunc.getTime();
            }

            if(xreq.cmds[c].id !== undefined)
                result.id = xreq.cmds[c].id;
            response.aborted--;
            if(result.errcode !== undefined || result.errmsg != undefined) {
                response.failed++;
                if(xreq.params && !xreq.params.ignoreErrors)
                    break;
            } else {
                response.worked++;
                if(result.cookies) {
                    for(var ck = 0; ck < result.cookies.length; ck++) {
                        res.setHeader("Set-Cookie", result.cookies[ck]);
                    }
                    delete result.cookies;
                }
            }
            response.results.push(result);
        }

        res.send(response);

        next();
    }

    //--------------------------------------------------------------------------
    // Command argument validation loop.
    //--------------------------------------------------------------------------

    /* FUNC */ validateCommandArgs(cmd, def) {
        for(var arg in cmd.args) {
            if(def.args[arg].valid === undefined || def.args[arg].valid === null)
                return false;
            try {
                cmd.args[arg] = this.validate(cmd.args[arg], def.args[arg].valid);
            } catch(e) {
                return true;
            }
        }
        return false;
    }

    //--------------------------------------------------------------------------
    // Generic error flinger.
    //--------------------------------------------------------------------------

    /* FUNC */ fling(res, next, num, msg) {
        res.statusCode = num;
        res.end(msg);
        return next();
    }

    //--------------------------------------------------------------------------
    // Initializes the handlers.
    //--------------------------------------------------------------------------

    /* FUNC */ initHandlers() {
        if(Object.keys(this.handlers).length == 0)
            this.error("fatal", "No handlers were exported by handler files.", "xpapi._initHandlers");

        for(var h in this.handlers) {
            this.initHandler(this.handlers[h]);
        }

        this.subPaths = Object.keys(this.subPaths);
    }

    //--------------------------------------------------------------------------
    // Initializes a handler. Broken out from initHandlers, plural, to reuse
    // with autoreload feature.
    //--------------------------------------------------------------------------

    /* FUNC */ initHandler(handler, force = false) {
            var h = handler;
            if(h.name === undefined || !this.genval.isNonEmptyString(h.name))
                this.error("fatal", "Missing or invalid name in handler.", "xpapi._initHandlers");
            if(h.args === undefined && h.args !== null)
                this.error("fatal", "Missing args in handler\"" + h.name + "\".", "xpapi._initHandlers");
            var argCnt = 0;
            for(var k in h.args) {
                argCnt++;
            }
            if(argCnt == 0) {
                this.error("warn", "Empty args in handler \"" + h.name + "\", converted to null.", "xpapi._initHandlers");
                h.args = null;
            }
            if(h.func === undefined || typeof h.func != "function")
                this.error("fatal", "Missing or invalid function in handler \"" + h.name + "\".", "xpapi._initHandlers");
            if(h.desc === undefined || !this.genval.isNonEmptyString(h.desc))
                this.error("warn", "Missing or invalid desc in handler \"" + h.name + "\".", "xpapi._initHandlers");

            h.init = true;

            if(h.args !== null)
                this.validateHandlerArgs(h.name, h.args);
    }

    //--------------------------------------------------------------------------
    // Validates a handler args element. Returns nothing, but terminates the
    // program if an error is found.
    //--------------------------------------------------------------------------

    /* FUNC */ validateHandlerArgs(handlerName, args) {

        for(var name in args) {
            var arg = args[name];

            if(arg.valid === undefined)
                this.error("fatal", "Missing valid attribute for arg \"" + name + "\" in handler \"" + handlerName + "\".", "xpapi._validateHandlerArgs");

            // TODO: validate validators. No, seriously.

            if(arg.required === undefined)
                this.error("fatal", "Missing required attribute for arg \"" + name + "\" in handler \"" + handlerName + "\".", "xpapi._validateHandlerArgs");

            if(arg.errmsg === undefined)
                this.error("fatal", "Missing errmsg attribute for arg \"" + name + "\" in handler \"" + handlerName + "\".", "xpapi._validateHandlerArgs");

            if(arg.desc === undefined)
                this.error("warn", "Missing desc attribute for arg \"" + name + "\" in handler \"" + handlerName + "\".", "xpapi._validateHandlerArgs");

        }

    }


    //--------------------------------------------------------------------------
    // Loads the handlers. If autoload is enabled, it loads all of the files in
    // the handler directory into this.config.handlerFiles. Otherwise, it
    // loads whichever files were explicitly placed in handlerFiles at init.
    //--------------------------------------------------------------------------

    /* FUNC */ loadHandlers(subdir = false) {

        if(this.config.autoload) {

            try {
                var cwd = subdir ? subdir : this.config.handlerDir;
                var items = this.fs.readdirSync(cwd, { withFileTypes: true });
                this.error("debug", "Found " + items.length + " items in " + cwd + this.sep, "xpapi._loadHandlers");

                for(var i = 0; i < items.length; i++) {
                    if(items[i].isFile()) {
                        this.loadHandler(cwd + this.sep + items[i].name);
                    } else if(items[i].isDirectory() && this.apiMulti) {
                        this.loadHandlers(this.fs.realpathSync(cwd + this.sep + items[i].name));
                    }
                }

            } catch(e) {console.log(e);
                this.error("fatal", "Unable to open handler directory \""
                    + this.fs.realpathSync(this.config.handlerDir) + "\".", "xpapi._loadHandlers");
            }

        } else {

            this.config.handlerFiles = this.uniq(this.config.handlerFiles);

            for(var i = 0; i < this.config.handlerFiles.length; i++) {
                try {
                    this.loadHandler(this.config.handlerFiles[i]);
                } catch(e) {
                    this.error("fatal", "Unable to require \"" + this.config.handlerFiles[i] + "\".",
                        "xpapi._loadHandlers");
                }
            }
        }
    }


    //--------------------------------------------------------------------------
    // Loads a handler file.
    //--------------------------------------------------------------------------

    /* FUNC */ loadHandler(filename) {
        try {
            delete require.cache[filename];
            var handlers = require(filename);
            this.error("debug", "Loaded \"" + filename + "\".", "xpapi._loadHandler");
            if(this.config.apiMulti) {
                var subPath = "/" + this.getSubPath(filename);
                if(subPath != "/")
                    subPath += "/";
            } else {
                var subPath = "";
            }
            if(!Array.isArray(handlers)) {
                handlers = [handlers];
            }

            for(var h = 0; h < handlers.length; h++) {
                handlers[h].name = subPath + handlers[h].name;
                if(this.handlers[handlers[h].name] === undefined) {
                    this.error("debug", "Loaded handler " + handlers[h].name + " from " + filename + ".", "xpapi._loadHandler");
                } else {
                    this.error("debug", "Reloaded handler " + handlers[h].name + " from " + filename + ".", "xpapi._loadHandler");
                }
                handlers[h].init = false;
                this.handlers[handlers[h].name] = handlers[h];
            }

        } catch(e) {
            this.error("fatal", "Unable to require \"" + filename + "\".", "xpapi._loadHandler");
        }

    }

    //--------------------------------------------------------------------------
    // (Re)loads a changed handler file.
    //--------------------------------------------------------------------------

    /* FUNC */ loadChangedHandler(file) {
        this.loadHandler(file.fullPath);
        for(var k in this.handlers) {
            if(!this.handlers[k].init) {
                this.initHandler(this.handlers[k], true);
                this.error("info", "Reloaded handler file \"" + file + "\" after change.", "xpapi._loadChangedHandler");
            }
        }
    }

    //--------------------------------------------------------------------------
    // Given an absolute path to a handler file, strips off the filename and
    // everything up to and including the handler directory, yielding a path
    // relative to handlerDir.
    //--------------------------------------------------------------------------

    /* FUNC */ getSubPath(path) {
        var remove = this.config.handlerDir.split(this.sep).length;
        var path = path.split(this.sep);
        return path.slice(remove, path.length - 1).join(this.sep);
    }

    //--------------------------------------------------------------------------
    // Utility function to return a copy of an array sorted and with duplicates
    // removed.
    //--------------------------------------------------------------------------

    /* FUNC */ uniq(a) {
        if(a.length) {
            var obj = { };
            for(var i = 0; i < a.length; i++)
                obj[this.config.handlerFiles[i]] = true;
            this.config.handlerFiles = [ ];
            for(var k in obj)
                a.push(k);
        }
        return a;
    }

    //--------------------------------------------------------------------------
    // Loads the plugins. If autoload is enabled, it attempts to require
    // everything in the plugins directory. Otherwise, it walks through whatever
    // files were loaded into pluginFiles via options passed to the constructor.
    //--------------------------------------------------------------------------

    /* FUNC */ loadPlugins() {

        if(this.config.autoload) {
            try {
                var items = this.fs.readdirSync(this.config.pluginDir, { withFileTypes: true });
                this.error("debug", "Found " + items.length + " items in "
                    + this.config.pluginDir + ".", "xpapi.constructor");

                for(var i = 0; i < items.length; i++) {
                    if(items[i].isFile()) {
                        this.config.pluginFiles.push(this.config.pluginDir + this.sep + items[i].name);
                        this.error("debug", "Found plugin file \""
                            + this.config.pluginFiles[this.config.pluginFiles.length - 1]
                            + "\".", "xpapi.constructor");
                    }
                }
                this.error("debug", "Found " + this.config.pluginFiles.length
                    + " plugin files.", "xpapi.constructor");

            } catch(e) {
                this.error("fatal", "Unable to open plugin directory \""
                    + this.config.pluginDir + "\".", "xpapi.constructor");
            }
        }

        for(var i = 0; i < this.config.pluginFiles.length; i++) {

            try {

                var plugins = require(this.config.pluginFiles[i]);
                this.error("debug", "Loaded \"" + this.config.pluginFiles[i] + "\".",
                    "xpapi.constructor");

                if(plugins.pre)
                    this.server.pre(plugins.pre);

                if(plugins.use)
                    this.server.use(plugins.use);

                if(plugins.handler) {
                    var config = { };
                    for(var k in this.config) {
                        config[k] = this.config[k];
                    }
                    for(var p in plugins.handler) {
                        for(var h in this.handlers) {
                            plugins.handler[p](config, this.handlers[h]);
                        }
                    }
                }

            } catch(e) {

                this.error("fatal", "Unable to require \"" + this.config.pluginFiles[i] + "\".",
                    "xpapi.constructor");
            }

        }

    }

    //--------------------------------------------------------------------------
    // Given a value and a set of tests, applies the tests and returns the
    // (possibly altered) value on success. Throws an error on failure. Not all
    // of these are really tests; a number of them perform some kind of data
    // manipulation such as trimming whitespace. Accordingly, they are performed
    // in the order specified.
    //--------------------------------------------------------------------------

    /* FUNC */ validate(val, tests) {

        for(var i = 0; i < tests.length; i++) {

            switch(tests[i][0]) {

                //--------------------------------------------------------------
                // ["isArray", ?min, ?max]

                case "isArray":
                    if(!Array.isArray(val)
                        || (tests[i][1] !== undefined && val.length < tests[i][1])
                        || (tests[i][2] !== undefined && val.length < tests[i][2])) {
                        this.error("info", "Failed isArray test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------
                // ["isArrayOfInts", ?min, ?max]

                case "isArrayOfIntegers":
                case "isArrayOfInts":
                    if(!this.genval.isArrayOfInts(val, tests[i][1], tests[i][2])) {
                        this.error("info", "Failed " + test[i][0] + " test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------
                // ["isArrayOfFloats", ?min, ?max]

                case "isArrayOfFloats":
                    if(!this.genval.isArrayOfFloats(val, tests[i][1], tests[i][2])) {
                        this.error("info", "Failed " + test[i][0] + " test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------
                // ["isArrayOfNonEmptyStrings", ?min, ?max]

                case "isArrayOfNonEmptyStrings":
                    if(!this.genval.isArrayOfNonEmptyStrings(val, tests[i][1], tests[i][2])) {
                        this.error("info", "Failed " + test[i][0] + " test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------
                // ["isArrayOfStrings", ?min, ?max]

                case "isArrayOfStrings":
                    if(!this.genval.isArrayOfStrings(val, tests[i][1], tests[i][2])) {
                        this.error("info", "Failed " + test[i][0] + " test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------
                // ["isBetween", min, max]

                case "isBetween":
                    if(!this.genval.isBetween(val, tests[i][1], tests[i][2])) {
                        this.error("info", "Failed isWithin test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------

                case "isBoolean":
                    if(!this.genval.isBoolean(val)) {
                        this.error("info", "Failed isBoolean test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------

                case "isChar":
                    if(!this.genval.isChar(val)) {
                        this.error("info", "Failed isChar test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------

                case "isInt":
                case "isInteger":
                    val = parseInt(val);
                    if(isNaN(val) || !this.genval.isInteger(val)) {
                        this.error("info", "Failed isInt test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------

                case "isInArray":
                    if(!this.genval.isInArray(val, tests[i][1])) {
                        this.error("info", "Failed isInArray test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }

                    break;

                //--------------------------------------------------------------

                case "isFloat":
                    val = parseFloat(val);
                    if(isNaN(val) || !this.genval.isFloat(val)) {
                        this.error("info", "Failed isFloat test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------

                case "isNonEmptyString":
                    if(!this.genval.isNonEmptyString(val)) {
                        this.error("info", "Failed isNonEmptyString test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------

                case "isNull":
                    if(!this.genval.isNull(val)) {
                        this.error("info", "Failed isNull test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------
                // ["isString", ?min, ?max]

                case "isString":
                    if(!this.genval.isString(val)
                        || (tests[i][1] !== undefined && val.length < tests[i][1])
                        || (tests[i][2] !== undefined && val.length < tests[i][2])) {
                        this.error("info", "Failed isString test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------
                // ["isWithin", min, max]

                case "isWithin":
                    if(!this.genval.isWithin(val, tests[i][1], tests[i][2])) {
                        this.error("info", "Failed isWithin test.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------
                // For a number, if the value is outside of the min/max range,
                // it is replaced with the nearer value.
                //
                // ["clamp", min, max]

                case "clamp":
                    if(val < tests[i][1])
                        val = tests[i][1];
                    else if(val > tests[i][2])
                        val = tests[i][2];
                    break;

                //--------------------------------------------------------------
                // Attempts to convert val into a number.

                case "toNumber":
                    val = parseFloat(val);
                    if(isNaN(val)) {
                        this.error("info", "Cannot convert val to a number.", "xpapi._validate");
                        throw new Error("_validate failed.");
                    }
                    break;

                //--------------------------------------------------------------
                // Trims leading and trailing whitespace from a string.

                case "trim":
                    try {
                        val = val.trim();
                    } catch(e) {
                        throw new Error("warn", "Invalid type passed to trim test.", "xpapi._validate");
                    }
                    break;

                default:
                    this.error("warn", "Undefined test \"" + tests[i][0] + "\".", "xpapi._validate");
                    throw new Error("Validation failed with unknown test.");
                    break;
            }

        }

        return val;

    }


    //--------------------------------------------------------------------------
    // Outputs the runtime header to console. This will become progressively
    // more ostentatious and ridiculous as time goes by.
    //--------------------------------------------------------------------------

    /* FUNC */ outputHeader(content, width = 76, lineChar = "=") {

        var line    = lineChar.repeat(width);
        var title   = " ".repeat(Math.round(((width - 2) / 2) - (content.length / 2)))
            + content;
        title += " ".repeat(width - 4 - title.length);

        console.log(
            "\n" + this.ac.blue(line) + "\n"
            + this.ac.blue(lineChar + " ") + this.ac.yellow.bold(title) + this.ac.blue(" " + lineChar) + "\n"
            + this.ac.blue(line) + "\n"
        );

    }

    //--------------------------------------------------------------------------
    // If a logger has been defined, log messages will be passed to it here;
    // otherwise it defaults to console.log().
    //--------------------------------------------------------------------------

    /* FUNC */ log(msg) {
        if(this.config.logger)
            this.config.logger(msg);
    }



    //--------------------------------------------------------------------------
    // Prints an error message to console if permitted by the current verbosity
    // level, and if the error is fatal, terminates the process.
    //--------------------------------------------------------------------------

    /* FUNC */ error(level, message, location = null) {

        if(location === null)
            location = this.config.appName.toUpperCase();

        if(this.config.verbosity) {
            switch(level) {
                case "fatal":
                    console.log(this.ac.bgRed.yellowBright("[" + location + "]") + this.ac.redBright(" FATAL ERROR: ") + this.ac.yellowBright(message));
                    break;
                case "warn":
                    if(this.config.verbosity >= 1)
                        console.log(this.ac.bgYellow.whiteBright("[" + location + "]") + this.ac.yellowBright(" WARNING: ") + message);
                    break;
                case "info":
                    if(this.config.verbosity >= 2)
                        console.log(this.ac.bgGreen.whiteBright("[" + location + "]") + this.ac.greenBright(" INFO: ") + message);
                    break;
                case "debug":
                    if(this.config.verbosity >= 3)
                        console.log("[" + location + "] DEBUG: " + message);
                    break;
            }
        }

        if(level == "fatal" && this.config.verbosity > 0)
            process.exit(1);
    }

    //--------------------------------------------------------------------------
    // Documentation generator.
    //--------------------------------------------------------------------------

    /* FUNC */ documentation(req, res, next) {
        var docs = [];

        docs.push(
            "<html lang='en'>\n"
            + "<head>\n"
            + "<meta charset='utf-8'>\n"
            + "<title>" + this.config.name + " Documentation</title>"
        );
        if(this.config.cssUrl) {
            docs.push("<link rel='stylesheet' href='" + this.config.cssUrl + "'>");
        } else {
            docs.push(
                "<style type='text/css'>\n"
                + "body,table { font: 10pt Arial,Helvetica,sans-serif; }\n"
                + "a { text-decoration: none; }\n"
                + "a:hover { text-decoration: underline; }\n"
                + "span.code { background-color: #EEE; font: 10pt Consolas,Courier,fixed; }\n"
                + "h1 { background-color: black; color: white; text-align: center; padding: 0.5em; }\n"
                + "h2 { margin-top: 2em; border: 2px solid black; padding: 0.25em; }\n"
                + "h3.method-name { padding-top: 1em; border-bottom: 1px solid black; margin-bottom: 2px; font-family: Consolas,Courier,fixed; font-size: 120%; }\n"
                + "h3.method-name + p { margin-top: 2px; }\n"
                + "table.method-args { border-spacing: 1px; background-color: black; }\n"
                + "table.method-args thead { color: white; }\n"
                + "table.method-args tbody { background-color: white; }\n"
                + "table.method-args td:nth-child(1) { font: bold 10pt Consolas,Courier,fixed; }\n"
                + "</style>"
            );
        }
        docs.push(
            "</head>\n"
            + "<body>\n"
            + "<h1>" + this.config.name + " API Documentation</h1>\n"
            + "<h2>Table of Contents</h2>\n"
            + "<ul>"
        );

        var methodNames = [ ];
        for(var name in this.handlers)
            methodNames.push(name)
        methodNames.sort();

        for(var i = 0; i < methodNames.length; i++)
            docs.push("<li><a href='#" + methodNames[i] + "'>" + methodNames[i] + "</a></li>");

        docs.push(
            "</ul>\n"
            + "<h2>Endpoint Descriptions</h2>"
        );

        for(var m = 0; m < methodNames.length; m++) {
            var method = this.handlers[this.handlers[methodNames[m]]];

            docs.push("<a name='" + method.name + "'></a>");
            docs.push("<h3 class='method-name'>" + method.name + "</h3>");
            docs.push("<p class='method-desc'>" + method.desc + "</p>");

            var argnames = [ ];
            for(var argname in method.args)
                argnames.push(argname);

            if(argnames.length) {
                argnames.sort();
                docs.push(
                    "<table class='method-args'>\n"
                    + "<thead>\n"
                    + "<tr><th>Argument</th><th>Req</th><th>Description</th></tr></thead>\n"
                    + "<tbody>"
                );
                for(var a = 0; a < argnames.length; a++) {
                    var arg = method.args[argnames[a]];
                    docs.push(
                        "<tr><td>" + argnames[a] + "</td>\n"
                        + "<td>" + (arg.req ? "Y" : "N") + "</td>\n"
                        + "<td>" + arg.desc + "</td></tr>"
                    );
                }
                docs.push("</tbody></table>");
            } else {
                docs.push("<p><em>This function has no arguments.</em></p>");
            }

        }

        docs.push(
            "</body>\n"
            + "</html>\n"
        );

        res.setHeader("content-type", "text/html");
        res.setHeader("Set-Cookie", "xpapiDocs=true; HttpOnly;");
        res.end(docs.join("\n"));
        return next();

    }

}

//--------------------------------------------------------------------------
// If a file is uploaded, we search for an xpapi command with an argument
// whose name matches the fieldname with a prepended '@'. (There can be
// more than one, incidentally.) It then copies an object with information
// about the file to that argument, minus the '@', and deletes the placeholder.
// The object looks like this:
//
// { size: 603, path: "/path/to/file", name: "foo.txt", type: "text/plain" }
//--------------------------------------------------------------------------

/* FUNC */ function uploadHandler(options) {

    function handler(req, res, next) {

        var xreq = null;
        try {
            xreq = JSON.parse(req.body.xpapi);
        } catch(e) {
            // TODO: need some kind of error notification
            return next();
        }
        if(xreq === null)
            return next();

        for(var c = 0; c < xreq.cmds.length; c++) {
            for(var a in xreq.cmds[c].args) {
                if(a.substr(0, 1) == "@" && req.files[a.substr(1)] !== undefined) {
                    var field = a.substr(1);
                    xreq.cmds[c].args[field] = {
                        size: req.files[field].size,
                        path: req.files[field].path,
                        name: req.files[field].name,
                        type: req.files[field].type,
                    };
                    delete xreq.cmds[c].args[a];
                }
            }
        }

        req.body.xpapi = JSON.stringify(xreq);
        return next();
    }

    return handler;
}


//--------------------------------------------------------------------------
// Generic validation functions.
//--------------------------------------------------------------------------

var genval = {

    //--------------------------------------------------------------------------

    isArray: function(val, min, max) {
        if(!Array.isArray(val))
            return false;
    },

    //--------------------------------------------------------------------------

    isArrayOfInts: function(val, min, max) {
        if(!Array.isArray(val))
            return false;
        if((min !== undefined && val.length < min)
            || (max !== undefined && val.length > max))
            return false;
        for(var i = 0; i < val.length; i++)
            val[i] = parseInt(val[i]);
            if(isNaN(val[i]) || typeof val[i] != "number" || val[i] != Math.floor(val[i]))
                return false;
        return true;
    },

    //--------------------------------------------------------------------------

    isArrayOfFloats: function(val, min, max) {
        if(!Array.isArray(val))
            return false;
        if((min !== undefined && val.length < min)
            || (max !== undefined && val.length > max))
            return false;
        for(var i = 0; i < val.length; i++) {
            val[i] = parseFloat(val);
            if(isNaN(val[i]) || typeof val[i] != "number")
                return false;
        }
        return true;
    },

    //--------------------------------------------------------------------------

    isArrayOfNonEmptyStrings: function(val, min, max) {
        if(!Array.isArray(val))
            return false;
        if((min !== undefined && val.length < min)
            || (max !== undefined && val.length > max))
            return false;
        for(var i = 0; i < val.length; i++)
            if(typeof val[i] != "string" || val[i].length < 1)
                return false;
        return true;
    },

    //--------------------------------------------------------------------------

    isArrayOfStrings: function(val, min, max) {
        if(!Array.isArray(val))
            return false;
        if((min !== undefined && val.length < min)
            || (max !== undefined && val.length > max))
            return false;
        for(var i = 0; i < val.length; i++)
            if(typeof val[i] != "string")
                return false;
        return true;
    },

    //--------------------------------------------------------------------------

    isBetween: function(val, min, max) {
        return val > min && val < max ? true : false;
    },

    //--------------------------------------------------------------------------

    isBoolean: function(val) {
        return typeof val == "boolean" ? true : false;
    },

    //--------------------------------------------------------------------------

    isChar: function(val) {
        return typeof val == "string" && val.length == 1 ? true : false;
    },

    //--------------------------------------------------------------------------

    isFloat: function(val) {
        val = parseFloat(val);
        return (!isNan(val) && typeof val == "number") ? true : false;
    },

    //--------------------------------------------------------------------------

    isInArray: function(val, array) {
        for(var i = 0; i < array.length; i++)
            if(array[i] == val)
                return true;
        return false;
    },

    //--------------------------------------------------------------------------

    isInteger: function(val) {
        val = parseInt(val);
        return (!isNaN(val) && typeof val == "number") && val == Math.floor(val) ? true : false;
    },

    //--------------------------------------------------------------------------

    isKey: function(val, object) {
        return object[val] === undefined ? false : true;
    },

    //--------------------------------------------------------------------------

    isNonEmptyString: function(val) {
        return typeof val == "string" && val.length ? true : false;
    },

    //--------------------------------------------------------------------------

    isNull: function(val) {
        return val === null ? true : false;
    },

    //--------------------------------------------------------------------------

    isNullOrFunction: function(val) {
        return (val === null || typeof val == "function") ? true : false;
    },

    //--------------------------------------------------------------------------

    isString: function(val) {
        return typeof val == "string" ? true : false;
    },

    //--------------------------------------------------------------------------

    isWithin: function(val, min, max) {
        return val >= min && val <= max ? true : false;
    },

};



module.exports = xpapi;
