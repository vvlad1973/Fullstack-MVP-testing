/**
 * Time spent on each question, accumulated across visits.
 *
 * The LMS report has a «Продолжительность (сек.)» column for every interaction and it used to
 * be empty always: the package never measured anything. Beyond the empty column this is the
 * base material of item analysis (how long an item takes), which is why the figure is also
 * handed to telemetry.
 *
 * SUM, not last visit: with «возврат к неотвеченным» enabled a learner leaves a question and
 * comes back, and reporting only the last visit would claim two seconds for an item they
 * thought about for a minute.
 *
 * SCOPE: one SCO session. The totals live in memory and are NOT written into
 * `cmi.suspend_data` — that budget is what PRD-36 spent a whole track reclaiming, and the run
 * state is read by packages already in the field. A learner who closes the SCO and resumes
 * therefore reports the time of the resumed session; the figure stays honest about what it
 * measured, and the alternative (an unbounded per-question map in a 64 KB budget) is the very
 * failure mode PRD-36 removed.
 */
var TBQuestionTime = (function () {
    /** questionId -> accumulated milliseconds of CLOSED visits. */
    var totals = {};
    /** The question currently on screen, or null. */
    var openId = null;
    /** When the open visit started. */
    var openAt = 0;

    /** Milliseconds since `openAt`, never negative — the learner's clock can jump back. */
    function openMs() {
        if (openId === null) return 0;
        var delta = Date.now() - openAt;
        return delta > 0 ? delta : 0;
    }

    /** Close the open visit into its total. */
    function close() {
        if (openId === null) return;
        totals[openId] = (totals[openId] || 0) + openMs();
        openId = null;
        openAt = 0;
    }

    return {
        /**
         * The learner is now looking at this question.
         *
         * Re-showing the SAME question is a no-op: `render()` runs on every redraw (feedback
         * shown, timer tick, theme switch), not only on a move, and closing-then-reopening
         * would be equivalent but pointless.
         *
         * @param {string} id question id
         */
        show: function (id) {
            if (!id) return;
            if (openId === id) return;
            close();
            openId = id;
            openAt = Date.now();
        },

        /** The learner left the question screen (moved on, opened the обзор, finished). */
        leave: function () {
            close();
        },

        /**
         * Total time on this question, INCLUDING the visit still open — an attempt is often
         * finished straight from the question, and that last visit belongs in the report.
         *
         * @param {string} id question id
         * @returns {number} milliseconds
         */
        totalMsFor: function (id) {
            var closed = totals[id] || 0;
            return openId === id ? closed + openMs() : closed;
        },

        /** Forget everything — a new attempt starts its own measurement. */
        reset: function () {
            totals = {};
            openId = null;
            openAt = 0;
        }
    };
})();

if (typeof window !== 'undefined') window.TBQuestionTime = TBQuestionTime;
