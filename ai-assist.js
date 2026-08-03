// ai-assist.js — "Analyze Case with AI" button, implementing the hybrid safety
// architecture: the classical rubric engine (unchanged, script.js) always runs
// first and is never replaced. The AI independently reasons through the same
// case and is compared against that classical result server-side. If they
// agree, the classical result is shown with an "AI confirmed" note. If they
// disagree, the classical result STAYS primary, with the AI's alternative
// shown as a clearly-labeled secondary note — never as a silent replacement.

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

  function setup() {
    const inputEl = document.getElementById("symptomInput");
    const resultBtn = document.getElementById("resultBtn");

    const aiBtn = document.createElement("button");
    aiBtn.id = "aiAssistBtn";
    aiBtn.textContent = "🔍 Analyze Case with AI";
    aiBtn.className = "ai-assist-btn";
    aiBtn.style.display = "none"; // shown only when logged in
    resultBtn.insertAdjacentElement("afterend", aiBtn);

    const statusEl = document.createElement("div");
    statusEl.id = "aiAssistStatus";
    statusEl.className = "ai-assist-status";
    aiBtn.insertAdjacentElement("afterend", statusEl);

    // Holds the AI note box, inserted next to the classical result once it exists.
    const aiNoteEl = document.createElement("div");
    aiNoteEl.id = "aiAssistNote";
    aiNoteEl.style.display = "none";

    window.RemedyAuth.onAuthChange((user) => {
      aiBtn.style.display = user ? "inline-block" : "none";
    });

    function getClassicalRemedyName() {
      const el = document.querySelector(".md-remedy-name");
      return el ? el.textContent.trim() : "";
    }

    aiBtn.addEventListener("click", async () => {
      const caseText = inputEl.value.trim();
      if (!caseText) {
        statusEl.textContent = "Type a case description first.";
        statusEl.className = "ai-assist-status ai-assist-error";
        return;
      }
      aiBtn.disabled = true;
      aiNoteEl.style.display = "none";
      statusEl.textContent = "Running classical search…";
      statusEl.className = "ai-assist-status";

      // Step 1: always run the unchanged classical search first, so there is
      // always a rubric-based result on screen even if the AI call fails.
      resultBtn.click();
      await new Promise(r => setTimeout(r, 400)); // let the DOM render the result

      const classicalRemedy = getClassicalRemedyName();
      statusEl.textContent = "Analyzing case with AI…";

      try {
        const result = await window.RemedyAuth.requestAiAnalysis(caseText, classicalRemedy);
        renderAiNote(result, classicalRemedy);
        statusEl.textContent = "✔ Analysis complete — " + result.remaining + " AI analyses left this month.";
        statusEl.className = "ai-assist-status ai-assist-success";
      } catch (err) {
        const code = err && err.code;
        if (code === "functions/resource-exhausted") {
          statusEl.textContent = "You've used all your AI analyses this month — the classical result above still applies.";
        } else if (code === "functions/unauthenticated") {
          statusEl.textContent = "Please log in first to use AI analysis.";
        } else {
          statusEl.textContent = "AI analysis unavailable right now — the classical result above still applies.";
        }
        statusEl.className = "ai-assist-status ai-assist-error";
      } finally {
        aiBtn.disabled = false;
      }
    });

    function renderAiNote(result, classicalRemedy) {
      const eyebrow = document.querySelector(".md-eyebrow");
      const anchor = eyebrow ? eyebrow.closest("div").parentElement : null;
      if (!anchor) return;

      if (result.agreement) {
        aiNoteEl.className = "ai-note ai-note-agree";
        aiNoteEl.innerHTML =
          '<div class="ai-note-title">✓ AI confirmed</div>' +
          '<div class="ai-note-body">Independent AI analysis reached the same remedy. ' +
          'Key symptoms weighed: ' + escapeHtml((result.keySymptoms || []).join(", ")) + '.</div>';
      } else {
        aiNoteEl.className = "ai-note ai-note-disagree";
        aiNoteEl.innerHTML =
          '<div class="ai-note-title">AI suggests alternative: ' + escapeHtml(result.aiRemedy) + '</div>' +
          '<div class="ai-note-body">' + escapeHtml(result.reasoning) + '</div>' +
          '<div class="ai-note-body ai-note-classical">Classical result (' + escapeHtml(classicalRemedy) +
          ') remains the primary suggestion above.</div>';
      }
      aiNoteEl.style.display = "block";
      if (!aiNoteEl.parentElement) anchor.insertAdjacentElement("afterend", aiNoteEl);
    }

    function escapeHtml(s) {
      const d = document.createElement("div");
      d.textContent = s || "";
      return d.innerHTML;
    }
  }
})();
