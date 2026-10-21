import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom doesn't implement scrolling; the chat scrolls to its newest message.
Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  cleanup();
});
