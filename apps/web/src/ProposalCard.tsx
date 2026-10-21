import {
  type EventsProposalView,
  type ProposalStatus,
  ProposalDecisionResponseSchema,
  SCORE_MAX,
} from "@ai-wellness-coach/shared";
import { useState } from "react";
import { useApi } from "./api.js";
import { eventWhenLabel } from "./event-when-label.js";

const INVALID_MESSAGE =
  "I couldn't save this as it is. Tell me what to change and I'll draft it again.";
const FAILED_MESSAGE = "Something went wrong saving this. Please try again.";

type Problem = "invalid" | "failed" | null;

const typeLabel = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1).replaceAll("_", " ");

/**
 * A confirmation card for a propose_events draft. Save and Discard send only
 * the tool call id; the API saves the draft it stored, never anything from
 * the browser.
 */
export function ProposalCard({ proposal }: { proposal: EventsProposalView }) {
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

  const now = new Date();
  return (
    <article
      className={`proposal-card proposal-card-${status}`}
      aria-label="Drafted events"
    >
      <ul className="proposal-events">
        {proposal.events.map((event, i) => (
          <li key={i} className="proposal-event">
            <p className="proposal-event-heading">
              <span className="proposal-type">{typeLabel(event.type)}</span>
              <span className="proposal-when">
                {eventWhenLabel(event.occurredOn, event.localTime, now)}
              </span>
            </p>
            <p className="proposal-summary">{event.summary}</p>
            {(event.feelScore !== undefined || event.feelWords.length > 0) && (
              <p className="proposal-feel">
                Feeling
                {event.feelScore !== undefined &&
                  ` ${String(event.feelScore)} of ${String(SCORE_MAX)}`}
                {event.feelWords.length > 0 &&
                  `: ${event.feelWords.join(", ")}`}
              </p>
            )}
            {event.tags.length > 0 && (
              <ul className="proposal-tags" aria-label="Tags">
                {event.tags.map((tag) => (
                  <li key={tag}>{tag.replaceAll("_", " ")}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
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
      {status === "saved" && (
        <p className="proposal-status">Saved to your journal</p>
      )}
      {status === "discarded" && <p className="proposal-status">Discarded</p>}
      {status === "pending" && problem !== null && (
        <p className="proposal-problem" role="alert">
          {problem === "invalid" ? INVALID_MESSAGE : FAILED_MESSAGE}
        </p>
      )}
    </article>
  );
}
