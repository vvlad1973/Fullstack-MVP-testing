/**
 * @module utils/scorm/runState
 * @description PRD-36: the run-state model of the SCORM package — the codec that keeps
 * `cmi.suspend_data` inside its budget, the attempt summary builder and the migration of the
 * legacy format. Pure functions only: nothing here touches the SCORM data model, so the whole
 * module is testable from the sources (port-pattern) without a package build.
 *
 * A ROW is a homogeneous run of values whose length equals the number of delivered questions.
 * A row is stored as ONE string and its elements are addressed by POSITION — names and ids cost
 * more than the values themselves, and a UUID key alone would eat a quarter of the budget.
 *
 * Exposes the global `TBRunState`.
 */
var TBRunState = (function () {
  var STATUS_CODES = { answered: 'a', skipped: 's', unanswered: 'u' };
  var STATUS_BY_CODE = { a: 'answered', s: 'skipped', u: 'unanswered' };

  /** Base36 keeps an index one character wide up to 35 — the common case for options. */
  function b36(n) { return Number(n).toString(36); }
  function unb36(s) { return parseInt(s, 36); }

  // ── Delivery: «section.question» pairs in delivery order ──────────────────
  function encodeDelivery(positions) {
    var out = [];
    for (var i = 0; i < (positions || []).length; i++) {
      out.push(b36(positions[i].s) + '.' + b36(positions[i].q));
    }
    return out.join(',');
  }

  function decodeDelivery(row) {
    if (!row) return [];
    var parts = String(row).split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var pair = parts[i].split('.');
      if (pair.length !== 2) continue;
      var s = unb36(pair[0]);
      var q = unb36(pair[1]);
      // FR-23: a corrupted cell is an ABSENT one. Letting NaN through would address
      // `sections[NaN]` and blank the question instead of the slot.
      if (isNaN(s) || isNaN(q)) continue;
      out.push({ s: s, q: q });
    }
    return out;
  }

  // ── Answers: one element per delivered question, shape decided by its type ──
  function encodeAnswer(answer, question) {
    var type = (question && question.type) || 'single';
    if (answer === undefined || answer === null) return '';
    if (type === 'allocation') {
      // Amounts are unbounded, so they stay decimal with an explicit separator.
      var keys = Object.keys(answer).sort(function (a, b) { return Number(a) - Number(b); });
      var amounts = [];
      for (var i = 0; i < keys.length; i++) amounts.push(String(answer[keys[i]]));
      return amounts.join('.');
    }
    if (type === 'matching') {
      // Position = left item index, value = the right index it was matched to.
      var lefts = Object.keys(answer).sort(function (a, b) { return Number(a) - Number(b); });
      var pairs = [];
      for (var j = 0; j < lefts.length; j++) pairs.push(b36(lefts[j]) + b36(answer[lefts[j]]));
      return pairs.join('');
    }
    if (Object.prototype.toString.call(answer) === '[object Array]') {
      var idx = [];
      for (var k = 0; k < answer.length; k++) idx.push(b36(answer[k]));
      return idx.join('');
    }
    return b36(answer);
  }

  function decodeAnswer(cell, question) {
    var type = (question && question.type) || 'single';
    if (cell === '' || cell === undefined) return undefined;
    if (type === 'allocation') {
      var amounts = cell.split('.');
      var alloc = {};
      for (var i = 0; i < amounts.length; i++) alloc[i] = parseInt(amounts[i], 10);
      return alloc;
    }
    if (type === 'matching') {
      var map = {};
      for (var j = 0; j + 1 < cell.length; j += 2) map[unb36(cell[j])] = unb36(cell[j + 1]);
      return map;
    }
    if (type === 'multiple' || type === 'ranking') {
      var list = [];
      for (var k = 0; k < cell.length; k++) list.push(unb36(cell[k]));
      return list;
    }
    return unb36(cell);
  }

  function encodeAnswers(answers, questions) {
    var out = [];
    for (var i = 0; i < (questions || []).length; i++) {
      out.push(encodeAnswer((answers || [])[i], questions[i]));
    }
    return out.join(',');
  }

  function decodeAnswers(row, questions) {
    var cells = row === '' || row === undefined || row === null ? [] : String(row).split(',');
    var out = [];
    for (var i = 0; i < (questions || []).length; i++) {
      out.push(decodeAnswer(cells[i] === undefined ? '' : cells[i], questions[i]));
    }
    return out;
  }

  // ── Statuses (PRD-19) and option shuffling (PRD-16) ───────────────────────
  function encodeStatuses(statuses) {
    var out = '';
    for (var i = 0; i < (statuses || []).length; i++) {
      out += STATUS_CODES[statuses[i]] || 'u';
    }
    return out;
  }

  function decodeStatuses(row) {
    var out = [];
    for (var i = 0; i < (row || '').length; i++) out.push(STATUS_BY_CODE[row[i]] || 'unanswered');
    return out;
  }

  function encodeShuffle(maps) {
    var out = [];
    for (var i = 0; i < (maps || []).length; i++) {
      var m = maps[i];
      if (!m) { out.push(''); continue; }
      var cell = '';
      for (var j = 0; j < m.length; j++) cell += b36(m[j]);
      out.push(cell);
    }
    return out.join(',');
  }

  function decodeShuffle(row) {
    var cells = row === '' || row === undefined || row === null ? [] : String(row).split(',');
    var out = [];
    for (var i = 0; i < cells.length; i++) {
      if (!cells[i]) { out.push(null); continue; }
      var m = [];
      for (var j = 0; j < cells[i].length; j++) m.push(unb36(cells[i][j]));
      out.push(m);
    }
    return out;
  }

  // ── Package fingerprint: positions are valid only inside THIS package ─────
  function fingerprint(testData) {
    var sections = (testData && testData.sections) || [];
    var counts = [];
    for (var i = 0; i < sections.length; i++) {
      counts.push((sections[i].questions || []).length);
    }
    var keys = ((testData && testData.breakdownKeys) || []).length;
    return sections.length + ':' + counts.join(',') + ':' + keys;
  }

  function sameFingerprint(fp, testData) {
    return !!fp && fp === fingerprint(testData);
  }

  // ── Attempt summary: the ONE shape a finished attempt is stored in ────────

  /** FR-04: higher percent wins; on a tie the LATER attempt does. */
  function pickBest(current, candidate) {
    if (!current) return candidate;
    if (!candidate) return current;
    if (candidate.pc !== current.pc) return candidate.pc > current.pc ? candidate : current;
    return new Date(candidate.at) >= new Date(current.at) ? candidate : current;
  }

  function sectionIndexOf(testData, topicId) {
    var sections = (testData && testData.sections) || [];
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].topicId === topicId) return i;
    }
    return -1;
  }

  function keyIndexOf(testData, key) {
    var keys = (testData && testData.breakdownKeys) || [];
    for (var i = 0; i < keys.length; i++) if (keys[i] === key) return i;
    return -1;
  }

  /** FR-18: a breakdown row shrinks to its numbers; the key text lives in TEST_DATA. */
  function packBreakdown(entries, testData) {
    var out = [];
    for (var i = 0; i < (entries || []).length; i++) {
      var e = entries[i];
      var ki = keyIndexOf(testData, e.key);
      if (ki < 0) continue;
      out.push({
        k: ki, i: e.items, a: e.answered, e: e.earned, p: e.possible,
        pp: e.percentPoints, pu: e.percentUnits,
      });
    }
    return out.length ? out : undefined;
  }

  /**
   * FR-22: the ONE place a finished attempt becomes a stored summary. Everything derivable
   * from TEST_DATA (topic name, recommendations, pass-rule text, breakdown key) is dropped:
   * the package already ships it, and a second copy is exactly what overflows the budget.
   */
  function buildSummary(results, testData, meta) {
    var topics = [];
    var trs = (results && results.topicResults) || [];
    for (var i = 0; i < trs.length; i++) {
      var t = trs[i];
      topics.push({
        s: sectionIndexOf(testData, t.topicId),
        c: t.correct, q: t.total, e: t.earnedPoints, p: t.possiblePoints,
        pc: t.percent, ok: t.passed,
        // PRD-24: the variant that gated this topic, and the threshold it resolved to —
        // the «Требуется…» label reads the latter, so dropping it would blank the label
        // of every saved attempt.
        f: (meta.deliveredForms || {})[t.topicId] || undefined,
        r: (t.resolvedPassRule && t.resolvedPassRule.value != null) ? t.resolvedPassRule.value : undefined,
        bd: packBreakdown(t.breakdown, testData),
      });
    }
    var testScope = [];
    var all = (results && results.breakdowns) || [];
    for (var j = 0; j < all.length; j++) if (all[j].scope === 'test') testScope.push(all[j]);
    return {
      n: meta.attemptNumber,
      at: meta.completedAt,
      src: meta.source,
      pc: results.percent, c: results.correct, q: results.totalQuestions,
      e: parseFloat(results.earnedPoints) || 0, p: parseFloat(results.possiblePoints) || 0,
      ok: !!results.passed,
      t: topics,
      bd: packBreakdown(testScope, testData),
      rv: (results.resultComputation && results.resultComputation.values) || {},
      sv: (results.scaleComputation && results.scaleComputation.values) || {},
    };
  }

  /** The stored best summary, whatever format version the state came in. */
  function bestOf(stateObj) {
    return (stateObj && stateObj.best) || null;
  }

  /** FR-06/FR-07: rows of the attempt being stored — delivery, answers, statuses. */
  function buildDetail(runtimeState) {
    if (!runtimeState || !runtimeState.flatQuestions || !runtimeState.flatQuestions.length) {
      return undefined;
    }
    var questions = [], answers = [], statuses = [];
    for (var i = 0; i < runtimeState.flatQuestions.length; i++) {
      var q = runtimeState.flatQuestions[i].question;
      questions.push(q);
      answers.push((runtimeState.answers || {})[q.id]);
      statuses.push((runtimeState.questionStatuses || {})[q.id] || 'unanswered');
    }
    return {
      dl: encodeDelivery(runtimeState.deliveryPositions || []),
      an: encodeAnswers(answers, questions),
      st: encodeStatuses(statuses),
    };
  }

  // ── Migration: format 1 (a growing attempts[] array) -> format 2 ──────────

  /** A legacy (format 1) attempt record as a format-2 summary; content is dropped. */
  function summaryFromLegacy(record, testData) {
    var topics = [];
    var trs = (record && record.topicResults) || [];
    for (var i = 0; i < trs.length; i++) {
      topics.push({
        s: sectionIndexOf(testData, trs[i].topicId),
        c: trs[i].correct, q: trs[i].total,
        e: trs[i].earnedPoints, p: trs[i].possiblePoints,
        pc: trs[i].percent, ok: trs[i].passed,
      });
    }
    return {
      n: record.attemptNumber, at: record.completedAt, src: record.completedAtSource,
      pc: record.percent, c: record.totalCorrect, q: record.totalQuestions,
      e: record.earnedPoints, p: record.possiblePoints, ok: !!record.passed,
      t: topics, rv: record.resultValues || {}, sv: record.scaleValues || {},
    };
  }

  /**
   * FR-12/FR-13: bring whatever the LMS hands back to format 2. Three inputs are possible —
   * format 2 of THIS package (pass through), format 2 of ANOTHER package (its positions
   * address other questions: keep the counter and both barriers, drop the addressed parts),
   * and format 1 (fold the attempt array into counter + best + last).
   */
  function migrate(stateObj, testData) {
    var s = stateObj || {};
    if (s.v === 2) {
      if (s.fp && !sameFingerprint(s.fp, testData)) {
        if (s.best) delete s.best.d;
        if (s.currentSession) s.currentSession = null;
        s.fp = fingerprint(testData);
      }
      return s;
    }
    var attempts = s.attempts || [];
    var best = null;
    for (var i = 0; i < attempts.length; i++) {
      best = pickBest(best, summaryFromLegacy(attempts[i], testData));
    }
    var last = attempts.length ? summaryFromLegacy(attempts[attempts.length - 1], testData) : null;
    var out = {
      v: 2,
      fp: fingerprint(testData),
      attemptsUsed: typeof s.attemptsUsed === 'number' ? s.attemptsUsed : 0,
      best: best,
      last: (best && last && best.n === last.n) ? 0 : last,
    };
    // FR-16: the barriers' own fields travel unchanged, shape and meaning both.
    if (s.timer) out.timer = s.timer;
    if (s.retake) out.retake = s.retake;
    return out;
  }

  // ── Budget: a limit that is CHECKED, not hoped for ────────────────────────

  var BUDGET = 4096; // FR-15: the SCORM 1.2 limit; a 15x margin on 2004.

  /**
   * FR-14 / §6.2: fit the state into the budget by a DECLARED order of sacrifices, never by
   * silently truncating the string. What goes first is what a learner loses least by: the LMS
   * report's per-question interactions. What never goes is what the attempt limit and both
   * eligibility barriers stand on — losing those reopens the limit and both barriers at once,
   * which is exactly the failure this whole work exists to end.
   */
  function fitToBudget(stateObj, budget) {
    var limit = budget || BUDGET;
    var s = JSON.parse(JSON.stringify(stateObj || {}));
    var sacrifices = [];
    var fits = function () { return JSON.stringify(s).length <= limit; };
    if (fits()) return { state: s, sacrifices: sacrifices };
    if (s.best && s.best.d) { delete s.best.d; sacrifices.push('best.detail'); }
    if (fits()) return { state: s, sacrifices: sacrifices };
    if (s.currentSession && s.currentSession.sh) {
      delete s.currentSession.sh; sacrifices.push('session.shuffle');
    }
    if (fits()) return { state: s, sacrifices: sacrifices };
    if (s.best) {
      s.best = { n: s.best.n, at: s.best.at, src: s.best.src, pc: s.best.pc, ok: s.best.ok };
      sacrifices.push('best.summary');
    }
    if (fits()) return { state: s, sacrifices: sacrifices };
    if (typeof s.last === 'object' && s.last) {
      s.last = { n: s.last.n, at: s.last.at, src: s.last.src, pc: s.last.pc, ok: s.last.ok };
      sacrifices.push('last.summary');
    }
    return { state: s, sacrifices: sacrifices };
  }

  /**
   * FR-24: an unreadable state is NOT an empty one. Before this the two were indistinguishable
   * — a string the LMS had truncated came back as «no state», silently reopening the attempt
   * limit, the timer anchor and both barriers.
   */
  function parseState(raw) {
    if (!raw) return { outcome: 'empty', state: { v: 2, attemptsUsed: 0 } };
    try {
      return { outcome: 'parsed', state: JSON.parse(raw) };
    } catch (e) {
      return { outcome: 'corrupt', state: { v: 2, attemptsUsed: 0 } };
    }
  }

  return {
    encodeDelivery: encodeDelivery,
    decodeDelivery: decodeDelivery,
    encodeAnswers: encodeAnswers,
    decodeAnswers: decodeAnswers,
    encodeStatuses: encodeStatuses,
    decodeStatuses: decodeStatuses,
    encodeShuffle: encodeShuffle,
    decodeShuffle: decodeShuffle,
    fingerprint: fingerprint,
    sameFingerprint: sameFingerprint,
    pickBest: pickBest,
    buildSummary: buildSummary,
    buildDetail: buildDetail,
    bestOf: bestOf,
    sectionIndexOf: sectionIndexOf,
    keyIndexOf: keyIndexOf,
    fitToBudget: fitToBudget,
    parseState: parseState,
    migrate: migrate,
    BUDGET: BUDGET,
  };
})();
