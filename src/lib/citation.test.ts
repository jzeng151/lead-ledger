import { describe, it, expect } from "vitest";
import { checkCitations } from "./citation";

it("strips a claim with no sourced dossier field", () => {
  const dossier = { funding: { value: "Series B", confidence: 0.9, source: "gdelt" } };
  const rejected = new Set<string>();
  const r = checkCitations([{ text: "Series B", ref: "funding" }, { text: "IPO soon", ref: "ipo" }], dossier, rejected);
  expect(r.kept.map(c => c.ref)).toEqual(["funding"]);
  expect(r.stripped).toContain("ipo");
});

it("strips a claim whose ref was rejected by verification", () => {
  const dossier = { funding: { value: "Series B", confidence: 0.9, source: "gdelt" } };
  const rejected = new Set<string>(["funding"]);
  const r = checkCitations([{ text: "Series B", ref: "funding" }], dossier, rejected);
  expect(r.kept).toEqual([]);
  expect(r.stripped).toContain("funding");
});

it("strips a claim whose dossier field has no source", () => {
  const dossier: Record<string, { value: string; confidence: number; source?: string }> = {
    funding: { value: "Series B", confidence: 0.9 },
  };
  const rejected = new Set<string>();
  const r = checkCitations([{ text: "Series B", ref: "funding" }], dossier, rejected);
  expect(r.kept).toEqual([]);
  expect(r.stripped).toContain("funding");
});
