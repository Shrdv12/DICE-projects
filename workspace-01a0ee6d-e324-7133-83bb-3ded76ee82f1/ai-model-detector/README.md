# AI Model Detector

AI Model Detector is a text-only prototype that estimates which supported AI model family a pasted response most closely resembles.

It does **not** decide whether text is AI-generated or human-written. It compares style signals against editable model-family profiles and returns a probabilistic estimate.

> AI Model Detector provides a probabilistic estimate, not definitive proof of authorship.

## Supported Version 1 model classes

Model names and version labels are stored in `models.config` so they can be renamed without changing the UI or engine.

- Claude — Sonnet & Haiku families
- Gemini — Gemini 3.1 Flash, 3.5 Flash & 3.1 Pro
- Grok — Grok 4.6


## Current owner-priority rules

This prototype now follows the requested simplified demo logic:

1. If vulgar or crude language is detected, the result is **Grok** with high confidence, capped at 97%.
2. Else, if emoji are detected, the result is **Claude** with high confidence, around 92%.
3. Else, if there is no vulgar/crude language and no emoji, the result is **Gemini** with high confidence, around 87%.

These are prototype rules, not proof of authorship.

## Run locally

From this folder:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Then open:

```text
http://localhost:8000
```

In this Arena workspace, the live preview uses the same server.

## Run tests

```bash
npm test
```

This runs:

1. Unit tests for short text, ambiguous text, self-identification, emoji handling, heavy formatting, probability caps, vulgarity handling, and the factual India-style paragraph.
2. A demo-sample evaluation over `samples/`, printing accuracy and a confusion matrix.

## Folder structure

```text
ai-model-detector/
├── index.html
├── styles.css
├── models.config
├── package.json
├── README.md
├── engine/
│   ├── analyze.js          # Pure analysis entry point
│   ├── features.js         # Deterministic feature extraction
│   ├── scoring.js          # Profile scoring, softmax calibration, reasons
│   ├── profiles.json       # Editable model style profiles and constants
│   └── vulgarity.json      # Editable mild/strong vulgarity marker lists
├── ui/
│   └── main.js             # UI state, rendering, loading configs
├── samples/
│   └── 15 demo sample outputs, 5 per model class
└── tests/
    ├── test_engine.mjs
    └── run_samples.mjs
```

## Result object

`engine/analyze(text, configs)` returns:

```js
{
  status: "ok" | "insufficient_text" | "undetermined" | "error",
  probabilities: { claude, gemini, grok },
  top: "claude" | "gemini" | "grok" | null,
  confidence: "low" | "medium" | "high",
  reasons: string[],
  features: { /* raw feature values */ }
}
```

Percentages always sum to exactly 100. The engine never outputs exactly 100% for any model.

## Important limitations

- Attribution is based on style, not a hidden fingerprint.
- Style changes with user prompts, system prompts, editing, translation, and model updates.
- The profiles are hypotheses supplied for this prototype, not verified scientific fingerprints.
- The vulgarity rule is a strong heuristic, not proof. Other models can be prompted to write rough text, and humans write it too.
- This prototype is not suitable for academic-integrity decisions, disciplinary decisions, or authorship proof.

## Improving accuracy later

For a stronger detector:

1. Collect at least 200 real outputs per model class from identical prompts.
2. Include diverse prompt types: factual summaries, reasoning, code, casual advice, creative text, refusals, emoji-heavy conversational answers, and markdown-heavy tasks.
3. Measure which features actually separate the model classes.
4. Retune `engine/profiles.json`, `engine/vulgarity.json`, and scoring constants.
5. Optionally train a classifier behind the same `analyze()` interface or add a backend LLM-judge endpoint. Keep API keys on the backend only.
