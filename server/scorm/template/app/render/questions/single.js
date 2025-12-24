function renderSingleQuestionInput(q, answer, locked, correct, shuffleMapping) {
  var correctIndex = (typeof correct.correctIndex === 'number') ? correct.correctIndex : -1;
  var displayOrder = shuffleMapping || q.data.options.map(function(_, i) { return i; });
  var html = '';

  displayOrder.forEach(function(originalIndex) {
    var selected = answer === originalIndex ? 'selected' : '';
    var correctClass = '';
    if (locked) {
      if (originalIndex === correctIndex) correctClass = ' correct-answer';
      else if (answer === originalIndex && originalIndex !== correctIndex) correctClass = ' incorrect-answer';
    }
    var clickHandler = locked ? '' : 'onclick="selectSingle(\'' + q.id + '\',' + originalIndex + ')"';
    html += '<div class="option ' + selected + correctClass + '" data-index="' + originalIndex + '" ' + clickHandler + ' style="' + (locked ? 'cursor:default;' : '') + '">';
    html += '<input type="radio" name="q_' + q.id + '" ' + (answer === originalIndex ? 'checked' : '') + ' ' + (locked ? 'disabled' : '') + '>';
    html += escapeHtml(q.data.options[originalIndex]) + '</div>';
  });

  return html;
}
