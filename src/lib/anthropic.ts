import Anthropic from "@anthropic-ai/sdk";
// Constructed on first use, not at import. The SDK throws when ANTHROPIC_API_KEY
// is absent, and a top-level construction makes that throw during module load of
// /api/runs or /api/sync, before runContact can create the run row. Deferring it
// pushes the auth failure into the run lifecycle, where it is recorded and
// streamed like any other run error.
let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}
