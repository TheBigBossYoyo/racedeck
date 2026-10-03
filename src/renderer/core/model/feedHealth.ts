/**
 * Enrichment-progress and feed-quality shapes. `SystemStatus` (an engine) turns
 * them into user-facing rows, so they live in the neutral model rather than next
 * to the providers that measure them (`ProviderDiagnostics`, which bundles them,
 * stays in `core/providers/types.ts`, which also re-exports these).
 */

/**
 * What the provider can truthfully say about one enrichment feed. The main
 * process streams chunks without announcing a total point count, so the only
 * measurable extent is how far along the SESSION TIMELINE the applied points
 * reach (`coveredSeconds`) against the session length core timing established.
 */
export interface EnrichmentFeedProgress {
  /** `pending`: not requested yet. `failed`: gave up (see `enrichmentIssue`). */
  state: 'pending' | 'loading' | 'done' | 'failed'
  /** Points received and applied so far. */
  pointsApplied: number
  /** Session time (s) of the newest applied point; null until one has arrived. */
  coveredSeconds: number | null
}

export interface EnrichmentProgress {
  position: EnrichmentFeedProgress
  carData: EnrichmentFeedProgress
  /** Session length (s) from core timing; null when not known — never estimated. */
  totalSeconds: number | null
}

/** One kind of unexpected value seen in a feed, with how often and against how many checks. */
export interface FeedAnomalyReason {
  /** Noun phrase, e.g. "non-numeric lap time". */
  problem: string
  count: number
  /** Values of this kind inspected in total (the denominator for `count`). */
  checked: number
  /** The first one seen, e.g. `#44 LastLapTime: "OUT"`; null only if none was captured. */
  example: string | null
}

export interface FeedAnomalies {
  feed: string
  anomalies: number
  /** Most frequent first. */
  reasons: FeedAnomalyReason[]
}

/**
 * Shape anomalies counted at the provider boundary (wrong-typed or missing feed
 * values). Purely descriptive: the data itself is never altered because of them.
 * `feeds` lists only feeds with at least one anomaly, most affected first.
 */
export interface FeedQualityReport {
  totalAnomalies: number
  feeds: FeedAnomalies[]
}
