import {
  isExists as configExists,
  getConfigPath,
  readConfigLoose
} from "./config"
import { loadDatasets } from "./datasets"
import { t } from "./i18n"
import {
  forgetNotes,
  listAllDatasetAnswers,
  listDatasetVersionsSummary,
  loadMemory,
  resolveMemoryDbPath,
  saveMemory
} from "./memory-store"
import { loadModels, resolveConfigModels } from "./models"
import { loadPersonas } from "./personas"
import { deleteSessionRow, listSessions, loadSessionRow } from "./session-store"
import {
  configPage,
  type DatasetVersionSummary,
  datasetsPage,
  notesPage,
  notFoundPage,
  personasPage,
  sessionPage,
  sessionsPage,
  unconfiguredPersonasPage
} from "./web-pages"

/**
 * The `kaja web` subcommand: a localhost-only webserver for viewing the
 * config (secrets masked) and browsing/pruning memory.sqlite. Like
 * lib/memory-cli.ts and lib/session-cli.ts it's dispatched (from cli.tsx)
 * before the config guard and built only on the stores plus
 * readConfigLoose — inspecting a broken setup is precisely when this UI is
 * most useful, so it must work without a valid LLM config.
 */

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  })
}

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location } })
}

/**
 * Exported seam for tests (pass port 0 for an ephemeral one). Bound to
 * 127.0.0.1 on purpose: the pages expose memory contents and delete
 * actions, so the server must never listen on a public interface.
 */
export function startWebServer(port: number) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    routes: {
      "/": async () => {
        const [config, store, sessions, answers, versions, dbPath] =
          await Promise.all([
            readConfigLoose(),
            loadMemory(),
            listSessions(),
            listAllDatasetAnswers(),
            listDatasetVersionsSummary(),
            resolveMemoryDbPath()
          ])
        return html(
          configPage({
            config,
            configPath: getConfigPath(),
            dbPath,
            counts: {
              notes: Object.keys(store).length,
              sessions: sessions.length,
              dataset_answers: answers.length,
              dataset_versions: versions.length
            }
          })
        )
      },
      "/personas": async () => {
        // lib/agents.ts pulls in lib/openai.ts, which reads the LLM config
        // at module load and exits the process if it's missing/invalid —
        // fine for the normal boot path (cli.tsx only imports it after its
        // own config guard), fatal here since this whole server exists to
        // stay usable on a broken config. Import it dynamically, and only
        // once we know the file is there.
        if (!(await configExists())) {
          return html(unconfiguredPersonasPage())
        }
        const [
          { Agent, askUserTool, buildSystemPrompt, runCommandTool },
          { forgetNoteTool, listNotesTool, recallMemoryTool, rememberNoteTool },
          { datasetInfoTool }
        ] = await Promise.all([
          import("./agents"),
          import("../tools/memory"),
          import("../tools/dataset-info")
        ])
        const previewTools = [
          askUserTool,
          runCommandTool,
          rememberNoteTool,
          recallMemoryTool,
          forgetNoteTool,
          listNotesTool,
          datasetInfoTool
        ]
        const config = await readConfigLoose()
        const models = [...(await loadModels()), ...resolveConfigModels(config)]
        const personas = await loadPersonas(models)
        const entries = await Promise.all(
          personas.map(async (persona) => ({
            persona,
            systemPrompt: await buildSystemPrompt(
              new Agent({
                model: persona.model ?? "",
                tools: previewTools,
                instructions: persona.instructions,
                dataset: persona.dataset
              })
            )
          }))
        )
        return html(personasPage(entries))
      },
      "/notes": async () => html(notesPage(await loadMemory())),
      "/notes/delete": {
        POST: async (req) => {
          const key = (await req.formData()).get("key")
          if (typeof key === "string") {
            const store = await loadMemory()
            if (forgetNotes(store, { key }).length > 0) await saveMemory(store)
          }
          return seeOther("/notes")
        }
      },
      "/sessions": async () => html(sessionsPage(await listSessions())),
      "/sessions/:id": async (req) => {
        const session = await loadSessionRow(Number.parseInt(req.params.id, 10))
        return session ? html(sessionPage(session)) : html(notFoundPage(), 404)
      },
      "/sessions/:id/delete": {
        POST: async (req) => {
          await deleteSessionRow(Number.parseInt(req.params.id, 10))
          return seeOther("/sessions")
        }
      },
      "/datasets": async () => {
        const [allAnswers, versionSummaries, datasets] = await Promise.all([
          listAllDatasetAnswers(),
          listDatasetVersionsSummary(),
          loadDatasets()
        ])
        const versions: DatasetVersionSummary[] = versionSummaries.map((v) => ({
          topic: v.topic,
          owner: v.owner,
          version: v.version,
          answers: allAnswers.filter(
            (a) =>
              a.topic === v.topic &&
              a.owner === v.owner &&
              a.version === v.version
          ),
          totalFields: datasets.get(v.topic)?.fields.length,
          completedAt: v.completedAt
        }))
        return html(datasetsPage(versions))
      }
    },
    fetch: () => html(notFoundPage(), 404)
  })
}

/**
 * Runs the server until SIGINT/SIGTERM, matching the "run until killed"
 * shape of `kaja telegram`. Returns an exit code instead of calling
 * process.exit itself, so tests can call it directly.
 */
export async function runWebCli(flags: { port: number }): Promise<number> {
  let server: ReturnType<typeof startWebServer>
  try {
    server = startWebServer(flags.port)
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error))
    return 1
  }

  console.log(t("web.listening", { url: server.url.href }))
  await new Promise<void>((resolve) => {
    const onSignal = () => {
      process.off("SIGINT", onSignal)
      process.off("SIGTERM", onSignal)
      resolve()
    }
    process.on("SIGINT", onSignal)
    process.on("SIGTERM", onSignal)
  })
  await server.stop(true)
  return 0
}
