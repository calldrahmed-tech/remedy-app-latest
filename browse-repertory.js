// browse-repertory.js — lets a doctor open the repertory chapter-by-chapter
// (Abdomen, Eye, Ear, Mind, ...) and search inside one chapter, instead of
// only free-text search. Purely a browsing/reference view — clicking a
// rubric shows its graded remedies, it does not feed back into the main
// search. Fetches its own copy of repertory.json/remedies.json (small,
// cached by the browser) rather than reaching into script.js's internal
// module-scoped DB, same isolation pattern as ai-assist.js / auth-ui.js.

(function () {
  let repertory = null;
  let remedyNames = {}; // id -> display name
  let currentChapter = null;

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function waitForReady(check, thenRun, triesLeft) {
    if (check()) { thenRun(); return; }
    if (triesLeft <= 0) return;
    setTimeout(() => waitForReady(check, thenRun, triesLeft - 1), 250);
  }

  waitForReady(() => document.getElementById("browseRepertoryBtn"), setup, 80);

  function setup() {
    const openBtn = document.getElementById("browseRepertoryBtn");
    const modal = document.getElementById("browseRepertoryModal");
    const closeBtn = document.getElementById("browseCloseBtn");
    const chapterList = document.getElementById("browseChapterList");
    const rubricPane = document.getElementById("browseRubricPane");
    const rubricSearch = document.getElementById("browseRubricSearch");
    const rubricList = document.getElementById("browseRubricList");
    const backBtn = document.getElementById("browseBackBtn");
    const remedyPane = document.getElementById("browseRemedyPane");
    const remedyContent = document.getElementById("browseRemedyContent");
    const rubricBackBtn = document.getElementById("browseRubricBackBtn");
    const titleEl = document.getElementById("browseModalTitle");

    function showChapters() {
      titleEl.textContent = "📖 Browse Repertory";
      chapterList.style.display = "block";
      rubricPane.style.display = "none";
      remedyPane.style.display = "none";
      currentChapter = null;
    }

    function showRubrics(section) {
      currentChapter = section;
      titleEl.textContent = "📖 " + section;
      chapterList.style.display = "none";
      remedyPane.style.display = "none";
      rubricPane.style.display = "block";
      rubricSearch.value = "";
      renderRubricList("");
    }

    function showRemedies(rubric) {
      titleEl.textContent = "📖 " + rubric.rubric;
      rubricPane.style.display = "none";
      remedyPane.style.display = "block";
      const sorted = rubric.remedies.slice().sort((a, b) => b.grade - a.grade);
      remedyContent.innerHTML = sorted.map(r => {
        const stars = "★".repeat(r.grade) + "☆".repeat(3 - r.grade);
        const name = remedyNames[r.id] || r.id;
        return `<div class="browse-remedy-item"><span class="browse-remedy-stars">${stars}</span><span class="browse-remedy-name">${esc(name)}</span></div>`;
      }).join("") || `<div class="patient-list-empty">No remedies listed.</div>`;
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

    function renderRubricList(filterText) {
      const term = (filterText || "").trim().toLowerCase();
      const items = repertory.filter(r => r.section === currentChapter);
      const filtered = term ? items.filter(r => r.rubric.toLowerCase().includes(term)) : items;
      if (!filtered.length) {
        rubricList.innerHTML = `<div class="patient-list-empty">No match in this chapter.</div>`;
        return;
      }
      rubricList.innerHTML = filtered.map((r, i) => `
        <div class="patient-list-row browse-rubric-row" data-idx="${items.indexOf(r)}">
          <div class="patient-list-name browse-rubric-name">${esc(r.rubric)}</div>
          <div class="patient-list-meta">${r.remedies.length} remed${r.remedies.length === 1 ? "y" : "ies"}</div>
        </div>
      `).join("");
      rubricList.querySelectorAll(".browse-rubric-row").forEach(row => {
        row.addEventListener("click", () => showRemedies(items[Number(row.dataset.idx)]));
      });
    }

    function openModal() {
      modal.style.display = "flex";
      showChapters();
      if (!repertory) {
        chapterList.innerHTML = `<div class="patient-list-empty">Loading…</div>`;
        Promise.all([
          fetch("repertory.json").then(r => r.json()),
          fetch("remedies.json").then(r => r.json())
        ]).then(([repData, remData]) => {
          repertory = repData.repertory || [];
          (remData.remedies || []).forEach(r => { remedyNames[r.id] = r.name; });
          renderChapterList();
        }).catch(() => {
          chapterList.innerHTML = `<div class="patient-list-empty">Could not load repertory.</div>`;
        });
      } else {
        renderChapterList();
      }
    }

    openBtn.addEventListener("click", openModal);
    closeBtn.addEventListener("click", () => { modal.style.display = "none"; });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });
    backBtn.addEventListener("click", showChapters);
    rubricBackBtn.addEventListener("click", () => showRubrics(currentChapter));
    rubricSearch.addEventListener("input", () => renderRubricList(rubricSearch.value));
  }
})();
