// repertorize.js — classical repertorization: the doctor picks individual
// rubrics across different chapters (Eye, Urinary, Mind, Generalities...)
// and this tallies which remedy best covers the picked set, the same way
// RADAR/ReferenceWorks-style repertorization software works. Standalone
// module, fetches its own copy of repertory.json/remedies.json — same
// isolation pattern as browse-repertory.js, does not touch the main
// search engine in script.js at all.
//
// Two entry modes into the same rubric-picking pane:
//  - "By Chapter" (original): browse Eye/Urinary/Mind/... then tick rubrics.
//  - "By Condition" (new): click a common disease name (Tonsillitis, Fever,
//    Toothache, Earache, ...) and get a cross-chapter shortlist of every
//    rubric mentioning that condition, still tick-to-add the same way.
// Both modes feed the exact same selected-rubrics tray and Compute step.

(function () {
  let repertory = null;
  let remedyNames = {}; // id -> display name
  let currentChapter = null;
  let mode = "chapter"; // "chapter" | "condition"
  let currentCondition = null; // { label, keywords }
  let selected = []; // [{key, section, rubric, remedies}]

  // Curated common conditions a doctor or patient would search by name rather than
  // by picking through chapters. Each keyword is matched as a case-insensitive
  // substring against rubric text — multi-word phrases where possible to avoid
  // false-positive noise from generic single words (e.g. "cold" alone would match
  // every "worse from cold" modality rubric across the whole repertory).
  const CONDITIONS = [
    { label: "Tonsillitis", keywords: ["tonsillitis", "tonsils swollen", "tonsils infected"] },
    { label: "Earache / Ear Infection", keywords: ["ear infection", "earache", "otitis"] },
    { label: "Toothache", keywords: ["toothache", "tooth pain", "tooth ache"] },
    { label: "Fever", keywords: ["fever"] },
    { label: "Headache", keywords: ["headache", "migraine"] },
    { label: "Sinusitis", keywords: ["sinusitis", "sinus infection"] },
    { label: "Common Cold", keywords: ["common cold"] },
    { label: "Cough", keywords: ["cough"] },
    { label: "Bronchitis / Chest Infection", keywords: ["bronchitis", "chest infection"] },
    { label: "Sore Throat", keywords: ["sore throat"] },
    { label: "Urinary Infection (UTI)", keywords: ["urinary tract infection", "uti with"] },
    { label: "Boils / Abscess", keywords: ["boil", "abscess"] },
    { label: "Conjunctivitis / Pink Eye", keywords: ["conjunctivitis", "pink eye"] },
    { label: "Mouth Ulcers", keywords: ["mouth ulcer", "stomatitis"] },
    { label: "Swollen Glands", keywords: ["gland"] },
    { label: "Diarrhea", keywords: ["diarrhea"] },
    { label: "Constipation", keywords: ["constipation"] },
    { label: "Acidity / Heartburn", keywords: ["acidity", "heartburn"] },
    { label: "Back Pain", keywords: ["back pain"] },
    { label: "Joint Pain", keywords: ["joint"] },
    { label: "Skin Rash / Itching", keywords: ["rash", "itching"] },
    { label: "Vertigo / Dizziness", keywords: ["vertigo", "dizz"] }
  ];

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function rubricKey(section, rubric) { return section + "::" + rubric; }

  function waitForReady(check, thenRun, triesLeft) {
    if (check()) { thenRun(); return; }
    if (triesLeft <= 0) return;
    setTimeout(() => waitForReady(check, thenRun, triesLeft - 1), 250);
  }

  waitForReady(() => document.getElementById("repertorizeBtn"), setup, 80);

  function setup() {
    const openBtn = document.getElementById("repertorizeBtn");
    const modal = document.getElementById("repertorizeModal");
    const closeBtn = document.getElementById("repCloseBtn");
    const chapterList = document.getElementById("repChapterList");
    const conditionList = document.getElementById("repConditionList");
    const rubricPane = document.getElementById("repRubricPane");
    const rubricSearch = document.getElementById("repRubricSearch");
    const rubricList = document.getElementById("repRubricList");
    const backBtn = document.getElementById("repBackBtn");
    const resultsPane = document.getElementById("repResultsPane");
    const resultsContent = document.getElementById("repResultsContent");
    const resultsBackBtn = document.getElementById("repResultsBackBtn");
    const titleEl = document.getElementById("repModalTitle");
    const tray = document.getElementById("repTray");
    const computeBtn = document.getElementById("repComputeBtn");
    const modeTabs = document.getElementById("repModeTabs");
    const modeChapterBtn = document.getElementById("repModeChapterBtn");
    const modeConditionBtn = document.getElementById("repModeConditionBtn");

    function renderTray() {
      if (!selected.length) {
        tray.innerHTML = `<div class="repertorize-tray-empty">No rubrics picked yet. Choose a chapter below, then tick the rubrics that fit this case.</div>`;
        computeBtn.style.display = "none";
        return;
      }
      tray.innerHTML = `<div class="repertorize-tray-title">${selected.length} rubric${selected.length === 1 ? "" : "s"} picked for this case:</div>` +
        selected.map(s => `
          <div class="repertorize-tray-item">
            <span class="repertorize-tray-chapter">${esc(s.section)}</span>
            <span class="repertorize-tray-rubric">${esc(s.rubric)}</span>
            <button type="button" class="repertorize-tray-remove" data-key="${esc(s.key)}" title="Remove">✕</button>
          </div>
        `).join("");
      tray.querySelectorAll(".repertorize-tray-remove").forEach(btn => {
        btn.addEventListener("click", () => {
          selected = selected.filter(s => s.key !== btn.dataset.key);
          renderTray();
          if (mode === "chapter" && currentChapter) renderRubricList(rubricSearch.value);
          if (mode === "condition" && currentCondition) renderConditionRubricList(rubricSearch.value);
        });
      });
      computeBtn.style.display = "block";
    }

    function setModeTab(newMode) {
      mode = newMode;
      modeChapterBtn.classList.toggle("repertorize-mode-tab-active", mode === "chapter");
      modeConditionBtn.classList.toggle("repertorize-mode-tab-active", mode === "condition");
    }

    function showChapters() {
      setModeTab("chapter");
      titleEl.textContent = "🧮 Repertorize Case";
      chapterList.style.display = "block";
      conditionList.style.display = "none";
      rubricPane.style.display = "none";
      resultsPane.style.display = "none";
      currentChapter = null;
      currentCondition = null;
    }

    function showConditions() {
      setModeTab("condition");
      titleEl.textContent = "🧮 Repertorize Case";
      chapterList.style.display = "none";
      conditionList.style.display = "block";
      rubricPane.style.display = "none";
      resultsPane.style.display = "none";
      currentChapter = null;
      currentCondition = null;
    }

    function showRubrics(section) {
      currentChapter = section;
      currentCondition = null;
      titleEl.textContent = "🧮 " + section;
      chapterList.style.display = "none";
      conditionList.style.display = "none";
      resultsPane.style.display = "none";
      rubricPane.style.display = "block";
      backBtn.textContent = "← All chapters";
      rubricSearch.placeholder = "Search inside this chapter…";
      rubricSearch.value = "";
      renderRubricList("");
    }

    function showConditionRubrics(condition) {
      currentCondition = condition;
      currentChapter = null;
      titleEl.textContent = "🧮 " + condition.label;
      chapterList.style.display = "none";
      conditionList.style.display = "none";
      resultsPane.style.display = "none";
      rubricPane.style.display = "block";
      backBtn.textContent = "← All conditions";
      rubricSearch.placeholder = "Narrow down within " + condition.label + "…";
      rubricSearch.value = "";
      renderConditionRubricList("");
    }

    function toggleRubric(item) {
      const key = rubricKey(item.section, item.rubric);
      const idx = selected.findIndex(s => s.key === key);
      if (idx >= 0) {
        selected.splice(idx, 1);
      } else {
        selected.push({ key, section: item.section, rubric: item.rubric, remedies: item.remedies });
      }
      renderTray();
    }

    function renderChapterList() {
      const counts = {};
      repertory.forEach(r => { counts[r.section] = (counts[r.section] || 0) + 1; });
      const sections = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      chapterList.innerHTML = sections.map(sec => `
        <div class="patient-list-row browse-chapter-row" data-section="${esc(sec)}">
          <div class="patient-list-name">${esc(sec)}</div>
          <div class="patient-list-meta">${counts[sec]} rubric${counts[sec] === 1 ? "" : "s"}</div>
        </div>
      `).join("");
      chapterList.querySelectorAll(".browse-chapter-row").forEach(row => {
        row.addEventListener("click", () => showRubrics(row.dataset.section));
      });
    }

    function renderConditionList() {
      conditionList.innerHTML = CONDITIONS.map(c => {
        const count = repertory.filter(r => matchesCondition(r, c)).length;
        return `
        <div class="patient-list-row browse-chapter-row" data-label="${esc(c.label)}">
          <div class="patient-list-name">🩺 ${esc(c.label)}</div>
          <div class="patient-list-meta">${count} match${count === 1 ? "" : "es"}</div>
        </div>`;
      }).join("");
      conditionList.querySelectorAll(".browse-chapter-row").forEach(row => {
        const condition = CONDITIONS.find(c => c.label === row.dataset.label);
        row.addEventListener("click", () => showConditionRubrics(condition));
      });
    }

    function matchesCondition(rubricItem, condition) {
      const text = rubricItem.rubric.toLowerCase();
      return condition.keywords.some(k => text.includes(k));
    }

    function renderRubricList(filterText) {
      const term = (filterText || "").trim().toLowerCase();
      const items = repertory.filter(r => r.section === currentChapter);
      const filtered = term ? items.filter(r => r.rubric.toLowerCase().includes(term)) : items;
      renderRubricRows(filtered, false);
    }

    function renderConditionRubricList(filterText) {
      const term = (filterText || "").trim().toLowerCase();
      const items = repertory.filter(r => matchesCondition(r, currentCondition));
      const filtered = term ? items.filter(r => r.rubric.toLowerCase().includes(term)) : items;
      renderRubricRows(filtered, true);
    }

    function renderRubricRows(filtered, showChapterTag) {
      if (!filtered.length) {
        rubricList.innerHTML = `<div class="patient-list-empty">No match found.</div>`;
        return;
      }
      rubricList.innerHTML = filtered.map((r) => {
        const key = rubricKey(r.section, r.rubric);
        const isChecked = selected.some(s => s.key === key);
        const chapterTag = showChapterTag ? `<span class="repertorize-tray-chapter" style="margin-right:6px;">${esc(r.section)}</span>` : "";
        return `
        <div class="patient-list-row repertorize-rubric-row ${isChecked ? "repertorize-rubric-row-checked" : ""}" data-key="${esc(key)}">
          <label class="repertorize-rubric-label">
            <input type="checkbox" class="repertorize-rubric-checkbox" ${isChecked ? "checked" : ""}>
            <span class="browse-rubric-name">${chapterTag}${esc(r.rubric)}</span>
          </label>
          <div class="patient-list-meta">${r.remedies.length} remed${r.remedies.length === 1 ? "y" : "ies"}</div>
        </div>`;
      }).join("");
      rubricList.querySelectorAll(".repertorize-rubric-row").forEach(row => {
        const item = filtered.find(r => rubricKey(r.section, r.rubric) === row.dataset.key);
        row.addEventListener("click", () => {
          toggleRubric(item);
          if (mode === "condition") renderConditionRubricList(rubricSearch.value);
          else renderRubricList(rubricSearch.value);
        });
      });
    }

    function computeResults() {
      titleEl.textContent = "🧮 Repertorization Result";
      chapterList.style.display = "none";
      conditionList.style.display = "none";
      rubricPane.style.display = "none";
      resultsPane.style.display = "block";

      // Classic Kentian repertorization tally: for every remedy, count how many of the
      // PICKED rubrics it appears in, and sum its grade across them. Ranked primarily by
      // rubric coverage (a remedy hitting more of the doctor's picked symptoms is a
      // stronger totality match), then by total grade weight as the tiebreaker.
      const totals = {};
      selected.forEach(rub => {
        rub.remedies.forEach(rm => {
          if (!totals[rm.id]) totals[rm.id] = { id: rm.id, score: 0, count: 0, rubrics: [] };
          totals[rm.id].score += rm.grade;
          totals[rm.id].count += 1;
          totals[rm.id].rubrics.push(rub.rubric);
        });
      });
      const ranked = Object.values(totals).sort((a, b) => b.count - a.count || b.score - a.score);

      if (!ranked.length) {
        resultsContent.innerHTML = `<div class="patient-list-empty">None of the picked rubrics share a common remedy.</div>`;
        return;
      }

      const totalRubrics = selected.length;
      resultsContent.innerHTML = `<div class="repertorize-result-summary">Based on ${totalRubrics} picked rubric${totalRubrics === 1 ? "" : "s"}:</div>` +
        ranked.slice(0, 15).map((r, i) => {
          const name = remedyNames[r.id] || r.id;
          const pct = Math.round((r.count / totalRubrics) * 100);
          return `
          <div class="repertorize-result-row ${i === 0 ? "repertorize-result-top" : ""}">
            <div class="repertorize-result-rank">${i + 1}</div>
            <div class="repertorize-result-info">
              <div class="repertorize-result-name">${esc(name)}</div>
              <div class="repertorize-result-meta">Covers ${r.count}/${totalRubrics} rubrics (${pct}%) · grade total ${r.score}</div>
            </div>
          </div>`;
        }).join("");
    }

    function openModal() {
      modal.style.display = "flex";
      showChapters();
      renderTray();
      if (!repertory) {
        chapterList.innerHTML = `<div class="patient-list-empty">Loading…</div>`;
        Promise.all([
          fetch("repertory.json").then(r => r.json()),
          fetch("remedies.json").then(r => r.json())
        ]).then(([repData, remData]) => {
          repertory = repData.repertory || [];
          (remData.remedies || []).forEach(r => { remedyNames[r.id] = r.name; });
          renderChapterList();
          renderConditionList();
        }).catch(() => {
          chapterList.innerHTML = `<div class="patient-list-empty">Could not load repertory.</div>`;
        });
      } else {
        renderChapterList();
        renderConditionList();
      }
    }

    openBtn.addEventListener("click", openModal);
    closeBtn.addEventListener("click", () => { modal.style.display = "none"; });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });
    backBtn.addEventListener("click", () => { mode === "condition" ? showConditions() : showChapters(); });
    resultsBackBtn.addEventListener("click", showChapters);
    rubricSearch.addEventListener("input", () => {
      if (mode === "condition") renderConditionRubricList(rubricSearch.value);
      else renderRubricList(rubricSearch.value);
    });
    computeBtn.addEventListener("click", computeResults);
    modeChapterBtn.addEventListener("click", showChapters);
    modeConditionBtn.addEventListener("click", showConditions);
  }
})();
