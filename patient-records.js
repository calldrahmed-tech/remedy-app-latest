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
    const patientHistory = document.getElementById("patientHistory");

    const myPatientsModal = document.getElementById("myPatientsModal");
    const myPatientsCloseBtn = document.getElementById("myPatientsCloseBtn");
    const patientSearchInput = document.getElementById("patientSearchInput");
    const patientListArea = document.getElementById("patientListArea");
    const patientDetailArea = document.getElementById("patientDetailArea");
    const patientDetailContent = document.getElementById("patientDetailContent");
    const patientDetailBackBtn = document.getElementById("patientDetailBackBtn");

    let myPatients = []; // cached after last fetch, filtered locally on search

    // Only logged-in doctors see the save/list buttons — nothing about this
    // requires touching script.js/protocol-mode.js, we only read their DOM.
    window.RemedyAuth.onAuthChange((user) => {
      patientActionsRow.style.display = user ? "flex" : "none";
    });

    // Reads whichever mode is currently visible (Expert Protocol or Full
    // Repertory) to capture what the doctor was just looking at.
    function getCurrentCaseInfo() {
      const protocolVisible = getComputedStyle(document.getElementById("protocolModeInput")).display !== "none";
      if (protocolVisible) {
        const chipsText = (document.getElementById("protocolChips").innerText || "").trim();
        const topRemedyEl = document.querySelector("#protocolResults .rc-name");
        return {
          symptoms: chipsText,
          remedy: topRemedyEl ? topRemedyEl.textContent.trim() : ""
        };
      }
      const symptoms = (document.getElementById("symptomInput").value || "").trim();
      const topRemedyEl = document.querySelector("#results .md-remedy-name");
      return {
        symptoms,
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
            remedy: caseInfo.remedy
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
      patientDetailContent.innerHTML = `
        <div class="patient-detail-header">
          <div class="name">${esc(p.name)}</div>
          <div class="meta">${p.age ? "Age " + esc(p.age) + " · " : ""}${esc(p.contact || "")}</div>
        </div>
        ${visits.map(v => `
          <div class="patient-visit-card">
            <div class="patient-visit-date">${esc(formatDate(v.date))}</div>
            ${v.remedy ? `<div class="patient-visit-remedy">${esc(v.remedy)}</div>` : ""}
            ${v.symptoms ? `<div class="patient-visit-symptoms">${esc(v.symptoms)}</div>` : ""}
          </div>
        `).join("") || `<div class="patient-list-empty">No visit details.</div>`}
      `;
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
