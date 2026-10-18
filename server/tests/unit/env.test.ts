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

  it("parses FalkorDB Cloud credentials and TLS flags", () => {
    const env = parseEnv({
      FALKORDB_HOST: "sentinel-cluster.falkordb.cloud",
      FALKORDB_PORT: "12345",
      FALKORDB_USERNAME: "sentinel_admin",
      FALKORDB_PASSWORD: "secret_password",
      FALKORDB_TLS: "true",
      GRAPH_NAME: "supplychain_sentinel",
    });
    expect(env.FALKORDB_HOST).toBe("sentinel-cluster.falkordb.cloud");
    expect(env.FALKORDB_PORT).toBe(12345);
    expect(env.FALKORDB_USERNAME).toBe("sentinel_admin");
    expect(env.FALKORDB_PASSWORD).toBe("secret_password");
    expect(env.FALKORDB_TLS).toBe(true);
    expect(env.GRAPH_NAME).toBe("supplychain_sentinel");
  });

  it("normalizes empty string credentials to undefined", () => {
    const env = parseEnv({
      FALKORDB_USERNAME: "",
      FALKORDB_PASSWORD: "   ",
      FALKORDB_URL: "",
    });
    expect(env.FALKORDB_USERNAME).toBeUndefined();
    expect(env.FALKORDB_PASSWORD).toBeUndefined();
    expect(env.FALKORDB_URL).toBeUndefined();
  });

  it("prevents production from defaulting to 127.0.0.1", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(/FALKORDB_HOST/);
  });

  it("accepts remote host in production", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      FALKORDB_HOST: "my-cluster.falkordb.cloud",
    });
    expect(env.FALKORDB_HOST).toBe("my-cluster.falkordb.cloud");
  });
});