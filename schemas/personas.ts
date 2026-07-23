import * as z from "zod"

const PersonaSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  instructions: z.string().min(1).optional()
})

export const PersonasFileSchema = z.object({
  personas: z.array(PersonaSchema).default([])
})

export type KajaPersonasFile = z.infer<typeof PersonasFileSchema>
export type Persona = z.infer<typeof PersonaSchema>
