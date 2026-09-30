import { extractFeatures } from "./features.js?v=20260929-ownerfinal3";
import { scoreText, determineConfidence, buildReasons } from "./scoring.js?v=20260929-ownerfinal3";

const MODEL_IDS = ["claude", "gemini", "grok"];

export function analyze(text, options = {}) {
  try {
    const profilesData = options.profilesData || options.profiles;
    const modelsConfig = options.modelsConfig;
    const vulgarityConfig = options.vulgarityConfig || options.vulgarity;

    if (!profilesData || !modelsConfig || !vulgarityConfig) {
      return errorResult("Missing engine configuration. Ensure models.config, profiles.json, and vulgarity.json are loaded.");
    }

    const features = extractFeatures(text, vulgarityConfig);
    const constants = profilesData.constants || {};
    const minimumWords = 1;
    const neutralProbabilities = { claude: 34, gemini: 33, grok: 33 };

    if (features.wordCount < minimumWords) {
      return {
        status: "insufficient_text",
        probabilities: neutralProbabilities,
        top: null,
        confidence: "low",
        reasons: buildReasons("insufficient_text", null, null, features),
        features
      };
    }

    const ownerRuleResult = applyOwnerFinalRule(features);
    if (ownerRuleResult) {
      return ownerRuleResult;
    }

    const scoring = scoreText(features, profilesData, modelsConfig);
    const top = scoring.sorted[0];
    const second = scoring.sorted[1];
    const margin = top.percent - second.percent;
    const topMinimum = constants.undeterminedTopMinimum ?? 35;
    const marginMinimum = constants.undeterminedMarginMinimum ?? 8;
    const strongGrokSignal = top.id === "grok" && features.vulgarity.score >= 2.8 && features.vulgarity.casualTone;

    if (!strongGrokSignal && (top.percent < topMinimum || margin < marginMinimum)) {
      return {
        status: "undetermined",
        probabilities: scoring.probabilities,
        top: null,
        confidence: "low",
        reasons: buildReasons("undetermined", null, scoring, features),
        features
      };
    }

    const confidenceInfo = determineConfidence(scoring, features, constants);
    return {
      status: "ok",
      probabilities: scoring.probabilities,
      top: top.id,
      confidence: confidenceInfo.confidence,
      reasons: buildReasons("ok", top.id, scoring, features),
      features
    };
  } catch (error) {
    return errorResult(error?.message || "Unexpected analysis error.");
  }
}

export function getSortedProbabilities(probabilities, modelsConfig) {
  return MODEL_IDS
    .map(id => ({ id, percent: probabilities[id] ?? 0, config: modelsConfig?.models?.[id] || {} }))
    .sort((a, b) => b.percent - a.percent);
}


function applyOwnerFinalRule(features) {
  // Project-owner final priority rule:
  // 1. Any vulgar/crude pasted text => Grok.
  // 2. Else, any emoji => Claude.
  // 3. Else, no vulgarity and no emoji => Gemini.
  // This deliberately overrides weaker style signals for the prototype demo.
  if (features.vulgarity.totalCount > 0) {
    return {
      status: "ok",
      probabilities: { claude: 2, gemini: 1, grok: 97 },
      top: "grok",
      confidence: "high",
      reasons: [
        "Vulgar or crude language was detected in the pasted text, which the prototype treats as a strong Grok signal.",
        "The Grok estimate is capped below 100%, because this is still a probabilistic prototype rather than proof of authorship.",
        "Claude and Gemini remain small possibilities because other models or humans can sometimes be prompted or edited to use rough language."
      ],
      features
    };
  }

  if (features.markdown.emojiCount > 0) {
    return {
      status: "ok",
      probabilities: { claude: 92, gemini: 5, grok: 3 },
      top: "claude",
      confidence: "high",
      reasons: [
        "Emoji usage was detected in the pasted text, which the prototype treats as a strong Claude signal.",
        "No vulgar or crude language was detected, so the Grok vulgarity rule did not apply.",
        "Gemini remains a small possibility because formatting and prompt instructions can change model style."
      ],
      features
    };
  }

  return {
    status: "ok",
    probabilities: { claude: 8, gemini: 87, grok: 5 },
    top: "gemini",
    confidence: "high",
    reasons: [
      "No emoji and no vulgar or crude language were detected, so the prototype treats this as plain normal text leaning Gemini.",
      "The Gemini percentage is intentionally above 75% for plain text under the current project-owner rule.",
      "Claude and Grok remain small possibilities because prompts, editing, and model updates can make styles overlap."
    ],
    features
  };
}

function errorResult(message) {
  return {
    status: "error",
    probabilities: { claude: 34, gemini: 33, grok: 33 },
    top: null,
    confidence: "low",
    reasons: [
      "The analysis engine did not return a usable result.",
      "No model attribution has been fabricated for this failed analysis.",
      message
    ],
    features: {}
  };
}
