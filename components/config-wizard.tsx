/**
 * First-run / invalid-config setup wizard. Step 0 picks a preset (provider
 * template or empty) to prefill field values, step 1 picks the UI language,
 * then steps grouped by feature; fields validate against their group's zod
 * schema per keystroke and a step can't advance until its fields pass.
 *
 * The LLM group is mandatory. The other groups (stt/tts/location/webSearch/
 * rerank/imageGen) are optional: leaving every field in a group blank omits
 * that group from the saved config (the feature stays unavailable); filling in any field
 * requires the whole group to validate before advancing.
 *
 * Key routing: Enter is owned by TextInput.onSubmit (next field, or next
 * step on the last), a step-level useInput owns Tab (switch field) and
 * Escape (back/cancel). TextInput ignores both. The preset, language, and
 * review steps have no TextInput and own their keys directly.
 */

import { file, TOML, write } from "bun"
import { Box, render, Text, useInput } from "ink"
import { useState } from "react"
import type * as z from "zod"
import fireworksModelsTemplate from "../docs/config/models.fireworks.toml" with {
  type: "text"
}
import ollamaModelsTemplate from "../docs/config/models.ollama.toml" with {
  type: "text"
}
import { getConfigPath, saveConfig } from "../lib/config"
import { getLanguage, type Language, setLanguage, t } from "../lib/i18n"
import { getModelsPath, resolveModels } from "../lib/models"
import {
  type KajaConfig,
  KajaEmbeddingSchema,
  KajaImageGenSchema,
  KajaLlmSchema,
  KajaLocationSchema,
  KajaRerankSchema,
  KajaSettingsSchema,
  KajaSttSchema,
  KajaTtsSchema,
  KajaWebSearchSchema
} from "../schemas/config"
import { ModelsFileSchema } from "../schemas/models"
import { TextInput } from "./elem/text-input"

type FieldName =
  | "llmBaseUrl"
  | "llmApiKey"
  | "llmModel"
  | "embeddingBaseUrl"
  | "embeddingApiKey"
  | "embeddingModel"
  | "sttSpeachesUrl"
  | "sttModel"
  | "sttLanguage"
  | "ttsSpeachesUrl"
  | "ttsModel"
  | "ttsVoice"
  | "locationServiceUrl"
  | "locationApiKey"
  | "webSearchApiKey"
  | "rerankModel"
  | "rerankBaseUrl"
  | "rerankApiKey"
  | "imageGenBaseUrl"
  | "imageGenApiKey"
  | "imageGenModel"

type GroupName =
  | "llm"
  | "embedding"
  | "stt"
  | "tts"
  | "location"
  | "webSearch"
  | "rerank"
  | "imageGen"

// Each group's fields, its zod shape for per-field validation, whether the
// whole group can be omitted when every field is left blank, and an optional
// extra description shown above the fields (beyond the generic "optional"
// hint) for groups whose purpose isn't self-evident from the field labels
// alone.
const GROUPS: {
  name: GroupName
  nameKey: string
  optional: boolean
  descriptionKey?: string
  fields: FieldName[]
}[] = [
  {
    name: "llm",
    nameKey: "wizard.groupLlm",
    optional: false,
    fields: ["llmBaseUrl", "llmApiKey", "llmModel"]
  },
  {
    name: "embedding",
    nameKey: "wizard.groupEmbedding",
    optional: true,
    descriptionKey: "wizard.groupEmbeddingHint",
    fields: ["embeddingBaseUrl", "embeddingApiKey", "embeddingModel"]
  },
  {
    name: "stt",
    nameKey: "wizard.groupStt",
    optional: true,
    fields: ["sttSpeachesUrl", "sttModel", "sttLanguage"]
  },
  {
    name: "tts",
    nameKey: "wizard.groupTts",
    optional: true,
    fields: ["ttsSpeachesUrl", "ttsModel", "ttsVoice"]
  },
  {
    name: "location",
    nameKey: "wizard.groupLocation",
    optional: true,
    fields: ["locationServiceUrl", "locationApiKey"]
  },
  {
    name: "webSearch",
    nameKey: "wizard.groupWebSearch",
    optional: true,
    fields: ["webSearchApiKey"]
  },
  {
    name: "rerank",
    nameKey: "wizard.groupRerank",
    optional: true,
    fields: ["rerankModel", "rerankBaseUrl", "rerankApiKey"]
  },
  {
    name: "imageGen",
    nameKey: "wizard.groupImageGen",
    optional: true,
    fields: ["imageGenBaseUrl", "imageGenApiKey", "imageGenModel"]
  }
]

const GROUP_OF: Record<FieldName, GroupName> = Object.fromEntries(
  GROUPS.flatMap((g) => g.fields.map((f) => [f, g.name]))
) as Record<FieldName, GroupName>

const OPTIONAL_GROUP: Record<GroupName, boolean> = Object.fromEntries(
  GROUPS.map((g) => [g.name, g.optional])
) as Record<GroupName, boolean>

// Per-field zod schema, keyed the same way values are: unwrap optionals so
// blank-is-valid can be special-cased in fieldError.
const FIELD_SCHEMAS: Record<FieldName, z.ZodType<string>> = {
  llmBaseUrl: KajaLlmSchema.shape.baseUrl,
  llmApiKey: KajaLlmSchema.shape.apiKey,
  llmModel: KajaLlmSchema.shape.model,
  embeddingBaseUrl: KajaEmbeddingSchema.shape.baseUrl.unwrap(),
  embeddingApiKey: KajaEmbeddingSchema.shape.apiKey.unwrap(),
  embeddingModel: KajaEmbeddingSchema.shape.model.unwrap(),
  sttSpeachesUrl: KajaSttSchema.shape.speachesUrl.unwrap(),
  sttModel: KajaSttSchema.shape.model.unwrap(),
  sttLanguage: KajaSttSchema.shape.language.unwrap(),
  ttsSpeachesUrl: KajaTtsSchema.shape.speachesUrl.unwrap(),
  ttsModel: KajaTtsSchema.shape.model.unwrap(),
  ttsVoice: KajaTtsSchema.shape.voice.unwrap(),
  locationServiceUrl: KajaLocationSchema.shape.serviceUrl,
  locationApiKey: KajaLocationSchema.shape.apiKey,
  webSearchApiKey: KajaWebSearchSchema.shape.apiKey,
  rerankModel: KajaRerankSchema.shape.model.unwrap(),
  rerankBaseUrl: KajaRerankSchema.shape.baseUrl.unwrap(),
  rerankApiKey: KajaRerankSchema.shape.apiKey.unwrap(),
  imageGenBaseUrl: KajaImageGenSchema.shape.baseUrl,
  imageGenApiKey: KajaImageGenSchema.shape.apiKey,
  imageGenModel: KajaImageGenSchema.shape.model.unwrap()
}

// Labels come from the dictionary (t(`wizard.${field}`)); placeholders are
// sample values and stay untranslated.
const FIELDS: Record<FieldName, { placeholder: string }> = {
  llmBaseUrl: { placeholder: "https://api.fireworks.ai/inference/v1" },
  llmApiKey: { placeholder: "fw_..." },
  llmModel: { placeholder: "accounts/fireworks/models/minimax-m3" },
  embeddingBaseUrl: { placeholder: "same as LLM base URL (default)" },
  embeddingApiKey: { placeholder: "same as LLM API key (default)" },
  embeddingModel: {
    placeholder: "accounts/fireworks/models/qwen3-embedding-8b (default)"
  },
  sttSpeachesUrl: { placeholder: "ws://localhost:8000 (default)" },
  sttModel: { placeholder: "Systran/faster-distil-whisper-small.en (default)" },
  sttLanguage: { placeholder: "app language (default)" },
  ttsSpeachesUrl: { placeholder: "ws://localhost:8000 (default)" },
  ttsModel: { placeholder: "speaches-ai/Kokoro-82M-v1.0-ONNX-fp16 (default)" },
  ttsVoice: { placeholder: "af_heart (default)" },
  locationServiceUrl: { placeholder: "https://ip2geo.demo.land/" },
  locationApiKey: { placeholder: "kaja" },
  webSearchApiKey: { placeholder: "BSA..." },
  rerankModel: {
    placeholder: "accounts/fireworks/models/qwen3-reranker-8b (default)"
  },
  rerankBaseUrl: { placeholder: "same as LLM base URL (default)" },
  rerankApiKey: { placeholder: "same as LLM API key (default)" },
  imageGenBaseUrl: { placeholder: "https://api.x.ai/v1" },
  imageGenApiKey: { placeholder: "xai-..." },
  imageGenModel: {
    placeholder: "grok-imagine-image-quality (provider default)"
  }
}

// Own-language names on purpose: the picker must be readable before the
// right language is chosen.
const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hu", label: "Magyar" }
]

type PresetName = "fireworks" | "ollama" | "empty"

// docs/config/models*.toml is this wizard's only source of provider-specific
// values — the LLM/embedding/imageGen fields below are derived from it
// rather than duplicated in a second per-provider file. Only written to disk
// on save, and only if models.toml doesn't already exist there — same
// first-run-only policy loadModels itself uses (see lib/models.ts).
const PRESET_MODELS_TEMPLATES: Partial<Record<PresetName, string>> = {
  fireworks: fireworksModelsTemplate as unknown as string,
  ollama: ollamaModelsTemplate as unknown as string
}

// Parsed once at module load: picking a preset prefills llm (mandatory) and
// embedding/rerank/imageGen (optional groups) from the first models.toml
// entry of the matching task — stt/tts have no per-model language/voice
// fields in models.toml, so they're left for the user to fill in regardless
// of preset.
function configFromModelsTemplate(
  template: string | undefined
): Partial<KajaConfig> {
  if (!template) return {}
  const resolved = resolveModels(ModelsFileSchema.parse(TOML.parse(template)))
  const chat = resolved.find((m) => m.task === "chat")
  const embedding = resolved.find((m) => m.task === "embedding")
  const rerank = resolved.find((m) => m.task === "rerank")
  const imageGen = resolved.find((m) => m.task === "image-generation")
  return {
    ...(chat && {
      llm: { baseUrl: chat.baseUrl, apiKey: chat.apiKey ?? "", model: chat.id }
    }),
    ...(embedding && {
      embedding: {
        baseUrl: embedding.baseUrl,
        apiKey: embedding.apiKey,
        model: embedding.id
      }
    }),
    ...(rerank && {
      rerank: {
        baseUrl: rerank.baseUrl,
        apiKey: rerank.apiKey,
        model: rerank.id
      }
    }),
    ...(imageGen && {
      imageGen: {
        baseUrl: imageGen.baseUrl,
        apiKey: imageGen.apiKey ?? "",
        model: imageGen.id
      }
    })
  }
}

const PRESET_CONFIGS: Record<PresetName, Partial<KajaConfig>> = {
  fireworks: configFromModelsTemplate(PRESET_MODELS_TEMPLATES.fireworks),
  ollama: configFromModelsTemplate(PRESET_MODELS_TEMPLATES.ollama),
  empty: {}
}

const PRESETS: { value: PresetName; labelKey: string }[] = [
  { value: "fireworks", labelKey: "wizard.presetFireworks" },
  { value: "ollama", labelKey: "wizard.presetOllama" },
  { value: "empty", labelKey: "wizard.presetEmpty" }
]

function valuesFromConfig(config: Partial<KajaConfig>): Values {
  return {
    llmBaseUrl: config.llm?.baseUrl ?? "",
    llmApiKey: config.llm?.apiKey ?? "",
    llmModel: config.llm?.model ?? "",
    embeddingBaseUrl: config.embedding?.baseUrl ?? "",
    embeddingApiKey: config.embedding?.apiKey ?? "",
    embeddingModel: config.embedding?.model ?? "",
    sttSpeachesUrl: config.stt?.speachesUrl ?? "",
    sttModel: config.stt?.model ?? "",
    sttLanguage: config.stt?.language ?? "",
    ttsSpeachesUrl: config.tts?.speachesUrl ?? "",
    ttsModel: config.tts?.model ?? "",
    ttsVoice: config.tts?.voice ?? "",
    locationServiceUrl:
      config.location?.serviceUrl ?? "https://ip2geo.demo.land/",
    locationApiKey: config.location?.apiKey ?? "kaja",
    webSearchApiKey: config.webSearch?.apiKey ?? "",
    rerankModel: config.rerank?.model ?? "",
    rerankBaseUrl: config.rerank?.baseUrl ?? "",
    rerankApiKey: config.rerank?.apiKey ?? "",
    imageGenBaseUrl: config.imageGen?.baseUrl ?? "",
    imageGenApiKey: config.imageGen?.apiKey ?? "",
    imageGenModel: config.imageGen?.model ?? ""
  }
}

// A blank field in an optional group is always valid (the group gets
// omitted entirely if every field in it is blank); everything else must
// pass its schema to advance.
function fieldError(field: FieldName, value: string): string | null {
  if (OPTIONAL_GROUP[GROUP_OF[field]] && value === "") return null
  const result = FIELD_SCHEMAS[field].safeParse(value)
  return result.success
    ? null
    : (result.error.issues[0]?.message ?? t("wizard.invalid"))
}

function stepValid(fields: FieldName[], values: Record<FieldName, string>) {
  return fields.every((f) => fieldError(f, values[f]) === null)
}

type Values = Record<FieldName, string>
type Outcome = "saved" | "cancelled"

// A full tab row (one Text per step) breaks on narrow terminals — the
// labels can't wrap individually, so they overlap once their combined width
// exceeds the terminal columns. A single short line has no such width
// dependency.
function Progress({ step }: { step: number }) {
  const names = [
    t("wizard.stepPreset"),
    t("wizard.stepLanguage"),
    ...GROUPS.map((g) => t(g.nameKey)),
    t("wizard.review")
  ]
  return (
    <Box marginBottom={1}>
      <Text bold>
        {t("wizard.stepOf", { current: step + 1, total: names.length })}
      </Text>
      <Text dimColor>{"  "}</Text>
      <Text>{names[step]}</Text>
    </Box>
  )
}

function PresetStep({
  onNext,
  onBack
}: {
  onNext: (preset: PresetName) => void
  onBack: () => void
}) {
  const [index, setIndex] = useState(0)

  useInput((_input, key) => {
    if (key.upArrow) {
      setIndex((i) => (i + PRESETS.length - 1) % PRESETS.length)
    } else if (key.downArrow) {
      setIndex((i) => (i + 1) % PRESETS.length)
    } else if (key.return) {
      const choice = PRESETS[index]
      if (choice) onNext(choice.value)
    } else if (key.escape) {
      onBack()
    }
  })

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text dimColor>{t("wizard.presetHint")}</Text>
      </Box>
      {PRESETS.map((preset, i) => (
        <Text key={preset.value} bold={i === index} dimColor={i !== index}>
          {i === index ? "● " : "○ "}
          {t(preset.labelKey)}
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
  optional,
  descriptionKey,
  values,
  setValues,
  onNext,
  onBack
}: {
  fields: FieldName[]
  optional: boolean
  descriptionKey?: string
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
      {descriptionKey && (
        <Box marginBottom={1}>
          <Text dimColor>{t(descriptionKey)}</Text>
        </Box>
      )}
      {optional && (
        <Box marginBottom={1}>
          <Text dimColor>{t("wizard.groupOptionalHint")}</Text>
        </Box>
      )}
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
  // 0 is the preset step, 1 is the language step, 2..GROUPS.length+1 are
  // field steps, then the review step (last).
  const [step, setStep] = useState(0)
  const [lang, setLang] = useState<Language>(getLanguage())
  const [values, setValues] = useState<Values>(() => valuesFromConfig(initial))
  const [preset, setPreset] = useState<PresetName>("empty")

  const save = async () => {
    // Keep an existing valid settings block (thinking/sounds/voice) so an
    // invalid-config fixup doesn't drop in-app preferences; the language
    // choice is always recorded.
    const settings = KajaSettingsSchema.safeParse(initial.settings)

    const embedding =
      values.embeddingModel || values.embeddingBaseUrl || values.embeddingApiKey
        ? {
            ...(values.embeddingModel && { model: values.embeddingModel }),
            ...(values.embeddingBaseUrl && {
              baseUrl: values.embeddingBaseUrl
            }),
            ...(values.embeddingApiKey && { apiKey: values.embeddingApiKey })
          }
        : undefined
    const stt =
      values.sttSpeachesUrl || values.sttModel || values.sttLanguage
        ? {
            ...(values.sttSpeachesUrl && {
              speachesUrl: values.sttSpeachesUrl
            }),
            ...(values.sttModel && { model: values.sttModel }),
            ...(values.sttLanguage && { language: values.sttLanguage })
          }
        : undefined
    const tts =
      values.ttsSpeachesUrl || values.ttsModel || values.ttsVoice
        ? {
            ...(values.ttsSpeachesUrl && {
              speachesUrl: values.ttsSpeachesUrl
            }),
            ...(values.ttsModel && { model: values.ttsModel }),
            ...(values.ttsVoice && { voice: values.ttsVoice })
          }
        : undefined
    const location =
      values.locationServiceUrl || values.locationApiKey
        ? {
            serviceUrl: values.locationServiceUrl,
            apiKey: values.locationApiKey
          }
        : undefined
    const webSearch = values.webSearchApiKey
      ? { apiKey: values.webSearchApiKey }
      : undefined
    const rerank =
      values.rerankModel || values.rerankBaseUrl || values.rerankApiKey
        ? {
            ...(values.rerankModel && { model: values.rerankModel }),
            ...(values.rerankBaseUrl && { baseUrl: values.rerankBaseUrl }),
            ...(values.rerankApiKey && { apiKey: values.rerankApiKey })
          }
        : undefined
    const imageGen =
      values.imageGenBaseUrl || values.imageGenApiKey || values.imageGenModel
        ? {
            baseUrl: values.imageGenBaseUrl,
            apiKey: values.imageGenApiKey,
            ...(values.imageGenModel && { model: values.imageGenModel })
          }
        : undefined

    await saveConfig({
      llm: {
        baseUrl: values.llmBaseUrl,
        apiKey: values.llmApiKey,
        model: values.llmModel
      },
      embedding,
      stt,
      tts,
      location,
      webSearch,
      rerank,
      imageGen,
      settings: { ...(settings.success ? settings.data : {}), language: lang }
    })

    const modelsTemplate = PRESET_MODELS_TEMPLATES[preset]
    if (modelsTemplate) {
      const modelsFile = file(getModelsPath())
      if (!(await modelsFile.exists())) await write(modelsFile, modelsTemplate)
    }

    onFinish("saved")
  }

  const group =
    step >= 2 && step <= GROUPS.length + 1 ? GROUPS[step - 2] : undefined

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} maxWidth={72}>
      <Text bold>{t("wizard.title")}</Text>
      <Text dimColor>{getConfigPath()}</Text>
      <Box
        flexDirection="column"
        borderStyle="classic"
        borderColor="blue"
        borderDimColor
        paddingX={1}
        marginTop={1}
      >
        <Progress step={step} />
        {step === 0 ? (
          <PresetStep
            onNext={(chosen) => {
              setPreset(chosen)
              setValues(valuesFromConfig(PRESET_CONFIGS[chosen]))
              setStep(1)
            }}
            onBack={() => onFinish("cancelled")}
          />
        ) : step === 1 ? (
          <LanguageStep
            value={lang}
            onNext={(next) => {
              // Takes effect immediately: the rest of the wizard (and the
              // zod locale) re-renders in the chosen language.
              setLanguage(next)
              setLang(next)
              setStep(2)
            }}
            onBack={() => setStep(0)}
          />
        ) : group ? (
          <StepFields
            // Remount per step so field focus starts fresh.
            key={step}
            fields={group.fields}
            optional={group.optional}
            descriptionKey={group.descriptionKey}
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
