// remedy-guide.js — A–Z list of remedies. Tap one to see ONLY its key points
// (short keynotes, worse/better), not the long materia medica text.
(function () {
  let remedies = null;
  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function waitFor(check, run, n) { if (check()) return run(); if (n > 0) setTimeout(() => waitFor(check, run, n - 1), 250); }
  waitFor(() => document.getElementById("remedyGuideBtn"), setup, 80);

  function cap(s) { s = s.trim(); return s.charAt(0).toUpperCase() + s.slice(1); }

  // Short, readable key points only: sort by weight, drop long sentences, drop duplicates.
  function keyPoints(r, big) {
    const seen = new Set(), worse = [], better = [], key = [];
    [...(r.keynotes || [])].sort((a, b) => (b.w || 0) - (a.w || 0)).forEach(k => {
      const t = (k.t || "").trim().replace(/[.;]+$/, "");
      if (!t || t.length > 55 || seen.has(t.toLowerCase())) return;
      seen.add(t.toLowerCase());
      if (/^worse\b/i.test(t)) worse.push(t.replace(/^worse\s*/i, ""));
      else if (/^better\b/i.test(t)) better.push(t.replace(/^better\s*/i, ""));
      else key.push(t);
    });
    return big ? { key: key.slice(0, 6), worse: worse.slice(0, 6), better: better.slice(0, 6) } : { key: key.slice(0, 6), worse: worse.slice(0, 5), better: better.slice(0, 5) };
  }

  function setup() {
    const modal = document.createElement("div");
    modal.id = "remedyGuideModal"; modal.className = "settings-modal"; modal.style.display = "none";
    modal.innerHTML = `<div class="settings-modal-inner browse-modal-inner">
      <div class="settings-modal-header"><span>💊 Remedies A–Z</span><button type="button" id="rgClose" class="settings-close">✕</button></div>
      <div id="rgListPane"><input type="search" id="rgSearch" class="settings-input" placeholder="Search remedy… e.g. bry, arnica" autocomplete="off">
        <div id="rgList" class="browse-chapter-list"></div></div>
      <div id="rgComparePane" style="display:none;"><button type="button" id="rgCmpBack" class="patient-back-btn">← Back</button><div id="rgCompare"></div></div>
      <div id="rgDetailPane" style="display:none;"><button type="button" id="rgBack" class="patient-back-btn">← All remedies</button><div id="rgDetail"></div></div>
    </div>`;
    document.body.appendChild(modal);
    const $ = (id) => document.getElementById(id);
    let compareFrom = null;

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
        <button type="button" class="rg-cmp-btn" data-id="${esc(r.id)}">⚖ Compare with another remedy</button>
        <div class="rg-note">Reference only. The full case decides the remedy.</div>`;
      $("rgListPane").style.display = "none"; $("rgDetailPane").style.display = "";
    }

    function showCompare(aId, bId) {
      const A = remedies.find(x => x.id === aId), B = remedies.find(x => x.id === bId); if (!A || !B) return;
      const ka = keyPoints(A, true), kb = keyPoints(B, true);
      const li = (arr) => arr.length ? `<ul class="rg-ul">${arr.map(x => `<li>${esc(cap(x))}</li>`).join("")}</ul>` : `<div class="rg-none">—</div>`;
      const block = (title, a, b) => {
        const sa = new Set(a.map(x => x.toLowerCase())), sb = new Set(b.map(x => x.toLowerCase()));
        const both = a.filter(x => sb.has(x.toLowerCase()));
        const onlyA = a.filter(x => !sb.has(x.toLowerCase())), onlyB = b.filter(x => !sa.has(x.toLowerCase()));
        if (!a.length && !b.length) return "";
        return `<div class="rg-h">${title}</div>
          ${both.length ? `<div class="rg-both"><span class="rg-both-lbl">Both:</span> ${both.map(x => esc(cap(x))).join(", ")}</div>` : ""}
          <div class="rg-cols"><div>${li(onlyA)}</div><div>${li(onlyB)}</div></div>`;
      };
      const pa = A.potency || {}, pb = B.potency || {};
      $("rgCompare").innerHTML = `
        <div class="rg-cols rg-cols-head"><div class="rg-name2">${esc(A.name)}</div><div class="rg-name2">${esc(B.name)}</div></div>
        ${block("Key points", ka.key, kb.key)}${block("Worse from", ka.worse, kb.worse)}${block("Better from", ka.better, kb.better)}
        <div class="rg-h">Usual potency</div>
        <div class="rg-cols"><div class="rg-small">${esc(pa.acute || pa.chronic || "—")}</div><div class="rg-small">${esc(pb.acute || pb.chronic || "—")}</div></div>
        <div class="rg-note">Look at what is different. Items under "Both" do not help to choose. The full case decides.</div>`;
      $("rgListPane").style.display = "none"; $("rgDetailPane").style.display = "none"; $("rgComparePane").style.display = "";
      compareFrom = null;
    }
    $("remedyGuideBtn").addEventListener("click", async () => {
      modal.style.display = "flex"; compareFrom = null; $("rgComparePane").style.display = "none";
      if (!remedies) {
        try { remedies = (await (await fetch("remedies.json")).json()).remedies || []; }
        catch (e) { $("rgList").innerHTML = `<div class="msg">Could not load remedies. Check your connection.</div>`; return; }
      }
      $("rgDetailPane").style.display = "none"; $("rgListPane").style.display = ""; renderList($("rgSearch").value);
    });
    $("rgClose").addEventListener("click", () => { modal.style.display = "none"; });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });
    $("rgSearch").addEventListener("input", (e) => renderList(e.target.value));
    $("rgList").addEventListener("click", (e) => { const b = e.target.closest(".rg-row"); if (!b) return; const id = b.getAttribute("data-id"); if (compareFrom && compareFrom !== id) showCompare(compareFrom, id); else showDetail(id); });
    $("rgDetail").addEventListener("click", (e) => {
      const b = e.target.closest(".rg-cmp-btn"); if (!b) return;
      compareFrom = b.getAttribute("data-id"); const r = remedies.find(x => x.id === compareFrom);
      $("rgDetailPane").style.display = "none"; $("rgListPane").style.display = ""; $("rgSearch").value = ""; renderList("");
      $("rgList").insertAdjacentHTML("afterbegin", `<div class="rg-pick">Pick a remedy to compare with <b>${esc(r.name)}</b></div>`);
    });
    $("rgCmpBack").addEventListener("click", () => { $("rgComparePane").style.display = "none"; $("rgListPane").style.display = ""; renderList($("rgSearch").value); });
    $("rgBack").addEventListener("click", () => { compareFrom = null; $("rgDetailPane").style.display = "none"; $("rgListPane").style.display = ""; });
  }
})();
