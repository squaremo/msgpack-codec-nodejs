var compile = require('bitsyntax').compile;

// http://wiki.msgpack.org/display/MSGPACK/Format+specification

var patterns = new Array(256);

function constant(value) {
    return function(binary) {
        return {value: value, rest: binary};
    }
};

// integers
// +fixnum
for (var i = 0; i < 128; i++) {
    patterns[i] = constant(i);
}
// -fixnum
for (var i = 224; i < 256; i++) {
    patterns[i] = constant(i - 256);
}

// 204-207, 208-211
patterns[0xcc] = compile('value:8, rest/binary');
patterns[0xcd] = compile('value:16, rest/binary');
patterns[0xce] = compile('value:32, rest/binary');
patterns[0xcf] = compile('value:64, rest/binary'); // good luck everyone
patterns[0xd0] = compile('value:8/signed, rest/binary');
patterns[0xd1] = compile('value:16/signed, rest/binary');
patterns[0xd2] = compile('value:32/signed, rest/binary');
patterns[0xd3] = compile('value:64/signed, rest/binary'); // really, best of luck

// constants encoded in one byte
// 192, 194, 195 (where's 193?)
patterns[0xc0] = constant(null);
patterns[0xc3] = constant(true);
patterns[0xc2] = constant(false);

// floating point
// 202, 203
patterns[0xca] = compile('value:32/float, rest/binary');
patterns[0xcd] = compile('value:64/float, rest/binary');

// raw bytes
// fixed raw
function fixraw(len) {
    return function(binary) {
        if (binary.length >= len) {
            return {value: binary.slice(0, len), rest: binary.slice(len)};
        }
        else {
            return false;
        }
    };
}

for (var i = 160; i < 192; i++) {
    patterns[i] = fixraw(i - 160);
}
// 218, 219
patterns[0xda] = compile('len:16, value:len/binary, rest/binary');
patterns[0xdb] = compile('len:32, value:len/binary, rest/binary');

// arrays
function array(count, binary) {
    var items = new Array(count);
    var rest = binary;
    for (var j = 0; j < count; j++) {
        var item = parse(rest);
        if (item) {
            items[j] = item.value;
            rest = item.rest;
        }
        else {
            return false;
        }
    }
    return {value: items, rest: rest};
}

function fixarray(count) {
    return function(binary) {
        return array(count, binary);
    };
}
for (var i = 144; i < 160; i++) {
    patterns[i] = fixarray(i - 144);
}

var len16 = compile('len:16, rest/binary');
var len32 = compile('len:32, rest/binary');

function prefixed(prefixPattern, parser) {
    return function(binary) {
        var prefix = prefixPattern(binary);
        if (prefix) {
            return parser(prefix.len, prefix.rest);
        }
        else {
            return false;
        }
    }
}

// 220, 221
patterns[0xdc] = prefixed(len16, array);
patterns[0xdd] = prefixed(len32, array);

// maps
function map(count, binary) {
    var entries = {};
    var rest = binary;
    for (var j = 0; j < count; j++) {
        var key = parse(rest);
        if (key) {
            var val = parse(key.rest);
            if (val) {
                entries[key] = val.value;
                rest = val.rest;
            }
            else {
                return false;
            }
        }
        else {
            return false;
        }
    }
    return {value: entries, rest: rest};
}

function fixmap(count) {
    return function(binary) {
        return map(count, binary);
    };
}
for (var i = 128; i < 144; i++) {
    patterns[i] = fixmap(i - 128);
}

// 222, 223
patterns[0xde] = prefixed(len16, map);
patterns[0xdf] = prefixed(len32, map);

// parse :: binary -> {'value': top, 'rest': binary} | false
// a return of false indicates there is not enough to parse a full value.
exports.parse = function(binary) {
    if (binary.length === 0) return false;
    var discriminator = binary[0];
    var rest = binary.slice(1);
    var parser = patterns[discriminator];
    return parser && parser(rest);
}
