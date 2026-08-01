// ai-assist.js — adds the "Improve My Wording with AI" button, wired to the
// secure backend function. This is a SEPARATE file from script.js on purpose:
// it never modifies or depends on the internals of the existing search engine,
// so it can't break anything that already works. It only ever calls the same
// public search function the "Get Remedy" button already uses.

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

    // Insert the button right after the existing "Get Remedy" button.
    const aiBtn = document.createElement("button");
    aiBtn.id = "aiAssistBtn";
    aiBtn.textContent = "✨ Improve My Wording with AI";
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
      statusEl.textContent = "Improving wording…";
      statusEl.className = "ai-assist-status";
      try {
        const { normalizedText, remaining } = await window.RemedyAuth.requestAiNormalization(caseText);
        inputEl.value = normalizedText;
        statusEl.textContent = "✔ Wording improved — " + remaining + " AI searches left this month. Running search…";
        statusEl.className = "ai-assist-status ai-assist-success";
        resultBtn.click(); // re-run the existing, unmodified search with the improved text
      } catch (err) {
        const code = err && err.code;
        if (code === "functions/resource-exhausted") {
          statusEl.textContent = "You've used all your AI searches this month — the search below still works normally.";
        } else if (code === "functions/unauthenticated") {
          statusEl.textContent = "Please log in first to use AI-assisted wording.";
        } else {
          statusEl.textContent = "AI assist unavailable right now — try the search as-is.";
        }
        statusEl.className = "ai-assist-status ai-assist-error";
      } finally {
        aiBtn.disabled = false;
      }
    });
  }
})();
