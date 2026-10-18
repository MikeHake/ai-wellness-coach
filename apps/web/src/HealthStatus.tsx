import { HealthResponseSchema } from "@ai-wellness-coach/shared";
import { useEffect, useState } from "react";

type Status = "checking" | "connected" | "unreachable";

export function HealthStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    const controller = new AbortController();

    async function check() {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/health`, {
          signal: controller.signal,
        });
        const parsed = HealthResponseSchema.safeParse(await res.json());
        setStatus(parsed.success ? "connected" : "unreachable");
      } catch {
        if (!controller.signal.aborted) {
          setStatus("unreachable");
        }
      }
    }

    void check();
    return () => {
      controller.abort();
    };
  }, []);

  if (status === "checking") {
    return <p>Checking in with the API...</p>;
  }
  if (status === "connected") {
    return <p>Connected to the API. You're all set!</p>;
  }
  return <p>Can't reach the API right now. Give it another try in a moment.</p>;
}
