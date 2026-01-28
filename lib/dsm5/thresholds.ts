import { z } from "zod";
import { DSM5_DOMAINS, type Dsm5Domain } from "./items";

// ============================================================================
// Domain Threshold Configuration
// Based on DSM-5 Level-1 Cross-Cutting Symptom Measure Scoring Guidelines
// ============================================================================

/**
 * Threshold configuration for a domain
 * - itemIds: Items that contribute to this domain's score
 * - threshold: Score at which the domain is considered "flagged"
 * - rule: How to apply the threshold across items
 */
export interface DomainThresholdConfig {
  domain: Dsm5Domain;
  itemIds: string[];
  threshold: number;
  rule: "any" | "all" | "sum";
  description: string;
  clinicalNote: string;
}

/**
 * Domain thresholds based on DSM-5 Level-1 scoring guidelines
 *
 * General rule: A score of 2 (mild) or higher on any item in the domain
 * triggers further inquiry (Level-2 assessment).
 *
 * Special cases:
 * - Suicidal Ideation: threshold = 1 (any mention requires follow-up)
 * - Substance Use: threshold = 1 (any use may warrant discussion)
 */
export const DOMAIN_THRESHOLDS: DomainThresholdConfig[] = [
  {
    domain: DSM5_DOMAINS.DEPRESSION,
    itemIds: ["D1", "D2"],
    threshold: 2,
    rule: "any",
    description: "Depressive symptoms elevated",
    clinicalNote: "Consider PHQ-9 or Level-2 Depression assessment",
  },
  {
    domain: DSM5_DOMAINS.ANGER,
    itemIds: ["ANG1"],
    threshold: 2,
    rule: "any",
    description: "Anger/irritability elevated",
    clinicalNote: "Consider Level-2 Anger assessment",
  },
  {
    domain: DSM5_DOMAINS.MANIA,
    itemIds: ["M1", "M2"],
    threshold: 2,
    rule: "any",
    description: "Manic symptoms elevated",
    clinicalNote: "Consider Level-2 Mania assessment or MDQ",
  },
  {
    domain: DSM5_DOMAINS.ANXIETY,
    itemIds: ["ANX1", "ANX2", "ANX3"],
    threshold: 2,
    rule: "any",
    description: "Anxiety symptoms elevated",
    clinicalNote: "Consider GAD-7 or Level-2 Anxiety assessment",
  },
  {
    domain: DSM5_DOMAINS.SOMATIC,
    itemIds: ["SOM1", "SOM2"],
    threshold: 2,
    rule: "any",
    description: "Somatic symptoms elevated",
    clinicalNote: "Consider Level-2 Somatic Symptom assessment",
  },
  {
    domain: DSM5_DOMAINS.SUICIDAL,
    itemIds: ["SUI1"],
    threshold: 1, // Any mention requires follow-up
    rule: "any",
    description: "Suicidal ideation present",
    clinicalNote: "CRITICAL: Conduct safety assessment immediately",
  },
  {
    domain: DSM5_DOMAINS.PSYCHOSIS,
    itemIds: ["PSY1", "PSY2"],
    threshold: 1, // Psychotic symptoms warrant low threshold
    rule: "any",
    description: "Psychotic symptoms present",
    clinicalNote: "Consider psychiatric evaluation",
  },
  {
    domain: DSM5_DOMAINS.SLEEP,
    itemIds: ["SLP1"],
    threshold: 2,
    rule: "any",
    description: "Sleep problems elevated",
    clinicalNote: "Consider Level-2 Sleep Disturbance assessment",
  },
  {
    domain: DSM5_DOMAINS.MEMORY,
    itemIds: ["MEM1"],
    threshold: 2,
    rule: "any",
    description: "Memory/cognitive concerns elevated",
    clinicalNote: "Consider cognitive screening",
  },
  {
    domain: DSM5_DOMAINS.REPETITIVE,
    itemIds: ["REP1", "REP2"],
    threshold: 2,
    rule: "any",
    description: "Repetitive thoughts/behaviors elevated",
    clinicalNote: "Consider Level-2 Repetitive Thoughts assessment or Y-BOCS",
  },
  {
    domain: DSM5_DOMAINS.DISSOCIATION,
    itemIds: ["DIS1"],
    threshold: 2,
    rule: "any",
    description: "Dissociative symptoms elevated",
    clinicalNote: "Consider Level-2 Dissociation assessment",
  },
  {
    domain: DSM5_DOMAINS.PERSONALITY,
    itemIds: ["PER1", "PER2"],
    threshold: 2,
    rule: "any",
    description: "Personality functioning concerns elevated",
    clinicalNote: "Consider Level-2 Personality Functioning assessment",
  },
  {
    domain: DSM5_DOMAINS.SUBSTANCE,
    itemIds: ["SUB1", "SUB2", "SUB3"],
    threshold: 1, // Any substance use warrants discussion
    rule: "any",
    description: "Substance use indicated",
    clinicalNote: "Consider AUDIT/DAST or Level-2 Substance Use assessment",
  },
];

// ============================================================================
// Severity Levels
// ============================================================================

export const severityLevelSchema = z.enum([
  "none",
  "mild",
  "moderate",
  "elevated",
  "severe",
]);
export type SeverityLevel = z.infer<typeof severityLevelSchema>;

/**
 * Map a raw score (0-4) to a severity level
 */
export function scoreToSeverity(score: number): SeverityLevel {
  if (score === 0) return "none";
  if (score === 1) return "mild";
  if (score === 2) return "moderate";
  if (score === 3) return "elevated";
  return "severe";
}

/**
 * Get the maximum severity from an array of scores
 */
export function getMaxSeverity(scores: number[]): SeverityLevel {
  const maxScore = Math.max(...scores, 0);
  return scoreToSeverity(maxScore);
}

// ============================================================================
// Threshold Evaluation Functions
// ============================================================================

/**
 * Evaluate if a domain meets its threshold
 */
export function evaluateDomainThreshold(
  config: DomainThresholdConfig,
  itemScores: Map<string, number>
): {
  meetsThreshold: boolean;
  maxScore: number;
  severity: SeverityLevel;
  scores: { itemId: string; score: number }[];
} {
  const scores = config.itemIds
    .map((itemId) => ({
      itemId,
      score: itemScores.get(itemId) ?? 0,
    }))
    .filter((s) => itemScores.has(s.itemId));

  if (scores.length === 0) {
    return {
      meetsThreshold: false,
      maxScore: 0,
      severity: "none",
      scores: [],
    };
  }

  let meetsThreshold = false;
  const maxScore = Math.max(...scores.map((s) => s.score));

  switch (config.rule) {
    case "any":
      meetsThreshold = scores.some((s) => s.score >= config.threshold);
      break;
    case "all":
      meetsThreshold = scores.every((s) => s.score >= config.threshold);
      break;
    case "sum": {
      const sum = scores.reduce((acc, s) => acc + s.score, 0);
      meetsThreshold = sum >= config.threshold;
      break;
    }
  }

  return {
    meetsThreshold,
    maxScore,
    severity: scoreToSeverity(maxScore),
    scores,
  };
}

/**
 * Evaluate all domains against their thresholds
 */
export function evaluateAllDomains(itemScores: Map<string, number>): Array<{
  config: DomainThresholdConfig;
  result: ReturnType<typeof evaluateDomainThreshold>;
}> {
  return DOMAIN_THRESHOLDS.map((config) => ({
    config,
    result: evaluateDomainThreshold(config, itemScores),
  }));
}

/**
 * Get domains that meet their thresholds (flagged for follow-up)
 */
export function getFlaggedDomains(
  itemScores: Map<string, number>
): DomainThresholdConfig[] {
  return DOMAIN_THRESHOLDS.filter((config) => {
    const { meetsThreshold } = evaluateDomainThreshold(config, itemScores);
    return meetsThreshold;
  });
}

/**
 * Get the threshold config for a specific domain
 */
export function getThresholdConfig(
  domain: Dsm5Domain
): DomainThresholdConfig | undefined {
  return DOMAIN_THRESHOLDS.find((config) => config.domain === domain);
}
