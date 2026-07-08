import OpenAI from "openai"

export const client = new OpenAI({
	apiKey: process.env.FIREWORKS_API_KEY,
	baseURL: process.env.OPENAI_API_BASE_URL
})
