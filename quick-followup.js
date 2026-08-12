// quick-followup.js — the zero-effort follow-up box: one sentence in, a
// traffic-light card out. No login, no saved patient, no form. Only touches
// its own DOM (#quickFollowUpBar) — the actual sentence parsing lives in
// hering-analysis.js's analyzeQuickFollowUp, reused here as-is.

(function () {
  function waitForReady(check, thenRun, triesLeft) {
    if (check()) { thenRun(); return; }
    if (triesLeft <= 0) return;
    setTimeout(() => waitForReady(check, thenRun, triesLeft - 1), 250);
  }

  waitForReady(
    () => document.getElementById("quickFollowUpBtn") && window.HeringAnalysis,
    setup,
    120
  );

  function setup() {
    const input = document.getElementById("quickFollowUpInput");
    const btn = document.getElementById("quickFollowUpBtn");
    const resultEl = document.getElementById("quickFollowUpResult");

    function check() {
      const result = window.HeringAnalysis.analyzeQuickFollowUp(input.value);
      resultEl.innerHTML = window.HeringAnalysis.renderFollowUpActionCard(result);
    }

    btn.addEventListener("click", check);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") check();
    });
  }
})();
