import { SCORE_MAX } from "@ai-wellness-coach/shared";

const typeLabel = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1).replaceAll("_", " ");

interface EventDetailsProps {
  type: string;
  summary: string;
  feelScore?: number | undefined;
  feelWords: readonly string[];
  tags: readonly string[];
  /** When it happened, such as "Yesterday, 6:00 AM"; left out when unknown. */
  when?: string | undefined;
}

/**
 * An event's type, summary, feel and tags. A confirmation card and the day
 * view both show events this way, so they read the same.
 */
export function EventDetails({
  type,
  summary,
  feelScore,
  feelWords,
  tags,
  when,
}: EventDetailsProps) {
  return (
    <>
      <p className="event-heading">
        <span className="event-type">{typeLabel(type)}</span>
        {when !== undefined && <span className="event-when">{when}</span>}
      </p>
      <p className="event-summary">{summary}</p>
      {(feelScore !== undefined || feelWords.length > 0) && (
        <p className="event-feel">
          Feeling
          {feelScore !== undefined &&
            ` ${String(feelScore)} of ${String(SCORE_MAX)}`}
          {feelWords.length > 0 && `: ${feelWords.join(", ")}`}
        </p>
      )}
      {tags.length > 0 && (
        <ul className="event-tags" aria-label="Tags">
          {tags.map((tag) => (
            <li key={tag}>{tag.replaceAll("_", " ")}</li>
          ))}
        </ul>
      )}
    </>
  );
}
