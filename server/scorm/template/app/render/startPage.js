function renderStartPage() {
  var app = document.getElementById('app');
  var used = getAttemptsUsed();
  var hasLimit = !!TEST_DATA.maxAttempts;
  var left = hasLimit ? Math.max(0, TEST_DATA.maxAttempts - used) : null;

  var iconQuestions = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>';
  var iconPass = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  var iconTime = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  var iconAttempts = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>';

  var html = '<div class="start-page" style="max-width:600px;margin:40px auto;padding:0 18px;">';

  // Header card
  html += '<div class="card" style="padding:32px;text-align:center;margin-bottom:24px;background:hsl(var(--card));border:1px solid hsl(var(--border));">';
  html += '<h1 style="color:hsl(var(--foreground));margin:0;font-size:28px;font-weight:700;">' + escapeHtml(TEST_DATA.title) + '</h1>';
  if (TEST_DATA.description) {
    html += '<p style="color:hsl(var(--muted-foreground));margin-top:12px;margin-bottom:0;font-size:15px;">' + escapeHtml(TEST_DATA.description) + '</p>';
  }
  html += '</div>';

  // Info section
  html += '<div class="card" style="padding:24px;background:hsl(var(--card));border:1px solid hsl(var(--border));">';
  html += '<h2 style="margin:0 0 20px 0;font-size:18px;font-weight:700;color:hsl(var(--foreground));">Информация о тесте</h2>';

  html += '<div style="display:grid;gap:12px;">';

  // Количество вопросов
  html += '<div style="display:flex;align-items:center;gap:12px;padding:16px;background:hsl(var(--muted));border-radius:12px;border:1px solid hsl(var(--border));">';
  html += '<div style="flex-shrink:0;color:#4f46e5;">' + iconQuestions + '</div>';
  html += '<div style="flex:1;"><div style="font-weight:600;color:hsl(var(--foreground));font-size:14px;">Количество вопросов</div><div style="color:hsl(var(--muted-foreground));font-size:13px;margin-top:2px;">' + TEST_DATA.totalQuestions + '</div></div>';
  html += '</div>';

  // Проходной балл
  html += '<div style="display:flex;align-items:center;gap:12px;padding:16px;background:hsl(var(--muted));border-radius:12px;border:1px solid hsl(var(--border));">';
  html += '<div style="flex-shrink:0;color:#16a34a;">' + iconPass + '</div>';
  html += '<div style="flex:1;"><div style="font-weight:600;color:hsl(var(--foreground));font-size:14px;">Проходной балл</div><div style="color:hsl(var(--muted-foreground));font-size:13px;margin-top:2px;">' + TEST_DATA.passPercent + '%</div></div>';
  html += '</div>';

  // Ограничение времени
  if (TEST_DATA.timeLimitMinutes) {
    html += '<div style="display:flex;align-items:center;gap:12px;padding:16px;background:hsl(var(--muted));border-radius:12px;border:1px solid hsl(var(--border));">';
    html += '<div style="flex-shrink:0;color:#f59e0b;">' + iconTime + '</div>';
    html += '<div style="flex:1;"><div style="font-weight:600;color:hsl(var(--foreground));font-size:14px;">Ограничение времени</div><div style="color:hsl(var(--muted-foreground));font-size:13px;margin-top:2px;">' + TEST_DATA.timeLimitMinutes + ' минут</div></div>';
    html += '</div>';
  }

  // Количество попыток
  if (TEST_DATA.maxAttempts) {
    html += '<div style="display:flex;align-items:center;gap:12px;padding:16px;background:hsl(var(--muted));border-radius:12px;border:1px solid hsl(var(--border));">';
    html += '<div style="flex-shrink:0;color:#8b5cf6;">' + iconAttempts + '</div>';
    html += '<div style="flex:1;"><div style="font-weight:600;color:hsl(var(--foreground));font-size:14px;">Попытки</div><div style="color:hsl(var(--muted-foreground));font-size:13px;margin-top:2px;">'
      + (hasLimit ? ('осталось ' + left + ' из ' + TEST_DATA.maxAttempts) : 'без ограничений')
      + '</div></div>';
    html += '</div>';
  }

  html += '</div>';

  // Custom content
  if (TEST_DATA.startPageContent) {
    html += '<div style="margin-top:20px;padding:16px;background:hsl(var(--muted));border-radius:12px;border-left:4px solid hsl(var(--primary));border:1px solid hsl(var(--border));">';
    html += '<div style="color:hsl(var(--foreground));font-size:14px;line-height:1.6;">' + escapeHtml(TEST_DATA.startPageContent) + '</div>';
    html += '</div>';
  }

  // ===== ЛОГИКА КНОПОК =====
  var noAttempts = hasLimit && left <= 0;
  var hasCompletedAttempts = !!getAllAttempts() && getAllAttempts().length > 0;
  var canStartNewAttempt = hasAttemptsLeft();

  html += '<div style="margin-top:24px;">';

  // Случай 1: Попытки закончились, есть результаты — только "Мой результат"
  if (noAttempts && hasCompletedAttempts) {
    html += '<div style="text-align:center;">';
    html += '<button class="btn" onclick="viewSavedResults()" style="padding:14px 40px;font-size:16px;font-weight:600;">';
    html += 'Мой результат';
    html += '</button>';
    html += '</div>';
  }
  // Случай 2: Есть попытки И есть завершённые результаты — две кнопки
  else if (canStartNewAttempt && hasCompletedAttempts) {
    html += '<div style="display:flex;gap:12px;flex-direction:column;align-items:center;">';
    html += '<button class="btn" onclick="startTest()" style="padding:14px 40px;font-size:16px;font-weight:600;">';
    html += 'Начать тестирование заново';
    html += '</button>';
    html += '<button class="btn" style="padding:14px 40px;font-size:16px;font-weight:600;background:hsl(var(--muted));color:hsl(var(--foreground));" onclick="viewSavedResults()">';
    html += 'Мой результат';
    html += '</button>';
    html += '</div>';
  }
  // Случай 3: Первый вход или нет завершённых попыток
  else {
    html += '<div style="text-align:center;">';
    html += '<button class="btn" '
      + (noAttempts ? 'disabled ' : '')
      + 'onclick="' + (noAttempts ? 'return false;' : 'startTest()') + '" '
      + 'style="padding:14px 40px;font-size:16px;font-weight:600;'
      + (noAttempts ? 'opacity:.55;cursor:not-allowed;' : '')
      + '">'
      + (noAttempts ? 'Попытки закончились' : 'Начать тестирование')
      + '</button>';
    html += '</div>';
  }

  html += '</div>';

  // закрываем карточку и обёртку страницы
  html += '</div></div>';

  app.innerHTML = html;
}

function startTest() {
  if (!hasAttemptsLeft()) {
    showToast('Попытки закончились', 'warn');
    return;
  }

  // ===== СОХРАНЯЕМ ПРЕДЫДУЩУЮ ПОПЫТКУ ЕСЛИ ПОЛЬЗОВАТЕЛЬ РЕАЛЬНО ОТВЕЧАЛ =====
  // Проверяем что:
  // 1. Есть вопросы в текущем варианте
  // 2. Пользователь прошёл хотя бы один вопрос (currentIndex > 0)
  // 3. Была зарегистрирована попытка (attemptsUsed > 0)
  var hasRealProgress = state.flatQuestions && 
                        state.flatQuestions.length > 0 && 
                        state.currentIndex > 0 &&
                        getAttemptsUsed() > 0;
  
  if (hasRealProgress) {
    console.log('💾 Сохраняем предыдущую попытку перед новым стартом');
    var results = calculateResults();
    saveAttemptResult(results);
    
    // Сохраняем текущий номер попытки ДО любых изменений
    var currentAttemptNum = Telemetry.getAttemptNumber();
    
    // ===== ОТПРАВЛЯЕМ ТЕЛЕМЕТРИЮ FINISH ДЛЯ ЭТОЙ ПОПЫТКИ =====
    Telemetry.finish({
      percent: results.percent,
      passed: results.passed,
      earnedPoints: results.earnedPoints,
      possiblePoints: results.possiblePoints,
      totalQuestions: results.totalQuestions,
      correct: results.correct,
      achievedLevels: results.achievedLevels || null
    }, currentAttemptNum);
    console.log('📤 Телеметрия finish отправлена для попытки:', currentAttemptNum);
    
    // Сбрасываем state для новой попытки
    state.answers = {};
    state.currentIndex = 0;
    state.submitted = false;
    state.feedbackShown = false;
    state.timeExpired = false;
    state.variant = null;
    state.flatQuestions = [];
    state.shuffleMappings = {};
    
    // Генерируем новый вариант
    generateVariant();
  }

  // фиксируем начало попытки
  var ok = registerAttemptStart();
  if (!ok) {
    showToast('Попытки закончились', 'warn');
    return;
  }

  // Send telemetry start
  Telemetry.start();

  state.phase = 'question';
  initTimer();
  render();
}

// ============================================
// ЗАМЕНИ функцию restart() в startPage.js на эту:
// ============================================

function restart() {
  if (!hasAttemptsLeft()) {
    showToast('Попытки закончились', 'warn');
    return;
  }

  // ===== СОХРАНЯЕМ ТЕКУЩУЮ ПОПЫТКУ ЕСЛИ ПОЛЬЗОВАТЕЛЬ РЕАЛЬНО ОТВЕЧАЛ =====
  var hasRealProgress = state.flatQuestions && 
                        state.flatQuestions.length > 0 && 
                        state.currentIndex > 0 &&
                        getAttemptsUsed() > 0;
  
  if (hasRealProgress) {
    console.log('💾 Сохраняем текущую попытку перед перезапуском');
    var results = calculateResults();
    saveAttemptResult(results);
    
    // Сохраняем текущий номер попытки ДО увеличения
    var currentAttemptNum = Telemetry.getAttemptNumber();
    
    // Отправляем телеметрию finish с явным номером попытки
    Telemetry.finish({
      percent: results.percent,
      passed: results.passed,
      earnedPoints: results.earnedPoints,
      possiblePoints: results.possiblePoints,
      totalQuestions: results.totalQuestions,
      correct: results.correct,
      achievedLevels: results.achievedLevels || null
    }, currentAttemptNum);
  }

  // ===== ПОЛНЫЙ СБРОС STATE =====
  state.answers = {};
  state.currentIndex = 0;
  state.phase = 'start';
  state.timeExpired = false;
  state.submitted = false;
  state.answerConfirmed = false;
  state.feedbackShown = false;  // <-- ЭТО КЛЮЧЕВОЕ!
  state.variant = null;
  state.flatQuestions = [];
  state.shuffleMappings = {};
  state.matchingPools = {};
  
  // Сброс таймера
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.remainingSeconds = null;
  
  // Сброс adaptive state если есть
  if (state.adaptiveState) {
    state.adaptiveState = null;
  }
  
  // ===== ОЧИСТКА DOM от старого фидбека =====
  var feedbackBlock = document.querySelector('.feedback-block');
  if (feedbackBlock) {
    feedbackBlock.remove();
  }
  
  // Удаляем классы подсветки ответов
  document.querySelectorAll('.correct-answer, .incorrect-answer').forEach(function(el) {
    el.classList.remove('correct-answer', 'incorrect-answer');
  });
  
  // ===== ГЕНЕРАЦИЯ НОВОГО ВАРИАНТА =====
  generateVariant();
  
  // ===== ТЕЛЕМЕТРИЯ: НОВАЯ ПОПЫТКА =====
  Telemetry.startNewAttempt();
  
  // ===== РЕГИСТРАЦИЯ ПОПЫТКИ В SCORM =====
  var ok = registerAttemptStart();
  if (!ok) {
    showToast('Попытки закончились', 'warn');
    return;
  }

  // ===== ЗАПУСК ТЕСТА =====
  state.phase = 'question';
  initTimer();
  render();
}

window.restart = restart;

// ===== ПРОСМОТР СОХРАНЁННЫХ РЕЗУЛЬТАТОВ =====
function viewSavedResults() {
  var bestAttempt = getBestAttempt();
  if (!bestAttempt) {
    showToast('Нет завершённых попыток', 'warn');
    return;
  }
  
  console.log('📊 Просмотр лучшей попытки:', Math.round(bestAttempt.percent) + '%');
  
  state.phase = 'viewResults';
  state.viewedAttempt = bestAttempt;
  render();
}

window.viewSavedResults = viewSavedResults;