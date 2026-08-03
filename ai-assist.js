// ai-assist.js — adds (1) a confidence-based nudge toward AI review, and (2)
// the "Analyse Case with AI" button that calls the secure backend function.
// This is a SEPARATE file from script.js on purpose: it never modifies or
// depends on the internals of the existing search engine, so it can't break
// anything that already works. It reads the classical engine's result straight
// from the rendered #results DOM (the .md-remedy-name text and the
// data-confidence attribute script.js already produces) rather than reaching
// into script.js's internals. The AI is NEVER called automatically — the
// nudge is UI-only, so AI usage (and cost) only ever happens when the doctor
// clicks the AI button themselves.

(function () {
  // Confidence bands, applied to the same `main.percent` script.js already
  // computes and displays. Below 25% script.js refuses to show a remedy at
  // all (its own CONFIDENCE_FLOOR), so LOW here only ever fires in practice
  // for the 25–39% range that still produces a result.
  const HIGH_THRESHOLD = 70;   // >70%  -> say nothing, classical result stands on its own
  const MEDIUM_THRESHOLD = 40; // 40-70% -> subtle suggestion
                                // <40%  -> clear alert

  function waitForReady(check, thenRun, triesLeft) {
    if (check()) { thenRun(); return; }
    if (triesLeft <= 0) return; // give up quietly — core app still works fine
    setTimeout(() => waitForReady(check, thenRun, triesLeft - 1), 250);
  }

  waitForReady(
    () => document.getElementById("symptomInput") && window.RemedyAuth,
    setup,
    40
  );

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function setup() {
    const inputEl = document.getElementById("symptomInput");
    const resultBtn = document.getElementById("resultBtn");
    const resultsEl = document.getElementById("results");

    // Insert the button right after the existing "Get Remedy" button.
    const aiBtn = document.createElement("button");
    aiBtn.id = "aiAssistBtn";
    aiBtn.textContent = "🧠 Analyse Case with AI";
    aiBtn.className = "ai-assist-btn";
    aiBtn.style.display = "none"; // shown only when logged in
    resultBtn.insertAdjacentElement("afterend", aiBtn);

    const statusEl = document.createElement("div");
    statusEl.id = "aiAssistStatus";
    statusEl.className = "ai-assist-status";
    aiBtn.insertAdjacentElement("afterend", statusEl);

    let loggedIn = false;
    // Show/hide the button based on login state, reusing RemedyAuth's own hook.
    window.RemedyAuth.onAuthChange((user) => {
      loggedIn = !!user;
      aiBtn.style.display = user ? "inline-block" : "none";
    });

    // ---------- Confidence nudge: runs on every "Get Remedy" click, doesn't
    // call the AI, just tells the doctor whether it's worth checking it. ----------
    resultBtn.addEventListener("click", () => {
      // script.js's own click handler (attached first, since script.js loads
      // before this file) has already run and rendered the result by the time
      // this listener fires.
      const card = resultsEl.querySelector(".main-decision-card");
      const hintId = "aiConfidenceHint";
      const existing = document.getElementById(hintId);
      if (existing) existing.remove();
      if (!card) return; // no result rendered (e.g. "no confident match") — nothing to hint about

      const confidence = Number(card.dataset.confidence);
      if (!Number.isFinite(confidence) || confidence > HIGH_THRESHOLD) return; // high confidence — say nothing

      const hint = document.createElement("div");
      hint.id = hintId;
      if (confidence >= MEDIUM_THRESHOLD) {
        hint.className = "ai-confidence-hint ai-confidence-medium";
        hint.textContent = "You may check AI opinion.";
      } else {
        hint.className = "ai-confidence-hint ai-confidence-low";
        hint.textContent = "⚠ Low confidence — AI review recommended.";
      }
      // Only offer a direct click-through when the doctor is actually logged in
      // (the AI button itself is hidden otherwise) — clicking the hint just
      // triggers the same manual AI button click, no extra API call logic here.
      if (loggedIn) {
        hint.classList.add("ai-confidence-clickable");
        hint.title = "Click to run the AI second opinion";
        hint.addEventListener("click", () => aiBtn.click());
      }
      card.insertAdjacentElement("afterend", hint);
    });

    aiBtn.addEventListener("click", async () => {
      const caseText = inputEl.value.trim();
      if (!caseText) {
        statusEl.textContent = "Type a case description first.";
        statusEl.className = "ai-assist-status ai-assist-error";
        return;
      }
      aiBtn.disabled = true;
      statusEl.textContent = "Analysing case…";
      statusEl.className = "ai-assist-status";
      try {
        // Run the classical (rubric) search first, unmodified, so we have its
        // pick to compare the AI's independent answer against.
        resultBtn.click();
        const classicalNameEl = resultsEl.querySelector(".md-remedy-name");
        const classicalRemedy = classicalNameEl ? classicalNameEl.textContent.trim() : "";

        const aiResult = await window.RemedyAuth.requestAiAnalysis(caseText, classicalRemedy);
        renderAiResult(aiResult, classicalRemedy);
        statusEl.textContent = "✔ AI analysis complete — " + aiResult.remaining + " AI searches left this month.";
        statusEl.className = "ai-assist-status ai-assist-success";
      } catch (err) {
        const code = err && err.code;
        if (code === "functions/resource-exhausted") {
          statusEl.textContent = "You've used all your AI searches this month — the search below still works normally.";
        } else if (code === "functions/unauthenticated") {
          statusEl.textContent = "Please log in first to use AI-assisted analysis.";
        } else {
          statusEl.textContent = "AI assist unavailable right now — try the search as-is.";
        }
        statusEl.className = "ai-assist-status ai-assist-error";
      } finally {
        aiBtn.disabled = false;
      }
    });

    function renderAiResult(aiResult, classicalRemedy) {
      let box = document.getElementById("aiAssistResult");
      if (!box) {
        box = document.createElement("div");
        box.id = "aiAssistResult";
        box.className = "ai-assist-result";
        resultsEl.insertAdjacentElement("afterend", box);
      }
      // Exact wording per spec: "AI agrees" OR "AI suggests alternative: ___"
      const agreementLine = classicalRemedy
        ? (aiResult.agreement
            ? `<div class="ai-agree">✔ AI agrees</div>`
            : `<div class="ai-disagree">⚠ AI suggests alternative: ${esc(aiResult.aiRemedy)}</div>`)
        : "";
      const symptomsLine = (aiResult.keySymptoms && aiResult.keySymptoms.length)
        ? `<div class="ai-key-symptoms">Key symptoms: ${aiResult.keySymptoms.map(esc).join(", ")}</div>`
        : "";
      box.innerHTML = `
        <div class="ai-result-title">🧠 AI Second Opinion</div>
        <div class="ai-result-remedy">${esc(aiResult.aiRemedy)}</div>
        ${agreementLine}
        ${symptomsLine}
        <div class="ai-reasoning">${esc(aiResult.reasoning)}</div>
      `;
    }
  }
})();
