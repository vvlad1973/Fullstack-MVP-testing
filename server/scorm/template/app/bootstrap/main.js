// app/bootstrap/main.js
(function () {
  function boot() {
    // SCORM runtime должен быть уже загружен (runtime.js)
    SCORM.init();

    // Initialize telemetry if configured
    if (TEST_DATA.telemetry) {
      Telemetry.init(TEST_DATA.telemetry);
    }

    window.addEventListener("beforeunload", function (e) {
      // ✅ Если тест не был официально завершён — отправляем лучший результат
      if (typeof scormFinished === 'undefined' || !scormFinished) {
        console.log('📤 beforeunload: отправляем данные в LMS...');
        
        // Отправляем лучший результат в LMS
        if (typeof getBestAttempt === 'function') {
          var bestAttempt = getBestAttempt();
          if (bestAttempt) {
            console.log('📤 beforeunload: лучшая попытка', Math.round(bestAttempt.percent) + '%');
            
            var percentScore = Math.round(bestAttempt.percent);
            var passed = !!bestAttempt.passed;
            
            // Устанавливаем значения напрямую (синхронно)
            try {
              SCORM.setValue('cmi.score.raw', percentScore);
              SCORM.setValue('cmi.score.min', 0);
              SCORM.setValue('cmi.score.max', 100);
              SCORM.setValue('cmi.score.scaled', percentScore / 100);
              SCORM.setValue('cmi.completion_status', 'completed');
              SCORM.setValue('cmi.success_status', passed ? 'passed' : 'failed');
              SCORM.setValue('cmi.exit', 'suspend');
            } catch (err) {
              console.log('⚠️ beforeunload ошибка SCORM:', err);
            }
          }
        }
      }
      
      try { SCORM.commit(); } catch (e) { }
      try { SCORM.terminate(); } catch (e) { }
    });

    // биндинги DnD
    bindMatchingDnDOnce();
    bindRankingDnDOnce();

    // Определяем режим теста и инициализируем
    if (TEST_DATA.mode === 'adaptive' && TEST_DATA.adaptiveTopics) {
      // Adaptive mode
      initAdaptiveTest();
    } else {
      // Standard mode
      generateVariant();
    }

    render();

    window.addEventListener("resize", function () {
      syncMatchingHeights();
    });
  }

  // чтобы работало и в обычной загрузке, и если скрипт подцепился поздно
  if (document.readyState === "loading") {
    window.addEventListener("load", boot);
  } else {
    setTimeout(boot, 0);
  }
})();

// ===== ОТПРАВКА ЛУЧШЕЙ ПОПЫТКИ В LMS =====
function sendBestAttemptToLMS(bestAttempt) {
  if (!bestAttempt) return;
  
  var percentScore = Math.round(bestAttempt.percent);
  var passed = !!bestAttempt.passed;
  
  // Objectives
  var objectives = [];
  if (bestAttempt.topicResults) {
    objectives = bestAttempt.topicResults.map(function(tr) {
      return {
        id: 'topic_' + tr.topicId,
        score: Math.round(tr.percent || 0),
        status: tr.passed === null ? 'unknown' : (tr.passed ? 'passed' : 'failed')
      };
    });
  }
  
  // Отправляем в SCORM
  try {
    SCORM.finish(percentScore, 100, passed, objectives, []);
  } catch (e) {
    console.log('⚠️ Ошибка отправки в LMS:', e);
  }
}

window.sendBestAttemptToLMS = sendBestAttemptToLMS;