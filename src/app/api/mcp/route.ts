import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse } from "next/server";
import { buildMcpServer } from "@/lib/mcp";
import { authenticateMcp } from "@/lib/mcp-auth";

/*
 * Streamable HTTP MCP endpoint, stateless: each request gets a fresh server
 * bound to the token's business, answers in JSON, and is closed. It runs in
 * this process because the SQLite database is in-process.
 */
async function handle(request: Request): Promise<Response> {
  const auth = authenticateMcp(request.headers.get("authorization"));
  if (auth === "off") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (auth === "unauthorized") {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="relaydesk"' } },
    );
  }
  const server = buildMcpServer(auth.businessId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

export { handle as DELETE, handle as GET, handle as POST };
