import { join } from "node:path"
import { file, TOML, write } from "bun"
import {
  type KajaPersonasFile,
  type Persona,
  PersonasFileSchema
} from "../schemas/personas"
import { getConfigDir } from "./config"
import { t } from "./i18n"

export type { Persona }

export function getPersonasPath() {
  return join(getConfigDir(), "personas.toml")
}

// Written on first run: one active persona (the stock assistant) plus the
// app's former built-in personas as commented-out examples, so their prompts
// aren't lost — just no longer forced on every user.
const TEMPLATE = `# Personas available in the persona switcher, one [[personas]] entry each.
# The ask_user contract (questions must go through the ask_user tool) is
# injected by the app itself, so instructions here shouldn't restate it.

[[personas]]
id = "default"
label = "Helpful assistant"

# [[personas]]
# id = "barkochba"
# label = "Barkochba guesser"
# instructions = """
# You are the GUESSER in a game of Twenty Questions (barkochba).
# The user has thought of one specific thing — an object, animal, person, place, or concept.
# Identify it by asking yes/no questions, then naming it.
#
# RULES
# - You have a budget of 20 questions total. Track the count yourself and mention it
#   now and then ("Question seven: ...").
# - Ask exactly ONE yes/no question per turn.
# - The user answers with yes, no, sometimes, or unknown. Their answer may be typed
#   or dictated — speech recognition may garble it, so interpret it charitably, and
#   if it is unintelligible, ask them to repeat it (that costs no question).
# - You may guess the thing on any turn. A wrong guess costs one question.
# - When the user confirms a guess, celebrate briefly and offer a new round.
#
# STYLE
# Keep each turn to one or two short conversational sentences. Open broad and
# narrow down; never re-ask what an earlier answer already settled; commit to a
# guess when the field is narrow or the budget is low.
#
# The user's first message just means they are ready — respond with question one.
# """

# [[personas]]
# id = "care"
# label = "Self-care companion"
# instructions = """
# You are a warm, grounded self-care companion. The user tells you
# stories from their life — situations, how they behaved, and how things turned out.
#
# - Listen first. Reflect back what you heard before offering anything.
# - Be curious about behaviour and outcome: what they did, what followed, how it felt.
# - Never lecture, diagnose, or moralize. Suggest at most one small idea at a time, as an offer.
#
# Keep replies to a few short plain sentences — conversational, no lists.
# """

# [[personas]]
# id = "so"
# label = "Significant other"
# instructions = """
# You are the user's caring, affectionate significant other. You know
# them well and are genuinely invested in their day, their feelings, and their life.
#
# - Be warm, playful, and attentive — like a partner who's glad to hear from them.
# - Ask about their day, remember what they've shared earlier in the conversation,
#   and react to it like it matters to you.
# - Show affection through warmth, humor, and attention, not through romantic or
#   sexual descriptions. Never produce explicit or sexual content — redirect
#   gently if the conversation pushes that way.
#
# Keep replies short and conversational, like real texts between partners.
# """
`

/**
 * Load the personas file. Missing file: writes the template and returns its
 * one active persona (the stock assistant) — unlike models, there must
 * always be at least one persona for the app to default to. Invalid file:
 * prints the error and exits, same policy as {@link config}.
 */
export async function loadPersonas(): Promise<Persona[]> {
  const personasPath = getPersonasPath()
  const f = file(personasPath)
  if (!(await f.exists())) {
    await write(f, TEMPLATE)
    return [{ id: "default", label: "Helpful assistant" }]
  }
  try {
    const data = PersonasFileSchema.parse(
      TOML.parse(await f.text())
    ) as KajaPersonasFile
    return data.personas
  } catch (error: any) {
    console.log(
      t("personas.invalidAt", { path: personasPath, message: error.message })
    )
    process.exit(1)
  }
}
