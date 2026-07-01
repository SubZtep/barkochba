import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";

const client = new OpenAI({
  apiKey: process.env.FIREWORKS_API_KEY,
  baseURL: "https://api.fireworks.ai/inference/v1",
});

const MODEL = "accounts/fireworks/models/minimax-m3";
const MAX_Q = 20;

const GUESSER_SYSTEM = `You are the GUESSER in a game of Twenty Questions.

GOAL
The user has thought of one specific thing — an object, animal, person, place, or concept. Identify it by asking yes/no questions, then naming it.

RULES
- You have a budget of 20 questions total.
- Ask exactly ONE question per turn.
- Every question must be answerable by yes/no.
- The user answers one of: Yes, No, Sometimes, Unknown.
  - "Sometimes" = partially / depends. "Unknown" = user can't say or it's irrelevant.
- You may guess the thing on any turn. A wrong guess consumes one question from your budget.
- WIN: you name the thing correctly within 20 questions.
- LOSE: 20 questions pass without a correct guess.

STRATEGY
- Open broad, then narrow: each question should split the remaining possibility space roughly in half (e.g. physical vs abstract, living vs non-living, man-made vs natural).
- Always use earlier answers. Never ask something already settled or implied.
- Track how many questions remain. Don't waste them on low-information questions.
- When the field is narrow or budget is low, commit to a guess instead of probing further.
- Treat "Sometimes" / "Unknown" as weak signal, not a dead end.`;

const GuesserSchema = z.object({
  reasoning: z.string(),
  type: z.enum(["question", "guess"]),
  text: z.string(),
});
type GuesserReply = z.infer<typeof GuesserSchema>;

const AnswerSchema = z.object({
  answer: z.enum(["Yes", "No", "Sometimes", "Unknown"]),
});

const answererSystem = (secret: string) =>
  `You are the ANSWERER in a game of Twenty Questions. The secret thing is: "${secret}".

RULES
- Answer every yes/no question truthfully and concisely about "${secret}".
- Reply with one of: Yes / No / Sometimes / Unknown
  - "Sometimes" if it's situational or partially true.
  - "Unknown" only if genuinely unanswerable.
- When asked to confirm a guess, reply Yes if it matches "${secret}" (case-insensitive, close synonyms count), otherwise No.`;

async function callGuesser(messages: OpenAI.ChatCompletionMessageParam[]): Promise<GuesserReply> {
  const res = await client.chat.completions.parse({
    model: MODEL,
    max_tokens: 500,
    messages: [{ role: "system", content: GUESSER_SYSTEM }, ...messages],
    response_format: zodResponseFormat(GuesserSchema, "reply"),
  });
  const parsed = res.choices[0]?.message.parsed;
  if (!parsed) throw new Error("Guesser returned no parsed content");
  return parsed;
}

async function callAnswerer(
  messages: OpenAI.ChatCompletionMessageParam[],
  system: string,
): Promise<string> {
  const res = await client.chat.completions.parse({
    model: MODEL,
    max_tokens: 100,
    messages: [{ role: "system", content: system }, ...messages],
    response_format: zodResponseFormat(AnswerSchema, "answer"),
  });
  const parsed = res.choices[0]?.message.parsed;
  if (!parsed) throw new Error("Answerer returned no parsed content");
  return parsed.answer;
}

async function main() {
  const rl = readline.createInterface({ input, output });
  const secret = (await rl.question("What is the secret thing? ")).trim();
  rl.close();

  if (!secret) { console.error("No secret provided."); process.exit(1); }

  console.log(`\nSecret: "${secret}" — starting game...\n`);

  const answSys = answererSystem(secret);
  const guesserMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "user", content: "I've thought of something. Start asking." },
  ];
  const answererMessages: OpenAI.ChatCompletionMessageParam[] = [];

  let asked = 0;

  while (true) {
    const reply = await callGuesser(guesserMessages);
    guesserMessages.push({ role: "assistant", content: JSON.stringify(reply) });

    if (reply.type === "guess") {
      answererMessages.push({ role: "user", content: `Is the answer "${reply.text}"?` });
      const confirmation = await callAnswerer(answererMessages, answSys);
      answererMessages.push({ role: "assistant", content: JSON.stringify({ answer: confirmation }) });

      const correct = confirmation === "Yes";
      console.log(`Guess: ${reply.text} → ${confirmation}`);

      if (correct) {
        console.log(`\nGuesser wins in ${asked} question${asked === 1 ? "" : "s"}!`);
        break;
      }

      asked++;
      if (asked >= MAX_Q) { console.log("\nOut of budget — answerer wins."); break; }
      guesserMessages.push({ role: "user", content: "No, wrong guess." });
      continue;
    }

    asked++;
    answererMessages.push({ role: "user", content: reply.text });
    const answer = await callAnswerer(answererMessages, answSys);
    answererMessages.push({ role: "assistant", content: JSON.stringify({ answer }) });

    console.log(`Q${asked}/${MAX_Q}: ${reply.text}`);
    console.log(`  → ${answer}`);
    if (reply.reasoning) console.log(`  (reasoning: ${reply.reasoning})`);
    console.log();

    guesserMessages.push({ role: "user", content: answer });

    if (asked >= MAX_Q) {
      guesserMessages.push({ role: "user", content: "That was question 20. Output a final guess now." });
      const final = await callGuesser(guesserMessages);

      answererMessages.push({ role: "user", content: `Is the answer "${final.text}"?` });
      const confirmation = await callAnswerer(answererMessages, answSys);
      const correct = confirmation === "Yes";

      console.log(`Final guess: ${final.text} → ${confirmation}`);
      console.log(correct ? "\nGuesser wins on the wire!" : "\nAnswerer wins.");
      break;
    }
  }
}

main().catch(console.error);
