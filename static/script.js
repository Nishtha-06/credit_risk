// Same-origin on Render. If you open index.html straight from disk, fall back to local FastAPI.
const API_BASE = location.protocol === "file:" ? "http://127.0.0.1:8000" : "";

const $ = (sel) => document.querySelector(sel);
const form = $("#loan-form");
const submitBtn = $("#submit");
const errorBox = $("#error");
const panel = $("#result");
const dialFill = $("#dial-fill");
const dialTick = $("#dial-tick");
const pctEl = $("#pct");
const verdictEl = $("#verdict");
const summaryEl = $("#summary");
const statThreshold = $("#stat-threshold");
const statLti = $("#stat-lti");
const ltiNote = $("#lti-note");
const rate = $("#rate");
const rateOut = $("#rate-out");

const DIAL_LENGTH = Math.PI * 100;      // matches the SVG arc (r = 100)
const DIAL_MS = 1400;                   // matches the CSS transition
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/* ---------- Interest rate slider ---------- */
function syncRate() {
  const pct = ((rate.value - rate.min) / (rate.max - rate.min)) * 100;
  rate.style.setProperty("--fill", pct + "%");
  rateOut.textContent = Number(rate.value).toFixed(1) + "%";
}
rate.addEventListener("input", syncRate);
syncRate();

/* ---------- Loan-to-income (derived field the API expects) ---------- */
function loanToIncome() {
  const income = parseFloat(form.person_income.value);
  const amount = parseFloat(form.loan_amnt.value);
  if (!income || !amount || income <= 0) return null;
  return amount / income;
}
function updateLtiNote() {
  const lti = loanToIncome();
  ltiNote.innerHTML = lti === null
    ? "Loan-to-income ratio is worked out for you once you enter income and amount."
    : `This loan is <strong>${(lti * 100).toFixed(0)}%</strong> of the borrower's annual income.`;
}
form.person_income.addEventListener("input", updateLtiNote);
form.loan_amnt.addEventListener("input", updateLtiNote);

/* ---------- Validation ---------- */
function validate() {
  let ok = true;
  form.querySelectorAll(".field").forEach((f) => f.classList.remove("invalid"));
  form.querySelectorAll("[required]").forEach((el) => {
    const valid = el.type === "radio"
      ? !!form.querySelector(`input[name="${el.name}"]:checked`)
      : el.checkValidity() && el.value !== "";
    if (!valid) {
      ok = false;
      el.closest(".field")?.classList.add("invalid");
    }
  });
  return ok;
}
form.addEventListener("input", (e) => e.target.closest(".field")?.classList.remove("invalid"));
form.addEventListener("change", (e) => e.target.closest(".field")?.classList.remove("invalid"));

/* ---------- UI helpers ---------- */
function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  errorBox.classList.remove("shake");
  void errorBox.offsetWidth; // restart animation
  errorBox.classList.add("shake");
}
function clearError() { errorBox.hidden = true; }

function setLoading(on) {
  submitBtn.disabled = on;
  submitBtn.classList.toggle("loading", on);
  submitBtn.querySelector(".btn-label").textContent = on ? "Checking" : "Check risk";
  if (on) {
    panel.dataset.state = "loading";
    verdictEl.textContent = "Checking application";
  }
}

function countUp(el, to, ms) {
  if (reduceMotion) { el.textContent = to.toFixed(1); return; }
  const start = performance.now();
  (function frame(now) {
    const t = Math.min((now - start) / ms, 1);
    el.textContent = (to * easeOut(t)).toFixed(1);
    if (t < 1) requestAnimationFrame(frame);
  })(start);
}

function placeTick(threshold) {
  const angle = Math.PI * (1 - threshold);
  const point = (r) => [120 + r * Math.cos(angle), 120 - r * Math.sin(angle)];
  const [x1, y1] = point(88);
  const [x2, y2] = point(114);
  dialTick.setAttribute("x1", x1); dialTick.setAttribute("y1", y1);
  dialTick.setAttribute("x2", x2); dialTick.setAttribute("y2", y2);
}

function resetPanel() {
  panel.dataset.state = "idle";
  dialFill.style.strokeDashoffset = DIAL_LENGTH;
  pctEl.textContent = "--";
  verdictEl.textContent = "No result yet";
  summaryEl.textContent = "Fill in the form and run the check. The dial shows the estimated chance of default, and the marker shows the model's cut-off.";
  statThreshold.textContent = "--";
  statLti.textContent = "--";
}

function showResult(result, lti) {
  const probability = result.default_probability;
  const threshold = result.threshold;
  const high = result.default_prediction === 1;
  const p100 = probability * 100;
  const t100 = threshold * 100;

  placeTick(threshold);
  panel.dataset.state = high ? "high" : "low";
  dialFill.style.strokeDashoffset = DIAL_LENGTH * (1 - Math.min(probability, 1));
  countUp(pctEl, p100, DIAL_MS);

  verdictEl.textContent = high ? "High risk" : "Low risk";
  summaryEl.textContent = high
    ? `The estimated chance of default is ${p100.toFixed(1)}%, above the ${t100.toFixed(1)}% cut-off. This application would be flagged.`
    : `The estimated chance of default is ${p100.toFixed(1)}%, below the ${t100.toFixed(1)}% cut-off. This application would pass.`;
  statThreshold.textContent = t100.toFixed(1) + "%";
  statLti.textContent = lti === null ? "--" : (lti * 100).toFixed(0) + "%";

  if (window.matchMedia("(max-width: 900px)").matches) {
    panel.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }
}

/* ---------- Submit ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  if (!validate()) {
    showError("Some details are missing. Fill in the highlighted fields and try again.");
    return;
  }

  const lti = loanToIncome();
  const fd = new FormData(form);
  const payload = {
    person_age: parseInt(fd.get("person_age"), 10),
    person_income: parseFloat(fd.get("person_income")),
    person_home_ownership: fd.get("person_home_ownership"),
    person_emp_length: parseFloat(fd.get("person_emp_length")),
    loan_intent: fd.get("loan_intent"),
    loan_grade: fd.get("loan_grade"),
    loan_amnt: parseFloat(fd.get("loan_amnt")),
    loan_int_rate: parseFloat(fd.get("loan_int_rate")),
    loan_percent_income: Math.round(lti * 100) / 100,
    cb_person_default_on_file: fd.get("cb_person_default_on_file"),
    cb_person_cred_hist_length: parseInt(fd.get("cb_person_cred_hist_length"), 10),
  };

  setLoading(true);
  const minWait = new Promise((r) => setTimeout(r, reduceMotion ? 0 : 600)); // keeps the loading state from flickering

  try {
    const [res] = await Promise.all([
      fetch(`${API_BASE}/application`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      minWait,
    ]);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`The server returned ${res.status}. ${detail.slice(0, 160)}`);
    }
    showResult(await res.json(), lti);
  } catch (err) {
    resetPanel();
    showError(err instanceof TypeError
      ? "Could not reach the model server. Check your connection and try again."
      : err.message);
  } finally {
    setLoading(false);
  }
});

form.addEventListener("reset", () => {
  clearError();
  form.querySelectorAll(".field").forEach((f) => f.classList.remove("invalid"));
  resetPanel();
  setTimeout(() => { syncRate(); updateLtiNote(); }, 0); // after the browser restores defaults
});
