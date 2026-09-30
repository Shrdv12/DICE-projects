import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../engine/analyze.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const configs = {
  modelsConfig: JSON.parse(fs.readFileSync(path.join(root, "models.config"), "utf8")),
  profilesData: JSON.parse(fs.readFileSync(path.join(root, "engine", "profiles.json"), "utf8")),
  vulgarityConfig: JSON.parse(fs.readFileSync(path.join(root, "engine", "vulgarity.json"), "utf8"))
};

function run(text) {
  return analyze(text, configs);
}

function assertValidProbabilities(result) {
  assert.equal(Object.values(result.probabilities).reduce((sum, value) => sum + value, 0), 100);
  assert.deepEqual(Object.keys(result.probabilities).sort(), ["claude", "gemini", "grok"]);
  for (const value of Object.values(result.probabilities)) {
    assert.notEqual(value, 100);
    assert.ok(value >= 0 && value <= 97);
  }
}

// Short text is blocked.
{
  const result = run("");
  assert.equal(result.status, "insufficient_text");
  assert.equal(result.top, null);
  assertValidProbabilities(result);
}

// Owner rule: no vulgarity and no emoji => Gemini, high confidence, above 75%.
{
  const result = run("The project is useful because it explains a concept clearly. It has benefits and limitations, and more examples would improve the result. Careful testing would make the estimate easier to trust. The response stays general, uses plain sentences, avoids special formatting, and does not include emoji or crude wording.");
  assert.equal(result.status, "ok");
  assert.equal(result.top, "gemini");
  assert.equal(result.confidence, "high");
  assert.ok(result.probabilities.gemini > 75);
  assertValidProbabilities(result);
}

// Owner rule: factual plain text => Gemini, high confidence, above 75%.
{
  const result = run("India is a country in South Asia and the world's most populous nation, home to more than 1.4 billion people. It has one of the oldest continuous civilizations in history, stretching back to the Indus Valley cities more than four thousand years ago, and it was the birthplace of Hinduism, Buddhism, Jainism, and Sikhism. After nearly two centuries of British colonial rule, it became independent in 1947 and adopted a constitution in 1950, and today it is the world's largest democracy. The country is known for its diversity: it has 22 officially recognized languages and hundreds more spoken, along with a wide range of religions, cuisines, festivals, and landscapes, from the Himalayas in the north to tropical coasts in the south. Its economy is one of the largest and fastest-growing in the world, driven by services, technology, manufacturing, and agriculture, though it still faces challenges such as inequality, poverty, and pressure on its infrastructure and environment.");
  assert.equal(result.status, "ok");
  assert.equal(result.top, "gemini");
  assert.equal(result.confidence, "high");
  assert.ok(result.probabilities.gemini > 75);
  assertValidProbabilities(result);
}

// Owner rule: emoji => Claude, high confidence, above 75%.
{
  const result = run("Absolutely, I can help with that 😊 The best version should stay focused on one clear experience instead of trying to cover every file type. It can explain the estimate carefully, show the competing scores, and remind the user that this is not definitive proof. That said, if you want, the profiles can be tuned later with more samples.");
  assert.equal(result.status, "ok");
  assert.equal(result.top, "claude");
  assert.equal(result.confidence, "high");
  assert.ok(result.probabilities.claude > 75);
  assertValidProbabilities(result);
}

// Owner rule: vulgar/crude text => Grok, high confidence, capped below 100%.
{
  const result = run("Straight answer: this plan is fucking bad and the extra dashboard idea is bullshit. Keep one text box, one button, and one result. No fluff. If the sample is too short, say so. If the scores are close, don't fake certainty. That's the whole product.");
  assert.equal(result.status, "ok");
  assert.equal(result.top, "grok");
  assert.equal(result.confidence, "high");
  assert.ok(result.probabilities.grok > 75);
  assert.ok(result.probabilities.grok <= 97);
  assertValidProbabilities(result);
}

// Priority: vulgarity beats emoji.
{
  const result = run("This is fucking bad 😊 Keep the explanation short, direct, and useful. If a pasted response contains rough vulgar language, the prototype should treat that signal as Grok first, even if an emoji is also present in the text. The extra sentence makes the test long enough for analysis.");
  assert.equal(result.status, "ok");
  assert.equal(result.top, "grok");
  assert.ok(result.probabilities.grok > 75);
  assertValidProbabilities(result);
}

console.log("Unit tests passed.");
