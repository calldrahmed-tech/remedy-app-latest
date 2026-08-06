// auth-ui.js — wires up the login/signup modal and account bar that already
// exist in index.html (authModal, accountBar) to window.RemedyAuth from
// firebase-init.js. Kept as its own file for the same reason as ai-assist.js:
// it only touches DOM it owns and never reaches into script.js's internals.

(function () {
  function waitForReady(check, thenRun, triesLeft) {
    if (check()) { thenRun(); return; }
    if (triesLeft <= 0) return; // give up quietly — core app still works fine
    setTimeout(() => waitForReady(check, thenRun, triesLeft - 1), 250);
  }

  waitForReady(
    () => document.getElementById("loginTriggerBtn") && window.RemedyAuth,
    setup,
    120 // 30s — Firebase SDK can take a while to load from CDN on a slow first visit
  );

  function setup() {
    const loginTriggerBtn = document.getElementById("loginTriggerBtn");
    const authModal = document.getElementById("authModal");
    const authModalTitle = document.getElementById("authModalTitle");
    const authCloseBtn = document.getElementById("authCloseBtn");
    const authForm = document.getElementById("authForm");
    const authNameField = document.getElementById("authNameField");
    const authName = document.getElementById("authName");
    const authEmail = document.getElementById("authEmail");
    const authPassword = document.getElementById("authPassword");
    const authSubmitBtn = document.getElementById("authSubmitBtn");
    const authToggleBtn = document.getElementById("authToggleBtn");
    const authStatus = document.getElementById("authStatus");
    const accountBar = document.getElementById("accountBar");
    const accountBarText = document.getElementById("accountBarText");
    const accountBarBtn = document.getElementById("accountBarBtn");

    let mode = "login"; // or "signup"

    function setStatus(msg, isError) {
      authStatus.textContent = msg || "";
      authStatus.style.color = isError ? "#c0392b" : "#2c5c3a";
    }

    function setMode(newMode) {
      mode = newMode;
      setStatus("");
      if (mode === "login") {
        authModalTitle.textContent = "🔐 Doctor Login";
        authNameField.style.display = "none";
        authSubmitBtn.textContent = "Log In";
        authToggleBtn.textContent = "Need an account? Sign Up";
        authPassword.setAttribute("autocomplete", "current-password");
      } else {
        authModalTitle.textContent = "🔐 Create Doctor Account";
        authNameField.style.display = "block";
        authSubmitBtn.textContent = "Sign Up";
        authToggleBtn.textContent = "Already have an account? Log In";
        authPassword.setAttribute("autocomplete", "new-password");
      }
    }

    function openModal() {
      setMode("login");
      authEmail.value = "";
      authPassword.value = "";
      authName.value = "";
      authModal.style.display = "flex";
    }

    function closeModal() {
      authModal.style.display = "none";
    }

    loginTriggerBtn.addEventListener("click", openModal);
    authCloseBtn.addEventListener("click", closeModal);
    authModal.addEventListener("click", (e) => {
      if (e.target === authModal) closeModal(); // click on overlay, not the card
    });
    authToggleBtn.addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));

    async function submitAuthForm() {
      const email = authEmail.value.trim();
      const password = authPassword.value;
      if (!email || !password) {
        setStatus("Email and password are required.", true);
        return;
      }
      authSubmitBtn.disabled = true;
      setStatus(mode === "login" ? "Logging in…" : "Creating account…");
      try {
        if (mode === "login") {
          await window.RemedyAuth.logIn(email, password);
        } else {
          const name = authName.value.trim();
          if (!name) {
            setStatus("Please enter your name.", true);
            authSubmitBtn.disabled = false;
            return;
          }
          await window.RemedyAuth.signUp(name, email, password);
        }
        closeModal();
      } catch (err) {
        setStatus(friendlyAuthError(err), true);
      } finally {
        authSubmitBtn.disabled = false;
      }
    }

    function friendlyAuthError(err) {
      const code = err && err.code;
      switch (code) {
        case "auth/invalid-email": return "That email address doesn't look right.";
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential": return "Incorrect email or password.";
        case "auth/email-already-in-use": return "An account with that email already exists.";
        case "auth/weak-password": return "Password must be at least 6 characters.";
        default: return "Something went wrong — please try again.";
      }
    }

    authSubmitBtn.addEventListener("click", submitAuthForm);
    authForm.addEventListener("submit", (e) => {
      e.preventDefault();
      submitAuthForm();
    });

    accountBarBtn.addEventListener("click", async () => {
      accountBarBtn.disabled = true;
      try {
        await window.RemedyAuth.logOut();
      } finally {
        accountBarBtn.disabled = false;
      }
    });

    window.RemedyAuth.onAuthChange((user) => {
      if (user) {
        loginTriggerBtn.style.display = "none";
        accountBar.style.display = "flex";
        accountBarText.textContent = "👨‍⚕️ " + (user.displayName || user.email);
        accountBarBtn.textContent = "Log Out";
      } else {
        loginTriggerBtn.style.display = "inline-block";
        accountBar.style.display = "none";
      }
    });
  }
})();
