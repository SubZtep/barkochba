import Anthropic from "@anthropic-ai/sdk";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const client = new Anthropic({
  apiKey: process.env.FIREWORKS_API_KEY,
  baseURL: "https://api.fireworks.ai/inference",
});

const MODEL = "accounts/fireworks/models/minimax-m3"; // swap freely
const MAX_Q = 20;

const SYSTEM = `You are the GUESSER in a game of Twenty Questions.

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
- Treat "Sometimes" / "Unknown" as weak signal, not a dead end.

OUTPUT — respond with ONLY a JSON object, no markdown, no extra text:
{"reasoning":"brief deduction from answers so far","type":"question"|"guess","text":"your question or your single guess"}`;

type Reply = { reasoning?: string; type: "question" | "guess"; text: string };

function parse(raw: string): Reply {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned) as Reply;
}

async function model(messages: Anthropic.MessageParam[]): Promise<Reply> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: SYSTEM,
    messages,
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return parse(text);
}

async function main() {
  const rl = readline.createInterface({ input, output });
  const ask = (q: string) => rl.question(q);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "I've thought of something. Start asking." },
  ];

  console.log("Think of something. Answer with: yes / no / sometimes / unknown.\n");

  let asked = 0;
  while (true) {
    const reply = await model(messages);
    messages.push({ role: "assistant", content: JSON.stringify(reply) });

    if (reply.type === "guess") {
      const ok = (await ask(`Guess: ${reply.text} — correct? (y/n) `)).trim().toLowerCase();
      if (ok.startsWith("y")) { console.log(`\nWon in ${asked} questions.`); break; }
      asked++;
      if (asked >= MAX_Q) { console.log("\nOut of budget — you win."); break; }
      messages.push({ role: "user", content: "No, wrong guess." });
      continue;
    }

    asked++;
    const ans = (await ask(`Q${asked}/${MAX_Q}: ${reply.text} `)).trim();
    messages.push({ role: "user", content: ans || "unknown" });

    if (asked >= MAX_Q) {
      messages.push({ role: "user", content: "That was question 20. Output a final guess now." });
      const final = await model(messages);
      const ok = (await ask(`Final guess: ${final.text} — correct? (y/n) `)).trim().toLowerCase();
      console.log(ok.startsWith("y") ? "\nWon on the wire." : "\nYou win.");
      break;
    }
  }
  rl.close();
}

main().catch(console.error);

