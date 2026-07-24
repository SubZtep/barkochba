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
  }
}

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

/**
 * Shown in the empty chat viewport before the first message: current
 * persona, every configured model grouped by task with a live reachability
 * check against its provider, and a one-line stats summary. Replaced by the
 * normal timeline as soon as the conversation starts.
 */
export function StartupPanel({
  persona,
  models,
  configPath,
  sessionCount,
  memoryNoteCount,
  toolCount
}: {
  persona: string
  models: ResolvedModel[]
  configPath: string
  sessionCount: number
  memoryNoteCount: number
  toolCount: number
}) {
  const [status, setStatus] = useState<Record<number, Availability>>({})

  useEffect(() => {
    let cancelled = false
    for (const [index, model] of models.entries()) {
      checkModelAvailability(model).then((available) => {
        if (cancelled) return
        setStatus((prev) => ({ ...prev, [index]: available ? "up" : "down" }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [models])

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
      {models.length === 0 ? (
        <Text dimColor>{t("startup.noModels")}</Text>
      ) : (
        <Box flexDirection="column">
          {[...grouped.entries()].map(([task, indices]) => (
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
      <Text dimColor>
        {t("startup.stats", {
          configPath,
          sessionCount,
          memoryNoteCount,
          toolCount
        })}
      </Text>
    </Box>
  )
}
