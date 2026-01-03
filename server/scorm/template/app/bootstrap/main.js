// app/bootstrap/main.js
(function () {
  function boot() {
    // SCORM runtime должен быть уже загружен (runtime.js)
    SCORM.init();

    window.addEventListener("beforeunload", function () {
      try { SCORM.commit(); } catch (e) {}
      try { SCORM.terminate(); } catch (e) {}
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
