function renderMatchingQuestionInput(q, answer, locked, correct, shuffleMapping) {
  var pairs = (answer && typeof answer === 'object') ? answer : {};

    var mappingObj = shuffleMapping || {};
    var leftMapping = mappingObj.left ? mappingObj.left : q.data.left.map(function (_, i) { return i; });
    var rightMapping = mappingObj.right ? mappingObj.right : q.data.right.map(function (_, i) { return i; });

    // rightIdx -> leftIdx
    var rightToLeft = {};
    Object.keys(pairs).forEach(function (k) {
        var l = parseInt(k, 10);
        var r = pairs[k];
        if (typeof r === 'number') rightToLeft[r] = l;
    });

    // pool
    if (!state.matchingPools) state.matchingPools = {};
    if (!Array.isArray(state.matchingPools[q.id])) state.matchingPools[q.id] = leftMapping.slice();

    var pool = state.matchingPools[q.id];

    var usedLeft = {};
    Object.keys(pairs).forEach(function (k) {
        var li = parseInt(k, 10);
        if (!Number.isNaN(li)) usedLeft[li] = true;
    });

    var nextPool = [];
    for (var pi = 0; pi < pool.length; pi++) {
        if (!usedLeft[pool[pi]]) nextPool.push(pool[pi]);
    }
    leftMapping.forEach(function (li) {
        if (usedLeft[li]) return;
        if (nextPool.indexOf(li) === -1) nextPool.push(li);
    });

    pool = nextPool;
    state.matchingPools[q.id] = pool;

    var html = '<div class="matching-board" data-qid="' + escapeHtml(q.id) + '" style="--matchRowH:auto;">';

    var poolSlot = 0;

    rightMapping.forEach(function (rightIdx) {
        var matchedLeft = rightToLeft.hasOwnProperty(rightIdx) ? rightToLeft[rightIdx] : null;
        var isJoined = (matchedLeft !== null);

        html += '<div class="matching-line' + (isJoined ? ' is-joined' : '') + '" data-qid="' + escapeHtml(q.id) + '" data-right="' + rightIdx + '">';

        // LEFT
        if (isJoined) {
            html += '<div class="match-tile match-left-slot match-drop-left" data-qid="' + escapeHtml(q.id) + '" data-right="' + rightIdx + '">';
            html += '<div class="match-chip" draggable="' + (locked ? 'false' : 'true') + '" data-qid="' + escapeHtml(q.id) + '" data-left="' + matchedLeft + '" data-from="match" data-right="' + rightIdx + '">'
                + escapeHtml(q.data.left[matchedLeft])
                + '</div>';
            html += '</div>';
        } else {
            var poolLeft = (poolSlot < pool.length) ? pool[poolSlot] : null;

            if (poolLeft !== null && poolLeft !== undefined) {
                html += '<div class="match-tile match-left-slot match-drop-left" data-qid="' + escapeHtml(q.id) + '" data-right="' + rightIdx + '" data-pool-slot="' + poolSlot + '">';
                html += '<div class="match-chip" draggable="' + (locked ? 'false' : 'true') + '" data-qid="' + escapeHtml(q.id) + '" data-left="' + poolLeft + '" data-from="pool" data-pool-index="' + poolSlot + '">'
                    + escapeHtml(q.data.left[poolLeft])
                    + '</div>';
                html += '</div>';
            } else {
                html += '<div class="match-empty match-left-slot match-drop-left" data-qid="' + escapeHtml(q.id) + '" data-right="' + rightIdx + '" data-pool-slot="' + poolSlot + '">'
                    + '<span class="slot-placeholder">Перетащите вариант</span>'
                    + '</div>';
            }

            poolSlot++;
        }

        html += '<div class="matching-gap"></div>';

        // RIGHT
        html += '<div class="match-tile match-right-tile match-drop-right" data-qid="' + escapeHtml(q.id) + '" data-right="' + rightIdx + '">'
            + escapeHtml(q.data.right[rightIdx])
            + '</div>';

        html += '</div>';
    });

    html += '</div>';
    return html;
}
