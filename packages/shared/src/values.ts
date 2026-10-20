// Fixed value sets shared by the database, API validation, and the web app.
// Each list is defined once here so the three can never drift apart.

/** Feelings are scored from 1 (low) to 5 (high). */
export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

/** Who wrote a chat message. */
export const MESSAGE_ROLES = ["user", "assistant", "tool"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];
