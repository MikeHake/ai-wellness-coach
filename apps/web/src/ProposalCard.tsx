import {
  type EventsProposalView,
  type ProfileProposalView,
  type ProposalStatus,
  type ProposalView,
  ProposalDecisionResponseSchema,
} from "@ai-wellness-coach/shared";
import { useState } from "react";
import { useApi } from "./api.js";
import { eventWhenLabel } from "./event-when-label.js";
import { EventDetails } from "./EventDetails.js";

const INVALID_MESSAGE =
  "I couldn't save this as it is. Tell me what to change and I'll draft it again.";
const FAILED_MESSAGE = "Something went wrong saving this. Please try again.";

type Problem = "invalid" | "failed" | null;

const LABELS = {
  events: { card: "Drafted events", saved: "Saved to your journal" },
  profile: { card: "Drafted name", saved: "Name saved" },
} as const;

function DraftedEvents({ proposal }: { proposal: EventsProposalView }) {
  const now = new Date();
  return (
    <ul className="proposal-events">
      {proposal.events.map((event, i) => (
        <li key={i} className="proposal-event">
          <EventDetails
            type={event.type}
            summary={event.summary}
            feelScore={event.feelScore}
            feelWords={event.feelWords}
            tags={event.tags}
            when={eventWhenLabel(event.occurredOn, event.localTime, now)}
          />
        </li>
      ))}
    </ul>
  );
}

function DraftedName({
  proposal,
  status,
}: {
  proposal: ProfileProposalView;
  status: ProposalStatus;
}) {
  const name = [proposal.firstName, proposal.lastName]
    .filter((part) => part !== undefined)
    .join(" ");
  return (
    <p className="proposal-name">
      {status === "pending" ? `Save your name as ${name}?` : name}
    </p>
  );
}

/**
 * A confirmation card for a propose_* draft. Save and Discard send only the
 * tool call id; the API saves the draft it stored, never anything from the
 * browser.
 */
export function ProposalCard({ proposal }: { proposal: ProposalView }) {
  const api = useApi();
  const [status, setStatus] = useState<ProposalStatus>(proposal.status);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);

  async function decide(decision: "save" | "discard") {
    setBusy(true);
    setProblem(null);
    try {
      const res = await api(
        `/proposals/${encodeURIComponent(proposal.toolCallId)}/${decision}`,
        { method: "POST" },
      );
      if (res.status === 422) {
        setProblem("invalid");
        return;
      }
      // 200 is the decision we asked for; 409 means the other one was made
      // first (in another tab, say). Either way, show where it stands.
      const body = ProposalDecisionResponseSchema.safeParse(
        res.ok || res.status === 409 ? await res.json() : undefined,
      );
      if (body.success) setStatus(body.data.status);
      else setProblem("failed");
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  }

  const labels = LABELS[proposal.kind];
  return (
    <article
      className={`proposal-card proposal-card-${status}`}
      aria-label={labels.card}
    >
      {proposal.kind === "events" ? (
        <DraftedEvents proposal={proposal} />
      ) : (
        <DraftedName proposal={proposal} status={status} />
      )}
      {status === "pending" && (
        <div className="proposal-actions">
          {problem !== "invalid" && (
            <button
              type="button"
              className="proposal-save"
              disabled={busy}
              onClick={() => void decide("save")}
            >
              Save
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide("discard")}
          >
            Discard
          </button>
        </div>
      )}
      {status === "saved" && <p className="proposal-status">{labels.saved}</p>}
      {status === "discarded" && <p className="proposal-status">Discarded</p>}
      {status === "pending" && problem !== null && (
        <p className="proposal-problem" role="alert">
          {problem === "invalid" ? INVALID_MESSAGE : FAILED_MESSAGE}
        </p>
      )}
    </article>
  );
}
