// remedy-guide.js — A–Z list of remedies. Tap one to see ONLY its key points
// (short keynotes, worse/better), not the long materia medica text.
(function () {
  let remedies = null;
  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function waitFor(check, run, n) { if (check()) return run(); if (n > 0) setTimeout(() => waitFor(check, run, n - 1), 250); }
  waitFor(() => document.getElementById("remedyGuideBtn"), setup, 80);

  function cap(s) { s = s.trim(); return s.charAt(0).toUpperCase() + s.slice(1); }

  // Short, readable key points only: sort by weight, drop long sentences, drop duplicates.
  function keyPoints(r) {
    const seen = new Set(), worse = [], better = [], key = [];
    [...(r.keynotes || [])].sort((a, b) => (b.w || 0) - (a.w || 0)).forEach(k => {
      const t = (k.t || "").trim().replace(/[.;]+$/, "");
      if (!t || t.length > 55 || seen.has(t.toLowerCase())) return;
      seen.add(t.toLowerCase());
      if (/^worse\b/i.test(t)) worse.push(t.replace(/^worse\s*/i, ""));
      else if (/^better\b/i.test(t)) better.push(t.replace(/^better\s*/i, ""));
      else key.push(t);
    });
    return { key: key.slice(0, 6), worse: worse.slice(0, 5), better: better.slice(0, 5) };
  }

  function setup() {
    const modal = document.createElement("div");
    modal.id = "remedyGuideModal"; modal.className = "settings-modal"; modal.style.display = "none";
    modal.innerHTML = `<div class="settings-modal-inner browse-modal-inner">
      <div class="settings-modal-header"><span>💊 Remedies A–Z</span><button type="button" id="rgClose" class="settings-close">✕</button></div>
      <div id="rgListPane"><input type="search" id="rgSearch" class="settings-input" placeholder="Search remedy… e.g. bry, arnica" autocomplete="off">
        <div id="rgList" class="browse-chapter-list"></div></div>
      <div id="rgDetailPane" style="display:none;"><button type="button" id="rgBack" class="patient-back-btn">← All remedies</button><div id="rgDetail"></div></div>
    </div>`;
    document.body.appendChild(modal);
    const $ = (id) => document.getElementById(id);

    function renderList(term) {
      const t = (term || "").toLowerCase().trim();
      const rows = remedies.filter(r => r.category && !(r.nosode)).filter(r => !t || (r.name + " " + r.abbr).toLowerCase().includes(t))
        .sort((a, b) => a.name.localeCompare(b.name));
      $("rgList").innerHTML = rows.length ? rows.map(r => `<button type="button" class="rg-row" data-id="${esc(r.id)}"><b>${esc(r.name)}</b> <span class="rg-abbr">${esc(r.abbr || "")}</span></button>`).join("")
        : `<div class="msg">No remedy found.</div>`;
    }
    function showDetail(id) {
      const r = remedies.find(x => x.id === id); if (!r) return;
      const k = keyPoints(r);
      const list = (arr) => arr.map(x => `<li>${esc(cap(x))}</li>`).join("");
      const pot = r.potency || {};
      $("rgDetail").innerHTML = `
        <div class="rg-name">${esc(r.name)} <span class="rg-abbr">${esc(r.abbr || "")}</span></div>
        <div class="rg-cat">${esc(cap(r.category || ""))}${r.system && r.system.length ? " · " + esc(r.system.slice(0, 4).join(", ")) : ""}</div>
        ${k.key.length ? `<div class="rg-h">Key points</div><ul class="rg-ul">${list(k.key)}</ul>` : ""}
        ${k.worse.length ? `<div class="rg-h">Worse from</div><ul class="rg-ul">${list(k.worse)}</ul>` : ""}
        ${k.better.length ? `<div class="rg-h">Better from</div><ul class="rg-ul">${list(k.better)}</ul>` : ""}
        ${pot.acute || pot.chronic ? `<div class="rg-h">Usual potency</div><ul class="rg-ul">${pot.acute ? `<li>${esc(pot.acute)}</li>` : ""}${pot.chronic ? `<li>${esc(pot.chronic)}</li>` : ""}</ul>` : ""}
        <div class="rg-note">Reference only. The full case decides the remedy.</div>`;
      $("rgListPane").style.display = "none"; $("rgDetailPane").style.display = "";
    }
    $("remedyGuideBtn").addEventListener("click", async () => {
      modal.style.display = "flex";
      if (!remedies) {
        try { remedies = (await (await fetch("remedies.json")).json()).remedies || []; }
        catch (e) { $("rgList").innerHTML = `<div class="msg">Could not load remedies. Check your connection.</div>`; return; }
      }
      $("rgDetailPane").style.display = "none"; $("rgListPane").style.display = ""; renderList($("rgSearch").value);
    });
    $("rgClose").addEventListener("click", () => { modal.style.display = "none"; });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });
    $("rgSearch").addEventListener("input", (e) => renderList(e.target.value));
    $("rgList").addEventListener("click", (e) => { const b = e.target.closest(".rg-row"); if (b) showDetail(b.getAttribute("data-id")); });
    $("rgBack").addEventListener("click", () => { $("rgDetailPane").style.display = "none"; $("rgListPane").style.display = ""; });
  }
})();
