const WORD_RE = /[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)?/gu;

export function extractFeatures(inputText, vulgarityConfig = {}) {
  const text = String(inputText || "").replace(/\r/g, "").trim();
  const lower = text.toLowerCase();
  const words = text.match(WORD_RE) || [];
  const sentences = splitSentences(text);
  const sentenceLengths = sentences.map(sentence => (sentence.match(WORD_RE) || []).length).filter(Boolean);
  const lines = text.split("\n");
  const nonEmptyLines = lines.map(line => line.trim()).filter(Boolean);
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const wordCount = words.length;
  const sentenceCount = Math.max(1, sentenceLengths.length || (wordCount ? 1 : 0));
  const paragraphCount = Math.max(1, paragraphs.length || (wordCount ? 1 : 0));
  const per100Base = Math.max(1, wordCount / 100);

  const meanSentenceLength = mean(sentenceLengths);
  const sentenceLengthVariance = variance(sentenceLengths, meanSentenceLength);
  const paragraphLengths = paragraphs.map(paragraph => (paragraph.match(WORD_RE) || []).length).filter(Boolean);
  const meanParagraphLength = mean(paragraphLengths);

  const markdown = getMarkdownFeatures(lines, nonEmptyLines, per100Base);
  const punctuation = getPunctuationFeatures(text, per100Base);
  const lexical = getLexicalFeatures(text, lower, per100Base);
  const openerPattern = detectOpener(sentences[0] || "");
  const closerPattern = detectCloser(sentences[sentences.length - 1] || "", sentences);
  const structure = getStructureFeatures(nonEmptyLines, sentences, paragraphs, markdown, wordCount);
  const factual = getFactualOverviewFeatures(text, lower, words, punctuation, per100Base, paragraphCount, sentenceCount);
  const selfIdentification = getSelfIdentificationFeatures(text, lower);
  const vulgarity = getVulgarityFeatures(text, lower, vulgarityConfig, per100Base, lexical, structure);
  const quality = getQualitySignals(text, lower, words, nonEmptyLines, markdown);

  return {
    textLength: text.length,
    wordCount,
    sentenceCount,
    meanSentenceLength: round(meanSentenceLength),
    sentenceLengthVariance: round(sentenceLengthVariance),
    paragraphCount,
    meanParagraphLength: round(meanParagraphLength),
    markdown,
    punctuation,
    lexical,
    openerPattern,
    closerPattern,
    structure,
    factual,
    selfIdentification,
    vulgarity,
    quality
  };
}

export function countPhrases(lowerText, phrases = []) {
  if (!lowerText || !phrases.length) return 0;
  let count = 0;
  for (const phrase of phrases) {
    const escaped = escapeRegExp(String(phrase).toLowerCase()).replace(/\s+/g, "\\s+");
    const regex = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "giu");
    const matches = lowerText.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

function splitSentences(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const pieces = normalized.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  return pieces.length ? pieces : [normalized];
}

function getMarkdownFeatures(lines, nonEmptyLines, per100Base) {
  const headerLines = nonEmptyLines.filter(line => /^#{1,6}\s+/.test(line));
  const bulletLines = nonEmptyLines.filter(line => /^\s*[-*•+]\s+/.test(line));
  const numberedLines = nonEmptyLines.filter(line => /^\s*\d+[.)]\s+/.test(line));
  const listLines = [...bulletLines, ...numberedLines];
  const nestedListDepth = listLines.reduce((maxDepth, line) => {
    const spaces = (line.match(/^\s*/) || [""])[0].replace(/\t/g, "  ").length;
    return Math.max(maxDepth, Math.floor(spaces / 2));
  }, 0);
  const tableLines = nonEmptyLines.filter(line => /^\s*\|.*\|\s*$/.test(line));
  const horizontalRules = nonEmptyLines.filter(line => /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line));
  const joined = lines.join("\n");
  const boldSpans = joined.match(/\*\*[^*]+\*\*/g) || [];
  const codeFences = joined.match(/```/g) || [];
  const inlineCode = joined.match(/`[^`\n]+`/g) || [];
  const emoji = joined.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu) || [];
  const lineBase = Math.max(1, nonEmptyLines.length);

  return {
    headerCount: headerLines.length,
    headerPer100: round(headerLines.length / per100Base),
    bulletLineCount: bulletLines.length,
    bulletLineRatio: round(bulletLines.length / lineBase),
    numberedLineCount: numberedLines.length,
    numberedListRatio: round(numberedLines.length / lineBase),
    nestedListDepth,
    tableCount: tableLines.length ? Math.max(1, Math.floor(tableLines.length / 2)) : 0,
    tableLineCount: tableLines.length,
    horizontalRuleCount: horizontalRules.length,
    boldSpanCount: boldSpans.length,
    boldSpanPer100: round(boldSpans.length / per100Base),
    codeBlockCount: Math.floor(codeFences.length / 2),
    inlineCodeCount: inlineCode.length,
    emojiCount: emoji.length,
    listLineRatio: round(listLines.length / lineBase),
    nonEmptyLineCount: nonEmptyLines.length
  };
}

function getPunctuationFeatures(text, per100Base) {
  const count = regex => (text.match(regex) || []).length;
  return {
    emDashCount: count(/[—–]/g),
    emDashPer100: round(count(/[—–]/g) / per100Base),
    semicolonCount: count(/;/g),
    semicolonPer100: round(count(/;/g) / per100Base),
    exclamationCount: count(/!/g),
    exclamationPer100: round(count(/!/g) / per100Base),
    questionCount: count(/\?/g),
    questionPer100: round(count(/\?/g) / per100Base),
    ellipsisCount: count(/\.\.\.|…/g),
    ellipsisPer100: round(count(/\.\.\.|…/g) / per100Base),
    parenthesesCount: count(/[()]/g),
    parenthesesPer100: round(count(/[()]/g) / per100Base),
    commaCount: count(/,/g),
    commaPer100: round(count(/,/g) / per100Base)
  };
}

function getLexicalFeatures(text, lower, per100Base) {
  const transitions = [
    "however", "therefore", "furthermore", "conversely", "fundamentally", "additionally",
    "overall", "moreover", "nevertheless", "nonetheless", "in contrast", "for example",
    "for instance", "as a result", "that said", "in summary", "in short", "on the other hand",
    "first", "next", "finally"
  ];
  const explanatoryTransitions = ["however", "therefore", "for example", "additionally", "overall", "in summary", "as a result", "first", "next", "finally"];
  const formalTransitions = ["furthermore", "conversely", "fundamentally", "in contrast", "moreover", "nevertheless", "nonetheless"];
  const hedges = [
    "as far as i know", "i'm not certain", "i am not certain", "i can't verify", "i cannot verify",
    "it depends", "that said", "worth noting", "likely", "may", "might", "could", "roughly", "plausibly",
    "not necessarily", "in practice", "broadly speaking", "rather than", "trade-off", "tradeoff",
    "uncertainty", "probabilistic", "hypothesis", "nuance", "nuanced"
  ];
  const honesty = ["i should be direct", "to be direct", "honestly", "genuinely", "important caveat", "caveat"];
  const gentlePushback = ["not quite", "not necessarily", "i'd push back", "i would push back", "the better way", "more accurate"];
  const closingOffers = ["if you want", "i can", "i'd be happy to", "i would be happy to", "happy to help", "i can also"];
  const imperativeTechnical = [
    "run this command", "install", "execute", "copy this", "paste this", "extract the", "return json",
    "use this command", "save the file", "create a file", "deploy", "configure", "parse", "validate"
  ];
  const blunt = ["let's be real", "bottom line", "here's the thing", "straight answer", "no fluff", "bluntly", "that's wrong", "this is wrong", "stupid", "ridiculous", "nonsense", "trash", "garbage"];
  const slang = ["yeah", "nope", "basically", "pretty much", "wild", "messy", "cool", "fun", "honestly"];
  const gushyOpeners = ["great question", "excellent question", "amazing question", "i'd love to", "i would love to", "absolutely!", "certainly!"];
  const examplePhrases = ["for example", "for instance", "such as", "including", "first", "next", "finally"];
  const breakdownPhrases = ["here is the breakdown", "here's the breakdown", "breakdown of", "at a glance", "key takeaway", "key takeaways"];

  const contractionCount = (lower.match(/\b(?:\w+['’](?:t|re|ve|ll|d|m)|(?:i|you|we|they|he|she|it|that|there|what|who|where|when|why|how|here|let|this)['’]s)\b/gi) || []).length;

  return {
    transitionCount: countPhrases(lower, transitions),
    transitionPer100: round(countPhrases(lower, transitions) / per100Base),
    explanatoryTransitionCount: countPhrases(lower, explanatoryTransitions),
    formalTransitionCount: countPhrases(lower, formalTransitions),
    hedgeCount: countPhrases(lower, hedges),
    hedgePer100: round(countPhrases(lower, hedges) / per100Base),
    honestyCount: countPhrases(lower, honesty),
    gentlePushbackCount: countPhrases(lower, gentlePushback),
    closingOfferCount: countPhrases(lower, closingOffers),
    imperativeTechnicalCount: countPhrases(lower, imperativeTechnical),
    imperativeTechnicalPer100: round(countPhrases(lower, imperativeTechnical) / per100Base),
    bluntCount: countPhrases(lower, blunt),
    slangCount: countPhrases(lower, slang),
    gushyOpenerCount: countPhrases(lower, gushyOpeners),
    examplePhraseCount: countPhrases(lower, examplePhrases),
    breakdownPhraseCount: countPhrases(lower, breakdownPhrases),
    contractionCount,
    contractionPer100: round(contractionCount / per100Base)
  };
}

function detectOpener(firstSentence) {
  const first = firstSentence.trim().toLowerCase();
  if (!first) return "none";
  if (/^(great|good|excellent|interesting|nice)\s+(question|point)/.test(first)) return "flattery";
  if (/^(here is|here's)\s+(a|the)?\s*breakdown/.test(first)) return "breakdown";
  if (/^sure[,.!]?/.test(first)) return "sure";
  if (/^(yep|yeah|nope)[,.!]?/.test(first)) return "yep_nope";
  if (/^(yes|no)[,.!]?\s/.test(first) || /^the answer is\b/.test(first) || /^[a-z][\w\s-]{1,45}\s+is\s+/.test(first)) return "direct_answer";
  return "none";
}

function detectCloser(lastSentence, sentences) {
  const last = lastSentence.trim().toLowerCase();
  if (!last) return "none";
  if (/\b(if you want|i can|i'd be happy to|i would be happy to|happy to)\b/.test(last)) return "offer";
  if (last.endsWith("?") && (sentences.match ? false : true)) return "single_followup_question";
  if (/^(in summary|overall|bottom line|in short|to summarize)\b/.test(last)) return "summary_line";
  return "none";
}

function getStructureFeatures(nonEmptyLines, sentences, paragraphs, markdown, wordCount) {
  const firstLine = nonEmptyLines[0] || "";
  const firstSentence = (sentences[0] || "").toLowerCase();
  const proseFirst = Boolean(firstLine && !/^\s*(?:#{1,6}\s+|[-*•+]\s+|\d+[.)]\s+|\|)/.test(firstLine));
  const listFirst = /^\s*(?:[-*•+]\s+|\d+[.)]\s+)/.test(firstLine);
  const headerFirst = /^#{1,6}\s+/.test(firstLine);
  const answerFirst = /^(yes|no|the answer is|bottom line|short answer|in short)\b/.test(firstSentence) || /^[a-z][\w\s-]{1,45}\s+is\s+/.test(firstSentence);
  const introFirst = /^(sure|certainly|here is|here's|let's|great question|this response|below is)\b/.test(firstSentence);
  const lineCount = Math.max(1, nonEmptyLines.length);

  return {
    proseFirst,
    listFirst,
    headerFirst,
    answerFirst,
    introFirst,
    shortParagraphRatio: round(paragraphs.filter(p => (p.match(WORD_RE) || []).length <= 45).length / Math.max(1, paragraphs.length)),
    listFirstRatio: round((markdown.bulletLineCount + markdown.numberedLineCount) / lineCount),
    proseLineRatio: round(nonEmptyLines.filter(line => !/^\s*(?:#{1,6}\s+|[-*•+]\s+|\d+[.)]\s+|\|)/.test(line)).length / lineCount),
    singleParagraphLongAnswer: paragraphs.length === 1 && wordCount >= 95,
    multiParagraph: paragraphs.length >= 3
  };
}

function getFactualOverviewFeatures(text, lower, words, punctuation, per100Base, paragraphCount, sentenceCount) {
  const factualPhrases = [
    "is a country", "country in", "world's most", "worlds most", "most populous", "home to", "more than",
    "one of the", "oldest continuous", "birthplace of", "became independent", "adopted a constitution",
    "largest democracy", "known for", "officially recognized", "wide range of", "from the", "in the north",
    "in the south", "economy is", "fastest-growing", "driven by", "faces challenges", "such as", "along with",
    "stretching back", "today it is", "it became", "it has", "located in", "population of", "founded in",
    "covers", "bordered by", "capital is", "history of", "economy", "culture", "landscape"
  ];
  const numberCount = (text.match(/\b\d+(?:\.\d+)?\b/g) || []).length;
  const yearCount = (text.match(/\b(?:1[5-9]\d{2}|20\d{2})\b/g) || []).length;
  const properNounMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  const properNounCount = properNounMatches.filter(item => !/^I$/.test(item)).length;
  const factualCueCount = countPhrases(lower, factualPhrases);
  const properNounDensity = properNounCount / Math.max(1, words.length);
  const enumerativeCommaSignal = punctuation.commaCount >= Math.max(5, sentenceCount * 2);
  const singleParagraphFactualOverview = paragraphCount === 1 && factualCueCount >= 3 && numberCount >= 2 && words.length >= 90;

  return {
    factualCueCount,
    factualCuePer100: round(factualCueCount / per100Base),
    numberCount,
    numberPer100: round(numberCount / per100Base),
    yearCount,
    properNounCount,
    properNounDensity: round(properNounDensity),
    enumerativeCommaSignal,
    singleParagraphFactualOverview,
    encyclopediaStyleSignal: singleParagraphFactualOverview || (factualCueCount >= 4 && numberCount >= 1 && properNounDensity >= 0.03)
  };
}

function getSelfIdentificationFeatures(text, lower) {
  const patterns = {
    claude: /\b(?:i\s*(?:am|'m)\s+claude|made by anthropic|anthropic's claude|anthropic claude)\b/i,
    gemini: /\b(?:i\s*(?:am|'m)\s+gemini|made by google|google's gemini|gemini\s+3\.)\b/i,
    grok: /\b(?:i\s*(?:am|'m)\s+grok|from xai|made by xai|xai's grok|grok\s+4\.6)\b/i
  };
  const quotedOrRoleplay = /\b(?:quote|quoted|roleplay|role-play|character|dialogue|story|pretend)\b/i.test(text);
  const detected = {};
  for (const [model, regex] of Object.entries(patterns)) {
    detected[model] = regex.test(lower);
  }
  return {
    detected,
    any: Object.values(detected).some(Boolean),
    quotedOrRoleplay
  };
}

function getVulgarityFeatures(text, lower, config, per100Base, lexical, structure) {
  const mildTerms = config.mild || [];
  const strongTerms = config.strong || [];
  const contextReducers = config.contextReducers || [];
  const warningTone = config.warningTone || [];
  const mildMatches = findTermMatches(lower, mildTerms);
  const strongMatches = findTermMatches(lower, strongTerms);
  const allMatches = [...mildMatches.map(m => ({ ...m, tier: "mild" })), ...strongMatches.map(m => ({ ...m, tier: "strong" }))].sort((a, b) => a.index - b.index);
  const quotedMatches = allMatches.filter(match => isInsideQuote(text, match.index));
  const contextReducerCount = countPhrases(lower, contextReducers);
  const warningToneCount = countPhrases(lower, warningTone);
  const roleplayOrStoryContext = contextReducerCount > 0 || /\b(?:he said|she said|they said|character|dialogue|story|roleplay|role-play|quoted)\b/i.test(text);
  const strongCount = strongMatches.length;
  const mildCount = mildMatches.length;
  const totalCount = allMatches.length;
  const quotedRatio = totalCount ? quotedMatches.length / totalCount : 0;
  const humanTypedSignal = hasHumanTypedSignal(text);
  const casualTone = totalCount > 0 && warningToneCount === 0 && quotedRatio < 0.75 && (
    lexical.slangCount > 0 || lexical.bluntCount > 0 || structure.shortParagraphRatio >= 0.5 || lexical.contractionCount >= 1 || /\b(?:lol|lmao|yeah|nope|bro)\b/i.test(text)
  );
  const rawScore = (mildCount * 1.0) + (strongCount * 3.2);
  let contextMultiplier = 1;
  if (quotedRatio >= 0.5) contextMultiplier *= 0.45;
  if (roleplayOrStoryContext) contextMultiplier *= 0.6;
  if (warningToneCount > 0) contextMultiplier *= 0.35;
  if (humanTypedSignal) contextMultiplier *= 0.75;
  if (casualTone) contextMultiplier *= 1.25;

  return {
    mildCount,
    strongCount,
    totalCount,
    per100: round(totalCount / per100Base),
    quotedCount: quotedMatches.length,
    quotedRatio: round(quotedRatio),
    roleplayOrStoryContext,
    warningTone: warningToneCount > 0,
    casualTone,
    humanTypedSignal,
    score: round(rawScore * contextMultiplier),
    rawScore: round(rawScore),
    contextMultiplier: round(contextMultiplier)
  };
}

function getQualitySignals(text, lower, words, nonEmptyLines, markdown) {
  const editedOrTranslatedSignal = /\b(?:translated|edited|rewritten|paraphrased|format-constrained|system prompt|as requested|rewrite this|rephrase)\b/i.test(text);
  const jsonLike = /^\s*[\[{]/.test(text) || /"[a-zA-Z0-9_]+"\s*:/.test(text);
  const codeLike = markdown.codeBlockCount > 0 || /\b(?:function|const|let|class|import|export|def|return)\b/.test(text);
  const typoSignal = hasHumanTypedSignal(text);
  return {
    editedOrTranslatedSignal,
    jsonLike,
    codeLike,
    typoSignal,
    allCapsRatio: round((words.filter(w => w.length > 2 && w === w.toUpperCase()).length) / Math.max(1, words.length)),
    averageLineLength: round(nonEmptyLines.join(" ").length / Math.max(1, nonEmptyLines.length))
  };
}

function findTermMatches(lower, terms) {
  const matches = [];
  for (const term of terms) {
    const escaped = escapeRegExp(String(term).toLowerCase()).replace(/\s+/g, "\\s+");
    const regex = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, "giu");
    let match;
    while ((match = regex.exec(lower)) !== null) {
      const leadingLength = match[1] ? match[1].length : 0;
      matches.push({ term: match[2], index: match.index + leadingLength });
      if (match.index === regex.lastIndex) regex.lastIndex += 1;
    }
  }
  return matches;
}

function isInsideQuote(text, index) {
  const before = text.slice(0, index);
  const doubleQuotes = (before.match(/["“”]/g) || []).length;
  return doubleQuotes % 2 === 1;
}

function hasHumanTypedSignal(text) {
  return /\b(?:u|ur|pls|plz|idk|imo|lol|lmao|btw)\b/i.test(text) || /[a-z]{2,}\d{2,}/i.test(text) || /(.)\1\1\1/.test(text);
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values, avg) {
  if (values.length <= 1) return 0;
  return values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function round(value, places = 3) {
  const factor = Math.pow(10, places);
  return Math.round((Number(value) || 0) * factor) / factor;
}
