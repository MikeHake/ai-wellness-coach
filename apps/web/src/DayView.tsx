import {
  addDays,
  type DayEntry,
  type DayResponse,
  DayResponseSchema,
  localToday,
} from "@ai-wellness-coach/shared";
import { useEffect, useState } from "react";
import { useApi } from "./api.js";
import { dayLabel, shortDateLabel, timeLabel } from "./event-when-label.js";
import { EventDetails } from "./EventDetails.js";

const EMPTY_MESSAGE =
  "Nothing here yet for this day. Tell the coach how it went and it will show up here.";

type DayState =
  | { status: "loading" }
  | { status: "ready"; day: DayResponse }
  | { status: "error" };

/** "Told the coach yesterday at 9:14 AM", for an entry told on another day. */
function toldNote(entry: DayEntry, today: string): string {
  const label = dayLabel(entry.createdOn, today);
  const when =
    label === "Today" || label === "Yesterday"
      ? label.toLowerCase()
      : `on ${label}`;
  return `Told the coach ${when} at ${timeLabel(entry.createdTime)}`;
}

/**
 * A read-only look at one day: what the person told the coach, in their own
 * words, and the events the coach saved from it. Corrections happen in chat.
 */
export function DayView({ timeZone }: { timeZone: string }) {
  const api = useApi();
  const today = localToday(timeZone, new Date());
  const [date, setDate] = useState(today);
  const [state, setState] = useState<DayState>({ status: "loading" });

  function goTo(next: string) {
    setDate(next);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await api(`/days/${date}`);
        if (!res.ok)
          throw new Error(`GET /days failed with ${String(res.status)}`);
        const day = DayResponseSchema.parse(await res.json());
        if (!cancelled) setState({ status: "ready", day });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [api, date]);

  const label = dayLabel(date, today);
  return (
    <section className="day" aria-label="Your day">
      <nav className="day-nav" aria-label="Choose a day">
        <button
          type="button"
          onClick={() => {
            goTo(addDays(date, -1));
          }}
        >
          <span aria-hidden="true">‹ </span>Previous day
        </button>
        <h2 className="day-heading">
          {label}
          {label !== shortDateLabel(date) && (
            <span className="day-date">{shortDateLabel(date)}</span>
          )}
        </h2>
        <button
          type="button"
          disabled={date >= today}
          onClick={() => {
            goTo(addDays(date, 1));
          }}
        >
          Next day<span aria-hidden="true"> ›</span>
        </button>
      </nav>

      {state.status === "loading" && (
        <p className="chat-status">Loading your day...</p>
      )}
      {state.status === "error" && (
        <p className="chat-status" role="alert">
          We couldn't load this day right now. Please try again in a moment.
        </p>
      )}
      {state.status === "ready" && state.day.entries.length === 0 && (
        <p className="day-empty">{EMPTY_MESSAGE}</p>
      )}
      {state.status === "ready" && state.day.entries.length > 0 && (
        <ol className="day-entries">
          {state.day.entries.map((entry) => (
            <li key={entry.id} className="day-entry">
              <p className="day-entry-text">{entry.text}</p>
              {entry.createdOn !== date && (
                <p className="day-entry-note">{toldNote(entry, today)}</p>
              )}
              {entry.events.length > 0 && (
                <ul className="proposal-events">
                  {entry.events.map((event) => (
                    <li key={event.id} className="proposal-event">
                      <EventDetails
                        type={event.type}
                        summary={event.summary}
                        feelScore={event.feelScore}
                        feelWords={event.feelWords}
                        tags={event.tags}
                        when={
                          event.localTime === undefined
                            ? undefined
                            : timeLabel(event.localTime)
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
