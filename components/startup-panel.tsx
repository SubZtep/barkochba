import { Box, Text } from "ink"
import { useEffect, useState } from "react"
import { t } from "../lib/i18n"
import { checkModelAvailability } from "../lib/model-check"
import type { ResolvedModel } from "../schemas/models"

type Availability = "pending" | "up" | "down"

function taskLabel(task: ResolvedModel["task"]) {
  switch (task) {
    case "chat":
      return t("startup.taskChat")
    case "text-to-speech":
      return t("startup.taskTts")
    case "speech-to-text":
      return t("startup.taskStt")
    case "embedding":
      return t("startup.taskEmbedding")
    case "rerank":
      return t("startup.taskRerank")
    case "image-generation":
      return t("startup.taskImageGen")
  }
}

// Display order for the grouped task sections, independent of the order
// models are merged in (models.toml entries land before config.json's stt,
// which would otherwise put stt before tts/image-generation). rerank sits
// right after embedding, mirroring the setup wizard's step order — the two
// are the halves of the same retrieval pipeline.
const TASK_ORDER: ResolvedModel["task"][] = [
  "chat",
  "embedding",
  "rerank",
  "text-to-speech",
  "speech-to-text",
  "image-generation"
]

const STATUS_ICON: Record<Availability, string> = {
  pending: "○",
  up: "✓",
  down: "✗"
}

const STATUS_COLOR: Record<Availability, string> = {
  pending: "gray",
  up: "green",
  down: "red"
}

// A provider can be slow to come up (e.g. a local speaches server still
// booting) — retry a failed check a few times before settling on "down".
const RETRY_DELAY_MS = 4000
const MAX_ATTEMPTS = 3

/**
 * Shown in the empty chat viewport before the first message: current
 * persona, every configured model grouped by task with a live reachability
 * check against its provider, and a one-line stats summary. Replaced by the
 * normal timeline as soon as the conversation starts.
 */
export function StartupPanel({
  persona,
  models,
  activeModelId,
  mcpServers = [],
  brainPath,
  cwd,
  sessionCount,
  memoryNoteCount,
  toolCount
}: {
  persona: string
  models: ResolvedModel[]
  /** Id of the chat model actually in use right now. Among chat-task models, only this one gets a live reachability check — the rest stay at their default "pending" icon. Non-chat tasks (tts, stt, embedding, image-generation) are always checked, since there's no notion of an "active" one among them. */
  activeModelId?: string
  mcpServers?: { id: string; toolCount: number }[]
  brainPath: string
  cwd: string
  sessionCount: number
  memoryNoteCount: number
  toolCount: number
}) {
  const [status, setStatus] = useState<Record<number, Availability>>({})

  useEffect(() => {
    let cancelled = false
    const timers: NodeJS.Timeout[] = []

    const attempt = (index: number, model: ResolvedModel, tries: number) => {
      checkModelAvailability(model).then((available) => {
        if (cancelled) return
        if (available) {
          setStatus((prev) => ({ ...prev, [index]: "up" }))
          return
        }
        if (tries < MAX_ATTEMPTS) {
          setStatus((prev) => ({ ...prev, [index]: "pending" }))
          timers.push(
            setTimeout(() => attempt(index, model, tries + 1), RETRY_DELAY_MS)
          )
          return
        }
        setStatus((prev) => ({ ...prev, [index]: "down" }))
      })
    }

    for (const [index, model] of models.entries())
      if (model.task !== "chat" || model.id === activeModelId)
        attempt(index, model, 1)

    return () => {
      cancelled = true
      for (const timer of timers) clearTimeout(timer)
    }
  }, [models, activeModelId])

  const grouped = models.reduce<Map<ResolvedModel["task"], number[]>>(
    (acc, model, index) => {
      const list = acc.get(model.task) ?? []
      list.push(index)
      acc.set(model.task, list)
      return acc
    },
    new Map()
  )

  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        {t("startup.persona")}
        <Text bold>{persona}</Text>
      </Text>
      <Text dimColor>
        {t("startup.cwd")}
        <Text bold>{cwd}</Text>
      </Text>
      {models.length === 0 ? (
        <Text dimColor>{t("startup.noModels")}</Text>
      ) : (
        <Box flexDirection="column">
          {[...grouped.entries()]
            .sort(([a], [b]) => TASK_ORDER.indexOf(a) - TASK_ORDER.indexOf(b))
            .map(([task, indices]) => (
              <Box key={task} flexDirection="column">
                <Text dimColor>{taskLabel(task)}</Text>
                {indices.map((index) => {
                  const model = models[index]!
                  const state = status[index] ?? "pending"
                  return (
                    <Text key={index}>
                      {"  "}
                      <Text color={STATUS_COLOR[state]}>
                        {STATUS_ICON[state]}
                      </Text>{" "}
                      {model.label ?? model.id}
                    </Text>
                  )
                })}
              </Box>
            ))}
        </Box>
      )}
      {mcpServers.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>{t("startup.mcpServers")}</Text>
          {mcpServers.map((server) => (
            <Text key={server.id}>
              {"  "}
              {server.id}{" "}
              <Text dimColor>
                {t("startup.mcpServerToolCount", { count: server.toolCount })}
              </Text>
            </Text>
          ))}
        </Box>
      )}
      <Text dimColor>
        {t("startup.stats", {
          brainPath,
          sessionCount,
          memoryNoteCount,
          toolCount
        })}
      </Text>
    </Box>
  )
}
