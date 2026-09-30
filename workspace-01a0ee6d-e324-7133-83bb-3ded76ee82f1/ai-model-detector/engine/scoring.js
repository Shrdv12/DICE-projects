const MODEL_IDS = ["claude", "gemini", "grok"];

export function scoreText(features, profilesData, modelsConfig) {
  const constants = profilesData.constants || {};
  const profiles = profilesData.profiles || {};
  const signals = buildSignals(features);
  const scores = Object.fromEntries(MODEL_IDS.map(model => [model, 0]));
  const evidence = [];

  for (const model of MODEL_IDS) {
    const profile = profiles[model] || { positiveWeights: {}, negativeWeights: {} };
    for (const [signalName, weight] of Object.entries(profile.positiveWeights || {})) {
      const signal = signals[signalName];
      if (!signal || !signal.value) continue;
      const contribution = Number(weight) * signal.value;
      scores[model] += contribution;
      if (contribution > 0.18) evidence.push(makeEvidence(model, signalName, contribution, signal, "positive"));
    }
    for (const [signalName, weight] of Object.entries(profile.negativeWeights || {})) {
      const signal = signals[signalName];
      if (!signal || !signal.value) continue;
      const contribution = Number(weight) * signal.value;
      scores[model] += contribution;
      if (contribution < -0.45) evidence.push(makeEvidence(model, signalName, contribution, signal, "negative"));
    }
  }

  applySelfIdentification(scores, evidence, features);
  applyGrokVulgarityRule(scores, evidence, features, constants);
  applyTieBreakers(scores, evidence, features);
  applyOwnerPriorityRules(scores, evidence, features);

  const probabilities = toProbabilities(scores, features, constants);
  const sorted = MODEL_IDS
    .map(id => ({ id, percent: probabilities[id], rawScore: scores[id], config: modelsConfig?.models?.[id] || {} }))
    .sort((a, b) => b.percent - a.percent || b.rawScore - a.rawScore);

  return { scores, probabilities, sorted, evidence, signals };
}

export function determineConfidence(result, features, constants = {}) {
  const top = result.sorted[0];
  const second = result.sorted[1];
  const margin = top.percent - second.percent;
  let confidence = "low";

  if (top.percent >= (constants.highConfidenceTop ?? 65) && margin >= (constants.highConfidenceMargin ?? 25)) {
    confidence = "high";
  } else if (top.percent >= (constants.mediumConfidenceTop ?? 45) && margin >= (constants.mediumConfidenceMargin ?? 12)) {
    confidence = "medium";
  }

  const strongCasualVulgarity = features.vulgarity.score >= 2.8 && features.vulgarity.casualTone && top.id === "grok";
  if (strongCasualVulgarity && top.percent >= 65) confidence = "high";

  if (features.wordCount < (constants.lowConfidenceMaxWords ?? 80)) {
    confidence = strongCasualVulgarity ? minConfidence(confidence, "medium") : "low";
  }

  const genericFactualOverview = features.factual.encyclopediaStyleSignal
    && features.lexical.hedgeCount === 0
    && features.markdown.listLineRatio === 0
    && features.markdown.emojiCount === 0
    && features.vulgarity.totalCount === 0;
  if (genericFactualOverview) confidence = minConfidence(confidence, "medium");

  if (features.quality.editedOrTranslatedSignal || features.quality.typoSignal) {
    confidence = lowerConfidence(confidence);
  }

  return { confidence, margin };
}

export function buildReasons(status, topId, scoring, features) {
  if (status === "insufficient_text") {
    return [
      "The text is under the minimum length needed to compare sentence rhythm, structure, and lexical markers.",
      "Several supported models could plausibly produce such a short sample.",
      "Paste at least 40 words, and preferably a longer response, for a meaningful estimate."
    ];
  }

  if (status === "undetermined") {
    const top = scoring.sorted[0];
    const second = scoring.sorted[1];
    const reasons = [
      `The top two estimates are close: ${displayName(top)} is only ${top.percent - second.percent} points above ${displayName(second)}.`,
      "The text does not contain enough distinctive formatting, emoji, vulgarity, factual-structure, or tone markers to separate the supported model families confidently."
    ];
    const overlap = pickPositiveEvidence(scoring.evidence, top.id, 1)[0] || pickPositiveEvidence(scoring.evidence, second.id, 1)[0];
    if (overlap) reasons.push(overlap.reason);
    reasons.push("More text, or a less edited sample, may produce a clearer estimate.");
    return unique(reasons).slice(0, 4);
  }

  const reasons = [];
  const topEvidence = pickPositiveEvidence(scoring.evidence, topId, 3);
  const second = scoring.sorted[1];

  if (topId === "grok" && features.vulgarity.totalCount > 0 && features.vulgarity.score >= 1.4) {
    reasons.push(
      features.vulgarity.casualTone
        ? "Vulgar or crude language was detected in a casual, unbothered tone, which is much more typical of Grok than the other supported profiles."
        : "Vulgar or crude language was detected, which increases the Grok estimate, though quote/story/warning context reduced the boost."
    );
  }

  for (const item of topEvidence) reasons.push(item.reason);

  const overlapEvidence = pickPositiveEvidence(scoring.evidence, second.id, 2)
    .filter(item => !reasons.includes(item.reason))[0];
  if (overlapEvidence) {
    reasons.push(overlapEvidence.reason.replace(/\.$/, "") + `, so ${displayName(second)} remains a plausible alternative.`);
  } else {
    reasons.push(makeFallbackOverlapReason(second.id, features));
  }

  reasons.push("The estimate remains probabilistic because these style markers can overlap across models and prompts.");
  return unique(reasons).slice(0, 4);
}

function buildSignals(f) {
  const m = f.markdown;
  const p = f.punctuation;
  const l = f.lexical;
  const s = f.structure;
  const factual = f.factual;
  const vulgar = f.vulgarity;

  const heavyMarkdownRaw =
    cap(m.headerPer100 / 1.25, 0, 1.2) +
    cap(m.boldSpanPer100 / 2.4, 0, 1.0) +
    cap(m.tableCount * 0.8, 0, 1.4) +
    cap(m.codeBlockCount * 0.75, 0, 1.2) +
    cap(m.horizontalRuleCount * 0.55, 0, 0.9) +
    cap(m.nestedListDepth * 0.45, 0, 0.9) +
    cap(m.listLineRatio * 1.05, 0, 1.0);

  const pureProseNoMarkdown = m.headerCount === 0 && m.tableCount === 0 && m.codeBlockCount === 0 && m.boldSpanCount === 0 && m.listLineRatio === 0;
  const mean = f.meanSentenceLength;
  const sentenceBalanced = triangle(mean, 12, 19, 29);
  const sentenceBalancedLong = triangle(mean, 18, 25, 36) * (l.hedgeCount + l.honestyCount + p.emDashCount + m.emojiCount > 0 ? 1 : 0.35);
  const shortSentence = triangle(mean, 4, 10, 16);
  const factualScore = factual.encyclopediaStyleSignal
    ? 1.55
    : cap((factual.factualCueCount + factual.numberCount + factual.yearCount) / 8, 0, 1.0);

  const claudeContext = l.hedgeCount > 0 || l.honestyCount > 0 || p.emDashCount > 0 || m.emojiCount > 0 || f.closerPattern === "offer";
  const grokContext = l.bluntCount > 0 || l.slangCount > 0 || vulgar.totalCount > 0 || (shortSentence > 0.72 && f.meanParagraphLength <= 58);
  const geminiContext = factual.encyclopediaStyleSignal || heavyMarkdownRaw > 0.45 || l.formalTransitionCount > 0 || l.breakdownPhraseCount > 0 || l.imperativeTechnicalCount > 0;
  const normalCleanText = pureProseNoMarkdown
    && m.emojiCount === 0
    && vulgar.totalCount === 0
    && !claudeContext
    && !grokContext
    && (factual.encyclopediaStyleSignal || (f.wordCount >= 95 && mean >= 14 && mean <= 34 && factual.factualCueCount >= 1));

  return {
    emojiScore: signal(cap(m.emojiCount / 2, 0, 1.4), "Emoji usage was detected, which currently leans Claude and works against Gemini in this prototype."),
    caveatScore: signal(cap(l.hedgeCount / 3.2, 0, 1.45), "Caveats and uncertainty markers increased the Claude-like score."),
    honestyScore: signal(cap(l.honestyCount / 2, 0, 1.25), "Honesty or directness markers increased the Claude-like score."),
    warmProseScore: signal((pureProseNoMarkdown && claudeContext && !vulgar.totalCount) ? 1 : 0, "Warm, low-format prose with qualification markers increased the Claude estimate."),
    emDashScore: signal(cap(p.emDashPer100 / 1.4, 0, 1.25), "Em-dash usage contributed to the Claude-style punctuation profile."),
    proseCaveatScore: signal((s.proseFirst && m.listLineRatio < 0.2 && claudeContext && !normalCleanText) ? 1 : 0, "Prose-first caveated organization increased the Claude estimate."),
    closingOfferScore: signal(f.closerPattern === "offer" ? 1 : 0, "A closing offer matched a common assistant-style ending."),
    balancedLongSentenceScore: signal(sentenceBalancedLong, "Longer, clause-heavy sentences gave some support to Claude-style prose."),
    lowMarkdownClaudeScore: signal(pureProseNoMarkdown && claudeContext && f.wordCount >= 70 ? 0.75 : 0, "Low-format prose was consistent with Claude's prose-first profile."),

    factualOverviewScore: signal(factualScore, "Neutral factual-overview cues, dates, names, or enumeration increased the Gemini estimate."),
    normalCleanTextScore: signal(normalCleanText ? 1 : 0, "Clean normal text without emoji, vulgarity, or strong caveat markers leaned Gemini in the current three-model setup."),
    heavyMarkdownScore: signal(cap(heavyMarkdownRaw, 0, 2.8), "Structured Markdown, tables, bolding, code, or hierarchy increased the Gemini estimate."),
    headerScore: signal(cap(m.headerPer100 / 1.2, 0, 1.35), "Markdown headers increased the Gemini-style hierarchy score."),
    boldScore: signal(cap(m.boldSpanPer100 / 2, 0, 1.3), "Frequent bold emphasis increased the Gemini-style formatting score."),
    tableScore: signal(cap(m.tableCount, 0, 1.5), "Markdown tables increased the Gemini estimate."),
    horizontalRuleScore: signal(cap(m.horizontalRuleCount, 0, 1), "Horizontal rules increased the Gemini-style formatting score."),
    nestedListScore: signal(cap(m.nestedListDepth / 2, 0, 1.2), "Nested lists increased the Gemini-style hierarchy score."),
    formalTransitionScore: signal(cap(l.formalTransitionCount / 2, 0, 1.2), "Formal transition vocabulary increased the Gemini estimate."),
    breakdownOpenerScore: signal(f.openerPattern === "breakdown" || l.breakdownPhraseCount > 0 ? 1 : 0, "A breakdown-style opener increased the Gemini estimate."),
    technicalImperativeScore: signal(cap(l.imperativeTechnicalCount / 3, 0, 1.2), "Imperative technical instructions increased the Gemini Flash-style score."),
    codeOrDataScore: signal((m.codeBlockCount > 0 || f.quality.jsonLike || f.quality.codeLike) ? 1 : 0, "Code, JSON, or data-format signals increased the Gemini estimate."),
    noEmojiGeminiContextScore: signal((m.emojiCount === 0 && geminiContext) ? 1 : 0, "No emoji appeared alongside Gemini-like structure or factual style, which supported Gemini."),

    vulgarityScore: signal(vulgar.score, "Vulgar or crude language was detected."),
    bluntScore: signal(cap(l.bluntCount / 2, 0, 1.3), "Blunt or dry wording increased the Grok-like score."),
    casualSlangScore: signal(cap(l.slangCount / 2.5, 0, 1.2), "Casual slang markers increased the Grok-like score."),
    shortParagraphScore: signal((s.shortParagraphRatio >= 0.65 && f.paragraphCount >= 2) ? 1 : 0, "Short paragraph pacing increased the Grok-like score."),
    shortSentenceScore: signal(shortSentence, "Short, punchy sentences increased the Grok-like score."),
    minimalFormattingGrokScore: signal((pureProseNoMarkdown && grokContext) ? 0.85 : 0, "Minimal formatting plus blunt/casual context increased the Grok-like directness score."),
    directAnswerScore: signal((s.answerFirst && grokContext && !factual.encyclopediaStyleSignal) ? 0.85 : 0, "A direct answer-first opening increased the Grok-like score."),
    noFillerScore: signal((grokContext && !s.introFirst && f.openerPattern !== "flattery" && l.gushyOpenerCount === 0) ? 0.65 : 0, "Lack of helper-style filler slightly increased the Grok-like score."),

    tableOrCodeScore: signal((m.tableCount > 0 || m.codeBlockCount > 0) ? 1 : 0, "Tables or code blocks worked against this model's usual prose profile."),
    listHeavySimpleScore: signal((m.listLineRatio > 0.55 && f.wordCount < 280) ? 1 : 0, "List-heavy formatting for a simple answer worked against prose-first models."),
    formalAcademicScore: signal((l.formalTransitionCount >= 2 || factual.properNounDensity > 0.08 || factual.encyclopediaStyleSignal) ? 0.8 : 0, "Formal academic or encyclopedic tone worked against the Grok profile."),
    longCaveatedScore: signal((l.hedgeCount >= 2 || mean > 27) ? 0.85 : 0, "Long or caveated prose worked against the Grok profile.")
  };
}

function applySelfIdentification(scores, evidence, features) {
  if (!features.selfIdentification.any) return;
  for (const model of MODEL_IDS) {
    if (!features.selfIdentification.detected[model]) continue;
    const quoted = features.selfIdentification.quotedOrRoleplay;
    const boost = quoted ? 1.1 : 5.4;
    scores[model] += boost;
    evidence.push({
      model,
      key: "selfIdentification",
      impact: boost,
      direction: "positive",
      reason: quoted
        ? `A self-identification reference to ${model} appeared, but it looked quoted or role-played, so the boost was reduced.`
        : `The text self-identifies as ${model}, which is strong but not definitive evidence.`
    });
  }
}

function applyGrokVulgarityRule(scores, evidence, features, constants) {
  const vulgar = features.vulgarity;
  if (!vulgar.totalCount) return;
  const baseBoost = constants.grokVulgarityBoost ?? 8.8;
  const strength = cap(vulgar.score / 3.2, 0.18, 1.35);
  let boost = baseBoost * strength;
  if (vulgar.quotedRatio >= 0.5) boost *= constants.grokQuotedVulgarityMultiplier ?? 0.42;
  if (vulgar.roleplayOrStoryContext) boost *= constants.grokRoleplayVulgarityMultiplier ?? 0.55;
  if (vulgar.warningTone) boost *= 0.45;

  const penalty = (constants.nonGrokVulgarityPenalty ?? -3.2) * cap(vulgar.score / 2.5, 0.25, 1.25);
  scores.grok += boost;
  scores.claude += penalty;
  scores.gemini += penalty;

  evidence.push({
    model: "grok",
    key: "grokVulgarityBoost",
    impact: boost,
    direction: "positive",
    reason: vulgar.casualTone
      ? "Vulgar language detected in a casual tone strongly increased the Grok estimate."
      : "Vulgar language was detected; contextual signals reduced but did not remove the Grok boost."
  });
}

function applyTieBreakers(scores, evidence, f) {
  if (f.factual.encyclopediaStyleSignal && f.lexical.hedgeCount === 0 && f.markdown.emojiCount === 0 && f.vulgarity.totalCount === 0) {
    scores.gemini += 0.75;
    scores.claude -= 0.35;
    evidence.push({
      model: "gemini",
      key: "factualNoEmojiTieBreaker",
      impact: 0.75,
      direction: "positive",
      reason: "The text is a neutral factual overview with no emoji or caveat-heavy style, so the tie-breaker leaned toward Gemini."
    });
  }

  if (f.markdown.emojiCount > 0 && f.vulgarity.totalCount === 0) {
    scores.claude += 0.65;
    scores.gemini -= 0.45;
    evidence.push({
      model: "claude",
      key: "emojiTieBreaker",
      impact: 0.65,
      direction: "positive",
      reason: "Emoji usage gave Claude an additional tie-breaker boost and reduced Gemini slightly."
    });
  }

  if ((f.markdown.tableCount > 0 || f.markdown.headerCount >= 3 || f.markdown.boldSpanCount >= 5) && f.vulgarity.totalCount === 0) {
    scores.gemini += 0.65;
  }
}

function applyOwnerPriorityRules(scores, evidence, f) {
  // Owner priority rules, applied after the normal capability/profile scoring:
  // vulgar/crude text => Grok, emoji text => Claude, plain normal text => Gemini.
  // These are strong boosts, not 100% proof, so probabilities remain capped.
  const plainText = f.markdown.headerCount === 0
    && f.markdown.tableCount === 0
    && f.markdown.codeBlockCount === 0
    && f.markdown.boldSpanCount === 0
    && f.markdown.listLineRatio === 0
    && f.markdown.emojiCount === 0
    && f.vulgarity.totalCount === 0;

  if (f.vulgarity.totalCount > 0 && !f.vulgarity.warningTone) {
    const directBoost = f.vulgarity.casualTone ? 3.8 : 2.1;
    scores.grok += directBoost;
    scores.claude -= 1.3;
    scores.gemini -= 1.4;
    evidence.push({
      model: "grok",
      key: "ownerVulgarityPriority",
      impact: directBoost,
      direction: "positive",
      reason: "Owner rule: vulgar or crude pasted text is treated as a strong Grok signal."
    });
    return;
  }

  if (f.markdown.emojiCount > 0) {
    scores.claude += 6.2;
    scores.gemini -= 2.2;
    scores.grok -= 0.8;
    evidence.push({
      model: "claude",
      key: "ownerEmojiPriority",
      impact: 6.2,
      direction: "positive",
      reason: "Owner rule: emojis in the pasted text are treated as a strong Claude signal."
    });
    return;
  }

  const hasClaudeSpecificStyle = f.lexical.hedgeCount > 0
    || f.lexical.honestyCount > 0
    || f.lexical.gentlePushbackCount > 0
    || f.punctuation.emDashCount > 0
    || f.closerPattern === "offer"
    || f.selfIdentification.detected?.claude;
  const hasGrokSpecificStyle = f.lexical.bluntCount > 0
    || f.lexical.slangCount > 0
    || f.selfIdentification.detected?.grok;

  if (plainText && f.wordCount >= 40 && !hasClaudeSpecificStyle && !hasGrokSpecificStyle) {
    scores.gemini += 4.6;
    scores.claude -= 0.8;
    scores.grok -= 0.7;
    evidence.push({
      model: "gemini",
      key: "ownerPlainTextPriority",
      impact: 4.6,
      direction: "positive",
      reason: "Owner rule: plain normal text without emoji, vulgarity, or stronger Claude/Grok markers is treated as a Gemini signal."
    });
  }
}

function toProbabilities(scores, features, constants = {}) {
  const temperature = constants.temperature ?? 2.25;
  const maxScore = Math.max(...MODEL_IDS.map(id => scores[id]));
  const exps = MODEL_IDS.map(id => Math.exp((scores[id] - maxScore) / temperature));
  const total = exps.reduce((sum, value) => sum + value, 0);
  const rawPercentages = Object.fromEntries(MODEL_IDS.map((id, index) => [id, (exps[index] / total) * 100]));
  const grokMayUse97 = features.vulgarity.totalCount > 0 && features.vulgarity.score >= 2.4;
  const caps = Object.fromEntries(MODEL_IDS.map(id => [id, id === "grok" && grokMayUse97 ? (constants.grokVulgarityCap ?? 97) : (constants.maxProbability ?? 95)]));
  const capped = capAndRedistribute(rawPercentages, caps);
  return roundPercentages(capped, caps);
}

function capAndRedistribute(percentages, caps) {
  const values = { ...percentages };
  const locked = new Set();
  for (let pass = 0; pass < 8; pass++) {
    const over = MODEL_IDS.filter(id => !locked.has(id) && values[id] > caps[id]);
    if (!over.length) break;
    let excess = 0;
    for (const id of over) {
      excess += values[id] - caps[id];
      values[id] = caps[id];
      locked.add(id);
    }
    const receivers = MODEL_IDS.filter(id => !locked.has(id));
    const receiverTotal = receivers.reduce((sum, id) => sum + values[id], 0);
    if (!receivers.length || receiverTotal <= 0) break;
    for (const id of receivers) values[id] += excess * (values[id] / receiverTotal);
  }
  const sum = MODEL_IDS.reduce((total, id) => total + values[id], 0);
  if (sum > 0) {
    for (const id of MODEL_IDS) values[id] = values[id] * (100 / sum);
  }
  return values;
}

function roundPercentages(values, caps) {
  const result = {};
  const floors = MODEL_IDS.map(id => ({ id, floor: Math.floor(values[id]), remainder: values[id] - Math.floor(values[id]) }));
  for (const item of floors) result[item.id] = Math.min(item.floor, caps[item.id]);
  let diff = 100 - MODEL_IDS.reduce((sum, id) => sum + result[id], 0);
  const order = floors.sort((a, b) => b.remainder - a.remainder);
  let cursor = 0;
  while (diff > 0 && cursor < 200) {
    const id = order[cursor % order.length].id;
    if (result[id] < caps[id]) {
      result[id] += 1;
      diff -= 1;
    }
    cursor += 1;
  }
  cursor = 0;
  while (diff < 0 && cursor < 200) {
    const id = order.slice().reverse()[cursor % order.length].id;
    if (result[id] > 0) {
      result[id] -= 1;
      diff += 1;
    }
    cursor += 1;
  }
  return result;
}

function makeEvidence(model, key, contribution, signalValue, direction) {
  return { model, key, impact: Math.abs(contribution), direction, reason: signalValue.reason };
}

function pickPositiveEvidence(evidence, model, limit) {
  return evidence
    .filter(item => item.model === model && item.direction === "positive" && item.reason)
    .sort((a, b) => b.impact - a.impact)
    .filter((item, index, array) => array.findIndex(other => other.reason === item.reason) === index)
    .slice(0, limit);
}

function makeFallbackOverlapReason(model, features) {
  if (model === "claude" && features.markdown.emojiCount > 0) return "Emoji usage can overlap with Claude-like conversational responses.";
  if (model === "claude" && features.markdown.listLineRatio === 0) return "Plain prose with little formatting also overlaps with Claude-style responses.";
  if (model === "gemini" && features.factual.factualCueCount > 0) return "Factual overview wording also overlaps with Gemini-style normal text.";
  if (model === "gemini" && features.markdown.listLineRatio > 0) return "List or Markdown formatting also overlaps with Gemini-style structured output.";
  if (model === "grok" && features.lexical.bluntCount > 0) return "Blunt phrasing also overlaps with Grok's direct style.";
  if (model === "grok" && features.markdown.listLineRatio === 0) return "Minimal formatting also overlaps with Grok's direct style.";
  return "Some general writing traits overlap with the next-most-likely model.";
}

function displayName(item) {
  return item.config?.displayName || item.id;
}

function signal(value, reason) {
  return { value: Number(value) || 0, reason };
}

function cap(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function triangle(value, left, peak, right) {
  if (value <= left || value >= right) return 0;
  if (value === peak) return 1;
  if (value < peak) return (value - left) / (peak - left);
  return (right - value) / (right - peak);
}

function unique(items) {
  return items.filter((item, index) => item && items.indexOf(item) === index);
}

function lowerConfidence(confidence) {
  if (confidence === "high") return "medium";
  if (confidence === "medium") return "low";
  return "low";
}

function minConfidence(confidence, maxConfidence) {
  const order = { low: 0, medium: 1, high: 2 };
  return order[confidence] <= order[maxConfidence] ? confidence : maxConfidence;
}
