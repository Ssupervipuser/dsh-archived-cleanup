/**
 * Host half of dsh-archived-cleanup.
 *
 * Enumerates the registry-global archive set and physically deletes those
 * sessions: the session's own log directory, its derived projection-cache
 * document, its Workspace accounting slot, and finally its archive entry.
 *
 * Nothing here runs unless a session is archived (unless the row config opts
 * out), and a live Agent always blocks deletion.
 */
import { rm } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

/** Base path of this plugin's authenticated `/api` routes. */
const ROUTE = '/api/dsh-archived-cleanup'

/**
 * The only file names a session's own log directory may contain for deletion:
 * every released generation spelling, `session.jsonl`, `session.v4.jsonl` and
 * their `.zstd` forms.
 */
const SESSION_LOG = /^session(?:\.v?[0-9]+)?\.jsonl(?:\.zstd)?$/

export const name = 'dsh-archived-cleanup'

export const inject = ['webServer', 'connection', 'workspaceRegistry', 'sessionPersistence']

/**
 * Resolve the row config into the option set this plugin uses.
 * @param config - raw Loader row config; absent fields keep their defaults.
 * @returns the normalized options.
 */
function resolveOptions(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  const maxBatch = Number.isInteger(raw.maxBatch) && raw.maxBatch > 0 ? raw.maxBatch : 200
  return {
    /** Delete a session that is not in the archive set. Off by default. */
    allowNonArchived: raw.allowNonArchived === true,
    /** Keep the derived projection-cache document instead of removing it. */
    keepProjectionCache: raw.keepProjectionCache === true,
    /** Upper bound on one delete request's session count. */
    maxBatch,
  }
}

/**
 * Read the durable archive set through the registry's public getter.
 * @param ctx - plugin context.
 * @returns archived session ids as plain strings, newest archive last.
 */
function archivedIds(ctx) {
  const registry = ctx.get('workspaceRegistry')
  const ids = registry === undefined ? undefined : registry.archivedSessionIds
  if (!Array.isArray(ids)) return []
  return ids.map((id) => String(id))
}

/**
 * Build one JSON response for a buffered `/api` route.
 * @param payload - already-serialized envelope.
 * @returns the response.
 */
function jsonResponse(payload) {
  return Response.json(payload, { headers: { 'cache-control': 'no-store' } })
}

/**
 * Wrap one handler so failures become `{ ok: false, error }` instead of a throw.
 * @param handler - receives the parsed JSON body.
 * @returns the response.
 */
function settled(handler) {
  return async (body) => {
    try {
      return jsonResponse({ ok: true, value: await handler(body) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = error !== null && typeof error === 'object' && typeof error.code === 'string'
        ? error.code
        : 'cleanup/failed'
      return jsonResponse({ ok: false, error: { code, message } })
    }
  }
}

/**
 * Read one request body as JSON, treating an empty body as `{}`.
 * @param request - the incoming request.
 * @returns the parsed body.
 */
async function readJsonBody(request) {
  const text = await request.text()
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('request body is not JSON')
    error.code = 'cleanup/bad-request'
    throw error
  }
}

/**
 * Describe one archived session for the list surface.
 * @param ctx - plugin context.
 * @param ids - ids whose titles are resolved in one observation.
 * @returns the list value.
 */
async function describeSessions(ctx, ids) {
  const persistence = ctx.get('sessionPersistence')
  const query = ctx.get('sessionQuery')
  const titles = new Map()
  if (query !== undefined && typeof query.readTitleSnapshots === 'function') {
    const results = await query.readTitleSnapshots(ids).catch(() => [])
    for (const result of results ?? []) {
      if (result?.status !== 'fulfilled') continue
      const title = result.value?.title
      if (typeof title?.title === 'string') {
        titles.set(String(result.sessionId), { title: title.title, updatedAt: title.updatedAt })
      }
    }
  }

  const items = []
  let totalBytes = 0
  for (const id of ids) {
    let snapshot
    try {
      snapshot = await persistence.stat(id)
    } catch {
      snapshot = undefined
    }
    const bytes = typeof snapshot?.sizeBytes === 'number' ? snapshot.sizeBytes : 0
    totalBytes += bytes
    const titled = titles.get(id)
    items.push({
      sessionId: id,
      title: titled?.title ?? null,
      updatedAt: titled?.updatedAt ?? snapshot?.header?.createdAt ?? null,
      createdAt: snapshot?.header?.createdAt ?? null,
      cwd: snapshot?.header?.cwd ?? null,
      sizeBytes: bytes,
      locationPath: snapshot?.location?.path ?? null,
      missing: snapshot === undefined,
    })
  }
  return { items, sessionIds: ids, totalBytes }
}

/**
 * Remove one session's derived projection-cache document, when the domain is open.
 * @param ctx - plugin context.
 * @param id - session id.
 * @returns true when a record was removed or nothing was left to remove.
 */
async function dropProjectionCache(ctx, id) {
  const domain = ctx.get('storageDomain')
  const open = typeof domain?.get === 'function' ? domain.get('session_projcache') : undefined
  if (open !== undefined) {
    try {
      await open.table('sessions').delete(id)
      return true
    } catch {
      return false
    }
  }
  return false
}

/**
 * Delete one session's files, accounting slot, and archive entry.
 * @param ctx - plugin context.
 * @param options - resolved row options.
 * @param id - session id to delete.
 * @returns a per-session outcome; `deleted: false` carries a reason.
 */
async function deleteSession(ctx, options, id) {
  const registry = ctx.get('workspaceRegistry')
  if (!archivedIds(ctx).includes(id) && !options.allowNonArchived) {
    return { sessionId: id, deleted: false, code: 'not-archived', message: 'This conversation is not archived.' }
  }

  const live = ctx.get('agents')?.get?.(id) ?? ctx.get('sessions')?.get?.(id)
  if (live !== undefined) {
    return { sessionId: id, deleted: false, code: 'live', message: 'This conversation is still open; close it first.' }
  }

  const persistence = ctx.get('sessionPersistence')
  let snapshot
  try {
    snapshot = await persistence.stat(id)
  } catch {
    snapshot = undefined
  }

  let removedLog = false
  const locationPath = snapshot?.location?.path
  if (typeof locationPath === 'string' && locationPath !== '') {
    const file = basename(locationPath)
    const directory = dirname(locationPath)
    const identity = snapshot?.header?.id ?? basename(directory)
    if (!SESSION_LOG.test(file) || String(identity) !== id) {
      return {
        sessionId: id,
        deleted: false,
        code: 'unsafe-path',
        message: `Refusing to delete an unexpected session path: ${locationPath}`,
      }
    }
    await rm(directory, { recursive: true, force: true })
    removedLog = true
  }

  if (!options.keepProjectionCache) await dropProjectionCache(ctx, id)

  for (const workspace of registry.list()) {
    if (!workspace.sessionIds?.includes(id)) continue
    try {
      await workspace.detachSession(id)
    } catch {
      // An accounting failure must not resurrect the archive entry.
    }
  }
  try {
    await registry.unarchiveSession(id)
  } catch {
    // Already absent is the desired end state.
  }

  return {
    sessionId: id,
    deleted: true,
    removedLog,
    freedBytes: typeof snapshot?.sizeBytes === 'number' ? snapshot.sizeBytes : 0,
    missing: snapshot === undefined,
  }
}

/**
 * The one implementation both callers use: the UI route and the agent tool.
 * @param ctx - plugin context.
 * @param options - resolved row options.
 */
function createService(ctx, options) {
  return {
    /** @returns every archived conversation with its size and title. */
    async list() {
      return describeSessions(ctx, archivedIds(ctx))
    },
    /**
     * Delete `sessionIds`, or every archived session when `all` is set.
     * @param body - `{ sessionIds?: string[], all?: boolean }`.
     * @returns per-session outcomes plus totals.
     */
    async delete(body) {
      const request = body !== null && typeof body === 'object' ? body : {}
      let targets
      if (request.all === true) {
        targets = archivedIds(ctx)
      } else if (Array.isArray(request.sessionIds)) {
        targets = [...new Set(request.sessionIds.filter((id) => typeof id === 'string' && id !== ''))]
      } else {
        const error = new Error('Pass sessionIds or all: true.')
        error.code = 'cleanup/bad-request'
        throw error
      }
      if (targets.length === 0) return { results: [], deletedCount: 0, freedBytes: 0 }
      if (targets.length > options.maxBatch) {
        const error = new Error(`At most ${options.maxBatch} conversations can be deleted per request.`)
        error.code = 'cleanup/too-many'
        throw error
      }

      const results = []
      let deletedCount = 0
      let freedBytes = 0
      for (const id of targets) {
        const outcome = await deleteSession(ctx, options, id)
        results.push(outcome)
        if (outcome.deleted) {
          deletedCount += 1
          freedBytes += outcome.freedBytes ?? 0
        }
      }
      return { results, deletedCount, freedBytes }
    },
  }
}

/**
 * Mount the authenticated `/api/dsh-archived-cleanup/*` routes.
 * @param ctx - plugin context.
 * @param service - the shared service implementation.
 * @returns disposer removing every route.
 */
function mountRoutes(ctx, service) {
  const disposers = []
  const fetchFace = ctx.get('connection')?.fetch
  const useConnectionFetch = typeof fetchFace?.register === 'function'
  const webServer = ctx.get('webServer')

  for (const method of ['list', 'delete']) {
    const handler = settled((body) => service[method](body))
    if (useConnectionFetch) {
      disposers.push(fetchFace.register({
        path: `${ROUTE}/${method}`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => handler(await readJsonBody(request)),
      }))
      continue
    }
    if (webServer !== undefined) {
      disposers.push(webServer.register({
        kind: 'exact',
        path: `${ROUTE}/${method}`,
        handler: async (req, res) => {
          const response = await handler(await readJsonBodyFromNode(req))
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(await response.text())
        },
      }))
    }
  }

  return () => {
    for (const dispose of disposers) {
      try {
        void dispose()
      } catch {
        // Teardown is best effort.
      }
    }
  }
}

/**
 * Read one Node request body as JSON.
 * @param req - incoming request.
 * @returns the parsed body.
 */
async function readJsonBodyFromNode(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('request body is not JSON')
    error.code = 'cleanup/bad-request'
    throw error
  }
}

/**
 * Render one tool result as a single text block.
 * @param value - the service value.
 * @returns content blocks.
 */
function renderSummary(value) {
  if (Array.isArray(value?.items)) {
    if (value.items.length === 0) return [{ type: 'text', text: 'No archived conversations.' }]
    const lines = value.items.map((item) => {
      const title = item.title ?? '(untitled)'
      const when = item.updatedAt === null ? 'unknown date' : new Date(item.updatedAt).toISOString().slice(0, 10)
      const size = `${Math.max(1, Math.round((item.sizeBytes ?? 0) / 1024))} KiB`
      return `- ${title} — ${item.sessionId} — ${when} — ${size}${item.missing === true ? ' — log missing' : ''}`
    })
    return [{ type: 'text', text: `Archived conversations (${value.items.length}):\n${lines.join('\n')}` }]
  }
  if (Array.isArray(value?.results)) {
    const failed = value.results.filter((result) => result.deleted !== true)
    const freed = `${Math.round((value.freedBytes ?? 0) / 1024)} KiB`
    const head = `Deleted ${value.deletedCount} conversation(s), freed ${freed}.`
    if (failed.length === 0) return [{ type: 'text', text: head }]
    const lines = failed.map((result) => `- ${result.sessionId}: ${result.code} — ${result.message}`)
    return [{ type: 'text', text: `${head}\nSkipped:\n${lines.join('\n')}` }]
  }
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/**
 * Host plugin entry.
 * @param ctx - plugin context.
 * @param config - Loader row config.
 */
export function apply(ctx, config) {
  const options = resolveOptions(config)
  const service = createService(ctx, options)

  ctx.effect(() => mountRoutes(ctx, service), 'dsh-archived-cleanup: api routes')

  const tools = ctx.get('tools')
  if (tools === undefined) return
  ctx.effect(() => tools.register({
    name: 'archived_conversations',
    description: 'List or permanently delete archived conversations. Deleting removes the conversation log, its cached projections, and its Workspace entry; it cannot be undone.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'delete'], description: 'list shows the archived conversations; delete removes them permanently.' },
        sessionIds: { type: 'array', items: { type: 'string' }, description: 'Conversations to delete when action is delete.' },
        all: { type: 'boolean', description: 'When action is delete, delete every archived conversation.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          results: { type: 'array', items: { type: 'object', additionalProperties: true } },
          deletedCount: { type: 'number' },
          freedBytes: { type: 'number' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => renderSummary(value),
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const input = args !== null && typeof args === 'object' ? args : {}
      if (input.action === 'delete') {
        return service.delete({
          sessionIds: input.sessionIds,
          all: input.all === true,
        })
      }
      return service.list()
    },
  }), 'dsh-archived-cleanup: agent tool')
}
