import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";

describe("parseEnv", () => {
  it("applies defaults for an empty environment", () => {
    const env = parseEnv({});
    expect(env.PORT).toBe(4000);
    expect(env.FALKORDB_HOST).toBe("127.0.0.1");
    expect(env.FALKORDB_PORT).toBe(6379);
    expect(env.GRAPH_NAME).toBe("sentinel");
    expect(env.OSV_CONCURRENCY).toBe(4);
  });

  it("coerces numeric strings", () => {
    const env = parseEnv({ PORT: "5050", OSV_TIMEOUT_MS: "2500" });
    expect(env.PORT).toBe(5050);
    expect(env.OSV_TIMEOUT_MS).toBe(2500);
  });

  it("rejects an out-of-range port", () => {
    expect(() => parseEnv({ PORT: "70000" })).toThrow(/PORT/);
  });

  it("rejects an unsafe graph name", () => {
    expect(() => parseEnv({ GRAPH_NAME: "x; MATCH (n) DETACH DELETE n" })).toThrow(/GRAPH_NAME/);
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => parseEnv({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});