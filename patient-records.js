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
    const getComboBtn = document.getElementById("getComboBtn");
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

    const digitsOnly = (s) => String(s || "").replace(/\D/g, "");

    // Same-name patients are told apart by contact number. If several patients share
    // the name and no number is typed, return null rather than guess the wrong one.
    function findPatientByName(name) {
      const term = (name || "").trim().toLowerCase();
      if (!term) return null;
      const sameName = myPatients.filter((p) => (p.name || "").trim().toLowerCase() === term);
      if (!sameName.length) return null;
      const typed = digitsOnly(patientContact.value);
      if (typed) {
        return sameName.find((p) => digitsOnly(p.contact) === typed)
            || sameName.find((p) => !digitsOnly(p.contact))
            || null;
      }
      return sameName.length === 1 ? sameName[0] : null;
    }

    // Remembers what the result on screen was computed from, so "Save Visit" never
    // files an old remedy under symptoms the doctor has since changed.
    let lastSearch = null; // { key, remedy }
    function caseKey(info) {
      return JSON.stringify([info.symptoms || "", info.tags || []]);
    }
    function rememberSearch() {
      const info = getCurrentCaseInfo();
      lastSearch = { key: caseKey(info), remedy: info.remedy || "" };
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
    const afterSearch = () => setTimeout(() => { rememberSearch(); checkLiveFollowUp(); }, 150);
    if (getProtocolBtn) getProtocolBtn.addEventListener("click", afterSearch);
    if (getComboBtn) getComboBtn.addEventListener("click", afterSearch);
    if (resultBtn) resultBtn.addEventListener("click", afterSearch);

    // Reads whichever mode is currently visible (Expert Protocol or Full
    // Repertory) to capture what the doctor was just looking at.
    function getCurrentCaseInfo() {
      const protocolVisible = getComputedStyle(document.getElementById("protocolModeInput")).display !== "none";
      const comboVisible = getComputedStyle(document.getElementById("comboModeInput")).display !== "none";
      if (protocolVisible || comboVisible) {
        const chipsText = (document.getElementById(protocolVisible ? "protocolChips" : "comboChips").innerText || "").trim();
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
        // Only keep the on-screen remedy if it was produced by the symptoms as they
        // stand now; otherwise save the visit without a remedy and say so.
        const remedyIsCurrent = !!lastSearch && lastSearch.key === caseKey(caseInfo);
        const remedyToSave = remedyIsCurrent ? (lastSearch.remedy || "") : "";
        await window.RemedyAuth.savePatientVisit(
          { name, age: patientAge.value.trim(), contact: patientContact.value.trim() },
          {
            date: new Date().toISOString(),
            symptoms: caseInfo.symptoms || patientHistory.value.trim(),
            tags: caseInfo.tags || [],
            remedy: remedyToSave,
            potency: patientPotency.value.trim()
          }
        );
        if (!remedyIsCurrent && caseInfo.remedy) {
          patientSaveStatus.textContent = "✔ Saved without a remedy — symptoms changed since the last search. Search again, then save.";
          patientSaveStatus.style.color = "#b26a00";
        } else {
          patientSaveStatus.textContent = "✔ Saved.";
          patientSaveStatus.style.color = "#2c5c3a";
        }
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

    // ---- Follow-up progress (Better / Same / Worse) + printable prescription ----
    const PROGRESS = {
      better: { icon: "😊", label: "Better", color: "#2c5c3a" },
      same:   { icon: "😐", label: "Same",   color: "#8a6d00" },
      worse:  { icon: "😟", label: "Worse",  color: "#c0392b" }
    };
    function progressBadge(v) {
      const g = PROGRESS[v && v.progress];
      return g ? `<span class="pv-badge" style="background:${g.color}">${g.icon} ${g.label}</span>` : "";
    }
    // Oldest -> newest strip so the doctor sees the whole course at a glance.
    function progressTimeline(visits) {
      const ordered = visits.slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      if (ordered.length < 2) return "";
      return `<div class="pv-timeline"><div class="pv-timeline-title">Progress over time</div><div class="pv-timeline-row">${
        ordered.map((v, i) => {
          const g = PROGRESS[v.progress];
          return `<div class="pv-dot-wrap"><div class="pv-dot" style="background:${g ? g.color : "#b8c2bb"}" title="${esc(g ? g.label : (i === 0 ? "First visit" : "No rating"))}">${g ? g.icon : (i === 0 ? "▶" : "·")}</div><div class="pv-dot-date">${esc(formatDate(v.date).split(",")[0])}</div></div>`;
        }).join('<div class="pv-line"></div>')
      }</div></div>`;
    }
    function printPrescription(p, v) {
      const doctor = (window.RemedyAuth && window.RemedyAuth.getCurrentUser() && window.RemedyAuth.getCurrentUser().displayName) || "";
      const w = window.open("", "_blank");
      if (!w) { alert("Please allow pop-ups for this site to print."); return; }
      const row = (k, val) => val ? `<tr><td class="k">${esc(k)}</td><td>${esc(val)}</td></tr>` : "";
      w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Prescription - ${esc(p.name)}</title>
        <style>body{font-family:Arial,sans-serif;max-width:640px;margin:30px auto;padding:0 20px;color:#111}
        h1{font-size:22px;margin:0 0 2px}.sub{color:#555;font-size:13px;margin-bottom:18px;border-bottom:2px solid #2c5c3a;padding-bottom:10px}
        table{width:100%;border-collapse:collapse;font-size:15px}td{padding:8px 4px;border-bottom:1px solid #ddd;vertical-align:top}.k{width:140px;color:#555;font-weight:bold}
        .rx{font-size:28px;font-weight:bold;margin:22px 0 4px}.blank{margin-top:26px;border-bottom:1px solid #999;height:26px}.lbl{font-size:12px;color:#555;margin-top:18px}
        .sig{margin-top:60px;text-align:right;font-size:13px;color:#333}.note{margin-top:30px;font-size:11px;color:#777}@media print{button{display:none}}</style></head><body>
        <h1>Prescription</h1><div class="sub">${doctor ? "Dr. " + esc(doctor) + " · " : ""}Date: ${esc(formatDate(v.date))}</div>
        <table>${row("Patient", p.name)}${row("Age", p.age)}${row("Contact", p.contact)}</table>
        <div class="rx">℞ ${esc(v.remedy || "—")}${v.potency ? " " + esc(v.potency) : ""}</div>
        <div class="lbl">Dose / directions</div><div class="blank"></div><div class="blank"></div>
        ${v.symptoms ? `<div class="lbl">Case notes</div><div style="font-size:14px">${esc(v.symptoms)}</div>` : ""}
        <div class="sig">Signature: ____________________</div>
        <div class="note">Homeopathic remedies support, but do not replace, medical care. Seek urgent medical help for serious or worsening symptoms.</div>
        <button onclick="window.print()" style="margin-top:20px;padding:10px 18px;font-size:15px">🖨 Print / Save as PDF</button>
        <script>setTimeout(function(){window.print()},400)<\/script></body></html>`);
      w.document.close();
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
          <button type="button" class="patient-delete-btn">🗑️ Delete patient</button>
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
        ${progressTimeline(visits)}
        ${visits.map((v, vi) => `
          <div class="patient-visit-card">
            <div class="patient-visit-date">${esc(formatDate(v.date))} ${progressBadge(v)}</div>
            ${v.remedy ? `<div class="patient-visit-remedy">${esc(v.remedy)}${v.potency ? " " + esc(v.potency) : ""}</div>` : ""}
            ${v.symptoms ? `<div class="patient-visit-symptoms">${esc(v.symptoms)}</div>` : ""}
            ${v.remedy ? `<button type="button" class="pv-print-btn" data-vi="${vi}">🖨 Print prescription</button>` : ""}
          </div>
        `).join("") || `<div class="patient-list-empty">No visit details.</div>`}
      `;

      patientDetailContent.querySelectorAll(".pv-print-btn").forEach(btn => {
        btn.addEventListener("click", () => printPrescription(p, visits[Number(btn.getAttribute("data-vi"))]));
      });

      const quickInput = patientDetailContent.querySelector(".patient-quick-update-input");
      const quickBtn = patientDetailContent.querySelector(".patient-quick-update-btn");
      const quickResult = patientDetailContent.querySelector(".patient-quick-update-result");
      if (quickInput && quickBtn && quickResult) {
        function runQuickCheck() {
          if (!window.HeringAnalysis) return;
          const text = quickInput.value;
          const result = window.HeringAnalysis.analyzeQuickFollowUp(text);
          quickResult.innerHTML = window.HeringAnalysis.renderFollowUpActionCard(result) + `
            <div class="pv-picker"><span class="pv-picker-lbl">How is the patient now?</span>
              ${Object.keys(PROGRESS).map(k => `<button type="button" class="pv-pick" data-p="${k}">${PROGRESS[k].icon} ${PROGRESS[k].label}</button>`).join("")}
            </div>
            <div>
              <button type="button" class="patient-quick-save-btn">💾 Save this as a new visit</button>
              <span class="patient-quick-save-status"></span>
            </div>
          `;
          let chosenProgress = "";
          quickResult.querySelectorAll(".pv-pick").forEach(b => b.addEventListener("click", () => {
            chosenProgress = b.getAttribute("data-p");
            quickResult.querySelectorAll(".pv-pick").forEach(x => x.classList.toggle("on", x === b));
          }));
          const saveBtn = quickResult.querySelector(".patient-quick-save-btn");
          const saveStatus = quickResult.querySelector(".patient-quick-save-status");
          saveBtn.addEventListener("click", async () => {
            saveBtn.disabled = true;
            saveStatus.textContent = "Saving…";
            try {
              await window.RemedyAuth.savePatientVisit(
                { id: p.id, name: p.name, age: p.age, contact: p.contact },
                {
                  date: new Date().toISOString(),
                  symptoms: text.trim(),
                  tags: [],
                  remedy: lastVisit ? (lastVisit.remedy || "") : "",
                  potency: lastVisit ? (lastVisit.potency || "") : "",
                  ...(chosenProgress ? { progress: chosenProgress } : {})
                }
              );
              p.visits = p.visits || [];
              p.visits.push({ date: new Date().toISOString(), symptoms: text.trim(), tags: [], remedy: lastVisit ? lastVisit.remedy : "", potency: lastVisit ? lastVisit.potency : "", ...(chosenProgress ? { progress: chosenProgress } : {}) });
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

      const deleteBtn = patientDetailContent.querySelector(".patient-delete-btn");
      deleteBtn.addEventListener("click", async () => {
        // Deleting a patient's full visit history is not reversible — a plain
        // browser confirm is enough friction to stop an accidental tap without
        // adding a whole extra modal for something a doctor does rarely.
        const sure = confirm(`Delete ${p.name} and their full visit history? This cannot be undone.`);
        if (!sure) return;
        deleteBtn.disabled = true;
        deleteBtn.textContent = "Deleting…";
        try {
          await window.RemedyAuth.deletePatient(patientId);
          myPatients = myPatients.filter(x => x.id !== patientId);
          backToList();
          renderPatientList(patientSearchInput.value);
        } catch (err) {
          deleteBtn.disabled = false;
          deleteBtn.textContent = "🗑️ Delete patient";
          alert(err && err.message ? err.message : "Could not delete — try again.");
        }
      });

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
