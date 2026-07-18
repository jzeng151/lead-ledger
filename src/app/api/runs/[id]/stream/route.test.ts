import { describe, it, expect } from "vitest";

import { db, schema } from "@/db";
import { GET } from "./route";

const read = async (runId: string) => {
  const res = await GET(new Request(`http://test/api/runs/${runId}/stream`), {
    params: Promise.resolve({ id: runId }),
  });
  return await res.text();
};

describe("run stream for a run nothing is driving", () => {
  it("reports an error rather than a clean end", async () => {
    // status running, but no in-memory bus: the process that owned this run is
    // gone (a restart, a killed background task).
    db.insert(schema.runs)
      .values({ id: "st-orphan", contactId: "st-c", status: "running", startedAt: new Date() })
      .run();

    const body = await read("st-orphan");

    // stream_end alone reads as a successful finish in the live view, which would
    // show the contact as done with no score and no failure.
    expect(body).toContain("agent_error");
    expect(body).toContain("no longer being processed");
    expect(body).toContain("stream_end");
  });

  it("replays a finished run and ends cleanly", async () => {
    const now = new Date();
    db.insert(schema.runs).values({ id: "st-done", contactId: "st-c2", status: "scored", startedAt: now }).run();
    db.insert(schema.runEvents)
      .values({ runId: "st-done", agent: "orchestrator", type: "run_completed", payload: {}, ts: now })
      .run();

    const body = await read("st-done");

    expect(body).toContain("run_completed");
    expect(body).toContain("stream_end");
    expect(body).not.toContain("agent_error");
  });
});
