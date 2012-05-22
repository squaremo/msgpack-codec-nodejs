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
patterns[0xcb] = compile('value:64/float, rest/binary');

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
                entries[key.value] = val.value;
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
function parse(binary) {
    if (binary.length === 0) return false;
    var discriminator = binary[0];
    var rest = binary.slice(1);
    var parser = patterns[discriminator];
    return !!parser && parser(rest); // exactly false rather than falsey
}

exports.parse = parse;

// There's not much opportunity to use bitsyntax when encoding; most
// values are pretty boring.

function array_parts(arr, parts) {
  var len = arr.length;
  parts.length = len;
  var size = 0;
  for (var i = 0; i < len; i++) {
    var encoded = generate(arr[i]);
    parts[i] = encoded;
    size += encoded.length;
  }
  return size;
}

function object_parts(map, parts) {
  var size = 0;
  for (var k in map) {
    if (map.hasOwnProperty(k)) {
      var encKey = generate_string(k);
      size += encKey.length;
      var encVal = generate(map[k]);
      size += encVal.length;
      parts.push(encKey);
      parts.push(encVal);
    }
  }
  return size;
}

function write_parts(buffers, target, offset) {
  for (var i = 0, len = buffers.length; i < len; i++) {
    var buf = buffers[i];
    buf.copy(target, offset);
    offset += buf.length;
  }
  return target;
}

function generate_string(value) {
  var buf, length = Buffer.byteLength(value);
  if (length < 0x20) {
    buf = new Buffer(length + 1);
    buf[0] = 160 + length;
    buf.write(value, 1);
  }
  else if (length < 0x10000) {
    buf = new Buffer(length + 3);
    buf[0] = 0xda;
    buf.writeUInt16BE(length, 1);
    buf.write(value, 3);
  }
  else if (length < 0x100000000) {
    buf = new Buffer(length + 5);
    buf[0] = 0xdb;
    buf.writeUInt32BE(length, 1);
    buf.write(value, 5);
  }
  else {
    throw "That string is way too big.";
  }
  return buf;
}

// generate :: top -> binary
function generate(value) {
  var type = typeof value;

  if (type === 'number') {
    var buf;
    // no point in using anything other than double outside
    // int32/uint32; (u)int64 covers less for the same sized encoding,
    // and is no more precise (since the underlying numbers are
    // doubles anyway). TODO float encoding inside those bounds?
    var isInteger = (value % 1 === 0);
    if (value < -0x80000000 || value >= 0x100000000 || !isInteger) {
      buf = new Buffer(9);
      buf[0] = 0xcb;
      buf.writeDoubleBE(value, 1);
    }
    // inside those bounds, we may be able to use a smaller encoding
    // if the number is an integer.
    else if (value < 0) {
      if (value < -0x80) {
        if (value < -0x8000) {
          buf = new Buffer(5);
          buf[0] = 0xd2;
          buf.writeInt32BE(value, 1);
        }
        else {
          buf = new Buffer(3);
          buf[0] = 0xd1;
          buf.writeInt16BE(value, 1);
        }
      }
      else {
        if (value < -32) {
          buf = new Buffer(2);
          buf[0] = 0xd0;
          buf[1] = value;
        }
        else {
          buf = new Buffer(1);
          buf[0] = 0xe0 | value;
        }
      }
    }
    else {
      if (value > 255) {
        if (value > 0xffff) {
          buf = new Buffer(5);
          buf[0] = 0xce;
          buf.writeUInt32BE(value, 1);
        }
        else {
          buf = new Buffer(3);
          buf[0] = 0xcd;
          buf.writeUInt16BE(value, 1);
        }
      }
      else {
        if (value > 127) {
          buf = new Buffer(2);
          buf[0] = 0xcc;
          buf[1] = value;
        }
        else {
          buf = new Buffer(1);
          buf[0] = value;
        }
      }
    }
    return buf;
  }

  var length = value.length;

  if (type === 'object') {
    var isArray = Array.isArray(value);
    var parts = [];
    var size = (isArray) ? array_parts(value, parts) : object_parts(value, parts);
    var count = (isArray) ? parts.length : parts.length / 2;
    console.log("Count: " + count);
    var result, offset;
    if (count < 0x10) {
      result = new Buffer(1 + size);
      result[0] = ((isArray) ? 0x90 : 0x80) + count;
      offset = 1;
    }
    else if (length < 0x10000) {
      result = new Buffer(3 + size);
      result[0] = (isArray) ? 0xdc : 0xde;
      result.writeUInt16BE(count, 1);
      offset = 3;
    }
    else if (length < 0x100000000) {
      result = new Buffer(5 + size);
      result[0] = (isArray) ? 0xdd : 0xdf;
      result.writeUInt32BE(count, 1);
      offset = 5;
    }
    return write_parts(parts, result, offset);
  }

  else if (type === 'string') {
    return generate_string(value);
  }
}

exports.generate = generate;
