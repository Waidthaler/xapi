
// In a real application, you would do things like create database connection
// pools here that would then be part of the package of dependencies for
// injection into command handlers.

// In this case, the object containing foo and baz will be passed as the third
// argument to the sumOfNumbers handler.

module.exports = {
    "sumOfNumbers": { foo: "bar", baz: "quux" }
};
