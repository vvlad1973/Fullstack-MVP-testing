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
  
  // Start button
  var noAttempts = hasLimit && left <= 0;

  html += '<div style="margin-top:24px;text-align:center;">';
  html += '<button class="btn" '
    + (noAttempts ? 'disabled ' : '')
    + 'onclick="' + (noAttempts ? 'return false;' : 'startTest()') + '" '
    + 'style="padding:14px 40px;font-size:16px;font-weight:600;'
    + (noAttempts ? 'opacity:.55;cursor:not-allowed;' : '')
    + '">'
    + (noAttempts ? 'Попытки закончились' : 'Начать тестирование')
    + '</button>';
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

  // фиксируем начало попытки
  var ok = registerAttemptStart();
  if (!ok) {
    showToast('Попытки закончились', 'warn');
    return;
  }

  state.phase = 'question';
  initTimer();
  render();
}


