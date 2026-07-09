import { join } from "node:path"
import { client } from "./openai"
import { fetchSpeech } from "./tts"

const soundFile = {
	bell: "333695__khrinx__thin-bell-ding-2.wav",
	magic: "628548__gmlh__icemagic.mp3",
	wind: "817959__jriches1__whoosh-away.mp3",
  hehe: "818171__sadiquecat__sadiquecat-mke600-laughing-nervous-laugh-hehe.wav"
} as const

export function playSound(sound: keyof typeof soundFile) {
	Bun.spawn([
		"pw-play",
		join(import.meta.dirname, "..", "assets", soundFile[sound])
	])
}

async function isCommandSafe(command: string): Promise<boolean> {
	const completion = await client.chat.completions.create({
		model: process.env.OPENAI_API_MODEL_REASONING!,
		temperature: 0,
		messages: [
			{
				role: "system",
				content:
					'You are a security check for shell commands about to run on a user\'s machine. Reply with only "safe" if the command is not harmful and cannot destroy or lose data, or "unsafe" otherwise. No other text.'
			},
			{ role: "user", content: command }
		]
	})
	const verdict = completion.choices[0]?.message.content?.trim().toLowerCase()
	return verdict === "safe"
}

export async function runProposedCommand(
	command: string,
	explanation: string,
	speak: (text: string) => Promise<void>
) {
	console.log(`\n[proposed command] ${command}\n[explanation] ${explanation}`)
	await speak(explanation)
	if (!(await isCommandSafe(command))) {
		const answer = prompt(`Run this command? (y/N)\n${command}`) ?? ""
		if (!/^y(es)?$/i.test(answer.trim())) {
			return "User declined to run the command."
		}
	}
	const proc = Bun.spawn(["sh", "-c", command], {
		stdout: "pipe",
		stderr: "pipe"
	})
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	])
	return JSON.stringify({ exitCode, stdout, stderr })
}

export async function saySomething(text: string) {
	const res = await fetchSpeech(text)
	console.log(`TTS: ${text}`, res)
}
