import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../engine/analyze.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const samplesDir = path.join(root, "samples");
const modelsConfig = JSON.parse(fs.readFileSync(path.join(root, "models.config"), "utf8"));
const modelIds = modelsConfig.order;
const configs = {
  modelsConfig,
  profilesData: JSON.parse(fs.readFileSync(path.join(root, "engine", "profiles.json"), "utf8")),
  vulgarityConfig: JSON.parse(fs.readFileSync(path.join(root, "engine", "vulgarity.json"), "utf8"))
};

const nonModelColumns = ["undetermined", "insufficient_text", "error"];
const matrix = Object.fromEntries(modelIds.map(actual => [actual, Object.fromEntries([...modelIds, ...nonModelColumns].map(predicted => [predicted, 0]))]));
let total = 0;
let correct = 0;

console.log("Sample evaluation (demo data):\n");
for (const file of fs.readdirSync(samplesDir).filter(file => file.endsWith(".txt")).sort()) {
  const actual = file.split("_")[0];
  if (!modelIds.includes(actual)) continue;
  const text = fs.readFileSync(path.join(samplesDir, file), "utf8");
  const result = analyze(text, configs);
  const predicted = result.top || result.status;
  matrix[actual][predicted] = (matrix[actual][predicted] || 0) + 1;
  total += 1;
  if (result.top === actual) correct += 1;
  const probabilities = modelIds.map(id => `${id}:${result.probabilities[id]}%`).join(" ");
  console.log(`${file.padEnd(16)} actual=${actual.padEnd(7)} predicted=${String(predicted).padEnd(17)} ${probabilities}`);
}

console.log(`\nAccuracy on demo samples: ${correct}/${total} (${Math.round((correct / total) * 100)}%)`);
console.log("\nConfusion matrix (rows = actual, columns = predicted):");
const columns = ["actual\\pred", ...modelIds, ...nonModelColumns];
console.log(columns.map(value => String(value).padStart(18)).join(""));
for (const actual of modelIds) {
  const row = [actual, ...modelIds.map(predicted => matrix[actual][predicted]), ...nonModelColumns.map(predicted => matrix[actual][predicted])];
  console.log(row.map(value => String(value).padStart(18)).join(""));
}
