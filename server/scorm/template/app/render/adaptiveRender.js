// app/render/adaptiveRender.js
// Rendering for adaptive test mode

/**
 * Render adaptive question page
 */
function renderAdaptiveQuestion() {
  var app = document.getElementById('app');
  var qData = getCurrentAdaptiveQuestion();

  if (!qData) {
    // No more questions - show results
    renderAdaptiveResults();
    return;
  }

  var q = qData.question;

  // Generate shuffle mapping for this question if not exists
  if (!state.shuffleMappings[q.id]) {
    if (q.type === 'single' || q.type === 'multiple') {
      var optCount = q.data.options ? q.data.options.length : 0;
      if (optCount > 0) {
        state.shuffleMappings[q.id] = createShuffleMapping(optCount);
      }
    } else if (q.type === 'matching') {
      var leftCount = q.data.left ? q.data.left.length : 0;
      var rightCount = q.data.right ? q.data.right.length : 0;
      if (leftCount > 0 && rightCount > 0) {
        state.shuffleMappings[q.id] = {
          left: createShuffleMapping(leftCount),
          right: createShuffleMapping(rightCount)
        };
      }
    } else if (q.type === 'ranking') {
      var itemCount = q.data.items ? q.data.items.length : 0;
      if (itemCount > 0) {
        state.shuffleMappings[q.id] = createShuffleMapping(itemCount);
        if (!state.answers[q.id]) {
          state.answers[q.id] = state.shuffleMappings[q.id].slice();
        }
      }
    }
  }

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
  html += '<h1 style="margin:0">' + escapeHtml(TEST_DATA.title) + '</h1>';
  if (state.remainingSeconds !== null) {
    var timerClass = state.remainingSeconds <= 60 ? 'style="color:#dc2626;font-weight:bold;font-size:18px;"' : 'style="color:#666;font-size:18px;"';
    html += '<div id="timer-display" ' + timerClass + '>' + formatTime(state.remainingSeconds) + '</div>';
  }
  html += '</div>';

  // Topic and level info
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  html += '<div style="color:#666;font-size:14px;">Тема: <span style="color:hsl(var(--foreground));font-weight:500;">' + escapeHtml(qData.topicName) + '</span></div>';
  if (TEST_DATA.showDifficultyLevel) {
    html += '<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:hsl(var(--primary));color:hsl(var(--primary-foreground));border-radius:20px;font-size:13px;font-weight:500;">';
    html += escapeHtml(qData.levelName);
    html += '</div>';
  }
  html += '</div>';

  // Progress for current level
  var progress = (qData.questionNumber / qData.totalInLevel) * 100;
  html += '<div class="progress-bar"><div class="progress-fill" style="width:' + progress + '%"></div></div>';

  // Question card
  html += '<div class="card">';
  html += '<div style="color:#666;margin-bottom:8px;">Вопрос ' + qData.questionNumber + ' из ' + qData.totalInLevel + '</div>';
  html += '<div class="question-text">' + escapeHtml(q.prompt) + '</div>';
  html += renderQuestionMedia(q);
  html += '<div id="question-input">';
  html += renderQuestionInput(q);
  html += '</div>';

  // Feedback after answer (if showCorrectAnswers and feedback is shown)
  if (TEST_DATA.showCorrectAnswers && state.feedbackShown && state.lastAdaptiveResult) {
    var isCorrect = state.lastAdaptiveResult.isCorrect;
    var statusColor = isCorrect ? '#16a34a' : '#dc2626';
    var statusText = isCorrect ? 'Правильно!' : 'Неправильно';

    html += '<div style="margin-top:16px;padding:12px;border-radius:8px;background:' + (isCorrect ? '#dcfce7' : '#fee2e2') + ';border:1px solid ' + statusColor + ';">';
    html += '<div style="font-weight:600;color:' + statusColor + ';margin-bottom:4px;">' + statusText + '</div>';

    var feedbackText = null;
    if (q.feedbackMode === 'conditional') {
      feedbackText = isCorrect ? q.feedbackCorrect : q.feedbackIncorrect;
    } else {
      feedbackText = q.feedback;
    }

    if (feedbackText) {
      html += '<div style="color:#333;font-size:14px;">' + escapeHtml(feedbackText) + '</div>';
    }
    html += '</div>';
  }

  html += '</div>';

  // Navigation
  html += '<div class="navigation" style="justify-content:flex-end">';
  if (TEST_DATA.showCorrectAnswers && !state.feedbackShown) {
    html += '<button class="btn" onclick="confirmAdaptiveAnswer()">Принять</button>';
  } else {
    html += '<button class="btn" onclick="continueAfterFeedback()">Далее</button>';
  }
  html += '</div>';

  app.innerHTML = html;
  syncMatchingHeights();
}

/**
 * Confirm answer (for showCorrectAnswers mode) - shows feedback without moving to next question
 */
function confirmAdaptiveAnswer() {
  var qData = getCurrentAdaptiveQuestion();
  if (!qData) return;

  var answer = state.answers[qData.id];
  if (answer === undefined || answer === null) {
    showToast('Пожалуйста, ответьте на вопрос', 'warn');
    return;
  }

  // Validate answer completeness
  if (!validateAdaptiveAnswer(qData.question, answer)) {
    return;
  }

  // Check answer correctness but DON'T submit yet - just show feedback
  var isCorrect = checkAnswer(qData.question, answer) === 1;
  
  state.lastAdaptiveResult = {
    isCorrect: isCorrect,
    questionId: qData.id
  };
  state.feedbackShown = true;

  // Re-render to show feedback on CURRENT question
  renderAdaptiveQuestion();
}

/**
 * Continue after viewing feedback - now actually submit and move forward
 */
function continueAfterFeedback() {
  var qData = getCurrentAdaptiveQuestion();
  if (!qData) return;

  var answer = state.answers[qData.id];
  
  // Now actually submit the answer
  var result = submitAdaptiveAnswer(qData.id, answer);
  
  // Reset feedback state
  state.feedbackShown = false;
  state.lastAdaptiveResult = null;

  // Check for transitions - only show if showDifficultyLevel is enabled
  if (TEST_DATA.showDifficultyLevel && (result.levelTransition || result.topicTransition)) {
    state.pendingTransition = result;
    renderAdaptiveTransition(result);
  } else if (result.isFinished) {
    renderAdaptiveResults();
  } else {
    renderAdaptiveQuestion();
  }
}

/**
 * Submit answer and continue (when showCorrectAnswers is OFF)
 */
function submitAdaptiveAnswerAndContinue() {
  var qData = getCurrentAdaptiveQuestion();
  if (!qData) return;

  var answer = state.answers[qData.id];
  if (answer === undefined || answer === null) {
    showToast('Пожалуйста, ответьте на вопрос', 'warn');
    return;
  }

  // Validate answer completeness
  if (!validateAdaptiveAnswer(qData.question, answer)) {
    return;
  }

  var result = submitAdaptiveAnswer(qData.id, answer);

  // Check for transitions - only show if showDifficultyLevel is enabled
  if (TEST_DATA.showDifficultyLevel && (result.levelTransition || result.topicTransition)) {
    state.pendingTransition = result;
    renderAdaptiveTransition(result);
  } else if (result.isFinished) {
    renderAdaptiveResults();
  } else {
    renderAdaptiveQuestion();
  }
}

/**
 * Validate answer completeness
 */
function validateAdaptiveAnswer(question, answer) {
  if (question.type === 'multiple' && Array.isArray(answer) && answer.length === 0) {
    showToast('Выберите хотя бы один вариант', 'warn');
    return false;
  }

  if (question.type === 'matching') {
    var leftItems = question.data.left || [];
    var pairs = answer || {};
    for (var i = 0; i < leftItems.length; i++) {
      if (pairs[i] === undefined || pairs[i] === null) {
        showToast('Сопоставьте все элементы', 'warn');
        return false;
      }
    }
  }

  return true;
}

/**
 * Render transition screen between levels/topics
 */
function renderAdaptiveTransition(result) {
  var app = document.getElementById('app');
  var isCorrect = result.isCorrect;
  var transition = result.levelTransition;
  var topicTransition = result.topicTransition;

  var html = '<div style="max-width:500px;margin:80px auto;text-align:center;">';

  // Icon
  if (isCorrect) {
    html += '<div style="width:80px;height:80px;margin:0 auto 24px;background:#166534;border-radius:50%;display:flex;align-items:center;justify-content:center;">';
    html += '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>';
    html += '</div>';
  } else {
    html += '<div style="width:80px;height:80px;margin:0 auto 24px;background:#991b1b;border-radius:50%;display:flex;align-items:center;justify-content:center;">';
    html += '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" stroke-width="2.5"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>';
    html += '</div>';
  }

  html += '<h2 style="margin:0 0 24px;font-size:28px;color:#fff;">' + (isCorrect ? 'Правильно!' : 'Неправильно') + '</h2>';

  // Level transition message
  if (transition) {
    var bgColor, borderColor, textColor, iconSvg;
    if (transition.type === 'up') {
      bgColor = '#166534';
      borderColor = '#22c55e';
      textColor = '#bbf7d0';
      iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    } else if (transition.type === 'down') {
      bgColor = '#991b1b';
      borderColor = '#ef4444';
      textColor = '#fecaca';
      iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
    } else {
      // complete
      bgColor = '#1e40af';
      borderColor = '#3b82f6';
      textColor = '#bfdbfe';
      iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
    }

    html += '<div style="padding:20px 24px;background:' + bgColor + ';border:2px solid ' + borderColor + ';border-radius:16px;margin-bottom:20px;">';
    html += '<div style="display:flex;align-items:center;justify-content:center;gap:12px;">';
    html += iconSvg;
    html += '<span style="font-size:18px;font-weight:500;color:' + textColor + ';">' + escapeHtml(transition.message) + '</span>';
    html += '</div>';
    html += '</div>';
  }

  // Topic transition message
  if (topicTransition) {
    html += '<p style="color:#9ca3af;font-size:16px;margin-top:16px;">Переход к теме: <strong style="color:#fff;">' + escapeHtml(topicTransition.toTopic) + '</strong></p>';
  }

  html += '<button class="btn" onclick="continueAfterTransition()" style="margin-top:32px;padding:14px 40px;font-size:16px;">Продолжить</button>';
  html += '</div>';

  app.innerHTML = html;

  // Auto-continue after delay
  setTimeout(function() {
    if (state.pendingTransition) {
      continueAfterTransition();
    }
  }, 2500);
}

/**
 * Continue after transition screen
 */
function continueAfterTransition() {
  state.pendingTransition = null;

  if (state.adaptiveState.isFinished) {
    renderAdaptiveResults();
  } else {
    renderAdaptiveQuestion();
  }
}

/**
 * Render adaptive test results
 */
function renderAdaptiveResults() {
  var app = document.getElementById('app');
  var result = state.adaptiveState.result;

  if (!result) {
    result = buildAdaptiveResult();
    state.adaptiveState.result = result;
  }

  var passed = result.overallPassed;

  var html = '<div class="results-page">';

  // Hero section
  html += '<div class="results-hero">';
  html += '<div class="results-hero-icon ' + (passed ? 'is-pass' : 'is-fail') + '">';
  if (passed) {
    html += '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10"/><path d="M17 4v5a5 5 0 0 1-10 0V4"/><path d="M5 6h2"/><path d="M17 6h2"/></svg>';
  } else {
    html += '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
  }
  html += '</div>';
  html += '<div class="results-hero-title">' + (passed ? 'Тест завершён!' : 'Тест завершён') + '</div>';
  html += '<div class="results-hero-sub">Адаптивное тестирование</div>';
  html += '</div>';

  // Topic results
  html += '<div class="results-section-title">Результаты по темам</div>';
  html += '<div class="results-topics-grid">';

  result.topicResults.forEach(function(tr) {
    var achieved = tr.achievedLevelIndex !== null;

    html += '<div class="card topic-card">';
    
    // Topic header
    html += '<div class="topic-head">';
    html += '<div class="topic-left">';
    html += '<div class="topic-icon ' + (achieved ? 'is-pass' : 'is-fail') + '">';
    if (achieved) {
      html += '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>';
    } else {
      html += '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    }
    html += '</div>';
    html += '<div class="topic-name">' + escapeHtml(tr.topicName) + '</div>';
    html += '</div>';
    
    // Achieved level badge
    if (achieved) {
      html += '<div class="results-pill is-pass">' + escapeHtml(tr.achievedLevelName) + '</div>';
    } else {
      html += '<div class="results-pill is-fail">Не достигнут</div>';
    }
    html += '</div>';

    // Stats
    html += '<div class="topic-row">';
    html += '<div class="k">Вопросов</div>';
    html += '<div class="val">' + tr.totalQuestionsAnswered + '</div>';
    html += '</div>';

    html += '<div class="topic-row">';
    html += '<div class="k">Правильных</div>';
    html += '<div class="val">' + tr.totalCorrect + ' (' + Math.round(tr.levelPercent) + '%)</div>';
    html += '</div>';

    // Progress bar
    html += '<div class="topic-bar ' + (achieved ? 'is-pass' : 'is-fail') + '">';
    html += '<div style="width:' + Math.min(100, Math.max(0, tr.levelPercent)) + '%"></div>';
    html += '</div>';

    // Feedback
    if (tr.feedback) {
      html += '<div style="margin-top:12px;padding:10px;background:hsl(var(--muted));border-radius:8px;font-size:13px;color:hsl(var(--muted-foreground));">';
      html += escapeHtml(tr.feedback);
      html += '</div>';
    }

    // Recommended links
    if (tr.recommendedLinks && tr.recommendedLinks.length > 0) {
      html += '<div style="margin-top:12px;">';
      html += '<div style="font-size:12px;color:hsl(var(--muted-foreground));margin-bottom:6px;">Рекомендуемые материалы:</div>';
      tr.recommendedLinks.forEach(function(link) {
        html += '<a href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:6px;padding:8px;background:hsl(var(--muted)/.5);border-radius:6px;margin-top:4px;text-decoration:none;color:hsl(var(--primary));font-size:13px;">';
        html += '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>';
        html += escapeHtml(link.title);
        html += '</a>';
      });
      html += '</div>';
    }

    html += '</div>';
  });

  html += '</div>';

  // Actions
  html += '<div class="results-actions">';
  html += '<button class="btn btn-outline" onclick="downloadPDF()">📄 Скачать PDF</button>';
  html += '<button class="btn" onclick="finishAndClose()">Завершить тест</button>';
  html += '</div>';

  html += '</div>';

  app.innerHTML = html;
}