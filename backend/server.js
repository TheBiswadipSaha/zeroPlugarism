/**
 * PureText Backend — server.js
 * Aggressive humanization pipeline to defeat AI detectors
 * Stack: Express + compromise.js + Datamuse API (no keys needed)
 */

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const axios = require("axios");
const nlp = require("compromise");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "../frontend/public")));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many requests. Please wait a moment." },
});
app.use("/api/", limiter);

// ─── In-memory synonym cache ──────────────────────────────────────────────────
const synCache = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function lcFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
function ucFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function wordCount(text) { return (text.match(/\b[a-zA-Z]+\b/g) || []).length; }
function chance(p) { return Math.random() < p; } // e.g. chance(0.3) = 30%

// ─── Transition replacement ───────────────────────────────────────────────────
const TRANSITIONS = {
  however: ["still", "yet", "that said", "even so", "but"],
  therefore: ["so", "as a result", "thus", "which means"],
  furthermore: ["on top of that", "beyond that", "what's more", "also"],
  "for example": ["for instance", "like", "to illustrate", "take"],
  "in conclusion": ["to wrap up", "in short", "all in all", "at the end of the day"],
  because: ["since", "given that", "seeing that", "as"],
  although: ["even though", "while", "despite the fact that", "whereas"],
  "in addition": ["on top of that", "also", "besides", "and"],
  additionally: ["on top of that", "also", "what's more", "and"],
  nevertheless: ["still", "even so", "that said", "but"],
  consequently: ["so", "as a result", "which means", "and so"],
  meanwhile: ["at the same time", "in parallel", "during this", "while this happens"],
  specifically: ["in particular", "namely", "to be exact", "more precisely"],
  overall: ["on the whole", "broadly", "in general", "all things considered"],
  ultimately: ["in the end", "at the end of the day", "when all is said and done", "finally"],
  "it is important to note": ["worth noting", "notably", "importantly", "it bears mentioning"],
  "it is worth noting": ["notably", "interestingly", "worth mentioning"],
  "plays a crucial role": ["is key", "matters a lot", "drives", "is central to"],
  "plays a significant role": ["is important to", "shapes", "drives", "contributes heavily to"],
  "it is essential": ["it is critical", "you need to", "it matters that"],
  "in order to": ["to", "so as to", "with the goal of"],
  "due to the fact that": ["because", "since", "given that"],
  "at this point in time": ["now", "currently", "at present", "today"],
  "in the event that": ["if", "should", "whenever"],
  "a large number of": ["many", "numerous", "a lot of"],
  "the majority of": ["most", "much of", "the bulk of"],
};

// ─── AI clichés that detectors specifically look for ─────────────────────────
const AI_CLICHES = {
  "delve into": ["look at", "dig into", "explore", "get into"],
  "delves into": ["looks at", "digs into", "explores", "gets into"],
  "delved into": ["looked at", "dug into", "explored"],
  "in the realm of": ["in", "within", "when it comes to"],
  "it's worth noting that": ["notably", "interestingly", "importantly"],
  "it is worth noting that": ["notably", "interestingly", "importantly"],
  "needless to say": ["obviously", "clearly", "of course"],
  "in today's world": ["today", "nowadays", "in modern times", "these days"],
  "in today's fast-paced world": ["today", "in the modern era", "these days"],
  "at the end of the day": ["ultimately", "in the end", "when it comes down to it"],
  "when it comes to": ["regarding", "on", "about", "for"],
  "the fact that": ["that", "how"],
  "in light of": ["given", "considering", "because of"],
  "shed light on": ["explain", "clarify", "reveal", "show"],
  "sheds light on": ["explains", "clarifies", "reveals", "shows"],
  "as we can see": ["clearly", "as shown", "evidently"],
  "it goes without saying": ["obviously", "clearly", "of course"],
  "in terms of": ["regarding", "for", "about", "on"],
  "serves as": ["acts as", "works as", "is", "functions as"],
  "plays a pivotal role": ["is key", "drives", "is central", "matters most"],
  "it is crucial": ["it matters", "it is key", "critically"],
  "it is imperative": ["you must", "it is essential", "critically important"],
  "in summary": ["to summarize", "in short", "briefly put"],
  "tapestry": ["mix", "blend", "combination", "range"],
  "landscape": ["field", "area", "domain", "space"],
  "paradigm": ["model", "approach", "framework", "system"],
  "leverage": ["use", "apply", "take advantage of"],
  "leveraging": ["using", "applying", "drawing on"],
  "utilize": ["use"],
  "utilizes": ["uses"],
  "utilized": ["used"],
  "utilizing": ["using"],
  "facilitate": ["help", "enable", "support", "make easier"],
  "facilitates": ["helps", "enables", "supports"],
  "robust": ["strong", "solid", "reliable", "effective"],
  "seamlessly": ["smoothly", "easily", "without friction"],
  "cutting-edge": ["advanced", "modern", "new", "latest"],
  "state-of-the-art": ["advanced", "modern", "top-tier", "latest"],
  "groundbreaking": ["innovative", "new", "pioneering", "novel"],
  "innovative": ["new", "creative", "fresh", "novel"],
  "revolutionize": ["transform", "change", "reshape", "overhaul"],
  "revolutionizes": ["transforms", "changes", "reshapes"],
  "crucial": ["key", "important", "critical", "vital"],
  "pivotal": ["key", "central", "important", "decisive"],
  "significant": ["major", "notable", "important", "substantial"],
  "substantial": ["large", "considerable", "significant", "major"],
  "comprehensive": ["thorough", "complete", "full", "wide-ranging"],
  "furthermore": ["also", "on top of that", "and", "what's more"],
  "moreover": ["also", "on top of that", "and", "additionally"],
  "nevertheless": ["still", "even so", "yet", "but"],
  "consequently": ["so", "as a result", "thus"],
  "subsequently": ["later", "then", "after that", "afterward"],
  "aforementioned": ["mentioned earlier", "the above", "this"],
  "henceforth": ["from now on", "going forward", "in the future"],
  "thus": ["so", "therefore", "as a result"],
  "hence": ["so", "that's why", "therefore"],
  "whilst": ["while", "as", "even as"],
  "amongst": ["among", "between", "within"],
  "whereby": ["where", "in which", "through which"],
  "therein": ["in this", "there", "within it"],
  "thereupon": ["then", "after that", "at that point"],
};

// ─── Human filler phrases to sprinkle in ─────────────────────────────────────
const HUMAN_FILLERS = [
  "honestly,",
  "truthfully,",
  "the thing is,",
  "here's the deal —",
  "to put it simply,",
  "let's be real,",
  "plain and simple,",
  "at its core,",
  "if you think about it,",
  "it's actually pretty simple:",
];

// ─── Passive → active voice patterns ─────────────────────────────────────────
const PASSIVE_PATTERNS = [
  { from: /(\w+) is being (\w+ed)/gi, to: (m, subj, verb) => `${verb}ing ${subj}` },
  { from: /it has been (\w+ed)/gi, to: (m, verb) => `this was ${verb}` },
  { from: /it was (\w+ed) that/gi, to: (m, verb) => `people ${verb} that` },
];

// ─── Datamuse — context-aware synonyms ───────────────────────────────────────
async function fetchSynonyms(word) {
  const key = `syn_${word.toLowerCase()}`;
  if (synCache.has(key)) return synCache.get(key);
  try {
    const { data } = await axios.get(
      `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word.toLowerCase())}&max=12`,
      { timeout: 3000 }
    );
    const syns = data
      .map((d) => d.word)
      .filter((w) => w && w !== word.toLowerCase() && w.length > 2 && !w.includes(" ") && /^[a-zA-Z-]+$/.test(w));
    synCache.set(key, syns);
    return syns;
  } catch { return []; }
}

async function fetchMeansLike(word) {
  const key = `ml_${word.toLowerCase()}`;
  if (synCache.has(key)) return synCache.get(key);
  try {
    const { data } = await axios.get(
      `https://api.datamuse.com/words?ml=${encodeURIComponent(word.toLowerCase())}&max=10`,
      { timeout: 3000 }
    );
    const syns = data
      .map((d) => d.word)
      .filter((w) => w && w !== word.toLowerCase() && w.length > 3 && !w.includes(" ") && /^[a-zA-Z-]+$/.test(w));
    synCache.set(key, syns);
    return syns;
  } catch { return []; }
}

// ─── Step 1: Kill AI clichés (highest impact) ─────────────────────────────────
function killAICliches(text) {
  let result = text;
  // Sort by length descending so longer phrases match first
  const sorted = Object.entries(AI_CLICHES).sort((a, b) => b[0].length - a[0].length);
  for (const [cliche, replacements] of sorted) {
    const escaped = cliche.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    result = result.replace(regex, (match) => {
      const rep = pick(replacements);
      return match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()
        ? ucFirst(rep) : rep;
    });
  }
  return result;
}

// ─── Step 2: Replace transition words ────────────────────────────────────────
function replaceTransitions(text) {
  let result = text;
  const sorted = Object.entries(TRANSITIONS).sort((a, b) => b[0].length - a[0].length);
  for (const [orig, replacements] of sorted) {
    const escaped = orig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    result = result.replace(regex, (match) => {
      const rep = pick(replacements);
      return match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()
        ? ucFirst(rep) : rep;
    });
  }
  return result;
}

// ─── Step 3: Sentence-level restructuring ─────────────────────────────────────
function restructureSentences(sentences, mode) {
  return sentences.map((s, i) => {
    const trimmed = s.trim();
    if (!trimmed || trimmed.length < 20) return trimmed;

    // Split overly long sentences at commas (AI loves run-ons)
    const words = trimmed.split(/\s+/);
    if (words.length > 28 && trimmed.includes(",")) {
      const parts = trimmed.split(",");
      if (parts.length >= 3) {
        const mid = Math.floor(parts.length / 2);
        const first = parts.slice(0, mid).join(",").trim();
        const second = parts.slice(mid).join(",").trim();
        if (first.length > 20 && second.length > 20) {
          const cleaned = second.replace(/^(and|but|or|which|that|while)\s+/i, "").trim();
          const firstFinal = first.replace(/[.]+$/, "") + ".";
          return firstFinal + " " + ucFirst(cleaned).replace(/[.]*$/, "") + ".";
        }
      }
    }

    // Occasionally merge two short consecutive sentences (humans do this)
    // (handled at a higher level)

    // Flip "X is Y because Z" → "Z, which is why X is Y"
    if (mode === "deep" && chance(0.2)) {
      const becauseMatch = trimmed.match(/^(.+?)\s+because\s+(.+)$/i);
      if (becauseMatch && becauseMatch[1].length > 15 && becauseMatch[2].length > 10) {
        return ucFirst(becauseMatch[2].replace(/[.!?]+$/, "")) + ", which is why " + lcFirst(becauseMatch[1].replace(/[.!?]+$/, "")) + ".";
      }
    }

    // Convert "There is/are X that Y" → "X Y"
    const thereIsMatch = trimmed.match(/^There (is|are) (.*?) that (.*?)\.?$/i);
    if (thereIsMatch && chance(0.5)) {
      return ucFirst(thereIsMatch[2]) + " " + thereIsMatch[3].replace(/[.]*$/, "") + ".";
    }

    return trimmed;
  });
}

// ─── Step 4: Vary sentence lengths (burstiness) ──────────────────────────────
// AI detectors measure "burstiness" — humans have more varied sentence lengths.
// Strategy: occasionally break one sentence OR fuse two short ones.
function varyLengths(sentences) {
  const result = [];
  let i = 0;
  while (i < sentences.length) {
    const cur = sentences[i].trim();
    const next = sentences[i + 1] ? sentences[i + 1].trim() : null;

    // Fuse two very short adjacent sentences
    if (next && cur.split(/\s+/).length < 8 && next.split(/\s+/).length < 8 && chance(0.35)) {
      const connector = pick(["and", "so", "but", "while", "as"]);
      const fused = cur.replace(/[.!?]+$/, "") + " " + connector + " " + lcFirst(next);
      result.push(fused);
      i += 2;
      continue;
    }

    result.push(cur);
    i++;
  }
  return result;
}

// ─── Step 5: Add human imperfections ─────────────────────────────────────────
function addHumanTouch(sentences, mode) {
  if (mode === "formal") return sentences; // formal stays clean

  return sentences.map((s, i) => {
    const trimmed = s.trim();
    if (!trimmed) return trimmed;

    // Occasionally start with "And" or "But" (humans do this)
    if (i > 0 && chance(0.12)) {
      const starter = pick(["And ", "But ", "So "]);
      const cleaned = trimmed.replace(/^(However|Therefore|Furthermore|Additionally|Moreover|Nevertheless|Consequently),?\s*/i, "");
      if (cleaned !== trimmed) {
        return starter + lcFirst(cleaned);
      }
    }

    // Occasionally add a human filler at sentence start (not too often)
    if (i > 1 && i % 5 === 0 && chance(0.25) && mode === "deep") {
      const filler = pick(HUMAN_FILLERS);
      const cleaned = trimmed.replace(/^[A-Z]/, (c) => c.toLowerCase());
      return ucFirst(filler) + " " + cleaned;
    }

    // Occasionally inject a short emphatic sentence after a long one
    if (trimmed.split(/\s+/).length > 20 && chance(0.2) && mode === "deep") {
      const emphasis = pick([
        "That matters a lot.",
        "This is key.",
        "It's that simple.",
        "And that's the point.",
        "Worth keeping in mind.",
      ]);
      return trimmed + " " + emphasis;
    }

    return trimmed;
  });
}

// ─── Step 6: Passive voice reduction ─────────────────────────────────────────
function reducePassive(text) {
  let result = text;
  for (const { from, to } of PASSIVE_PATTERNS) {
    result = result.replace(from, to);
  }
  // "is used to" → "helps"
  result = result.replace(/\bis used to\b/gi, "helps");
  // "are known to" → "tend to"
  result = result.replace(/\bare known to\b/gi, "tend to");
  // "can be seen as" → "looks like"
  result = result.replace(/\bcan be seen as\b/gi, "looks like");
  return result;
}

// ─── Step 7: Synonym substitution (async) ─────────────────────────────────────
async function replaceSynonyms(text, intensity, mode) {
  if (!text) return { text, changed: 0, synsApplied: 0 };
  const threshold = intensity / 100;

  const doc = nlp(text);

  const adjectives = doc.adjectives().out("array").filter((w) => w.length > 4 && /^[a-z]/i.test(w) && !AI_CLICHES[w.toLowerCase()]);
  const adverbs = doc.adverbs().out("array").filter((w) => w.length > 4 && /^[a-z]/i.test(w));
  const nouns = doc.nouns().not("#Pronoun").not("#ProperNoun").out("array").filter((w) => w.length > 5 && /^[a-z]/i.test(w) && !w.includes(" "));
  const verbs = doc.verbs().out("array").filter((w) =>
    w.length > 4 && /^[a-z]/i.test(w) &&
    !["have", "been", "will", "would", "could", "should", "might", "does", "were", "are", "was", "said"].includes(w.toLowerCase())
  );

  const allTargets = [...new Set([
    ...adjectives,
    ...adverbs,
    ...(mode !== "simple" ? nouns.slice(0, 12) : []),
    ...(mode === "deep" ? verbs.slice(0, 10) : []),
  ])].slice(0, 45);

  let result = text;
  let changed = 0;
  let synsApplied = 0;

  const synPromises = allTargets.map(async (word) => {
    if (Math.random() > threshold) return null;
    const syns = mode === "deep" ? await fetchMeansLike(word) : await fetchSynonyms(word);
    if (!syns || syns.length === 0) return null;
    const syn = syns[Math.floor(Math.random() * Math.min(5, syns.length))];
    return { word, syn };
  });

  const resolved = (await Promise.all(synPromises)).filter(Boolean);

  for (const { word, syn } of resolved) {
    if (!syn || syn === word.toLowerCase()) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`, "g");
    const before = result;
    result = result.replace(pattern, (match) => {
      if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) return ucFirst(syn);
      return syn;
    });
    if (result !== before) { changed++; synsApplied++; }
  }

  return { text: result, changed, synsApplied };
}

// ─── Step 8: NLP structural transforms ───────────────────────────────────────
function applyNLPTransforms(text, mode) {
  try {
    const doc = nlp(text);
    // Always expand contractions in formal mode; add them in casual modes
    if (mode === "formal") {
      doc.contractions().expand();
    } else if (mode === "simple" || mode === "standard") {
      // Add contractions to humanize (it is → it's, they are → they're)
      doc.contractions().contract();
    }
    if (mode === "deep") {
      // Shift some verb tenses to break uniform AI patterns
      doc.sentences().forEach((sent, i) => {
        try {
          if (i % 6 === 2) sent.verbs().toPastTense();
        } catch (_) {}
      });
    }
    return doc.text();
  } catch { return text; }
}

// ─── Formal vocabulary upgrades ───────────────────────────────────────────────
const FORMAL_UPGRADES = {
  "a lot of": "a considerable number of", "lots of": "numerous",
  big: "substantial", small: "minimal", get: "obtain", got: "obtained",
  make: "construct", made: "constructed", show: "demonstrate",
  showed: "demonstrated", need: "require", needed: "required",
  help: "assist", helped: "assisted", start: "initiate",
  started: "initiated", end: "conclude", ended: "concluded",
  think: "consider", thought: "considered", look: "examine",
  looked: "examined", find: "identify", found: "identified",
  "very": "considerably", "really": "substantially", "quite": "considerably",
};

function applyFormalUpgrades(text) {
  let result = text;
  for (const [casual, formal] of Object.entries(FORMAL_UPGRADES)) {
    const regex = new RegExp(`\\b${casual}\\b`, "gi");
    result = result.replace(regex, (m) => m[0] === m[0].toUpperCase() ? ucFirst(formal) : formal);
  }
  return result;
}

// ─── Simple vocabulary downgrades ────────────────────────────────────────────
const SIMPLE_DOWNGRADES = {
  utilize: "use", utilized: "used", demonstrate: "show",
  demonstrated: "showed", require: "need", required: "needed",
  obtain: "get", obtained: "got", initiate: "start", initiated: "started",
  conclude: "end", concluded: "ended", approximately: "about",
  sufficient: "enough", considerable: "large", facilitate: "help",
  "as a result": "so", "in order to": "to", "due to": "because of",
};

function applySimpleDowngrades(text) {
  let result = text;
  for (const [complex, simple] of Object.entries(SIMPLE_DOWNGRADES)) {
    const escaped = complex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    result = result.replace(regex, (m) => m[0] === m[0].toUpperCase() ? ucFirst(simple) : simple);
  }
  return result;
}

// ─── Estimate uniqueness ──────────────────────────────────────────────────────
function estimateUniqueness(original, rewritten, synsApplied, sentChanged) {
  const origWords = wordCount(original);
  if (origWords === 0) return 100;
  const changeRatio = (synsApplied + sentChanged * 2) / origWords;
  return Math.max(78, Math.min(97, Math.round(72 + changeRatio * 160)));
}

// ─── Sentence splitter ────────────────────────────────────────────────────────
function splitIntoSentences(text) {
  return (text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text])
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Main rewrite pipeline ────────────────────────────────────────────────────
async function rewriteText(inputText, mode, intensity) {
  let text = inputText.trim();
  if (!text) return { output: "", stats: {} };

  const originalWordCount = wordCount(text);

  // Step 1: Kill AI clichés (most impactful for detector evasion)
  text = killAICliches(text);

  // Step 2: Replace transition words
  text = replaceTransitions(text);

  // Step 3: Reduce passive voice
  text = reducePassive(text);

  // Step 4: NLP structural transforms (contractions, tense shifts)
  text = applyNLPTransforms(text, mode);

  // Step 5: Mode-specific vocabulary
  if (mode === "formal") text = applyFormalUpgrades(text);
  if (mode === "simple") text = applySimpleDowngrades(text);

  // Step 6: Sentence-level restructuring
  let sentences = splitIntoSentences(text);
  const originalSentCount = sentences.length;
  sentences = restructureSentences(sentences, mode);

  // Step 7: Vary sentence lengths (burstiness)
  if (mode !== "formal") {
    sentences = varyLengths(sentences);
  }

  // Step 8: Add human imperfections
  sentences = addHumanTouch(sentences, mode);

  text = sentences.join(" ");

  // Step 9: Synonym substitution (async, Datamuse)
  const { text: synonymized, changed, synsApplied } = await replaceSynonyms(text, intensity, mode);
  text = synonymized;

  // Step 10: Final cleanup
  text = text
    .replace(/\s{2,}/g, " ")
    .replace(/\s([.!?,;:])/g, "$1")
    .replace(/([.!?])\s*([a-z])/g, (m, p, c) => p + " " + c.toUpperCase()) // ensure caps after period
    .trim();

  const sentencesChanged = Math.abs(sentences.length - originalSentCount);
  const uniqueness = estimateUniqueness(inputText, text, synsApplied, sentencesChanged);

  return {
    output: text,
    stats: {
      originalWords: originalWordCount,
      outputWords: wordCount(text),
      wordsChanged: changed,
      synsApplied,
      sentencesRewritten: sentences.length,
      estimatedUniqueness: uniqueness,
    },
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", version: "2.0.0", cache: synCache.size });
});

app.post("/api/rewrite", async (req, res) => {
  const { text, mode = "standard", intensity = 70 } = req.body;

  if (!text || typeof text !== "string")
    return res.status(400).json({ error: "Missing or invalid text field." });
  if (text.trim().length < 10)
    return res.status(400).json({ error: "Text too short. Please enter at least 10 characters." });
  if (text.length > 50000)
    return res.status(400).json({ error: "Text too long. Max 50,000 characters." });

  const validModes = ["standard", "deep", "formal", "simple"];
  if (!validModes.includes(mode))
    return res.status(400).json({ error: "Invalid mode. Use: standard, deep, formal, or simple." });

  const parsedIntensity = parseInt(intensity, 10);
  if (isNaN(parsedIntensity) || parsedIntensity < 10 || parsedIntensity > 95)
    return res.status(400).json({ error: "Intensity must be 10–95." });

  try {
    const result = await rewriteText(text, mode, parsedIntensity);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("Rewrite error:", err);
    res.status(500).json({ error: "Rewrite failed. Please try again." });
  }
});

app.post("/api/rewrite/chunks", async (req, res) => {
  const { text, mode = "standard", intensity = 70 } = req.body;
  if (!text || typeof text !== "string")
    return res.status(400).json({ error: "Missing text field." });

  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let totalStats = { originalWords: 0, outputWords: 0, wordsChanged: 0, synsApplied: 0, sentencesRewritten: 0, estimatedUniqueness: 0 };
  const outputParagraphs = [];

  for (let i = 0; i < paragraphs.length; i++) {
    try {
      const result = await rewriteText(paragraphs[i], mode, parseInt(intensity, 10));
      outputParagraphs.push(result.output);
      for (const key of Object.keys(totalStats)) {
        if (key !== "estimatedUniqueness") totalStats[key] += result.stats[key] || 0;
      }
      res.write(`data: ${JSON.stringify({ type: "progress", index: i, total: paragraphs.length, paragraph: result.output })}\n\n`);
    } catch {
      outputParagraphs.push(paragraphs[i]);
    }
  }

  totalStats.estimatedUniqueness = estimateUniqueness(text, outputParagraphs.join("\n\n"), totalStats.synsApplied, totalStats.sentencesRewritten);
  res.write(`data: ${JSON.stringify({ type: "done", output: outputParagraphs.join("\n\n"), stats: totalStats })}\n\n`);
  res.end();
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/public/index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🚀 PureText v2 running at http://localhost:${PORT}`);
  console.log(`   Stack: Express + compromise.js + Datamuse API\n`);
});

module.exports = app;