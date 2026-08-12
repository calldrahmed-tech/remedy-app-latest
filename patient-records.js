// patient-records.js — "Save Visit" + "My Patients" for logged-in doctors.
// Saves to Firestore under users/{uid}/patients (see firebase-init.js and
// firestore.rules — private to each doctor). Kept as its own file for the
// same reason as ai-assist.js / auth-ui.js: it only touches DOM it owns.

(function () {
  function waitForReady(check, thenRun, triesLeft) {
    if (check()) { thenRun(); return; }
    if (triesLeft <= 0) return;
    setTimeout(() => waitForReady(check, thenRun, triesLeft - 1), 250);
  }

  waitForReady(
    () => document.getElementById("savePatientBtn") && window.RemedyAuth,
    setup,
    120
  );

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function setup() {
    const patientActionsRow = document.getElementById("patientActionsRow");
    const savePatientBtn = document.getElementById("savePatientBtn");
    const myPatientsBtn = document.getElementById("myPatientsBtn");
    const patientSaveStatus = document.getElementById("patientSaveStatus");
    const patientName = document.getElementById("patientName");
    const patientAge = document.getElementById("patientAge");
    const patientContact = document.getElementById("patientContact");
    const patientPotency = document.getElementById("patientPotency");
    const patientHistory = document.getElementById("patientHistory");

    const myPatientsModal = document.getElementById("myPatientsModal");
    const myPatientsCloseBtn = document.getElementById("myPatientsCloseBtn");
    const patientSearchInput = document.getElementById("patientSearchInput");
    const patientListArea = document.getElementById("patientListArea");
    const patientDetailArea = document.getElementById("patientDetailArea");
    const patientDetailContent = document.getElementById("patientDetailContent");
    const patientDetailBackBtn = document.getElementById("patientDetailBackBtn");

    const followUpLiveCard = document.getElementById("followUpLiveCard");
    const getProtocolBtn = document.getElementById("getProtocolBtn");
    const resultBtn = document.getElementById("resultBtn");

    let myPatients = []; // cached after last fetch, filtered locally on search

    // Only logged-in doctors see the save/list buttons — nothing about this
    // requires touching script.js/protocol-mode.js, we only read their DOM.
    window.RemedyAuth.onAuthChange((user) => {
      patientActionsRow.style.display = user ? "flex" : "none";
      if (user) {
        // Pre-fetch so a returning patient's history is already available the
        // moment the doctor runs a search — not just after opening "My Patients".
        window.RemedyAuth.getMyPatients().then((list) => { myPatients = list; }).catch(() => {});
      } else {
        myPatients = [];
        followUpLiveCard.innerHTML = "";
      }
    });

    function findPatientByName(name) {
      const term = (name || "").trim().toLowerCase();
      if (!term) return null;
      return myPatients.find((p) => (p.name || "").trim().toLowerCase() === term) || null;
    }

    // Runs after a search, only when the doctor has typed the name of a
    // patient who already has at least one saved visit — builds a live
    // "visit 2" snapshot from what's on screen RIGHT NOW (nothing is saved),
    // compares it to their last saved visit, and shows the same WAIT/REPEAT/
    // CHANGE/ANTIDOTE card that "My Patients" shows, but before the doctor
    // has to save anything first.
    function checkLiveFollowUp() {
      if (!window.HeringAnalysis) { followUpLiveCard.innerHTML = ""; return; }
      const existing = findPatientByName(patientName.value);
      if (!existing || !(existing.visits || []).length) { followUpLiveCard.innerHTML = ""; return; }
      const lastVisit = existing.visits.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
      const caseInfo = getCurrentCaseInfo();
      if (!caseInfo.tags.length && !caseInfo.symptoms) { followUpLiveCard.innerHTML = ""; return; }
      const liveVisit = { date: new Date().toISOString(), symptoms: caseInfo.symptoms, tags: caseInfo.tags };
      const result = window.HeringAnalysis.getSecondVisitAction(lastVisit, liveVisit);
      followUpLiveCard.innerHTML = window.HeringAnalysis.renderFollowUpActionCard(result);
    }

    // A short delay lets the actual result cards finish rendering first —
    // both search buttons render synchronously, but this keeps it safe even
    // if that ever changes.
    if (getProtocolBtn) getProtocolBtn.addEventListener("click", () => setTimeout(checkLiveFollowUp, 150));
    if (resultBtn) resultBtn.addEventListener("click", () => setTimeout(checkLiveFollowUp, 150));

    // Reads whichever mode is currently visible (Expert Protocol or Full
    // Repertory) to capture what the doctor was just looking at.
    function getCurrentCaseInfo() {
      const protocolVisible = getComputedStyle(document.getElementById("protocolModeInput")).display !== "none";
      if (protocolVisible) {
        const chipsText = (document.getElementById("protocolChips").innerText || "").trim();
        const topRemedyEl = document.querySelector("#protocolResults .rc-name");
        return {
          symptoms: chipsText,
          tags: window.getProtocolSymptomSnapshot ? window.getProtocolSymptomSnapshot() : [],
          remedy: topRemedyEl ? topRemedyEl.textContent.trim() : ""
        };
      }
      const symptoms = (document.getElementById("symptomInput").value || "").trim();
      const topRemedyEl = document.querySelector("#results .md-remedy-name");
      return {
        symptoms,
        tags: [],
        remedy: topRemedyEl ? topRemedyEl.textContent.trim() : ""
      };
    }

    savePatientBtn.addEventListener("click", async () => {
      const name = patientName.value.trim();
      if (!name) {
        patientSaveStatus.textContent = "Type a patient name first.";
        patientSaveStatus.style.color = "#c0392b";
        return;
      }
      savePatientBtn.disabled = true;
      patientSaveStatus.textContent = "Saving…";
      patientSaveStatus.style.color = "";
      try {
        const caseInfo = getCurrentCaseInfo();
        await window.RemedyAuth.savePatientVisit(
          { name, age: patientAge.value.trim(), contact: patientContact.value.trim() },
          {
            date: new Date().toISOString(),
            symptoms: caseInfo.symptoms || patientHistory.value.trim(),
            tags: caseInfo.tags || [],
            remedy: caseInfo.remedy,
            potency: patientPotency.value.trim()
          }
        );
        patientSaveStatus.textContent = "✔ Saved.";
        patientSaveStatus.style.color = "#2c5c3a";
      } catch (err) {
        patientSaveStatus.textContent = err && err.message ? err.message : "Could not save — try again.";
        patientSaveStatus.style.color = "#c0392b";
      } finally {
        savePatientBtn.disabled = false;
      }
    });

    function formatDate(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d)) return iso;
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    }

    function renderPatientList(filterText) {
      const term = (filterText || "").trim().toLowerCase();
      const filtered = term
        ? myPatients.filter(p => (p.name || "").toLowerCase().includes(term))
        : myPatients;
      if (!filtered.length) {
        patientListArea.innerHTML = `<div class="patient-list-empty">${myPatients.length ? "No match." : "No saved patients yet."}</div>`;
        return;
      }
      patientListArea.innerHTML = filtered.map(p => {
        const visitCount = (p.visits || []).length;
        const lastVisit = (p.visits || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
        return `
          <div class="patient-list-row" data-id="${esc(p.id)}">
            <div>
              <div class="patient-list-name">${esc(p.name)}</div>
              <div class="patient-list-meta">${visitCount} visit${visitCount === 1 ? "" : "s"}${lastVisit ? " · last: " + esc(formatDate(lastVisit.date)) : ""}</div>
            </div>
            <div class="patient-list-meta">${esc(p.contact || "")}</div>
          </div>
        `;
      }).join("");
      patientListArea.querySelectorAll(".patient-list-row").forEach(row => {
        row.addEventListener("click", () => openPatientDetail(row.dataset.id));
      });
    }

    function openPatientDetail(patientId) {
      const p = myPatients.find(x => x.id === patientId);
      if (!p) return;
      const visits = (p.visits || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      // visits[0] is the latest (Visit 2), visits[1] is the one before it (Visit 1) —
      // the Second Visit Decision Engine only ever looks at that most recent pair.
      let followUpAction = (window.HeringAnalysis && visits.length >= 2)
        ? window.HeringAnalysis.getSecondVisitAction(visits[1], visits[0])
        : null;
      // The strict chip comparison needs BOTH visits to carry symptom chips —
      // if a visit was saved via Quick Update (free text only), it can't run
      // and returns an honest "not enough info." But the latest visit's own
      // sentence is often self-contained ("joint pain much better, sleeping
      // well") — read it the same way the Quick Update box does, so this top
      // summary doesn't contradict the answer the doctor just got below.
      if (followUpAction && followUpAction.action === "UNCLEAR" && !followUpAction.reliable && visits[0] && visits[0].symptoms) {
        const fallback = window.HeringAnalysis.analyzeQuickFollowUp(visits[0].symptoms);
        if (fallback && fallback.reliable) followUpAction = fallback;
      }
      const lastVisit = visits[0]; // carries the remedy/potency forward onto a saved quick update
      patientDetailContent.innerHTML = `
        <div class="patient-detail-header">
          <div class="name">${esc(p.name)}</div>
          <div class="meta">${p.age ? "Age " + esc(p.age) + " · " : ""}${esc(p.contact || "")}</div>
        </div>
        ${visits.length ? `
        <div class="patient-quick-update">
          <label class="patient-quick-update-label">🔄 Quick update for ${esc(p.name)}</label>
          <div class="patient-quick-update-row">
            <input type="text" class="patient-quick-update-input" placeholder='e.g. "fever gone but cough started"'>
            <button type="button" class="patient-quick-update-btn">Check</button>
          </div>
          <div class="patient-quick-update-result"></div>
        </div>` : ""}
        ${window.HeringAnalysis ? window.HeringAnalysis.renderFollowUpActionCard(followUpAction) : ""}
        ${visits.map(v => `
          <div class="patient-visit-card">
            <div class="patient-visit-date">${esc(formatDate(v.date))}</div>
            ${v.remedy ? `<div class="patient-visit-remedy">${esc(v.remedy)}${v.potency ? " " + esc(v.potency) : ""}</div>` : ""}
            ${v.symptoms ? `<div class="patient-visit-symptoms">${esc(v.symptoms)}</div>` : ""}
          </div>
        `).join("") || `<div class="patient-list-empty">No visit details.</div>`}
      `;

      const quickInput = patientDetailContent.querySelector(".patient-quick-update-input");
      const quickBtn = patientDetailContent.querySelector(".patient-quick-update-btn");
      const quickResult = patientDetailContent.querySelector(".patient-quick-update-result");
      if (quickInput && quickBtn && quickResult) {
        function runQuickCheck() {
          if (!window.HeringAnalysis) return;
          const text = quickInput.value;
          const result = window.HeringAnalysis.analyzeQuickFollowUp(text);
          quickResult.innerHTML = window.HeringAnalysis.renderFollowUpActionCard(result) + `
            <div>
              <button type="button" class="patient-quick-save-btn">💾 Save this as a new visit</button>
              <span class="patient-quick-save-status"></span>
            </div>
          `;
          const saveBtn = quickResult.querySelector(".patient-quick-save-btn");
          const saveStatus = quickResult.querySelector(".patient-quick-save-status");
          saveBtn.addEventListener("click", async () => {
            saveBtn.disabled = true;
            saveStatus.textContent = "Saving…";
            try {
              await window.RemedyAuth.savePatientVisit(
                { name: p.name, age: p.age, contact: p.contact },
                {
                  date: new Date().toISOString(),
                  symptoms: text.trim(),
                  tags: [],
                  remedy: lastVisit ? (lastVisit.remedy || "") : "",
                  potency: lastVisit ? (lastVisit.potency || "") : ""
                }
              );
              p.visits = p.visits || [];
              p.visits.push({ date: new Date().toISOString(), symptoms: text.trim(), tags: [], remedy: lastVisit ? lastVisit.remedy : "", potency: lastVisit ? lastVisit.potency : "" });
              openPatientDetail(patientId); // re-render with the new visit in history
            } catch (err) {
              saveStatus.textContent = err && err.message ? err.message : "Could not save — try again.";
              saveBtn.disabled = false;
            }
          });
        }
        quickBtn.addEventListener("click", runQuickCheck);
        quickInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runQuickCheck(); });
      }

      patientListArea.style.display = "none";
      patientSearchInput.style.display = "none";
      patientDetailArea.style.display = "block";
    }

    function backToList() {
      patientDetailArea.style.display = "none";
      patientListArea.style.display = "block";
      patientSearchInput.style.display = "block";
    }

    async function openMyPatientsModal() {
      myPatientsModal.style.display = "flex";
      backToList();
      patientSearchInput.value = "";
      patientListArea.innerHTML = `<div class="patient-list-empty">Loading…</div>`;
      try {
        myPatients = await window.RemedyAuth.getMyPatients();
        renderPatientList("");
      } catch (err) {
        patientListArea.innerHTML = `<div class="patient-list-empty">Could not load patients.</div>`;
      }
    }

    myPatientsBtn.addEventListener("click", openMyPatientsModal);
    myPatientsCloseBtn.addEventListener("click", () => { myPatientsModal.style.display = "none"; });
    myPatientsModal.addEventListener("click", (e) => {
      if (e.target === myPatientsModal) myPatientsModal.style.display = "none";
    });
    patientSearchInput.addEventListener("input", () => renderPatientList(patientSearchInput.value));
    patientDetailBackBtn.addEventListener("click", backToList);
  }
})();
