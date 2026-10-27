import { z } from "zod";
import { ProfileProposalViewSchema } from "./propose-profile.js";
import { EventsProposalViewSchema } from "./propose-events.js";

/** Any confirmation card, told apart by its `kind`. */
export const ProposalViewSchema = z.discriminatedUnion("kind", [
  EventsProposalViewSchema,
  ProfileProposalViewSchema,
]);
export type ProposalView = z.infer<typeof ProposalViewSchema>;
