// patient-info.js — optional patient-info toggle. Purely on-screen, nothing
// is saved or sent anywhere; it's just a note area for the doctor's own use
// while working a case.

(function () {
  const toggle = document.getElementById("patientInfoToggle");
  const fields = document.getElementById("patientInfoFields");
  const chevron = document.getElementById("patientInfoChevron");
  if (!toggle || !fields) return;

  toggle.addEventListener("click", () => {
    const isOpen = fields.style.display !== "none";
    fields.style.display = isOpen ? "none" : "flex";
    chevron.textContent = isOpen ? "▾" : "▴";
  });
})();
