// test handler

var yoMama3 = {
    name: "yoMama3",
    args: {
        echo: {
            valid:    [["isNonEmptyString"]],
            required: true,
            errmsg:   "echo must be a non-empty string.",
            desc:     "This text will be output to the console."
        },
        "@testUpload": {
            valid:    null,
            required: false,
            errmsg:   null,
            desc:     "This is a file upload."
        }
    },
    desc: "This is a silly test function.",
    func: function(req, args) {
        if(args.echo == "Your mother") {
            return {
                output: "Tell your mom I said hi!"
            };
        } else {
            return {
                errmsg:  "That's not who I'm looking for.",
                errcode: "NOTMOM",
            };
        }
    }
};

var sumOfNumbers3 = {
    name: "sumOfNumbers3",
    args: {
        addends: {
            valid:    [["isArrayOfFloats"]],
            required: true,
            errmsg:   "addends must be an array of floats.",
            desc:     "An array of numbers to be added together."
        }
    },
    desc: "This is a test function.",
    func: function(req, args, deps) {
        var result = 0;
        for(var i = 0; i < args.addends.length; i++)
            result += args.addends[i]
        return {
            output: { sum: result, pluginTest: req.dummy, depTest: deps.foo }
        }
    }
};

var multiArgTest3 = {
    name: "multiArgTest3",
    args: {
        someInt: {
            valid:    [["isInteger"], ["isWithin", 5, 10]],
            required: true,
            errmsg:   "someInt must be an integer between 5 and 10, inclusive.",
            desc:     "<p>Testing isInteger built-in test. You must supply and integer in the range 5-10.</p>"
        },
        name: {
            valid:    [["isString"], ["isNonEmptyString"]],
            required: false,
            errmsg:   "name must be a non-empty string.",
            desc:     "<p>The name argument is optional, but if supplied, it must be a non-empty string.</p>"
        },
        godzilla: {
            valid:    [["isBoolean"]],
            required: true,
            errmsg:   "godzilla must be a boolean. There is only Godzilla or no Godzilla. There is no try.",
            desc:     "<p>Determines whether Godzilla will be released or not.</p>"
        }
    },
    desc: "This is another silly test function. In it, you must specify an integer within a certain range and whether or not you require Godzilla. Optionally, you may supply a name.",
    func: function(req, args) {
        var result = "You have called multiArgTest with a valid integer between 5-10. Godzilla, whom "
            + (args.name === undefined ? "you have called anonymously" : "you have called by the alias '" + args.name + "'")
            + ", will" + (args.godzilla ? " " : " not ") + "be summoned.";
        return { output: result, cookies: ["godzilla=king_of_the_monsters;"] };
    }
};

module.exports = [yoMama3, sumOfNumbers3, multiArgTest3];


