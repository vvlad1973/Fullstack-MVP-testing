var __rankClickBound = false;

function bindRankingClicksOnce() {
  if (__rankClickBound) return;
  __rankClickBound = true;

  document.addEventListener('click', function(e) {
    var el = e.target;

    // fallback если closest нет
    while (el && el !== document) {
      if (el.classList && el.classList.contains('rank-btn')) break;
      el = el.parentNode;
    }
    if (!el || el === document) return;

    if (el.disabled) return;

    var qId = el.getAttribute('data-qid');
    var pos = parseInt(el.getAttribute('data-pos'), 10);
    var dir = parseInt(el.getAttribute('data-dir'), 10);

    if (!qId || Number.isNaN(pos) || Number.isNaN(dir)) return;

    moveRank(qId, pos, dir);
  });
}

var __rankDndBound = false;
function bindRankingDnDOnce(){
  if (__rankDndBound) return;
  __rankDndBound = true;

  var dragPayload = null; // { qid, fromPos, itemIdx }

  function closestByClass(node, cls) {
    var el = node;
    while (el && el !== document) {
      if (el.classList && el.classList.contains(cls)) return el;
      el = el.parentNode;
    }
    return null;
  }

  // function clearOver(){
  //   document.querySelectorAll('.rank-item.is-over').forEach(function(n){
  //     n.classList.remove('is-over');
  //   });
  // }

  function getPayload(e){
    try {
      var raw = e.dataTransfer.getData('application/json');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) { return null; }
  }

  function moveInArray(arr, from, to){
    if (from === to) return arr;
    var copy = arr.slice();
    var item = copy.splice(from, 1)[0];
    copy.splice(to, 0, item);
    return copy;
  }

  document.addEventListener('dragstart', function(e){
    var el = closestByClass(e.target, 'rank-draggable');
    if (!el) return;

    // блокируем DnD после принятия
    if (TEST_DATA.showCorrectAnswers && state.feedbackShown) {
      e.preventDefault();
      return;
    }

    var qid = el.getAttribute('data-qid');
    var fromPos = parseInt(el.getAttribute('data-pos'), 10);
    var itemIdx = parseInt(el.getAttribute('data-item'), 10);
    if (!qid || Number.isNaN(fromPos) || Number.isNaN(itemIdx)) return;

    dragPayload = { qid: qid, fromPos: fromPos, itemIdx: itemIdx };
    el.classList.add('dragging');

    try{
      e.dataTransfer.setData('application/json', JSON.stringify(dragPayload));
      e.dataTransfer.effectAllowed = 'move';
    }catch(err){}
  });

  document.addEventListener('dragend', function(e){
    var el = closestByClass(e.target, 'rank-draggable');
    if (el) el.classList.remove('dragging');
    dragPayload = null;
    clearMatchOver();
    // clearOver();
  });

  document.addEventListener('dragover', function(e){
    var over = closestByClass(e.target, 'rank-item');
    if (!over) return;

    if (TEST_DATA.showCorrectAnswers && state.feedbackShown) return;

    e.preventDefault();
    // clearOver();
    over.classList.add('is-over');

    try{ e.dataTransfer.dropEffect = 'move'; }catch(err){}
  });

  document.addEventListener('drop', function(e){
    var over = closestByClass(e.target, 'rank-item');
    if (!over) return;

    if (TEST_DATA.showCorrectAnswers && state.feedbackShown) return;

    e.preventDefault();
    over.classList.remove('is-over');

    var p = getPayload(e) || dragPayload;
    if (!p) return;

    var qid = over.getAttribute('data-qid');
    if (!qid || qid !== p.qid) return;

    var toPos = parseInt(over.getAttribute('data-pos'), 10);
    if (Number.isNaN(toPos)) return;

    var current = state.answers[qid];
    if (!Array.isArray(current)) return;

    state.answers[qid] = moveInArray(current, p.fromPos, toPos);
    rerenderCurrentQuestionInput();
  });
}