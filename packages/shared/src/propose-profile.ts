import { z } from "zod";
import { PROPOSAL_STATUSES, type ProposalStatus } from "./values.js";

export const NAME_MAX_LENGTH = 50;

const name = () => z.string().trim().min(1).max(NAME_MAX_LENGTH);

/**
 * The input of the propose_profile tool, and the draft stored in `proposal`.
 * Save parses the stored draft with this same schema before applying it.
 * The descriptions become part of the model's tool definition.
 */
export const ProposeProfileSchema = z.object({
  firstName: name().describe(
    "The first name the person asked to be called, as they wrote it.",
  ),
  lastName: name()
    .optional()
    .describe("Their last name, only if they gave it. Leave it out otherwise."),
});
export type ProposeProfile = z.infer<typeof ProposeProfileSchema>;

/** A confirmation card for a propose_profile draft. */
export const ProfileProposalViewSchema = ProposeProfileSchema.extend({
  kind: z.literal("profile"),
  toolCallId: z.string(),
  status: z.enum(PROPOSAL_STATUSES),
});
export type ProfileProposalView = z.infer<typeof ProfileProposalViewSchema>;

export function toProfileProposalView(
  toolCallId: string,
  status: ProposalStatus,
  draft: ProposeProfile,
): ProfileProposalView {
  return { kind: "profile", toolCallId, status, ...draft };
}
