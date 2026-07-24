import * as z from "zod"

const McpServerSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({})
})

export const McpFileSchema = z.object({
  servers: z.array(McpServerSchema).default([])
})

export type KajaMcpFile = z.infer<typeof McpFileSchema>
export type McpServerEntry = z.infer<typeof McpServerSchema>
