/**
 * First-run / invalid-config setup wizard. Steps are grouped by service;
 * fields validate against KajaConfigSchema per keystroke and a step can't
 * advance until its fields pass.
 *
 * Key routing: Enter is owned by TextInput.onSubmit (next field, or next
 * step on the last), a step-level useInput owns Tab (switch field) and
 * Escape (back/cancel). TextInput ignores both.
 */

import { Box, render, Text, useInput } from "ink"
import { useState } from "react"
import { configPath, saveConfig } from "../lib/config"
import {
  type KajaConfig,
  KajaConfigSchema,
  KajaSettingsSchema
} from "../schemas/config"
import { TextInput } from "./elem/text-input"

type FieldName = Exclude<keyof KajaConfig, "settings">

const FIELDS: Record<FieldName, { label: string; placeholder: string }> = {
  openaiApiBaseUrl: {
    label: "OpenAI-compatible base URL",
    placeholder: "https://api.fireworks.ai/inference/v1"
  },
  openaiApiKey: { label: "API key", placeholder: "fw_..." },
  openaiApiModel: {
    label: "Model id",
    placeholder: "accounts/fireworks/models/minimax-m3"
  },
  braveApiKey: { label: "Brave Search API key", placeholder: "BSA..." },
  geoServiceUrl: {
    label: "Geo service URL",
    placeholder: "https://few-booklet-31770.ondis.co/"
  },
  geoServiceApiKey: {
    label: "Geo service API key (UUID)",
    placeholder: "019ea05a-eacc-7ce7-8af9-e0cbf842d483"
  }
}

const GROUPS: { name: string; fields: FieldName[] }[] = [
  {
    name: "LLM",
    fields: ["openaiApiBaseUrl", "openaiApiKey", "openaiApiModel"]
  },
  { name: "Brave Search", fields: ["braveApiKey"] },
  { name: "Geo service", fields: ["geoServiceUrl", "geoServiceApiKey"] }
]

const STEP_NAMES = [...GROUPS.map((g) => g.name), "Review"]

function fieldError(field: FieldName, value: string): string | null {
  const result = KajaConfigSchema.shape[field].safeParse(value)
  return result.success ? null : (result.error.issues[0]?.message ?? "Invalid")
}

function stepValid(fields: FieldName[], values: Record<FieldName, string>) {
  return fields.every((f) => fieldError(f, values[f]) === null)
}

type Values = Record<FieldName, string>
type Outcome = "saved" | "cancelled"

function Progress({ step }: { step: number }) {
  return (
    <Box marginBottom={1}>
      {STEP_NAMES.map((name, i) => (
        <Text
          key={name}
          color={i < step ? "green" : undefined}
          bold={i === step}
          dimColor={i > step}
        >
          {i < step ? "✓" : i === step ? "●" : "○"} {name}
          {i < STEP_NAMES.length - 1 ? "  " : ""}
        </Text>
      ))}
    </Box>
  )
}

function StepFields({
  fields,
  values,
  setValues,
  onNext,
  onBack
}: {
  fields: FieldName[]
  values: Values
  setValues: (update: (prev: Values) => Values) => void
  onNext: () => void
  onBack: () => void
}) {
  const [focusIndex, setFocusIndex] = useState(0)
  // Set when advancing was blocked: from then on errors show even on blank
  // untouched fields.
  const [attempted, setAttempted] = useState(false)

  useInput((_input, key) => {
    if (key.tab) {
      const delta = key.shift ? fields.length - 1 : 1
      setFocusIndex((i) => (i + delta) % fields.length)
    } else if (key.escape) {
      onBack()
    }
  })

  const submit = (index: number) => {
    if (index < fields.length - 1) {
      setFocusIndex(index + 1)
    } else if (stepValid(fields, values)) {
      onNext()
    } else {
      setAttempted(true)
      setFocusIndex(fields.findIndex((f) => fieldError(f, values[f]) !== null))
    }
  }

  return (
    <Box flexDirection="column">
      {fields.map((field, i) => {
        const error = fieldError(field, values[field])
        const focused = i === focusIndex
        // Blank untouched fields stay quiet until a blocked advance; anything
        // typed (or prefilled) gets immediate feedback.
        const showError = error !== null && (attempted || values[field] !== "")
        return (
          <Box key={field} flexDirection="column">
            <Text bold={focused} dimColor={!focused}>
              {FIELDS[field].label}
            </Text>
            <Box>
              <Text dimColor={!focused}>{focused ? "> " : "  "}</Text>
              <TextInput
                value={values[field]}
                focus={focused}
                onChange={(next) =>
                  setValues((prev) => ({ ...prev, [field]: next }))
                }
                onSubmit={() => submit(i)}
                placeholder={FIELDS[field].placeholder}
              />
            </Box>
            {showError && <Text color="red"> {error}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

function ReviewStep({
  values,
  onConfirm,
  onBack
}: {
  values: Values
  onConfirm: () => void
  onBack: () => void
}) {
  useInput((_input, key) => {
    if (key.return) onConfirm()
    else if (key.escape) onBack()
  })

  return (
    <Box flexDirection="column">
      {(Object.keys(FIELDS) as FieldName[]).map((field) => (
        <Box key={field}>
          <Text dimColor>{FIELDS[field].label}: </Text>
          <Text>{values[field]}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color="green">Enter: save and start · Esc: back</Text>
      </Box>
    </Box>
  )
}

function ConfigWizard({
  initial,
  onFinish
}: {
  initial: Partial<KajaConfig>
  onFinish: (outcome: Outcome) => void
}) {
  // 0..GROUPS.length-1 are field steps, GROUPS.length is the review step.
  const [step, setStep] = useState(0)
  const [values, setValues] = useState<Values>(() => {
    const out = {} as Values
    for (const field of Object.keys(FIELDS) as FieldName[]) {
      const v = initial[field]
      out[field] = typeof v === "string" ? v : ""
    }
    return out
  })

  const save = async () => {
    // Keep an existing valid settings block (thinking/sounds/voice) so an
    // invalid-config fixup doesn't drop in-app preferences.
    const settings = KajaSettingsSchema.safeParse(initial.settings)
    await saveConfig({
      ...values,
      ...(settings.success && initial.settings
        ? { settings: settings.data }
        : {})
    })
    onFinish("saved")
  }

  const group = GROUPS[step]

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Kaja setup</Text>
      <Text dimColor>{configPath}</Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderDimColor
        paddingX={1}
        marginTop={1}
      >
        <Progress step={step} />
        {group ? (
          <StepFields
            // Remount per step so field focus starts fresh.
            key={step}
            fields={group.fields}
            values={values}
            setValues={setValues}
            onNext={() => setStep(step + 1)}
            onBack={() =>
              step === 0 ? onFinish("cancelled") : setStep(step - 1)
            }
          />
        ) : (
          <ReviewStep
            values={values}
            onConfirm={save}
            onBack={() => setStep(step - 1)}
          />
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Enter next · Tab switch field · Esc back/cancel</Text>
      </Box>
    </Box>
  )
}

export async function runConfigWizard(
  initial: Partial<KajaConfig>
): Promise<Outcome> {
  let outcome: Outcome = "cancelled"
  // Primary buffer, default keyboard protocol: the wizard needs neither
  // alternate screen nor kitty, and the app's own render() sets both up after.
  const instance = render(
    <ConfigWizard
      initial={initial}
      onFinish={(o) => {
        outcome = o
        instance.unmount()
      }}
    />
  )
  await instance.waitUntilExit()
  return outcome
}
