function renderQuestionInput(q) {
  var answer = state.answers[q.id];
  var locked = TEST_DATA.showCorrectAnswers && state.feedbackShown;
  var correct = q.correct || {};
  var shuffleMapping = state.shuffleMappings[q.id];

  if (q.type === 'single')   return renderSingleQuestionInput(q, answer, locked, correct, shuffleMapping);
  if (q.type === 'multiple') return renderMultipleQuestionInput(q, answer, locked, correct, shuffleMapping);
  if (q.type === 'matching') return renderMatchingQuestionInput(q, answer, locked, correct, shuffleMapping);
  if (q.type === 'ranking')  return renderRankingQuestionInput(q, answer, locked, correct, shuffleMapping);

  return '<div>Неизвестный тип вопроса</div>';
}
