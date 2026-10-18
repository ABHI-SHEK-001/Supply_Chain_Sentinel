import { Router, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createMcpServer, type McpDeps } from "./mcp-server.js";

const methodNotAllowed = (res: Response): void => {
  res
    .status(405)
    .set("Allow", "POST")
    .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. This endpoint is stateless; use POST." }, id: null });
};

/**
 * Mounted at /mcp. Streamable HTTP in stateless mode: each request gets its own server and transport,
 * but all of them call the same service instances as the REST API.
 * Like the REST API, this endpoint has no authentication yet.
 */
export function createMcpRouter(deps: McpDeps): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const server = createMcpServer(deps);
    // The SDK documents `sessionIdGenerator: undefined` for stateless mode, but its types reject it (and the
    // transport as a `Transport`) under exactOptionalPropertyTypes, hence the two narrow casts.
    const options = { sessionIdGenerator: undefined } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0];
    const transport = new StreamableHTTPServerTransport(options);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  router.get("/", (_req, res) => methodNotAllowed(res));
  router.delete("/", (_req, res) => methodNotAllowed(res));
  return router;
}
