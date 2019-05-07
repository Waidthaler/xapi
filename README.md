# xpapi - Sane Web APIs v1.1.0

The xpapi module presents an easy-to-use, simple, and powerful micro-framework 
for building web APIs on top of Restify. It is purely for APIs and has no UI
functionality. It is also moderately opinionated, providing for a minimalist
flow built around JSON and POST requests. It is also capable of generating
documentation <!-- and client helper libraries --> on the fly.

## Usage

The module is initialized by instantiating the ``xpapi`` class:

```javascript
var xpapi = new (require("xpapi"))(options);
```

...where `options` is an object containing the runtime options:

* **`apiPath`:** Specifies the base path where xpapi will accept requests, e.g. `"/api"`. There is only one of these; xpapi doesn't play silly games with URLs.
* **`apiPort`:** Specifies the port to listen to, e.g., 80, 443, 8080, etc.
* **`apiMulti`:** Enables serving multiple APIs with different paths.
* **`autoload`:** If true, handlers will be automatically loaded from `handlerDir`.
* **`autoreload`:** If true, `handlerDir` will be monitored for changes and modules automatically reloaded.
* **`corsOrigins`:** Optional. Defines legal CORS origins.
* **`cssUrl`:** Optional external CSS URL for generated docs.
* **`dependencies`:** Optional module mapping dependencies to commands (see below).
* **`genDocsPath`:** Optional. If specified, hitting this path with a browser will yield the auto-generated HTMLdocumentation.
* **`handlerDir`:** Specifies the location of the handler files.
* **`handlerFiles`:** If `autoload` is `false`, this must be an array of handler filenames.
* **`logger`:** Optional. This is a callback for a user-supplied logging function.
* **`maxBodySize`:** Defines the maximum size of a request, uploads included.
* **`name`:** Display name for the API in generated documentation. Defaults to "Unnamed".
* **`pluginDir`:** Specifies the location of the plugin files.
* **`pluginFiles`:** If `autoload` is `false`, this must be an array of plugin filenames.
* **`production`:** Defaults to `false`. If `true`, xpapi is runnning in a production environment.
* **`sessionName`:** Optional. Name of session cookie.
* **`uploadDir`:** Optional directory for file uploads. If not specified, defaults to `os.tmpdir()`.
* **`verbosity`:** Sets verbosity level for logging. 0 = quiet, 1 = warnings, 2 = info, 3 = debug.


## The Basic Flow

The client sends a POST request containing one or more API calls as a 
JSON-encoded object in the body with MIME type `application/json` with a 
standard format:

```javascript
{
    params: {                     // optional, governs whole request
        benchmark: true,              // default false
        ignoreErrors: false           // default false    
    },
    cmds: [                       // contains one or more API function calls
        { 
            cmd: "getPrices",              // name of API function 
            args: {                        // named, unordered arguments to function
                dept: "tools", 
                subset: "saleItems", 
                limit: 500 
            }
            id: "price query"              // optional, returned with results
         },
        { 
            cmd: "getSales",
            args: {
                saleType: "weekend",
                expires:  "2019-05-15"
            }
         },
         
    ]
}
```

The optional `params` member specifies parameters that apply to the whole 
request. Currently, two parameters are supported. The `benchmark` flag (default 
`false`) enables timing information in the response. The `ignoreErrors` flag 
(default `false`) will cause all of the commands in the request to be processed 
regardless of any errors; the default behavior is to stop processing after the 
first error.

The `cmds` member is mandatory, and its value is an array of commands/endpoints
to execute. The only required member of each is the `cmd` element, which specifies
the function name, but most commands will include an `args` object containing
named, unordered arguments to the function. Finally, the optional `id` element is
attached to the command results to make it easier to identify.

For the purposes of this example, we'll assume that the second command, 
`"getSales"` failed. The response, also JSON-encoded in transit, would look something 
like this:

```javascript
{
    cmdCnt:  2,            // total number of commands in request
    worked:  1,            // number of commands that succeeded
    failed:  1,            // number of commands that failed
    aborted: 0,            // number of commands not executed after an earlier error
    
    results: [             // array of results, in same order as in request
        {
            output:   "....",         // output of command, can be any type
            execTime: 2,              // runtime of command in milliseconds (if params.benchmark == true)
            id:       "price query"   // id string passed with request
        },
        {
            errcode:  "DARNIT",       // invariant short error code (see below)
            errmsg:   "Bad date",     // human-readable error message
            execTime: 1
        }
    ]
}
```

The first four elements, `cmdCnt`, `worked`, `failed`, and `aborted`, specify 
how many commands were in the request, how many succeeded, how many failed, and 
how many were skipped after the first error, respectively.

The `results` element contains an array of command results in the same order as 
in the request. Successful commands will include an `output` element with the 
results of the command. If the `params.benchmark` flag is on, an `execTime` 
element will contain the number of milliseconds elapsed during command 
execution. If a command `id` was supplied, it will also be included.

Failed commands will contain either `errcode` or `errmsg`, usually both. The 
`errmsg` element contains a human-readable error message which, depending on the 
situation, might be intended for display to an end user in a user interface, but 
which may be expected to change over time as the API evolves. The `errcode` 
element, on the other hand, is intended to be a short, invariant code that 
client-side code can depend on.

### Handlers

Of course, xpapi does nothing without adding your own handler files. A handler is 
simply a module that exports an array of handler objects. Here's an example:

```javascript
var dummy = {
    name: "dummy",
    args: {
        echo: {
            valid:    [["isNonEmptyString"]],
            required: true,
            errmsg:   "echo must be a non-empty string.",
            desc:     "This text will be output to the console."
        }
    },
    desc: "This is a test function.",
    func: function(req, args) {
        console.log(args.echo);
        if(args.echo == "Your mother") {
            return {
                output: "Tell your mom I said hi."
            };
        } else {
            return {
                errmsg:  "That's not who I'm looking for.",
                errcode: "NOTMOM",
            };
        }
    }
}

module.exports = [dummy];
```

A handler must have a unique `name`. It will usually have an `args` object that 
specifies the function arguments (we'll come back to this in a second). It 
should have a `desc` element which is an HTML string to use in the documentation 
to describe the function. And it must have a `func` element, which is the actual 
handler function. All handler functions take at least two arguments, the `req` 
request object from Restify and the `args` object containing the inbound 
function arguments. If you are using the `dependencies` option, there is a third
argument which will receive any dependencies mapped to the command.

The handler function will return an object with an `output` element on success 
or an object with `errmsg` and `errcode` elements on failure. A `cookies` element
containing an array of cookies to set may also be passed; this is only executed
if the handler executes successfully.

Let's take a closer look at the contents of `args`:

```javascript
args: {
    echo: {
        valid:    [["isNonEmptyString"]],
        required: true,
        errmsg:   "echo must be a non-empty string.",
        desc:     "This text will be output to the console."
    }
}
```

Each argument is indexed by its unique name, like `echo` above. The associated
object contains up to four elements, `valid`, `require`, `errmsg`, and `desc`.

The optional `valid` element contains either `null` (for no generic validation) 
or an array of arrays. Each sub-array contains the name of a built-in validation 
function, followed by any arguments it takes, to be executed in the order 
specified. The `errmsg` element will be returned as part of the 406 error if 
validation fails -- a failure at this level aborts the entire request. By 
convention, error messages should specify what a legal value would be.

A single handler file may define as many handlers as you like. You may also have 
as many handler files as you like.

### Built-in Generic Validation Functions

Xpapi provides a bunch of built-in validation functions, mostly for generic type 
and range validation, to avoid repetitive ad hoc validation in the user-supplied 
handler functions. All of them return the supplied argument on success, which 
means that they can also be used to perform transformations on the data like
trimming whitespace.

#### Tests

* `[isArray]` - Succeeds if the value is an array.
* `[isArrayOfFloats(, min, max)]` - Succeeds if the value is an array of floats. If `min` and `max` are specified, tests to see if the number of elements is within `min`-`max`.
* `[isArrayOfIntegers(, min, max)]` - Succeeds if the value is an array of integers. If `min` and `max` are specified, tests to see if the number of elements is within `min`-`max`.
* `[isArrayOfInts(, min, max)]` - Alias for `isArrayOfIntegers`.
* `[isArrayOfNonEmptyStrings(, min, max)]` - Succeeds if the value is an array of non-empty strings. If `min` and `max` are specified, tests to see if the number of elements is within `min`-`max`.
* `[isArrayOfStrings(, min, max)]` - Succeeds if the value is an array of strings. If `min` and `max` are specified, tests to see if the number of elements is within `min`-`max`.
* `[isBetween(, min, max)]` - Succeeds if `min < val < max`. Contrast with `isWithin`.
* `[isBoolean]` - Succeeds if the value is a boolean.
* `[isChar]` - Succeeds if the value is a single-character string.
* `[isFloat]` - Succeeds if the value is a float.
* `[isInArray, *array*]` - Succeeds if the value is in the supplied array.
* `[isInteger]` - Succeeds if the value is an integer, i.e., has no fractional part.
* `[isInt]` - Alias for `isInteger`.
* `[isNonEmptyString]` - Succeeds if the value is a non-empty string.
* `[isNull]` - Succeeds if the value is `null`.
* `[isString]` - Succeeds if the value is a string.
* `[isWithin]` - Succeeds if `min <= val <= max`. Contrast with `isBetween`.

#### Transformations

* `[clamp(, min, max)]` - Forces a numeric argument to fall within the range `min`-`max`.
* `[toNumber]` - Replaces the value with `parseFloat(val)`. Throws an error if the result is `NaN`.
* `[trim]` - Trims leading and trailing whitespace from the value.

### File Uploads

File uploads via multipart/form-data is inherently hacky, so handling them 
involves a certain amount of meta-hackery. For a file upload field to be 
included in the arguments to a handler command, you must create a handler 
argument named `@fieldname` where `fieldname` is the name of the file upload 
field. Xpapi will search for uploaded files, match them to the specially marked 
fields, removing the leading `@` as it goes, and leaving a data structure as the 
field value, e.g.,

```javascript
{ size: 7648, path: "/tmp/ae9689f9ae898f799", name: "report.txt", type: "text/plain" }
```

It is up to the handler to do whatever needs to be done with the file.

### Cookies

Every handler takes the request object as its first argument; cookies are 
available therein as usual. To set a cookie, a `cookie` element can be added to 
the returned object containing an array of standard cookie strings, e.g.:

```javascript
return {
    errmsg:  "That's not who I'm looking for.",
    errcode: "NOTMOM",
    cookie:  "SessionId=F4D9690DE593841BD81ABD2583A237F0; Path=/api; SameSite=Strict"
};
```

### Plugins

Xpapi supports `pre` and `use` plugins. These are ordinary Restify plugins. If 
`autoload` is `true`, they are automatically loaded from the files in 
`pluginDir`; otherwise, they must be added to `pluginFiles` explicitly. The 
files should export an object with a `pre` and/or `use` element, the contents of 
which are arrays of plugin functions.

### Dependency Injection

Xpapi supports a lightweight form of dependency injection using the `dependencies`
configuration option, which specifies a path to a file mapping command names to
objects containing dependencies. In the simple example below, the `sumOfNumbers`
command will receive the associated object as its third argument.

```javascript
module.exports = {
    sumOfNumbers: { foo: "bar", baz: "quux" }
};
```

### API Versioning and Multiple APIs in the Same Xpapi Process

The original intention (pre-1.1.0) was to have a single API path. In practice, 
it turns out to be a lot easier to have multiple paths to support different
versions and entirely different APIs within a single Xpapi process. In keeping
with the general practice of not breaking backward compatibility, this is now
possible with the new `apiMulti` configuration option.

The default value for `apiMulti` is boolean `false`, in which case all handlers 
are served from the URL specified by `apiPath`. If `apiMulti` is `true`, then 
only handlers present in the top-level `handlerDir` will be served at `apiPath`, 
and handlers in subdirectories will be served at URLs corresponding to `apiPath` +
`/subdirectoryName`.

For example, let's assume your `apiPath` is `/api*` -- the trailing `*` is 
required in this case -- and your `handlerDir` is named `handlers`, and its 
layout looks something like this:

```
/handlers
    foo.js            ... The handlers in foo.js and bar.js will be served
    bar.js                from /api
    /jobs_v1
        baz.js        ... The handlers in baz.js will be served from /api/jobs_v1
    /jobs_v2
        quux.js       ... The handlers in quux.js will be served from /api/jobs_v2
```

You don't have to use the `apiMulti` feature, of course. A slightly more complex 
alternative is to specify the desired version or API subset using custom headers 
in the request object and let the handlers sort it out internally. The choice is 
yours. Inside the (very large) company that sponsors the development of Xpapi, 
we found it easier to split things up this way to make version control and 
deployment simpler. A smaller organization or project might have no need for 
this feature.


### Miscellaneous

#### Naming

Xpapi was originally named Xapi, but that name was already in use by another 
project when it came time to publish. Neither actually stands for anything. Feel 
free to have pointless debates over whether it should be pronounced 
ex-pee-ay-pee-eye or ex-pappy. Bonus points for complaining that the 
pronunciation guides should be rendered in IPA phonetic characters for 
non-English speakers. Odds are good it will be completely renamed by the time it 
hits 2.0.0.


### TODO

* Improved plugin-based dependency injection.
* More and better examples.
* Improved documentation.
* Provide a hook for custom validators.
* Client-side wrapper generation.
* Logging hook.


### Changelog

#### 1.1.0

* Removed leading underscores from "private" methods. 
* Ported over a more refined version of the `error` and `outputHeader` methods from another project.
* Documented `apiMulti` configuration option.
* Implemented `apiMulti` functionality. 
