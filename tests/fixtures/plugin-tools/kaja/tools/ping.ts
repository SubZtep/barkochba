export const pingTool = {
  definition: {
    type: "function",
    function: {
      name: "ping",
      description: "test plugin tool",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  execute: async () => "pong"
}

// Not a Tool — no `execute` — loadPluginTools should ignore this export.
export const notATool = 42
