/**
 * Authentication screens logic: Login & Registration validation, password toggle,
 * real POST /api/auth/login and POST /api/auth/register integration.
 */
import { API, setFallbackToken } from "./api.js";
import { qs, qsa, showToast } from "./utils.js";

function showFeedback(message, type = "error") {
  const box = qs("#auth-feedback");
  if (!box) return;
  box.hidden = false;
  box.className = `form-alert form-alert-${type}`;
  box.textContent = message;
}

function wirePasswordToggles() {
  qsa("[data-toggle-pw]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = qs(`#${btn.dataset.togglePw}`);
      if (!target) return;
      const isHidden = target.type === "password";
      target.type = isHidden ? "text" : "password";
      btn.textContent = isHidden ? "Hide" : "Show";
      btn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
    });
  });
}

function initLoginPage() {
  const form = qs("#login-form");
  if (!form) return;

  const demoBtn = qs("#fill-demo-btn");
  if (demoBtn) {
    demoBtn.addEventListener("click", () => {
      qs("#login-identifier").value = "elena.demo@unimeet.edu";
      qs("#login-password").value = "DemoUser123!";
      showToast("Demo credentials filled. Click Sign in to continue.", "info");
    });
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const identifier = qs("#login-identifier").value.trim();
    const password = qs("#login-password").value;
    qs("#err-identifier").textContent = "";
    qs("#err-password").textContent = "";

    let valid = true;
    if (!identifier) {
      qs("#err-identifier").textContent = "Please enter your email or username.";
      valid = false;
    }
    if (!password) {
      qs("#err-password").textContent = "Please enter your password.";
      valid = false;
    }
    if (!valid) return;

    const btn = qs("#login-submit-btn");
    btn.disabled = true;
    btn.textContent = "Signing in...";

    try {
      const res = await API.login({ identifier, password });
      if (res.access_token) setFallbackToken(res.access_token);
      showFeedback("Signed in! Redirecting to Discover...", "success");
      window.setTimeout(() => {
        window.location.href = "discover.html";
      }, 450);
    } catch (err) {
      showFeedback(err.message || "Login failed.", "error");
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });
}

function initRegisterPage() {
  const form = qs("#register-form");
  if (!form) return;

  const pwInput = qs("#reg-password");
  const ruleLen = qs("#rule-len");
  const ruleLetter = qs("#rule-letter");
  const ruleDigit = qs("#rule-digit");

  const checkPasswordRules = (pw) => {
    const hasLen = pw.length >= 8;
    const hasLetter = /[A-Za-z]/.test(pw);
    const hasDigit = /\d/.test(pw);
    ruleLen.classList.toggle("is-met", hasLen);
    ruleLetter.classList.toggle("is-met", hasLetter);
    ruleDigit.classList.toggle("is-met", hasDigit);
    return hasLen && hasLetter && hasDigit;
  };

  pwInput.addEventListener("input", () => checkPasswordRules(pwInput.value));

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    qsa(".field-error", form).forEach((el) => {
      el.textContent = "";
    });

    const firstName = qs("#reg-first-name").value.trim();
    const lastName = qs("#reg-last-name").value.trim();
    const username = qs("#reg-username").value.trim();
    const email = qs("#reg-email").value.trim();
    const university = qs("#reg-university").value.trim();
    const city = qs("#reg-city").value.trim();
    const password = pwInput.value;
    const confirm = qs("#reg-confirm").value;

    let valid = true;
    if (!firstName) {
      qs("#err-first-name").textContent = "First name is required.";
      valid = false;
    }
    if (!lastName) {
      qs("#err-last-name").textContent = "Last name is required.";
      valid = false;
    }
    if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username)) {
      qs("#err-username").textContent = "Username must be 3–50 chars (letters, numbers, _, ., -).";
      valid = false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      qs("#err-email").textContent = "Please enter a valid email address.";
      valid = false;
    }
    if (!checkPasswordRules(password)) {
      qs("#err-password").textContent = "Password must meet all requirements above.";
      valid = false;
    }
    if (password !== confirm) {
      qs("#err-confirm").textContent = "Passwords do not match.";
      valid = false;
    }
    if (!valid) return;

    const btn = qs("#register-submit-btn");
    btn.disabled = true;
    btn.textContent = "Creating account...";

    try {
      const res = await API.register({
        first_name: firstName,
        last_name: lastName,
        username,
        email,
        university: university || null,
        city: city || null,
        password,
      });
      if (res.access_token) setFallbackToken(res.access_token);
      showFeedback("Account created! Taking you to your profile interests...", "success");
      window.setTimeout(() => {
        window.location.href = "profile.html";
      }, 600);
    } catch (err) {
      showFeedback(err.message || "Registration failed.", "error");
      btn.disabled = false;
      btn.textContent = "Create account";
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wirePasswordToggles();
  const page = document.body?.dataset?.page;
  if (page === "login") initLoginPage();
  if (page === "register") initRegisterPage();
});
