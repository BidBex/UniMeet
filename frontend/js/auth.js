/**
 * Authentication screens logic backed by Firebase Authentication:
 * - Sign In (login.html)
 * - Dedicated Reset Password (reset-password.html, supporting Firebase oobCode)
 * - Create Account (register.html)
 * Automatically redirects already-authenticated users to discover.html.
 */
import { API } from "./api.js";
import { CONFIG } from "./config.js";
import { DemoStore } from "./demo-store.js";
import { waitForAuthInit } from "./firebase-client.js";
import { qs, qsa } from "./utils.js";

function showFeedback(message, type = "error") {
  const box = qs("#auth-feedback");
  if (!box) return;
  box.hidden = false;
  box.className = `form-alert form-alert-${type}`;
  box.textContent = message;
}

function clearFeedback() {
  const box = qs("#auth-feedback");
  if (box) {
    box.hidden = true;
    box.textContent = "";
  }
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

async function initLoginPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const oobCode = urlParams.get("oobCode") || urlParams.get("token");
  if (urlParams.get("mode") === "resetPassword" || (urlParams.get("mode") === "reset" && oobCode)) {
    const paramName = urlParams.get("oobCode") ? "oobCode" : "token";
    window.location.replace(`reset-password.html?${paramName}=${encodeURIComponent(oobCode || "")}`);
    return;
  }

  const existingUser = await waitForAuthInit();
  if (existingUser || DemoStore.isDemoSession()) {
    window.location.replace("discover.html");
    return;
  }

  const loginForm = qs("#login-form");
  if (!loginForm) return;

  loginForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    clearFeedback();
    const identifier = qs("#login-identifier").value.trim();
    const password = qs("#login-password").value;
    qs("#err-identifier").textContent = "";
    qs("#err-password").textContent = "";

    let valid = true;
    if (!identifier) {
      qs("#err-identifier").textContent = "Please enter your email address.";
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
      qs("#err-identifier").textContent = "Please enter a valid registered email address.";
      valid = false;
    }
    if (!password) {
      qs("#err-password").textContent = "Please enter your password.";
      valid = false;
    }
    if (!valid) {
      showFeedback("Please complete all required fields.", "error");
      return;
    }

    const btn = qs("#login-submit-btn");
    btn.disabled = true;
    btn.textContent = "Signing in...";

    try {
      await API.login({ identifier, password });
      showFeedback("Signed in! Redirecting to Discover...", "success");
      window.setTimeout(() => {
        window.location.href = "discover.html";
      }, 350);
    } catch (err) {
      showFeedback(err.message || "Unable to sign in right now. Please try again.", "error");
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });

  const demoEmailEl = qs("#demo-email-text");
  const demoPasswordEl = qs("#demo-password-text");
  if (demoEmailEl) demoEmailEl.textContent = CONFIG.DEMO_ACCOUNT.email;
  if (demoPasswordEl) demoPasswordEl.textContent = CONFIG.DEMO_ACCOUNT.password;

  const demoFillBtn = qs("#demo-fill-btn");
  if (demoFillBtn) {
    demoFillBtn.addEventListener("click", () => {
      clearFeedback();
      qs("#login-identifier").value = CONFIG.DEMO_ACCOUNT.email;
      qs("#login-password").value = CONFIG.DEMO_ACCOUNT.password;
      qs("#err-identifier").textContent = "";
      qs("#err-password").textContent = "";
    });
  }

  const demoLoginBtn = qs("#demo-login-btn");
  if (demoLoginBtn) {
    demoLoginBtn.addEventListener("click", async () => {
      clearFeedback();
      qs("#login-identifier").value = CONFIG.DEMO_ACCOUNT.email;
      qs("#login-password").value = CONFIG.DEMO_ACCOUNT.password;
      demoLoginBtn.disabled = true;
      demoLoginBtn.textContent = "Signing in...";
      try {
        await API.loginWithDemoAccount();
        showFeedback("Signed in as Demo Student! Redirecting to Discover...", "success");
        window.setTimeout(() => {
          window.location.href = "discover.html";
        }, 350);
      } catch (err) {
        showFeedback(err.message || "Unable to sign in to the demo account right now.", "error");
        demoLoginBtn.disabled = false;
        demoLoginBtn.textContent = "Sign in as Demo Student";
      }
    });
  }
}

function initResetPasswordPage() {
  const forgotForm = qs("#forgot-form");
  const resetForm = qs("#reset-form");
  if (!forgotForm && !resetForm) return;

  const heading = qs("#auth-heading");
  const subheading = qs("#auth-subheading");
  const resetLinkBox = qs("#reset-link-box");

  let activeResetCode = "";

  const setView = (mode) => {
    clearFeedback();
    if (resetLinkBox) resetLinkBox.hidden = true;
    if (forgotForm) forgotForm.hidden = mode !== "forgot";
    if (resetForm) resetForm.hidden = mode !== "reset";

    if (mode === "reset") {
      if (heading) heading.textContent = "Create a new password";
      if (subheading) subheading.textContent = "Choose a strong new password for your UniMeet account.";
      qs("#reset-new-password")?.focus();
    } else {
      if (heading) heading.textContent = "Reset your password";
      if (subheading) {
        subheading.textContent =
          "Enter your registered email address and we'll send you a password reset link.";
      }
    }
  };

  const urlParams = new URLSearchParams(window.location.search);
  const paramCode = urlParams.get("oobCode") || urlParams.get("token");
  if (paramCode) {
    activeResetCode = paramCode;
    setView("reset");
  } else {
    setView("forgot");
  }

  if (forgotForm) {
    forgotForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      clearFeedback();
      if (resetLinkBox) resetLinkBox.hidden = true;

      const email = qs("#forgot-email").value.trim();
      const errEl = qs("#err-forgot-email");
      errEl.textContent = "";

      if (!email) {
        errEl.textContent = "Please enter your email address.";
        showFeedback("Please complete all required fields.", "error");
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errEl.textContent = "Please enter a valid email address.";
        showFeedback("Please enter a valid email address.", "error");
        return;
      }

      const btn = qs("#forgot-submit-btn");
      btn.disabled = true;
      btn.textContent = "Sending...";

      try {
        const res = await API.forgotPassword(email);
        showFeedback(
          res.message ||
            "Password reset email sent. Check your inbox and follow the link to choose a new password.",
          "success"
        );
      } catch (err) {
        showFeedback(err.message || "Could not process password reset request.", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Send Reset Link";
      }
    });
  }

  if (resetForm) {
    const newPwInput = qs("#reset-new-password");
    const rLen = qs("#reset-rule-len");
    const rLetter = qs("#reset-rule-letter");
    const rDigit = qs("#reset-rule-digit");

    const checkResetRules = (pw) => {
      const hasLen = pw.length >= 8;
      const hasLetter = /[A-Za-z]/.test(pw);
      const hasDigit = /\d/.test(pw);
      rLen?.classList.toggle("is-met", hasLen);
      rLetter?.classList.toggle("is-met", hasLetter);
      rDigit?.classList.toggle("is-met", hasDigit);
      return hasLen && hasLetter && hasDigit;
    };

    newPwInput?.addEventListener("input", () => checkResetRules(newPwInput.value));

    resetForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      clearFeedback();
      qs("#err-reset-password").textContent = "";
      qs("#err-reset-confirm").textContent = "";

      const newPassword = newPwInput.value;
      const confirmPassword = qs("#reset-confirm-password").value;

      let valid = true;
      if (!newPassword || !confirmPassword) {
        if (!newPassword) {
          qs("#err-reset-password").textContent = "Please enter a new password.";
        }
        if (!confirmPassword) {
          qs("#err-reset-confirm").textContent = "Please confirm your new password.";
        }
        showFeedback("Please complete all required fields.", "error");
        return;
      }

      if (!checkResetRules(newPassword)) {
        qs("#err-reset-password").textContent = "Password must meet all requirements above.";
        valid = false;
      }
      if (newPassword !== confirmPassword) {
        qs("#err-reset-confirm").textContent = "Passwords do not match.";
        valid = false;
      }
      if (!activeResetCode) {
        showFeedback("Missing or invalid reset code. Please request a new reset link.", "error");
        return;
      }
      if (!valid) return;

      const btn = qs("#reset-submit-btn");
      btn.disabled = true;
      btn.textContent = "Updating...";

      try {
        const res = await API.resetPassword(activeResetCode, newPassword);
        activeResetCode = "";
        newPwInput.value = "";
        qs("#reset-confirm-password").value = "";
        window.history.replaceState({}, "", "reset-password.html");
        setView("forgot");
        showFeedback(
          res.message || "Password updated successfully. You can now sign in with your new password.",
          "success"
        );
      } catch (err) {
        showFeedback(err.message || "Could not reset password.", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Update Password";
      }
    });
  }
}

async function initRegisterPage() {
  const existingUser = await waitForAuthInit();
  if (existingUser || DemoStore.isDemoSession()) {
    window.location.replace("discover.html");
    return;
  }

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
    clearFeedback();
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
    let missingRequired = false;

    if (!firstName) {
      qs("#err-first-name").textContent = "First name is required.";
      valid = false;
      missingRequired = true;
    }
    if (!lastName) {
      qs("#err-last-name").textContent = "Last name is required.";
      valid = false;
      missingRequired = true;
    }
    if (!username) {
      qs("#err-username").textContent = "Username is required.";
      valid = false;
      missingRequired = true;
    } else if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username)) {
      qs("#err-username").textContent = "Username must be 3–50 chars (letters, numbers, _, ., -).";
      valid = false;
    }
    if (!email) {
      qs("#err-email").textContent = "Email address is required.";
      valid = false;
      missingRequired = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      qs("#err-email").textContent = "Please enter a valid email address.";
      valid = false;
    }
    if (!password) {
      qs("#err-password").textContent = "Password is required.";
      valid = false;
      missingRequired = true;
    } else if (!checkPasswordRules(password)) {
      qs("#err-password").textContent = "Password must meet all requirements above.";
      valid = false;
    }
    if (!confirm) {
      qs("#err-confirm").textContent = "Please confirm your password.";
      valid = false;
      missingRequired = true;
    } else if (password !== confirm) {
      qs("#err-confirm").textContent = "Passwords do not match.";
      valid = false;
    }

    if (!valid) {
      if (missingRequired) {
        showFeedback("Please complete all required fields.", "error");
      }
      return;
    }

    const btn = qs("#register-submit-btn");
    btn.disabled = true;
    btn.textContent = "Creating account...";

    try {
      await API.register({
        first_name: firstName,
        last_name: lastName,
        username,
        email,
        university: university || null,
        city: city || null,
        password,
      });
      showFeedback("Account created! Taking you to your profile interests...", "success");
      window.setTimeout(() => {
        window.location.href = "profile.html";
      }, 450);
    } catch (err) {
      showFeedback(err.message || "Registration failed. Please try again.", "error");
      btn.disabled = false;
      btn.textContent = "Create account";
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wirePasswordToggles();
  const page = document.body?.dataset?.page;
  if (page === "login") initLoginPage();
  if (page === "reset-password") initResetPasswordPage();
  if (page === "register") initRegisterPage();
});
