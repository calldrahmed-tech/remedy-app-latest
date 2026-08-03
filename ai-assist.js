// ai-assist.js — adds the "Analyse Case with AI" button, wired to the secure
// backend function. This is a SEPARATE file from script.js on purpose: it
// never modifies or depends on the internals of the existing search engine,
// so it can't break anything that already works. It reads the classical
// engine's top pick straight from the rendered #results DOM (via the
// .md-remedy-name element script.js already produces) rather than reaching
// into script.js's internals.

(function () {
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

    // Show/hide the button based on login state, reusing RemedyAuth's own hook.
    window.RemedyAuth.onAuthChange((user) => {
      aiBtn.style.display = user ? "inline-block" : "none";
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
      const agreementLine = classicalRemedy
        ? (aiResult.agreement
            ? `<div class="ai-agree">✔ Agrees with the classical match (${esc(classicalRemedy)})</div>`
            : `<div class="ai-disagree">⚠ Differs from the classical match (${esc(classicalRemedy)}) — worth weighing both</div>`)
        : "";
      const symptomsLine = (aiResult.keySymptoms && aiResult.keySymptoms.length)
        ? `<div class="ai-key-symptoms">Key symptoms: ${aiResult.keySymptoms.map(esc).join(", ")}</div>`
        : "";
      box.innerHTML = `
        <div class="ai-result-title">🧠 AI's Independent Assessment</div>
        <div class="ai-result-remedy">${esc(aiResult.aiRemedy)}</div>
        ${agreementLine}
        ${symptomsLine}
        <div class="ai-reasoning">${esc(aiResult.reasoning)}</div>
      `;
    }
  }
})();
