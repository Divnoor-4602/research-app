import {
  DSM5_LEVEL1_ITEMS,
  type Dsm5Domain,
  type Dsm5Item,
  getAllDomains,
  getDomainsAboveThreshold,
  getItemsByDomain,
} from "./items";

// ============================================================================
// Domain Priority Order
// ============================================================================

/**
 * Default domain priority order for sequential questioning.
 * Based on clinical relevance and typical assessment flow.
 */
export const DOMAIN_PRIORITY_ORDER: Dsm5Domain[] = [
  "Depression",
  "Anxiety",
  "Anger",
  "Mania",
  "Somatic Symptoms",
  "Sleep Problems",
  "Memory",
  "Repetitive Thoughts and Behaviors",
  "Dissociation",
  "Personality Functioning",
  "Psychosis",
  "Substance Use",
  "Suicidal Ideation", // Last due to sensitivity, but always asked
];

// ============================================================================
// Related Domain Mapping
// ============================================================================

/**
 * Domains that are clinically related and should be explored together
 * when one shows elevated scores.
 */
export const RELATED_DOMAINS: Record<Dsm5Domain, Dsm5Domain[]> = {
  Depression: ["Anxiety", "Sleep Problems", "Suicidal Ideation"],
  Anxiety: ["Depression", "Somatic Symptoms", "Sleep Problems"],
  Anger: ["Mania", "Substance Use"],
  Mania: ["Depression", "Sleep Problems", "Anger"],
  "Somatic Symptoms": ["Anxiety", "Depression"],
  "Suicidal Ideation": ["Depression", "Substance Use"],
  Psychosis: ["Dissociation", "Substance Use"],
  "Sleep Problems": ["Depression", "Anxiety", "Mania"],
  Memory: ["Depression", "Dissociation"],
  "Repetitive Thoughts and Behaviors": ["Anxiety"],
  Dissociation: ["Psychosis", "Memory"],
  "Personality Functioning": ["Depression", "Anxiety"],
  "Substance Use": ["Depression", "Mania", "Suicidal Ideation"],
};

// ============================================================================
// Item Selection Functions
// ============================================================================

/**
 * Select the next item to ask based on adaptive ordering.
 *
 * Priority logic:
 * 1. If high-severity domains detected (score >= threshold), prioritize
 *    remaining items in those domains and their related domains
 * 2. Otherwise, follow sequential domain order
 * 3. Group items within same domain together
 *
 * @param pendingItems - Item IDs that haven't been asked yet
 * @param completedItems - Item IDs that have been completed
 * @param itemScores - Map of itemId to score (0-4)
 * @returns The next itemId to ask, or null if all items complete
 */
export function selectNextItem(
  pendingItems: string[],
  completedItems: string[],
  itemScores: Map<string, number>
): string | null {
  if (pendingItems.length === 0) {
    return null;
  }

  // 1. Find domains with high severity scores
  const highSeverityDomains = getDomainsAboveThreshold(itemScores);

  // 2. If high severity domains exist, prioritize them and related domains
  if (highSeverityDomains.length > 0) {
    const priorityDomains = getPriorityDomains(highSeverityDomains);

    for (const domain of priorityDomains) {
      const nextItem = findPendingItemInDomain(pendingItems, domain);
      if (nextItem) {
        return nextItem;
      }
    }
  }

  // 3. Fall back to sequential domain order
  for (const domain of DOMAIN_PRIORITY_ORDER) {
    const nextItem = findPendingItemInDomain(pendingItems, domain);
    if (nextItem) {
      return nextItem;
    }
  }

  // 4. If still nothing found (shouldn't happen), return first pending
  return pendingItems[0] ?? null;
}

/**
 * Get priority domains including related domains for high-severity ones
 */
function getPriorityDomains(highSeverityDomains: Dsm5Domain[]): Dsm5Domain[] {
  const prioritySet = new Set<Dsm5Domain>();

  // Add high severity domains first
  for (const domain of highSeverityDomains) {
    prioritySet.add(domain);
  }

  // Add related domains
  for (const domain of highSeverityDomains) {
    const related = RELATED_DOMAINS[domain] ?? [];
    for (const relatedDomain of related) {
      prioritySet.add(relatedDomain);
    }
  }

  // Convert to array, maintaining priority order
  return DOMAIN_PRIORITY_ORDER.filter((d) => prioritySet.has(d));
}

/**
 * Find the first pending item in a specific domain
 */
function findPendingItemInDomain(
  pendingItems: string[],
  domain: Dsm5Domain
): string | null {
  const domainItems = getItemsByDomain(domain);
  for (const item of domainItems) {
    if (pendingItems.includes(item.itemId)) {
      return item.itemId;
    }
  }
  return null;
}

// ============================================================================
// Coverage Tracking
// ============================================================================

/**
 * Get the coverage status for all domains
 */
export function getDomainCoverage(
  pendingItems: string[],
  completedItems: string[]
): DomainCoverage[] {
  const allDomains = getAllDomains();
  return allDomains.map((domain) => {
    const domainItems = getItemsByDomain(domain);
    const total = domainItems.length;
    const completed = domainItems.filter((item) =>
      completedItems.includes(item.itemId)
    ).length;
    const pending = domainItems.filter((item) =>
      pendingItems.includes(item.itemId)
    ).length;

    return {
      domain,
      totalItems: total,
      completedItems: completed,
      pendingItems: pending,
      isComplete: pending === 0,
      percentComplete: total > 0 ? (completed / total) * 100 : 100,
    };
  });
}

export interface DomainCoverage {
  domain: Dsm5Domain;
  totalItems: number;
  completedItems: number;
  pendingItems: number;
  isComplete: boolean;
  percentComplete: number;
}

/**
 * Get overall interview progress
 */
export function getInterviewProgress(
  pendingItems: string[],
  completedItems: string[]
): InterviewProgress {
  const totalItems = DSM5_LEVEL1_ITEMS.length;
  const completed = completedItems.length;
  const remaining = pendingItems.length;

  return {
    totalItems,
    completedItems: completed,
    remainingItems: remaining,
    percentComplete: totalItems > 0 ? (completed / totalItems) * 100 : 100,
    isComplete: remaining === 0,
  };
}

export interface InterviewProgress {
  totalItems: number;
  completedItems: number;
  remainingItems: number;
  percentComplete: number;
  isComplete: boolean;
}

// ============================================================================
// Item Utilities
// ============================================================================

/**
 * Get the item object by ID
 */
export function getItem(itemId: string): Dsm5Item | undefined {
  return DSM5_LEVEL1_ITEMS.find((item) => item.itemId === itemId);
}

/**
 * Get the domain for an item
 */
export function getItemDomain(itemId: string): Dsm5Domain | undefined {
  const item = getItem(itemId);
  return item?.domain as Dsm5Domain | undefined;
}

/**
 * Check if all items in a domain are complete
 */
export function isDomainComplete(
  domain: Dsm5Domain,
  completedItems: string[]
): boolean {
  const domainItems = getItemsByDomain(domain);
  return domainItems.every((item) => completedItems.includes(item.itemId));
}

/**
 * Get items that should be explored based on a high score in one item
 */
export function getSuggestedFollowUpItems(
  itemId: string,
  pendingItems: string[]
): string[] {
  const domain = getItemDomain(itemId);
  if (!domain) {
    return [];
  }

  // Get related domains
  const relatedDomains = RELATED_DOMAINS[domain] ?? [];

  // Find pending items in related domains
  const suggestions: string[] = [];
  for (const relatedDomain of relatedDomains) {
    const domainItems = getItemsByDomain(relatedDomain);
    for (const item of domainItems) {
      if (pendingItems.includes(item.itemId)) {
        suggestions.push(item.itemId);
      }
    }
  }

  return suggestions;
}
