var __matchHeightRAF = 0;
function syncMatchingHeights() {
  try {
    if (__matchHeightRAF) cancelAnimationFrame(__matchHeightRAF);
  } catch (e) {}

  __matchHeightRAF = requestAnimationFrame(function() {
    var roots = document.querySelectorAll('.matching-board');
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      if (!root || !root.style) continue;

      // reset to auto for measurement
      root.style.setProperty('--matchRowH', 'auto');

      // measure after next frame so layout is updated
      (function(r) {
        requestAnimationFrame(function() {
          var nodes = r.querySelectorAll('.match-tile, .match-empty');
          var maxH = 0;
          for (var j = 0; j < nodes.length; j++) {
            var h = nodes[j].offsetHeight || 0;
            if (h > maxH) maxH = h;
          }
          if (maxH < 44) maxH = 56; // safety
          r.style.setProperty('--matchRowH', String(maxH) + 'px');
        });
      })(root);
    }
  });
}

var __matchDndBound = false;

function bindMatchingDnDOnce() {
  if (__matchDndBound) return;
  __matchDndBound = true;

  function closestByClass(node, cls) {
    var el = node;
    while (el && el !== document) {
      if (el.classList && el.classList.contains(cls)) return el;
      el = el.parentNode;
    }
    return null;
  }

  var __matchOverEl = null;

  function clearMatchOver() {
    if (__matchOverEl) __matchOverEl.classList.remove('is-over');
    __matchOverEl = null;
  }

  function setMatchOver(el) {
    if (__matchOverEl && __matchOverEl !== el) __matchOverEl.classList.remove('is-over');
    __matchOverEl = el;
    if (__matchOverEl) __matchOverEl.classList.add('is-over');
  }

  function parsePayloadFromEvent(e) {
    var raw = '';
    try { raw = e.dataTransfer.getData('application/json'); } catch (err) {}
    if (!raw) {
      try { raw = e.dataTransfer.getData('text/plain'); } catch (err2) {}
    }
    if (!raw) return null;

    // JSON first
    try {
      var obj = JSON.parse(raw);
      if (obj && obj.qid) return obj;
    } catch (e1) {}

    // fallback: qid|leftIdx|from|poolIndex|rightIdx
    var parts = String(raw).split('|');
    if (parts.length < 2) return null;

    var qid = parts[0];
    var leftIdx = parseInt(parts[1], 10);
    if (!qid || Number.isNaN(leftIdx)) return null;

    var payload = { qid: qid, leftIdx: leftIdx, from: parts[2] || 'pool' };
    if (parts[3]) {
      var pi = parseInt(parts[3], 10);
      if (!Number.isNaN(pi)) payload.poolIndex = pi;
    }
    if (parts[4]) {
      var ri = parseInt(parts[4], 10);
      if (!Number.isNaN(ri)) payload.rightIdx = ri;
    }
    return payload;
  }

  function getCurrentQuestionById(qid) {
    // Standard mode - check flatQuestions
    if (state.flatQuestions && state.flatQuestions.length > 0) {
      var current = state.flatQuestions[state.currentIndex] && state.flatQuestions[state.currentIndex].question;
      if (current && String(current.id) === String(qid)) return current;

      for (var i = 0; i < state.flatQuestions.length; i++) {
        var q = state.flatQuestions[i].question;
        if (q && String(q.id) === String(qid)) return q;
      }
    }
    
    // Adaptive mode - check adaptiveState and TEST_DATA.adaptiveTopics
    if (TEST_DATA.mode === 'adaptive' && state.adaptiveState) {
      // First check current question
      if (state.adaptiveState.currentQuestionId === qid) {
        var qData = getCurrentAdaptiveQuestion();
        if (qData && qData.question) return qData.question;
      }
      
      // Search in all adaptive topics
      if (TEST_DATA.adaptiveTopics) {
        for (var t = 0; t < TEST_DATA.adaptiveTopics.length; t++) {
          var topic = TEST_DATA.adaptiveTopics[t];
          if (topic.questions) {
            for (var j = 0; j < topic.questions.length; j++) {
              var aq = topic.questions[j];
              if (aq && String(aq.id) === String(qid)) return aq;
            }
          }
        }
      }
    }
    
    return null;
  }

  function normalizePool(qid, leftMapping, ans) {
    if (!state.matchingPools) state.matchingPools = {};
    if (!Array.isArray(state.matchingPools[qid])) state.matchingPools[qid] = leftMapping.slice();

    var pool = state.matchingPools[qid];

    // used left
    var used = {};
    Object.keys(ans || {}).forEach(function(k) {
      var li = parseInt(k, 10);
      if (!Number.isNaN(li)) used[li] = true;
    });

    // remove used from pool
    var next = [];
    for (var i = 0; i < pool.length; i++) {
      var li2 = pool[i];
      if (!used[li2]) next.push(li2);
    }

    // add missing unused in leftMapping order
    for (var j = 0; j < leftMapping.length; j++) {
      var li3 = leftMapping[j];
      if (used[li3]) continue;
      if (next.indexOf(li3) === -1) next.push(li3);
    }

    state.matchingPools[qid] = next;
    return next;
  }

  function removeFromPool(pool, leftIdx, poolIndex) {
    if (!Array.isArray(pool)) return -1;

    if (typeof poolIndex === 'number' && poolIndex >= 0 && poolIndex < pool.length && pool[poolIndex] === leftIdx) {
      pool.splice(poolIndex, 1);
      return poolIndex;
    }

    var idx = pool.indexOf(leftIdx);
    if (idx >= 0) {
      pool.splice(idx, 1);
      return idx;
    }

    return -1;
  }

  function insertIntoPool(pool, leftIdx, index) {
    if (!Array.isArray(pool)) return;
    var i = (typeof index === 'number') ? index : pool.length;
    if (i < 0) i = 0;
    if (i > pool.length) i = pool.length;
    pool.splice(i, 0, leftIdx);
  }

  function leftForRight(ans, rightIdx) {
    var keys = Object.keys(ans || {});
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (ans[k] === rightIdx) return parseInt(k, 10);
    }
    return null;
  }

  function removeLeftFromAnswers(ans, leftIdx) {
    if (!ans || typeof ans !== 'object') return;
    if (ans.hasOwnProperty(leftIdx)) delete ans[leftIdx];
    if (ans.hasOwnProperty(String(leftIdx))) delete ans[String(leftIdx)];
  }

  // dragstart
  document.addEventListener('dragstart', function(e) {
    var card = closestByClass(e.target, 'match-chip');
    if (!card) return;

    if (TEST_DATA.showCorrectAnswers && state.feedbackShown) {
      e.preventDefault();
      return;
    }

    var qid = card.getAttribute('data-qid');
    var left = parseInt(card.getAttribute('data-left'), 10);
    if (!qid || Number.isNaN(left)) return;

    var from = card.getAttribute('data-from') || 'pool';
    var payload = { qid: qid, leftIdx: left, from: from };

    var piStr = card.getAttribute('data-pool-index');
    if (piStr !== null && piStr !== '') {
      var pi = parseInt(piStr, 10);
      if (!Number.isNaN(pi)) payload.poolIndex = pi;
    }

    var riStr = card.getAttribute('data-right');
    if (riStr !== null && riStr !== '') {
      var ri = parseInt(riStr, 10);
      if (!Number.isNaN(ri)) payload.rightIdx = ri;
    }

    try {
      e.dataTransfer.setData('application/json', JSON.stringify(payload));
      e.dataTransfer.setData(
        'text/plain',
        payload.qid + '|' + payload.leftIdx + '|' + payload.from + '|' +
        (payload.poolIndex !== undefined ? payload.poolIndex : '') + '|' +
        (payload.rightIdx !== undefined ? payload.rightIdx : '')
      );
      e.dataTransfer.effectAllowed = 'move';
    } catch (err) {}
  });

  // dragover
  document.addEventListener('dragover', function(e) {
    var rightDrop = closestByClass(e.target, 'match-drop-right');
    var leftDrop = closestByClass(e.target, 'match-drop-left');
    var dropEl = rightDrop || leftDrop;
    if (!dropEl) return;

    if (TEST_DATA.showCorrectAnswers && state.feedbackShown) return;

    e.preventDefault();
    setMatchOver(dropEl);
    try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
  });

  document.addEventListener('dragleave', function(e) {
    var rightDrop = closestByClass(e.target, 'match-drop-right');
    var leftDrop = closestByClass(e.target, 'match-drop-left');
    var dropEl = rightDrop || leftDrop;
    if (!dropEl) return;

    // снимаем подсветку только если реально вышли из текущего drop
    if (__matchOverEl === dropEl && (!e.relatedTarget || !dropEl.contains(e.relatedTarget))) {
      clearMatchOver();
    }
  });

  // drop
  document.addEventListener('drop', function(e) {
    clearMatchOver();
    var rightDrop = closestByClass(e.target, 'match-drop-right');
    var leftDrop = closestByClass(e.target, 'match-drop-left');
    var dropEl = rightDrop || leftDrop;
    if (!dropEl) return;

    if (TEST_DATA.showCorrectAnswers && state.feedbackShown) return;

    e.preventDefault();
    dropEl.classList.remove('is-over');

    var payload = parsePayloadFromEvent(e);
    if (!payload || !payload.qid || Number.isNaN(payload.leftIdx)) return;

    var q = getCurrentQuestionById(payload.qid);
    if (!q || q.type !== 'matching') return;

    var ans = (state.answers[payload.qid] && typeof state.answers[payload.qid] === 'object') ? state.answers[payload.qid] : {};

    var shuffleMapping = state.shuffleMappings[q.id] || {};
    var leftMapping = shuffleMapping.left ? shuffleMapping.left : q.data.left.map(function(_, i){ return i; });

    var pool = normalizePool(payload.qid, leftMapping, ans);

    var poolSlotStr = dropEl.getAttribute('data-pool-slot');
    var targetRightStr = dropEl.getAttribute('data-right');
    var isPoolDrop = (poolSlotStr !== null && poolSlotStr !== '');

    if (isPoolDrop) {
      var targetSlot = parseInt(poolSlotStr, 10);
      if (Number.isNaN(targetSlot)) return;

      if (payload.from === 'pool') {
        var removedAt = removeFromPool(pool, payload.leftIdx, payload.poolIndex);
        if (removedAt >= 0 && removedAt < targetSlot) targetSlot = targetSlot - 1;
      } else {
        removeLeftFromAnswers(ans, payload.leftIdx);
      }

      insertIntoPool(pool, payload.leftIdx, targetSlot);

      state.answers[payload.qid] = ans;
      state.matchingPools[payload.qid] = pool;
      rerenderCurrentQuestionInput();
      return;
    }

    var targetRight = parseInt(targetRightStr, 10);
    if (Number.isNaN(targetRight)) return;

    if (payload.from === 'pool') {
      removeFromPool(pool, payload.leftIdx, payload.poolIndex);
    } else {
      removeLeftFromAnswers(ans, payload.leftIdx);
    }

    var oldLeft = leftForRight(ans, targetRight);
    if (oldLeft !== null && !Number.isNaN(oldLeft)) {
      removeLeftFromAnswers(ans, oldLeft);

      if (payload.from === 'pool' && typeof payload.poolIndex === 'number') {
        insertIntoPool(pool, oldLeft, payload.poolIndex);
      } else {
        insertIntoPool(pool, oldLeft, pool.length);
      }
    }

    ans[payload.leftIdx] = targetRight;

    Object.keys(ans).forEach(function(k) {
      var li = parseInt(k, 10);
      if (li !== payload.leftIdx && ans[k] === targetRight) delete ans[k];
    });

    state.answers[payload.qid] = ans;
    state.matchingPools[payload.qid] = pool;
    rerenderCurrentQuestionInput();
  });

  // dblclick matched -> return to pool
  document.addEventListener('dblclick', function(e) {
    var card = closestByClass(e.target, 'match-chip');
    if (!card) return;

    if (TEST_DATA.showCorrectAnswers && state.feedbackShown) return;

    var from = card.getAttribute('data-from');
    if (from !== 'match') return;

    var qid = card.getAttribute('data-qid');
    var leftIdx = parseInt(card.getAttribute('data-left'), 10);
    if (!qid || Number.isNaN(leftIdx)) return;

    var q = getCurrentQuestionById(qid);
    if (!q || q.type !== 'matching') return;

    var ans = (state.answers[qid] && typeof state.answers[qid] === 'object') ? state.answers[qid] : {};
    var shuffleMapping = state.shuffleMappings[q.id] || {};
    var leftMapping = shuffleMapping.left ? shuffleMapping.left : q.data.left.map(function(_, i){ return i; });

    var pool = normalizePool(qid, leftMapping, ans);

    removeLeftFromAnswers(ans, leftIdx);
    insertIntoPool(pool, leftIdx, pool.length);

    state.answers[qid] = ans;
    state.matchingPools[qid] = pool;
    rerenderCurrentQuestionInput();
  });
}