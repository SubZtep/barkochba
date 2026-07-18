/**
 * First-run / invalid-config setup wizard. Step 0 picks the UI language,
 * then steps grouped by service; fields validate against KajaConfigSchema
 * per keystroke and a step can't advance until its fields pass.
 *
 * Key routing: Enter is owned by TextInput.onSubmit (next field, or next
 * step on the last), a step-level useInput owns Tab (switch field) and
 * Escape (back/cancel). TextInput ignores both. The language and review
 * steps have no TextInput and own their keys directly.
 */

import { Box, render, Text, useInput } from "ink"
import { useState } from "react"
import { configPath, saveConfig } from "../lib/config"
import { getLanguage, type Language, setLanguage, t } from "../lib/i18n"
import {
  type KajaConfig,
  KajaConfigSchema,
  KajaSettingsSchema
} from "../schemas/config"
import { TextInput } from "./elem/text-input"

type FieldName = Exclude<keyof KajaConfig, "settings">

// Labels come from the dictionary (t(`wizard.${field}`)); placeholders are
// sample values and stay untranslated.
const FIELDS: Record<FieldName, { placeholder: string }> = {
  openaiApiBaseUrl: { placeholder: "https://api.fireworks.ai/inference/v1" },
  openaiApiKey: { placeholder: "fw_..." },
  openaiApiModel: { placeholder: "accounts/fireworks/models/minimax-m3" },
  braveApiKey: { placeholder: "BSA..." },
  geoServiceUrl: { placeholder: "https://few-booklet-31770.ondis.co/" },
  geoServiceApiKey: { placeholder: "019ea05a-eacc-7ce7-8af9-e0cbf842d483" }
}

const GROUPS: { nameKey: string; fields: FieldName[] }[] = [
  {
    nameKey: "wizard.groupLlm",
    fields: ["openaiApiBaseUrl", "openaiApiKey", "openaiApiModel"]
  },
  { nameKey: "wizard.groupBrave", fields: ["braveApiKey"] },
  { nameKey: "wizard.groupGeo", fields: ["geoServiceUrl", "geoServiceApiKey"] }
]

// Own-language names on purpose: the picker must be readable before the
// right language is chosen.
const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hu", label: "Magyar" }
]

function fieldError(field: FieldName, value: string): string | null {
  const result = KajaConfigSchema.shape[field].safeParse(value)
  return result.success
    ? null
    : (result.error.issues[0]?.message ?? t("wizard.invalid"))
}

function stepValid(fields: FieldName[], values: Record<FieldName, string>) {
  return fields.every((f) => fieldError(f, values[f]) === null)
}

type Values = Record<FieldName, string>
type Outcome = "saved" | "cancelled"

function Progress({ step }: { step: number }) {
  const names = [
    t("wizard.stepLanguage"),
    ...GROUPS.map((g) => t(g.nameKey)),
    t("wizard.review")
  ]
  return (
    <Box marginBottom={1}>
      {names.map((name, i) => (
        <Text
          key={name}
          color={i < step ? "green" : undefined}
          bold={i === step}
          dimColor={i > step}
        >
          {i < step ? "✓" : i === step ? "●" : "○"} {name}
          {i < names.length - 1 ? "  " : ""}
        </Text>
      ))}
    </Box>
  )
}

function LanguageStep({
  value,
  onNext,
  onBack
}: {
  value: Language
  onNext: (lang: Language) => void
  onBack: () => void
}) {
  const [index, setIndex] = useState(() =>
    Math.max(
      LANGUAGES.findIndex((l) => l.value === value),
      0
    )
  )

  useInput((_input, key) => {
    if (key.upArrow) {
      setIndex((i) => (i + LANGUAGES.length - 1) % LANGUAGES.length)
    } else if (key.downArrow) {
      setIndex((i) => (i + 1) % LANGUAGES.length)
    } else if (key.return) {
      const choice = LANGUAGES[index]
      if (choice) onNext(choice.value)
    } else if (key.escape) {
      onBack()
    }
  })

  return (
    <Box flexDirection="column">
      {LANGUAGES.map((lang, i) => (
        <Text key={lang.value} bold={i === index} dimColor={i !== index}>
          {i === index ? "● " : "○ "}
          {lang.label}
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
              {t(`wizard.${field}`)}
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
          <Text dimColor>{t(`wizard.${field}`)}: </Text>
          <Text>{values[field]}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color="green">{t("wizard.reviewHint")}</Text>
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
  // 0 is the language step, 1..GROUPS.length are field steps, the last is
  // the review step.
  const [step, setStep] = useState(0)
  const [lang, setLang] = useState<Language>(getLanguage())
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
    // invalid-config fixup doesn't drop in-app preferences; the language
    // choice is always recorded.
    const settings = KajaSettingsSchema.safeParse(initial.settings)
    await saveConfig({
      ...values,
      settings: { ...(settings.success ? settings.data : {}), language: lang }
    })
    onFinish("saved")
  }

  const group = step >= 1 ? GROUPS[step - 1] : undefined

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>{t("wizard.title")}</Text>
      <Text dimColor>{configPath}</Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderDimColor
        paddingX={1}
        marginTop={1}
      >
        <Progress step={step} />
        {step === 0 ? (
          <LanguageStep
            value={lang}
            onNext={(next) => {
              // Takes effect immediately: the rest of the wizard (and the
              // zod locale) re-renders in the chosen language.
              setLanguage(next)
              setLang(next)
              setStep(1)
            }}
            onBack={() => onFinish("cancelled")}
          />
        ) : group ? (
          <StepFields
            // Remount per step so field focus starts fresh.
            key={step}
            fields={group.fields}
            values={values}
            setValues={setValues}
            onNext={() => setStep(step + 1)}
            onBack={() => setStep(step - 1)}
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
        <Text dimColor>{t("wizard.footer")}</Text>
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
