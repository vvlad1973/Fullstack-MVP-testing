

var scormFinished = false;

function finishAndClose() {
  if (scormFinished) return;
  scormFinished = true;

  var results = calculateResults();

  var attemptsExhausted = !!TEST_DATA.maxAttempts && !hasAttemptsLeft();
  var realPassed = !!results.passed;

  // по умолчанию — честно
  var passedForLms = realPassed;

  // если время вышло — считаем провалом (и не закрываем "читом")
  if (state.timeExpired) {
    passedForLms = false;
  }

  // ✅ ХАК ДЛЯ WebSoft:
  // если попытки кончились и тест НЕ пройден — закрываем курс, иначе он висит "в процессе"
  if (attemptsExhausted && !realPassed && !state.timeExpired) {
    passedForLms = true;

    // маркер в данные, чтобы было видно, что фактически не сдал
    try {
      SCORM.setValue('cmi.comments_from_learner', 'ATTEMPTS_EXHAUSTED: FAILED (forced close)');
    } catch (e) {}
  }

  finishScorm(results, passedForLms);

  try { SCORM.commit(); } catch (e) {}
  try { SCORM.terminate(); } catch (e) {}
  try { window.close(); } catch (e) {}
}


window.finishAndClose = finishAndClose;


function calculateResults() {
  var totalEarnedPoints = 0;  // Sum of earned points (weighted by question points)
  var totalPossiblePoints = 0; // Total possible points
  var totalFullyCorrect = 0; // Fully correct count
  var totalQuestions = 0;
  var topicData = {};

  state.flatQuestions.forEach(function(fq) {
    var q = fq.question;
    var answer = state.answers[q.id];
    var scoreRatio = checkAnswer(q, answer);
    var qPoints = q.points || 1;

    totalPossiblePoints += qPoints;
    totalEarnedPoints += qPoints * scoreRatio;
    totalQuestions++;
    if (scoreRatio === 1) totalFullyCorrect++;

    if (!topicData[fq.topicId]) {
      var section = TEST_DATA.sections.find(function(s) { return s.topicId === fq.topicId; });
      topicData[fq.topicId] = {
        topicId: fq.topicId,
        topicName: fq.topicName,
        correct: 0,
        earnedPoints: 0,
        possiblePoints: 0,
        total: 0,
        passRule: section.topicPassRule,
        topicFeedback: section.topicFeedback || null,
        recommendedCourses: section.recommendedCourses || []
      };
    }
    topicData[fq.topicId].total++;
    topicData[fq.topicId].possiblePoints += qPoints;
    topicData[fq.topicId].earnedPoints += qPoints * scoreRatio;
    if (scoreRatio === 1) topicData[fq.topicId].correct++;
  });

  // Use point-based percentage for overall score (matches backend)
  var overallPercent = totalPossiblePoints > 0 ? (totalEarnedPoints / totalPossiblePoints) * 100 : 0;
  // Pass rule evaluation: percent type uses point-based percentage, count type uses fully correct count
  var overallPassed = checkPassRuleWithPartial(TEST_DATA.overallPassRule, overallPercent, totalFullyCorrect);

  var topicResults = [];
  var allTopicsPassed = true;

  Object.keys(topicData).forEach(function(tid) {
    var td = topicData[tid];
    // Use point-based percentage (matches backend)
    td.percent = td.possiblePoints > 0 ? (td.earnedPoints / td.possiblePoints) * 100 : 0;
    if (td.passRule) {
      td.passed = checkPassRuleWithPartial(td.passRule, td.percent, td.correct);
      if (!td.passed) allTopicsPassed = false;
    } else {
      td.passed = null;
    }
    topicResults.push(td);
  });

  var passed = overallPassed && allTopicsPassed;

  return {
    correct: totalFullyCorrect,
    totalQuestions: totalQuestions,
    earnedPoints: totalEarnedPoints,
    possiblePoints: totalPossiblePoints,
    percent: overallPercent,
    passed: passed,
    topicResults: topicResults
  };
}

// Returns a score between 0 and 1 (supports partial credit)
function checkAnswer(q, answer) {
  if (answer === undefined || answer === null) return 0;

  var correct = q.correct || {};

  // SINGLE
  if (q.type === 'single') {
    return answer === correct.correctIndex ? 1 : 0;
  }

  // MULTIPLE — строгое совпадение множеств
  if (q.type === 'multiple') {
    var correctIndices = Array.isArray(correct.correctIndices) ? correct.correctIndices.slice() : [];
    var user = Array.isArray(answer) ? answer.slice() : [];

    if (correctIndices.length === 0) return 0;
    if (user.length !== correctIndices.length) return 0;

    correctIndices.sort();
    user.sort();

    for (var i = 0; i < correctIndices.length; i++) {
      if (correctIndices[i] !== user[i]) return 0;
    }
    return 1;
  }

  // MATCHING — все пары должны совпасть
  if (q.type === 'matching') {
    var pairs = (answer && typeof answer === 'object') ? answer : {};
    var correctPairs = Array.isArray(correct.pairs) ? correct.pairs : [];

    if (Object.keys(pairs).length !== correctPairs.length) return 0;

    for (var i = 0; i < correctPairs.length; i++) {
      var p = correctPairs[i];
      if (pairs[p.left] !== p.right) return 0;
    }
    return 1;
  }

  // RANKING — порядок должен совпасть полностью
  if (q.type === 'ranking') {
    var order = Array.isArray(answer) ? answer : [];
    var correctOrder = Array.isArray(correct.correctOrder) ? correct.correctOrder : [];

    if (order.length !== correctOrder.length) return 0;

    for (var i = 0; i < order.length; i++) {
      if (order[i] !== correctOrder[i]) return 0;
    }
    return 1;
  }

  return 0;
}

function checkPassRule(rule, correct, total) {
  if (!rule) return true;
  if (rule.type === 'percent') {
    return (correct / total) * 100 >= rule.value;
  }
  return correct >= rule.value;
}

// Pass rule check that properly handles partial credit
// For percent rules, uses the already-calculated percent (from earned/possible)
// For count rules, uses the fully correct count
function checkPassRuleWithPartial(rule, percent, fullyCorrectCount) {
  if (!rule) return true;
  if (rule.type === 'percent') {
    return percent >= rule.value;
  }
  return fullyCorrectCount >= rule.value;
}

function finishScorm(results, passedForLms) {
  var objectives = results.topicResults.map(function(tr) {
    return {
      id: 'topic_' + tr.topicId,
      score: Math.round(tr.percent),
      status: tr.passed === null ? 'unknown' : (tr.passed ? 'passed' : 'failed')
    };
  });

  var interactions = [];

  function to1(x) { return typeof x === 'number' ? x + 1 : x; }

  function mapScormType(q) {
    if (q.type === 'single') return 'choice';
    if (q.type === 'multiple') return 'choice';
    if (q.type === 'matching') return 'matching';
    if (q.type === 'ranking') return 'sequencing';
    return 'other';
  }

  function formatResponse(q, ans) {
    if (ans == null) return '';

    if (q.type === 'single') return String(to1(ans));
    if (q.type === 'multiple') return ans.map(to1).join(',');
    if (q.type === 'ranking') return ans.map(to1).join(',');
    if (q.type === 'matching') {
      return Object.keys(ans)
        .sort((a,b)=>a-b)
        .map(k => to1(+k) + '-' + to1(ans[k]))
        .join(',');
    }
    return '';
  }

  function getCorrectAnswerFor(q) {
    var c = q.correct || {};
    if (q.type === 'single') return c.correctIndex;
    if (q.type === 'multiple') return c.correctIndices || [];
    if (q.type === 'ranking') return c.correctOrder || [];
    if (q.type === 'matching') {
      var m = {};
      (c.pairs || []).forEach(function(p){ m[p.left] = p.right; });
      return m;
    }
    return null;
  }

  state.flatQuestions.forEach(function(fq) {
    var q = fq.question;
    var ans = state.answers[q.id];
    var fullCorrect = checkAnswer(q, ans) === 1;

    interactions.push({
      id: 'q_' + q.id,
      type: mapScormType(q),
      result: fullCorrect ? 'correct' : 'incorrect',
      response: formatResponse(q, ans),
      correct: formatResponse(q, getCorrectAnswerFor(q)),
      description: q.prompt || ''
    });
  });

  var percentScore = Math.round(results.percent);
  SCORM.finish(percentScore, 100, passedForLms, objectives, interactions);
}