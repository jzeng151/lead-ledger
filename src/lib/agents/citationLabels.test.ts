import { describe, it, expect } from "vitest";
import { citationLabel } from "./citationLabels";

describe("citationLabel", () => {
  it("maps a Company/Contact/Tech field to a friendly label and its subagent", () => {
    expect(citationLabel("headcount")).toEqual({ label: "Headcount", agent: "Company" });
    expect(citationLabel("buyingRole")).toEqual({ label: "Buying role", agent: "Contact" });
    expect(citationLabel("competitorPresent")).toEqual({ label: "Competitor presence", agent: "Tech" });
  });

  it("renders news_<n> as a 1-indexed News signal", () => {
    expect(citationLabel("news_0")).toEqual({ label: "Signal 1", agent: "News" });
    expect(citationLabel("news_3")).toEqual({ label: "Signal 4", agent: "News" });
  });

  it("falls back to the raw ref with no agent for an unknown key", () => {
    expect(citationLabel("mysteryField")).toEqual({ label: "mysteryField", agent: "" });
  });
});
