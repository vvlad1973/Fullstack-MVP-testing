    function readSuspendObj() {
  try {
    var raw = SCORM.getValue('cmi.suspend_data') || '';
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function writeSuspendObj(obj) {
  try {
    var raw = JSON.stringify(obj || {});
    // SCORM 2004 suspend_data обычно до ~64KB, нам хватит
    SCORM.setValue('cmi.suspend_data', raw);
    SCORM.commit();
  } catch (e) {}
}

function getAttemptsUsed() {
  var s = readSuspendObj();
  return typeof s.attemptsUsed === 'number' ? s.attemptsUsed : 0;
}

function setAttemptsUsed(n) {
  var s = readSuspendObj();
  s.attemptsUsed = n;
  s.lastUpdated = new Date().toISOString();
  writeSuspendObj(s);
}

function hasAttemptsLeft() {
  if (!TEST_DATA.maxAttempts) return true; // если лимит не задан — не ограничиваем
  return getAttemptsUsed() < TEST_DATA.maxAttempts;
}

// Увеличиваем попытку 1 раз на запуск теста
function registerAttemptStart() {
  if (!TEST_DATA.maxAttempts) return true;

  var used = getAttemptsUsed();
  if (used >= TEST_DATA.maxAttempts) return false;

  setAttemptsUsed(used + 1);
  return true;
}