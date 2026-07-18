import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  CompanyFindings,
  ContactFindings,
  TechFindings,
  NewsFindings,
  EngagementFindings,
  VerificationFindings,
  IcpFitFindings,
  SynthesisOutput,
} from "./schemas";

// Every findings schema becomes the input schema of that agent's submit_findings
// tool, which the SDK serializes to JSON Schema. Anything unrepresentable there
// (a .transform(), most obviously) does not fail a unit test or a typecheck: it
// fails at run time, when the agent tries to submit, and takes the whole contact
// run with it. This asserts the conversion the SDK performs.
const SCHEMAS: [string, z.ZodTypeAny][] = [
  ["CompanyFindings", CompanyFindings],
  ["ContactFindings", ContactFindings],
  ["TechFindings", TechFindings],
  ["NewsFindings", NewsFindings],
  ["EngagementFindings", EngagementFindings],
  ["VerificationFindings", VerificationFindings],
  ["IcpFitFindings", IcpFitFindings],
  ["SynthesisOutput", SynthesisOutput],
];

describe("agent schemas convert to JSON Schema", () => {
  for (const [name, schema] of SCHEMAS) {
    it(name, () => {
      expect(() => z.toJSONSchema(schema)).not.toThrow();
    });
  }
});
