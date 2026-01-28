import { z } from "zod";

// ============================================================================
// Item Registry Version
// ============================================================================

/**
 * Version of the DSM-5 Level-1 item registry.
 * Increment when items are added, removed, or modified.
 */
export const DSM5_ITEM_REGISTRY_VERSION = "1.0.0";

// ============================================================================
// DSM-5 Level-1 Cross-Cutting Symptom Measure Item Schema
// ============================================================================

export const dsm5ItemSchema = z.object({
  itemId: z.string(),
  domain: z.string(),
  subdomain: z.string().optional(),
  text: z.string(),
  adultVersion: z.boolean().default(true),
});
export type Dsm5Item = z.infer<typeof dsm5ItemSchema>;

// ============================================================================
// DSM-5 Domains
// ============================================================================

export const DSM5_DOMAINS = {
  DEPRESSION: "Depression",
  ANGER: "Anger",
  MANIA: "Mania",
  ANXIETY: "Anxiety",
  SOMATIC: "Somatic Symptoms",
  SUICIDAL: "Suicidal Ideation",
  PSYCHOSIS: "Psychosis",
  SLEEP: "Sleep Problems",
  MEMORY: "Memory",
  REPETITIVE: "Repetitive Thoughts and Behaviors",
  DISSOCIATION: "Dissociation",
  PERSONALITY: "Personality Functioning",
  SUBSTANCE: "Substance Use",
} as const;

export type Dsm5Domain = (typeof DSM5_DOMAINS)[keyof typeof DSM5_DOMAINS];

// ============================================================================
// DSM-5 Level-1 Cross-Cutting Symptom Measure - Adult (23 Items)
// Based on the official DSM-5 Level 1 Cross-Cutting Symptom Measure
// ============================================================================

export const DSM5_LEVEL1_ITEMS: Dsm5Item[] = [
  // Domain I: Depression (2 items)
  {
    itemId: "D1",
    domain: DSM5_DOMAINS.DEPRESSION,
    text: "Little interest or pleasure in doing things?",
    adultVersion: true,
  },
  {
    itemId: "D2",
    domain: DSM5_DOMAINS.DEPRESSION,
    text: "Feeling down, depressed, or hopeless?",
    adultVersion: true,
  },

  // Domain II: Anger (1 item)
  {
    itemId: "ANG1",
    domain: DSM5_DOMAINS.ANGER,
    text: "Feeling more irritated, grouchy, or angry than usual?",
    adultVersion: true,
  },

  // Domain III: Mania (2 items)
  {
    itemId: "M1",
    domain: DSM5_DOMAINS.MANIA,
    text: "Sleeping less than usual, but still having a lot of energy?",
    adultVersion: true,
  },
  {
    itemId: "M2",
    domain: DSM5_DOMAINS.MANIA,
    text: "Starting lots more projects than usual or doing more risky things than usual?",
    adultVersion: true,
  },

  // Domain IV: Anxiety (3 items)
  {
    itemId: "ANX1",
    domain: DSM5_DOMAINS.ANXIETY,
    text: "Feeling nervous, anxious, frightened, worried, or on edge?",
    adultVersion: true,
  },
  {
    itemId: "ANX2",
    domain: DSM5_DOMAINS.ANXIETY,
    text: "Feeling panic or being frightened?",
    adultVersion: true,
  },
  {
    itemId: "ANX3",
    domain: DSM5_DOMAINS.ANXIETY,
    text: "Avoiding situations that make you anxious?",
    adultVersion: true,
  },

  // Domain V: Somatic Symptoms (2 items)
  {
    itemId: "SOM1",
    domain: DSM5_DOMAINS.SOMATIC,
    text: "Unexplained aches and pains (e.g., head, back, joints, abdomen, legs)?",
    adultVersion: true,
  },
  {
    itemId: "SOM2",
    domain: DSM5_DOMAINS.SOMATIC,
    text: "Feeling that your illnesses are not being taken seriously enough?",
    adultVersion: true,
  },

  // Domain VI: Suicidal Ideation (1 item)
  {
    itemId: "SUI1",
    domain: DSM5_DOMAINS.SUICIDAL,
    text: "Thoughts of actually hurting yourself?",
    adultVersion: true,
  },

  // Domain VII: Psychosis (2 items)
  {
    itemId: "PSY1",
    domain: DSM5_DOMAINS.PSYCHOSIS,
    text: "Hearing things other people couldn't hear, such as voices even when no one was around?",
    adultVersion: true,
  },
  {
    itemId: "PSY2",
    domain: DSM5_DOMAINS.PSYCHOSIS,
    text: "Feeling that someone could hear your thoughts, or that you could hear what another person was thinking?",
    adultVersion: true,
  },

  // Domain VIII: Sleep Problems (1 item)
  {
    itemId: "SLP1",
    domain: DSM5_DOMAINS.SLEEP,
    text: "Problems with sleep that affected your sleep quality over all?",
    adultVersion: true,
  },

  // Domain IX: Memory (1 item)
  {
    itemId: "MEM1",
    domain: DSM5_DOMAINS.MEMORY,
    text: "Problems with memory (e.g., learning new information) or with location (e.g., finding your way home)?",
    adultVersion: true,
  },

  // Domain X: Repetitive Thoughts and Behaviors (2 items)
  {
    itemId: "REP1",
    domain: DSM5_DOMAINS.REPETITIVE,
    text: "Unpleasant thoughts, urges, or images that repeatedly enter your mind?",
    adultVersion: true,
  },
  {
    itemId: "REP2",
    domain: DSM5_DOMAINS.REPETITIVE,
    text: "Feeling driven to perform certain behaviors or mental acts over and over again?",
    adultVersion: true,
  },

  // Domain XI: Dissociation (1 item)
  {
    itemId: "DIS1",
    domain: DSM5_DOMAINS.DISSOCIATION,
    text: "Feeling detached or distant from yourself, your body, your physical surroundings, or your memories?",
    adultVersion: true,
  },

  // Domain XII: Personality Functioning (2 items)
  {
    itemId: "PER1",
    domain: DSM5_DOMAINS.PERSONALITY,
    text: "Not knowing who you really are or what you want out of life?",
    adultVersion: true,
  },
  {
    itemId: "PER2",
    domain: DSM5_DOMAINS.PERSONALITY,
    text: "Not feeling close to other people or enjoying your relationships with them?",
    adultVersion: true,
  },

  // Domain XIII: Substance Use (3 items)
  {
    itemId: "SUB1",
    domain: DSM5_DOMAINS.SUBSTANCE,
    subdomain: "Alcohol",
    text: "Drinking at least 4 drinks of any kind of alcohol in a single day?",
    adultVersion: true,
  },
  {
    itemId: "SUB2",
    domain: DSM5_DOMAINS.SUBSTANCE,
    subdomain: "Tobacco",
    text: "Smoking any cigarettes, a cigar, or pipe, or using snuff or chewing tobacco?",
    adultVersion: true,
  },
  {
    itemId: "SUB3",
    domain: DSM5_DOMAINS.SUBSTANCE,
    subdomain: "Drugs",
    text: "Using any of the following medicines ON YOUR OWN, that is, without a doctor's prescription, in greater amounts or longer than prescribed: painkillers, stimulants, sedatives, or tranquilizers?",
    adultVersion: true,
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all item IDs for initializing question state
 */
export function getAllItemIds(): string[] {
  return DSM5_LEVEL1_ITEMS.map((item) => item.itemId);
}

/**
 * Get item by ID
 */
export function getItemById(itemId: string): Dsm5Item | undefined {
  return DSM5_LEVEL1_ITEMS.find((item) => item.itemId === itemId);
}

/**
 * Get items by domain
 */
export function getItemsByDomain(domain: Dsm5Domain): Dsm5Item[] {
  return DSM5_LEVEL1_ITEMS.filter((item) => item.domain === domain);
}

/**
 * Get all unique domains
 */
export function getAllDomains(): Dsm5Domain[] {
  return [
    ...new Set(DSM5_LEVEL1_ITEMS.map((item) => item.domain)),
  ] as Dsm5Domain[];
}

/**
 * Get default question state with all items pending
 */
export function getDefaultQuestionState() {
  return {
    pendingItems: getAllItemIds(),
    completedItems: [] as string[],
    followUpsNeeded: [] as string[],
    // State machine fields
    currentState: "INTRO" as const,
    currentItemId: null as string | null,
    isFollowUp: false,
    followUpUsedItems: [] as string[],
  };
}

/**
 * Scoring scale semantics (0-4 frequency anchors)
 */
export const SCORING_ANCHORS = {
  0: "Not at all",
  1: "Rarely (1-2 days)",
  2: "Several days",
  3: "More than half the days",
  4: "Nearly every day",
} as const;

export type ScoreValue = keyof typeof SCORING_ANCHORS;

// ============================================================================
// Domain Thresholds for Level-2 Assessment
// ============================================================================

/**
 * DSM-5 Level-1 to Level-2 threshold scores by domain.
 * If any item in a domain scores at or above the threshold,
 * Level-2 assessment for that domain may be indicated.
 *
 * Based on DSM-5 Cross-Cutting Symptom Measure scoring guidelines:
 * - Most domains: threshold = 2 (mild or greater)
 * - Substance Use: threshold = 1 (any use)
 * - Suicidal Ideation: threshold = 1 (any ideation - triggers safety protocol)
 */
export const DOMAIN_THRESHOLDS: Record<Dsm5Domain, number> = {
  [DSM5_DOMAINS.DEPRESSION]: 2,
  [DSM5_DOMAINS.ANGER]: 2,
  [DSM5_DOMAINS.MANIA]: 2,
  [DSM5_DOMAINS.ANXIETY]: 2,
  [DSM5_DOMAINS.SOMATIC]: 2,
  [DSM5_DOMAINS.SUICIDAL]: 1, // Any score triggers concern
  [DSM5_DOMAINS.PSYCHOSIS]: 2,
  [DSM5_DOMAINS.SLEEP]: 2,
  [DSM5_DOMAINS.MEMORY]: 2,
  [DSM5_DOMAINS.REPETITIVE]: 2,
  [DSM5_DOMAINS.DISSOCIATION]: 2,
  [DSM5_DOMAINS.PERSONALITY]: 2,
  [DSM5_DOMAINS.SUBSTANCE]: 1, // Any use noted
};

/**
 * Check if a domain score exceeds the threshold for Level-2 assessment
 */
export function isDomainAboveThreshold(
  domain: Dsm5Domain,
  highestScore: number
): boolean {
  return highestScore >= DOMAIN_THRESHOLDS[domain];
}

/**
 * Get domains that exceed thresholds based on item responses
 */
export function getDomainsAboveThreshold(
  itemScores: Map<string, number>
): Dsm5Domain[] {
  const domainHighScores = new Map<Dsm5Domain, number>();

  // Find highest score per domain
  for (const item of DSM5_LEVEL1_ITEMS) {
    const score = itemScores.get(item.itemId);
    if (score !== undefined) {
      const current = domainHighScores.get(item.domain as Dsm5Domain) ?? 0;
      if (score > current) {
        domainHighScores.set(item.domain as Dsm5Domain, score);
      }
    }
  }

  // Return domains above threshold
  const aboveThreshold: Dsm5Domain[] = [];
  for (const [domain, highScore] of domainHighScores) {
    if (isDomainAboveThreshold(domain, highScore)) {
      aboveThreshold.push(domain);
    }
  }

  return aboveThreshold;
}

/**
 * Get item count per domain for coverage tracking
 */
export function getItemCountByDomain(): Record<Dsm5Domain, number> {
  const counts = {} as Record<Dsm5Domain, number>;
  for (const domain of Object.values(DSM5_DOMAINS)) {
    counts[domain] = getItemsByDomain(domain).length;
  }
  return counts;
}
