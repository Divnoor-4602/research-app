import type { ReadabilityMetrics } from "../benchmark-schemas";

// ============================================================================
// Text Analysis Types
// ============================================================================

interface TextAnalysis {
  words: number;
  sentences: number;
  syllables: number;
  complexWords: number; // Words with >= 3 syllables
}

// ============================================================================
// Syllable Counting
// ============================================================================

/**
 * Estimates the number of syllables in a word using a heuristic approach.
 * This is a simplified algorithm that works reasonably well for English.
 */
function countSyllables(word: string): number {
  const cleanWord = word.toLowerCase().replace(/[^a-z]/g, "");

  if (cleanWord.length === 0) {
    return 0;
  }

  if (cleanWord.length <= 3) {
    return 1;
  }

  // Count vowel groups
  let syllables = 0;
  let prevWasVowel = false;
  const vowels = new Set(["a", "e", "i", "o", "u", "y"]);

  for (const char of cleanWord) {
    const isVowel = vowels.has(char);
    if (isVowel && !prevWasVowel) {
      syllables++;
    }
    prevWasVowel = isVowel;
  }

  // Handle silent 'e' at the end
  if (cleanWord.endsWith("e") && syllables > 1) {
    syllables--;
  }

  // Handle words ending in 'le' preceded by a consonant
  if (
    cleanWord.endsWith("le") &&
    cleanWord.length > 2 &&
    !vowels.has(cleanWord.at(-3) ?? "")
  ) {
    syllables++;
  }

  // Ensure at least 1 syllable
  return Math.max(1, syllables);
}

/**
 * Checks if a word is "complex" (has 3 or more syllables)
 * Excludes common suffixes that don't add complexity
 */
function isComplexWord(word: string): boolean {
  const cleanWord = word.toLowerCase().replace(/[^a-z]/g, "");

  // Skip short words
  if (cleanWord.length < 5) {
    return false;
  }

  // Check syllable count
  const syllables = countSyllables(cleanWord);

  // Words with common suffixes that artificially inflate syllable count
  // are still considered complex if they have 3+ syllables
  return syllables >= 3;
}

// ============================================================================
// Text Tokenization
// ============================================================================

/**
 * Splits text into sentences using common sentence-ending punctuation
 */
function tokenizeSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space or end of string
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // If no sentences found, treat the whole text as one sentence
  return sentences.length > 0 ? sentences : [text];
}

/**
 * Splits text into words
 */
function tokenizeWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9'-]/g, ""))
    .filter((w) => w.length > 0);
}

// ============================================================================
// Text Analysis
// ============================================================================

/**
 * Analyzes text and returns word count, sentence count, syllable count,
 * and complex word count
 */
function analyzeText(text: string): TextAnalysis {
  const sentences = tokenizeSentences(text);
  const words = tokenizeWords(text);

  let totalSyllables = 0;
  let complexWordCount = 0;

  for (const word of words) {
    const syllables = countSyllables(word);
    totalSyllables += syllables;

    if (isComplexWord(word)) {
      complexWordCount++;
    }
  }

  return {
    words: words.length,
    sentences: sentences.length,
    syllables: totalSyllables,
    complexWords: complexWordCount,
  };
}

// ============================================================================
// Readability Formulas
// ============================================================================

/**
 * Computes Flesch Reading Ease (FRE)
 * Higher scores = easier to read
 * - 90-100: Very easy (5th grade)
 * - 80-89: Easy (6th grade)
 * - 70-79: Fairly easy (7th grade)
 * - 60-69: Standard (8th-9th grade)
 * - 50-59: Fairly difficult (10th-12th grade)
 * - 30-49: Difficult (college)
 * - 0-29: Very difficult (college graduate)
 *
 * Formula: 206.835 - 1.015 * (words/sentences) - 84.6 * (syllables/words)
 */
export function computeFRE(text: string): number {
  const { words, sentences, syllables } = analyzeText(text);

  if (words === 0 || sentences === 0) {
    return 100; // Empty text is "very easy"
  }

  const avgWordsPerSentence = words / sentences;
  const avgSyllablesPerWord = syllables / words;

  const score =
    206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord;

  // Clamp to reasonable range
  return Math.max(0, Math.min(100, score));
}

/**
 * Computes Flesch-Kincaid Grade Level (FKG)
 * Returns the US grade level required to understand the text
 *
 * Formula: 0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59
 */
export function computeFKG(text: string): number {
  const { words, sentences, syllables } = analyzeText(text);

  if (words === 0 || sentences === 0) {
    return 0;
  }

  const avgWordsPerSentence = words / sentences;
  const avgSyllablesPerWord = syllables / words;

  const grade =
    0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;

  // Clamp to reasonable range (0-20)
  return Math.max(0, Math.min(20, grade));
}

/**
 * Computes Gunning Fog Index (GFI)
 * Returns the years of formal education needed to understand the text
 *
 * Formula: 0.4 * ((words/sentences) + 100 * (complexWords/words))
 */
export function computeGFI(text: string): number {
  const { words, sentences, complexWords } = analyzeText(text);

  if (words === 0 || sentences === 0) {
    return 0;
  }

  const avgWordsPerSentence = words / sentences;
  const percentComplexWords = (complexWords / words) * 100;

  const index = 0.4 * (avgWordsPerSentence + percentComplexWords);

  // Clamp to reasonable range (0-20)
  return Math.max(0, Math.min(20, index));
}

// ============================================================================
// Duplication Detection
// ============================================================================

/**
 * Computes the duplication rate in text (proportion of duplicate sentences)
 */
export function computeDuplicationRate(text: string): number {
  const sentences = tokenizeSentences(text);

  if (sentences.length <= 1) {
    return 0;
  }

  // Normalize sentences for comparison
  const normalized = sentences.map((s) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim()
  );

  const uniqueSet = new Set(normalized);
  const uniqueCount = uniqueSet.size;

  // Duplication rate = 1 - (unique / total)
  return 1 - uniqueCount / normalized.length;
}

// ============================================================================
// Main Entry Points
// ============================================================================

/**
 * Computes all readability metrics for a given text
 */
export function computeReadabilityMetrics(text: string): ReadabilityMetrics {
  return {
    fre: computeFRE(text),
    fkg: computeFKG(text),
    gfi: computeGFI(text),
  };
}

/**
 * Extracts interviewer text from transcript for readability analysis
 */
export function extractInterviewerText(
  transcript: Array<{ role: string; text: string }>
): string {
  return transcript
    .filter((entry) => entry.role === "interviewer")
    .map((entry) => entry.text)
    .join(" ");
}

/**
 * Extracts patient text from transcript for analysis
 */
export function extractPatientText(
  transcript: Array<{ role: string; text: string }>
): string {
  return transcript
    .filter((entry) => entry.role === "patient")
    .map((entry) => entry.text)
    .join(" ");
}

/**
 * Extracts narrative sections from a streamdown report
 * (summary, impressions, recommendations - excludes tables)
 */
export function extractReportNarrative(report: string): string {
  // Remove markdown table rows
  const withoutTables = report.replace(/\|[^|]+\|/g, " ");

  // Remove markdown headers but keep their text
  const withoutHeaders = withoutTables.replace(/^#+\s*/gm, "");

  // Remove bullet points but keep text
  const withoutBullets = withoutHeaders.replace(/^[-*]\s*/gm, "");

  // Clean up extra whitespace
  return withoutBullets.replace(/\s+/g, " ").trim();
}
