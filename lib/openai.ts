import OpenAI from "openai"
import { config } from "./config"

const { llm } = await config()

export const client = new OpenAI({
  apiKey: llm.apiKey,
  baseURL: llm.baseUrl
})
