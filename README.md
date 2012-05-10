msgpack codec for Node.JS
=========================

The msgpack codec, in Node.JS JavaScript, using
`require('bitsyntax')`. Using bitsyntax simplifies some bits and keeps
the line count down.

API
---

    var unpack = require('./index').parse;

    // unsigned 8-bit int
    unpack(new Buffer([0xcc, 67]));
    // -> { value: 67, rest: <Buffer > }

    // fixed map encoding
    unpack(new Buffer([129, 161, 65, 161, 66]));
    // -> { value: { A: <Buffer 42> }, rest: <Buffer > }
