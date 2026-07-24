import * as z from "zod"

// Credentials for one API endpoint, shared by every model that names it.
const ProviderSchema = z.object({
  base_url: z.url(),
  api_key: z.string().min(1).optional()
})

const TaskSchema = z.enum(["chat", "text-to-speech", "speech-to-text"])

const ModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  task: TaskSchema,
  // Which [providers.*] table holds the credentials; omitted means "default".
  provider: z.string().min(1).optional()
})

export const ModelsFileSchema = z
  .object({
    providers: z.record(z.string(), ProviderSchema).default({}),
    models: z.array(ModelSchema).default([])
  })
  .superRefine((data, ctx) => {
    data.models.forEach((model, index) => {
      const name = model.provider ?? "default"
      if (!data.providers[name]) {
        ctx.addIssue({
          code: "custom",
          path: ["models", index, "provider"],
          message: model.provider
            ? `Unknown provider "${name}"`
            : `Model "${model.id}" names no provider and [providers.default] is missing`
        })
      }
    })
  })

export type KajaModelsFile = z.infer<typeof ModelsFileSchema>
export type ModelTask = z.infer<typeof TaskSchema>

// Beyond the models.toml tasks above, the startup panel also reports on
// config.json's single-model embedding/imageGen blocks; they aren't part of
// models.toml so they don't belong in TaskSchema, but they share the same
// display/check shape.
export type ResolvedModelTask = ModelTask | "embedding" | "image-generation"

/** A model entry flattened with its provider's credentials. */
export type ResolvedModel = {
  id: string
  label?: string
  task: ResolvedModelTask
  baseUrl: string
  apiKey?: string
}
