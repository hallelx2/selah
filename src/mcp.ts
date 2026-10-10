import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { callTool, TOOLS, type ToolContext } from "./agent/tools"

/**
 * `selah mcp`: Selah's data as a Model Context Protocol server over stdio, so Codex, Claude
 * Code or any MCP client can read passages, search, consult Matthew Henry and see what the
 * reader is studying.
 */
export async function runMcpServer(ctx: ToolContext, version: string) {
  const server = new McpServer(
    { name: "selah", version },
    { instructions: "Bible passages, search, Matthew Henry's Commentary and the reader's own notes and reading context, from Selah." },
  )
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.shape, annotations: { readOnlyHint: true, openWorldHint: false } },
      async (args: Record<string, unknown>) => {
        const r = callTool(ctx, tool.name, args)
        return { content: [{ type: "text" as const, text: r.text }], isError: r.isError }
      },
    )
  }
  await server.connect(new StdioServerTransport())
}
