import { describe, expect, it } from "vitest";
import { createBackgroundTracker } from "./background.js";

describe("createBackgroundTracker", () => {
  it("settles only after every piece of work finishes, even failures", async () => {
    const { background, settled } = createBackgroundTracker();
    const order: string[] = [];
    let release!: () => void;
    background(
      new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => order.push("slow work")),
    );
    background(Promise.reject(new Error("failed work")));

    const done = settled().then(() => order.push("settled"));
    await Promise.resolve();
    expect(order).toEqual([]);

    release();
    await done;
    expect(order).toEqual(["slow work", "settled"]);
  });

  it("settles right away with nothing registered", async () => {
    await expect(createBackgroundTracker().settled()).resolves.toBeUndefined();
  });
});
