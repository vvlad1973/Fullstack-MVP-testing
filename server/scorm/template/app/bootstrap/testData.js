// Embedded test data
var TEST_DATA = (function () {
  var b64 = "__TEST_JSON_B64__";
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  var json = new TextDecoder("utf-8").decode(bytes);
  return JSON.parse(json);
})();
