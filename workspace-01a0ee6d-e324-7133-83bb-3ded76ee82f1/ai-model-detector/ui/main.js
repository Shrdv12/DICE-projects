import { analyze, getSortedProbabilities } from "../engine/analyze.js?v=20260929-ownerfinal3";

const $ = selector => document.querySelector(selector);

const elements = {
  textInput: $("#textInput"),
  wordCount: $("#wordCount"),
  charCount: $("#charCount"),
  demoBadge: $("#demoBadge"),
  demoBtn: $("#demoBtn"),
  clearBtn: $("#clearBtn"),
  analyzeBtn: $("#analyzeBtn"),
  inputHint: $("#inputHint"),
  loadingPanel: $("#loadingPanel"),
  resultsPanel: $("#resultsPanel"),
  modelTags: $("#modelTags")
};

const demoText = `DEMONSTRATION DATA — sample response for testing the prototype.

When evaluating a new idea, it helps to separate three questions: what problem does it solve, who benefits from that solution, and what evidence would show that it works? A useful first version does not need to prove everything. It should make the main claim testable, show the user a clear path, and be honest about uncertainty.

In practice, that means the prototype should stay focused. Rather than trying to support every possible file type or every possible model, it can concentrate on one well-designed interaction: paste text, analyze it, and return a cautious estimate with an explanation. That narrower scope makes the product easier to understand and easier to improve later.

There are also important caveats. Textual style is not a guaranteed fingerprint, and different systems can produce similar formatting, vocabulary, or reasoning patterns. The best result is therefore probabilistic: useful as a signal, but not definitive proof of where the text came from.`;

let configs = null;
let analyzeTimer = null;

init();

async function init() {
  try {
    configs = {
      modelsConfig: await loadJson("./models.config?v=20260929-ownerfinal3"),
      profilesData: await loadJson("./engine/profiles.json?v=20260929-ownerfinal3"),
      vulgarityConfig: await loadJson("./engine/vulgarity.json?v=20260929-ownerfinal3")
    };
    renderModelTags(configs.modelsConfig);
    updateCounts();
  } catch (error) {
    console.error(error);
    elements.analyzeBtn.disabled = true;
    elements.inputHint.textContent = "Analysis configuration could not be loaded. Run the app from a local web server.";
    renderAnalysisUnavailable(error.message);
  }

  elements.textInput.addEventListener("input", updateCounts);
  elements.demoBtn.addEventListener("click", loadDemo);
  elements.clearBtn.addEventListener("click", clearText);
  elements.analyzeBtn.addEventListener("click", runAnalysis);
  elements.resultsPanel.addEventListener("click", handleResultAction);
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

function renderModelTags(modelsConfig) {
  const html = modelsConfig.order.map(id => {
    const model = modelsConfig.models[id];
    return `
      <div class="model-tag" style="--accent:${model.accentColor}">
        <i aria-hidden="true"></i>
        <div><strong>${escapeHtml(model.displayName)}</strong><span>${escapeHtml(model.versionLabel)}</span></div>
      </div>`;
  }).join("");
  elements.modelTags.innerHTML = html;
}

function updateCounts() {
  const counts = getCounts(elements.textInput.value);
  elements.wordCount.textContent = counts.words.toLocaleString();
  elements.charCount.textContent = counts.chars.toLocaleString();
  elements.analyzeBtn.disabled = !configs || counts.words < 1;
  elements.demoBadge.hidden = !elements.textInput.value.includes("DEMONSTRATION DATA");

  if (counts.words === 0) {
    elements.inputHint.textContent = "Paste at least a few words to begin. Emoji → Claude, plain text → Gemini, vulgar text → Grok.";
  } else {
    elements.inputHint.textContent = "Ready. Current prototype rule: vulgar/crude text → Grok, emoji → Claude, otherwise plain text → Gemini.";
  }
}

function getCounts(text) {
  const trimmed = text.trim();
  const words = trimmed.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)?/gu) || [];
  return { words: words.length, chars: trimmed.length };
}

function loadDemo() {
  elements.textInput.value = demoText;
  elements.demoBadge.hidden = false;
  updateCounts();
  elements.textInput.focus();
}

function clearText() {
  window.clearTimeout(analyzeTimer);
  elements.textInput.value = "";
  elements.loadingPanel.hidden = true;
  elements.resultsPanel.hidden = true;
  elements.demoBadge.hidden = true;
  updateCounts();
  elements.textInput.focus();
}

function runAnalysis() {
  if (!configs) return renderAnalysisUnavailable("Configuration not loaded.");
  const text = elements.textInput.value.trim();
  if (!text) return;

  elements.resultsPanel.hidden = true;
  elements.loadingPanel.hidden = false;
  elements.analyzeBtn.disabled = true;
  elements.analyzeBtn.textContent = "Analyzing…";

  window.clearTimeout(analyzeTimer);
  analyzeTimer = window.setTimeout(() => {
    const result = analyze(text, configs);
    elements.loadingPanel.hidden = true;
    elements.analyzeBtn.textContent = "Analyze Text →";
    updateCounts();
    renderResult(result);
  }, 760);
}

function renderResult(result) {
  elements.resultsPanel.hidden = false;

  if (result.status === "ok") {
    renderOkResult(result);
  } else if (result.status === "undetermined") {
    renderUndetermined(result);
  } else if (result.status === "insufficient_text") {
    renderInsufficient(result);
  } else {
    renderAnalysisUnavailable(result.reasons?.[2] || "Something went wrong while analyzing the text.", result);
  }

  elements.resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderOkResult(result) {
  const top = result.top;
  const model = configs.modelsConfig.models[top];
  const percent = result.probabilities[top];
  const bars = getSortedProbabilities(result.probabilities, configs.modelsConfig);
  elements.resultsPanel.innerHTML = `
    <div class="results-grid">
      <div class="result-hero">
        <div>
          <span class="status-pill">Analysis Complete</span>
          <span class="overline">Most Likely</span>
          <h2 class="model-name">${escapeHtml(model.displayName)}</h2>
          <p class="version-line">${escapeHtml(model.versionLabel)}</p>
          <p class="estimated">${percent}% estimated similarity</p>
          <div class="ring" style="--score:${percent}; --accent:${model.accentColor}" aria-label="${percent} percent estimated similarity">
            <div><strong>${percent}%</strong><span>Similarity</span></div>
          </div>
        </div>
        <div class="result-actions">
          <button class="btn btn-primary" data-action="another" type="button">Analyze Another Text</button>
          <button class="btn btn-secondary" data-action="demo" type="button">Try Demo</button>
        </div>
      </div>
      <div class="result-details">
        <h3 class="section-title">Estimated percentages</h3>
        <div class="bar-list">${bars.map(renderBar).join("")}</div>
        ${renderConfidence(result.confidence)}
        ${renderReasons(result.reasons)}
        ${renderDisclaimer()}
        ${renderDetails(result.features)}
      </div>
    </div>`;
}

function renderUndetermined(result) {
  const bars = getSortedProbabilities(result.probabilities, configs.modelsConfig);
  elements.resultsPanel.innerHTML = `
    <div class="results-grid">
      <div class="result-hero">
        <div>
          <span class="status-pill warning">Analysis Complete</span>
          <span class="overline">Result</span>
          <h2 class="model-name">Unable to Determine</h2>
          <p class="estimated">Multiple models show similar characteristics in this text.</p>
          <div class="message-card"><strong>Confidence: Low</strong><p class="small-muted">Several models could plausibly produce this text. More distinctive text may be required for a meaningful estimate.</p></div>
        </div>
        <div class="result-actions"><button class="btn btn-primary" data-action="another" type="button">Analyze Another Text</button></div>
      </div>
      <div class="result-details">
        <h3 class="section-title">Close estimates</h3>
        <div class="bar-list">${bars.map(renderBar).join("")}</div>
        ${renderReasons(result.reasons)}
        ${renderDisclaimer()}
        ${renderDetails(result.features)}
      </div>
    </div>`;
}

function renderInsufficient(result) {
  elements.resultsPanel.innerHTML = `
    <div class="results-grid">
      <div class="result-hero">
        <div>
          <span class="status-pill warning">Not Enough Text</span>
          <span class="overline">Result</span>
          <h2 class="model-name">Insufficient Evidence</h2>
          <p class="estimated">Please provide a longer response for a more meaningful analysis.</p>
        </div>
        <div class="result-actions"><button class="btn btn-primary" data-action="another" type="button">Analyze Another Text</button></div>
      </div>
      <div class="result-details">
        <div class="message-card"><strong>Insufficient evidence</strong><p class="small-muted">Several models could plausibly produce this text. More text is required for a meaningful estimate.</p></div>
        ${renderReasons(result.reasons)}
        ${renderDisclaimer()}
        ${renderDetails(result.features)}
      </div>
    </div>`;
}

function renderAnalysisUnavailable(message, result = null) {
  elements.resultsPanel.hidden = false;
  elements.resultsPanel.innerHTML = `
    <div class="results-grid">
      <div class="result-hero">
        <div>
          <span class="status-pill error">Analysis Unavailable</span>
          <span class="overline">Error</span>
          <h2 class="model-name">Try Again</h2>
          <p class="estimated">Something went wrong while analyzing the text. Please try again.</p>
        </div>
        <div class="result-actions"><button class="btn btn-primary" data-action="another" type="button">Analyze Another Text</button></div>
      </div>
      <div class="result-details">
        <div class="message-card"><strong>No result fabricated</strong><p class="small-muted">${escapeHtml(message)}</p></div>
        ${renderReasons(result?.reasons || ["The analysis engine did not return a usable result.", "No model attribution has been fabricated for this failed analysis."])}
        ${renderDisclaimer()}
      </div>
    </div>`;
}

function renderBar(item) {
  const model = item.config;
  return `
    <div class="model-bar">
      <div class="bar-top">
        <span class="bar-label" style="--accent:${model.accentColor}"><i aria-hidden="true"></i><span>${escapeHtml(model.displayName)}<small>${escapeHtml(model.versionLabel)}</small></span></span>
        <span class="bar-percent">${item.percent}%</span>
      </div>
      <div class="bar-track" aria-hidden="true"><div class="bar-fill" style="--accent:${model.accentColor}; --pct:${item.percent}%"></div></div>
    </div>`;
}

function renderConfidence(confidence) {
  const width = confidence === "high" ? 92 : confidence === "medium" ? 62 : 32;
  return `
    <div class="confidence-card">
      <div class="confidence-row">
        <div>
          <h3 class="section-title" style="margin-bottom:4px">Confidence</h3>
          <p class="small-muted">Based on text length, signal strength, and separation between top estimates.</p>
        </div>
        <span class="confidence-value">${escapeHtml(confidence)}</span>
      </div>
      <div class="meter" style="--w:${width}%"><span></span></div>
    </div>`;
}

function renderReasons(reasons = []) {
  return `
    <div class="why-card">
      <h3 class="section-title">Why this result?</h3>
      <ul class="why-list">${reasons.slice(0, 4).map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
    </div>`;
}

function renderDisclaimer() {
  return `
    <div class="disclaimer-card">
      <div class="disclaimer-icon" aria-hidden="true">i</div>
      <div>
        <strong>AI Model Detector provides a probabilistic estimate, not definitive proof of authorship.</strong>
        <p class="small-muted">Style changes with prompts, system instructions, editing, translation, and model updates.</p>
      </div>
    </div>`;
}

function renderDetails(features) {
  return `
    <details class="details-card">
      <summary>Details: raw feature values</summary>
      <pre>${escapeHtml(JSON.stringify(features || {}, null, 2))}</pre>
    </details>`;
}

function handleResultAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "another") {
    elements.resultsPanel.hidden = true;
    elements.textInput.focus();
    elements.textInput.select();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (button.dataset.action === "demo") {
    loadDemo();
    runAnalysis();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
