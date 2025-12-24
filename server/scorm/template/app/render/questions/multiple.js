function renderMultipleQuestionInput(q, answer, locked, correct, shuffleMapping) {
  var selectedArr = Array.isArray(answer) ? answer : [];
  var correctSet = Array.isArray(correct.correctIndices) ? correct.correctIndices : [];
  var displayOrder = shuffleMapping || q.data.options.map(function(_, i) { return i; });
  var html = '';

  displayOrder.forEach(function(originalIndex) {
    var isSelected = selectedArr.indexOf(originalIndex) !== -1;
    var isCorrect = correctSet.indexOf(originalIndex) !== -1;

    var correctClass = '';
    if (locked) {
      if (isCorrect) correctClass = ' correct-answer';
      else if (isSelected && !isCorrect) correctClass = ' incorrect-answer';
    }

    var clickHandler = locked ? '' : 'onclick="toggleMultiple(\'' + q.id + '\',' + originalIndex + ')"';
    html += '<div class="option ' + (isSelected ? 'selected' : '') + correctClass + '" data-index="' + originalIndex + '" ' + clickHandler + ' style="' + (locked ? 'cursor:default;' : '') + '">';
    html += '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' ' + (locked ? 'disabled' : '') + '>';
    html += escapeHtml(q.data.options[originalIndex]) + '</div>';
  });

  return html;
}
