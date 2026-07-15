import OpenAI from "openai"
import { config } from "./config"

const { openaiApiKey, openaiApiBaseUrl } = await config()

export const client = new OpenAI({
  apiKey: openaiApiKey,
  baseURL: openaiApiBaseUrl
})
