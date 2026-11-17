// masters.js — "Masters' Advice" tab. Data lives in masters.json so new entries can be added
// without touching code. Each entry: { condition, master, remedies:[{name,potency}], source?, note? }
(function () {
  let entries = null, activeMaster = "";
  const $ = (id) => document.getElementById(id);
  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function wait(fn, n) { if (document.getElementById("mastersPanel")) return fn(); if (n > 0) setTimeout(() => wait(fn, n - 1), 250); }

  async function load() {
    if (entries) return;
    try { entries = (await (await fetch("masters.json")).json()).entries || []; }
    catch (e) { entries = null; $("mastersList").innerHTML = `<div class="msg">Could not load. Check your connection.</div>`; }
  }
  function render() {
    if (!entries) return;
    const q = ($("mastersSearch").value || "").toLowerCase().trim();
    const masters = [...new Set(entries.map(e => e.master))].sort();
    $("mastersChips").innerHTML = ["", ...masters].map(m =>
      `<button type="button" class="masters-chip${m === activeMaster ? " on" : ""}" data-m="${esc(m)}">${m ? esc(m) : "All masters"}</button>`).join("");
    const rows = entries.filter(e => (!activeMaster || e.master === activeMaster) &&
      (!q || (e.condition + " " + e.master + " " + e.remedies.map(r => r.name).join(" ")).toLowerCase().includes(q)));
    if (!rows.length) { $("mastersList").innerHTML = `<div class="msg">Nothing found yet. This section is growing — more entries are added regularly.</div>`; return; }
    const byCond = {};
    rows.forEach(e => { (byCond[e.condition] = byCond[e.condition] || []).push(e); });
    $("mastersList").innerHTML = Object.keys(byCond).sort().map(c => `
      <div class="masters-card"><div class="masters-cond">${esc(c)}</div>
        ${byCond[c].map(e => `<div class="masters-row">
          <div class="masters-rx">${e.remedies.map(r => esc(r.name) + (r.potency ? " " + esc(r.potency) : "")).join(" + ")} <span class="masters-by">(${esc(e.master)})</span></div>
          ${e.note ? `<div class="masters-note">${esc(e.note)}</div>` : ""}
          <div class="masters-src">${e.source ? "📖 " + esc(e.source) : "📖 source to be added"}</div>
        </div>`).join("")}
      </div>`).join("");
  }
  wait(function () {
    $("mastersSearch").addEventListener("input", render);
    $("mastersChips").addEventListener("click", (e) => { const b = e.target.closest(".masters-chip"); if (!b) return; activeMaster = b.getAttribute("data-m"); render(); });
    document.querySelector('.mode-tab[data-mode="masters"]').addEventListener("click", async () => { await load(); render(); });
  }, 80);
})();
