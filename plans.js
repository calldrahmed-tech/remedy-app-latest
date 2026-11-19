// plans.js — "Plans" window, and the return step after paying at Safepay.
(function () {
  let cfg = null, currency = "PKR";
  const $ = (id) => document.getElementById(id);
  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function wait(check, fn, n) { if (check()) return fn(); if (n > 0) setTimeout(() => wait(check, fn, n - 1), 250); }

  async function loadCfg() {
    if (cfg) return cfg;
    try { cfg = await (await fetch("plans.json")).json(); } catch (e) { cfg = null; }
    return cfg;
  }
  const user = () => window.RemedyAuth && window.RemedyAuth.getCurrentUser();

  async function render() {
    const body = $("plansBody");
    if (!cfg) { body.innerHTML = `<div class="msg">Could not load plans. Check your connection.</div>`; return; }
    let status = "";
    if (user() && window.RemedyAuth.getSubscription) {
      const s = await window.RemedyAuth.getSubscription();
      if (s && s.active) status = `<div class="plans-status ok">⭐ Pro is active until <b>${esc(new Date(s.expiresAtMs).toLocaleDateString())}</b></div>`;
    }
    const open = !!cfg.paymentsOpen;
    body.innerHTML = `${status}
      <div class="plans-cur">Pay in: <button type="button" class="plans-cur-btn${currency === "PKR" ? " on" : ""}" data-c="PKR">PKR (Pakistan)</button>
        <button type="button" class="plans-cur-btn${currency === "USD" ? " on" : ""}" data-c="USD">USD (other countries)</button></div>
      <div class="plans-card"><div class="plans-title">${esc(cfg.free.title)}</div>
        <ul>${cfg.free.points.map(p => `<li>${esc(p)}</li>`).join("")}</ul><div class="plans-price">Free</div></div>
      ${cfg.paid.map(p => `<div class="plans-card pro"><div class="plans-title">⭐ ${esc(p.title)}</div>
        <ul>${cfg.proPoints.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
        <div class="plans-price">${esc(p.prices[currency] || "")}</div>
        <button type="button" class="plans-buy" data-id="${esc(p.id)}" ${open ? "" : "disabled"}>${open ? "Upgrade" : "Coming soon"}</button></div>`).join("")}
      <div id="plansMsg" class="plans-msg"></div>
      <div class="plans-links"><a href="terms.html">Terms</a> · <a href="refund.html">Refund policy</a> · <a href="privacy.html">Privacy</a></div>`;
  }

  async function buy(planId) {
    const msg = $("plansMsg");
    if (!user()) {
      msg.textContent = "Please log in first, then tap Upgrade.";
      const login = $("loginTriggerBtn"); if (login) login.click();
      return;
    }
    msg.textContent = "Opening the secure payment page…";
    try {
      const r = await window.RemedyAuth.startCheckout(planId, currency);
      if (!r || !r.url) throw new Error("no url");
      window.location.href = r.url;
    } catch (e) {
      msg.textContent = (e && e.message && /not open/i.test(e.message)) ? "Payments are not open yet." : "Could not start the payment. Please try again.";
    }
  }

  // After Safepay sends the doctor back to the app: ?payment=return&order=ord_...
  async function handleReturn() {
    const q = new URLSearchParams(location.search);
    const kind = q.get("payment");
    if (!kind) return;
    history.replaceState(null, "", location.pathname);        // keep the address bar clean
    const bar = document.createElement("div");
    bar.className = "plans-banner"; document.body.prepend(bar);
    if (kind === "cancel") { bar.textContent = "Payment cancelled. You were not charged."; setTimeout(() => bar.remove(), 8000); return; }
    const order = q.get("order");
    bar.textContent = "Confirming your payment…";
    wait(() => window.RemedyAuth && window.RemedyAuth.getCurrentUser && window.RemedyAuth.getCurrentUser(), async () => {
      for (let i = 0; i < 8; i++) {
        try {
          const r = await window.RemedyAuth.confirmCheckout(order);
          if (r && r.status === "paid") { bar.textContent = "✅ Payment received. Pro is now active. Thank you!"; setTimeout(() => bar.remove(), 10000); return; }
        } catch (e) { /* try again */ }
        await new Promise(r => setTimeout(r, 3000));
      }
      bar.textContent = "Your payment is still being confirmed. If Pro is not active in a few minutes, contact support with your payment receipt.";
    }, 40);
  }

  wait(() => $("plansTopBtn"), function () {
    const modal = document.createElement("div");
    modal.className = "settings-modal"; modal.id = "plansModal"; modal.style.display = "none";
    modal.innerHTML = `<div class="settings-modal-inner browse-modal-inner">
      <div class="settings-modal-header"><span>⭐ Plans</span><button type="button" id="plansClose" class="settings-close">✕</button></div>
      <div id="plansBody"></div></div>`;
    document.body.appendChild(modal);
    $("plansTopBtn").addEventListener("click", async () => { modal.style.display = "flex"; await loadCfg(); render(); });
    $("plansClose").addEventListener("click", () => { modal.style.display = "none"; });
    modal.addEventListener("click", (e) => {
      if (e.target === modal) { modal.style.display = "none"; return; }
      const c = e.target.closest(".plans-cur-btn"); if (c) { currency = c.getAttribute("data-c"); render(); return; }
      const b = e.target.closest(".plans-buy"); if (b && !b.disabled) buy(b.getAttribute("data-id"));
    });
    handleReturn();
  }, 80);
})();
