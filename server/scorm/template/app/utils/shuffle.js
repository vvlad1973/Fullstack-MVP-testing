function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
}

function createShuffleMapping(length) {
  var indices = [];
  for (var i = 0; i < length; i++) indices.push(i);
  return shuffle(indices.slice());
}
