// Fixed value sets shared by the database, API validation, and the web app.
// Each list is defined once here so the three can never drift apart.

/** Feelings are scored from 1 (low) to 5 (high). */
export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

/** Who wrote a chat message. */
export const MESSAGE_ROLES = ["user", "assistant", "tool"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** What a confirmation card proposes. Phase 3 adds event_changes and event_type. */
export const PROPOSAL_KINDS = ["events", "profile"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** Where a proposal stands: waiting on the card, or decided by Save or Discard. */
export const PROPOSAL_STATUSES = ["pending", "saved", "discarded"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
