import * as core from '@actions/core'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { formatError, sleep } from './utils'

/**
 * The permissions the runner Service Account needs to manage job pods.
 */
export interface RequiredPermission {
  group: string
  verbs: string[]
  resource: string
  subresource: string
}

export const requiredPermissions: RequiredPermission[] = [
  {
    group: '',
    verbs: ['get', 'list', 'create', 'delete'],
    resource: 'pods',
    subresource: ''
  },
  {
    group: '',
    verbs: ['get', 'create'],
    resource: 'pods',
    subresource: 'exec'
  },
  {
    group: '',
    verbs: ['get', 'list', 'watch'],
    resource: 'pods',
    subresource: 'log'
  },
  {
    group: '',
    verbs: ['create', 'delete', 'get', 'list'],
    resource: 'secrets',
    subresource: ''
  }
]

/**
 * A single SelfSubjectAccessReview probe. Implementations must reject with the
 * raw API error when the review request itself cannot be delivered.
 */
export type ReviewFn = (attrs: {
  group: string
  resource: string
  subresource: string
  namespace: string
  verb: string
}) => Promise<{ status?: { allowed?: boolean } }>

export interface RetryOptions {
  retries?: number
  baseMs?: number
  capMs?: number
  sleepFn?: (ms: number) => Promise<void>
  random?: () => number
}

const DEFAULT_RETRIES = 5
const DEFAULT_BACKOFF_BASE_MS = 500
const DEFAULT_BACKOFF_CAP_MS = 8000

// A job's pod lives on one node, with one ServiceAccount whose RBAC does not
// change mid-job. Checking once per job is enough; caching the successful
// verdict keeps every later hook invocation from stampeding the API server.
// (Every hook invocation is a fresh process, so the cache has to be on disk.)
const CACHE_TTL_MS = 60 * 60 * 1000 // 1h
// If the API server cannot be reached during a check, a previously-good
// verdict may be reused within this grace window instead of aborting the job:
// transient control-plane failures are far more common than RBAC changing
// mid-run, and a truly missing permission still fails on the real call.
const CACHE_STALE_GRACE_MS = 24 * 60 * 60 * 1000

const transientNetworkCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET'
])

// HTTP codes that mean "the review request could not be evaluated" for the
// selfsubjectaccessreviews endpoint itself:
// - 429/5xx/timeout: the API server was busy or unreachable.
// - 401/403: creating a SelfSubjectAccessReview is granted to every
//   authenticated user by `system:basic-user`, so a rejection on the review
//   endpoint almost always indicates a transient authorization-decision-chain
//   failure (or a cluster-wide misconfiguration affecting all runners), not an
//   answer about the permission being probed. Treat as inconclusive + retry.
const transientStatusCodes = new Set([401, 403, 408, 429, 500, 502, 503, 504])

/**
 * Classifies whether an error from an API call is a transient infrastructure
 * failure (network, throttling, unavailable) rather than a definitive answer.
 */
export function isTransientApiError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const err = error as {
    code?: string
    statusCode?: number
    message?: string
    cause?: { code?: string; message?: string }
    response?: { status?: number }
  }
  const status = err.statusCode ?? err.response?.status
  if (typeof status === 'number') {
    return transientStatusCodes.has(status)
  }
  const code = err.code ?? err.cause?.code
  if (typeof code === 'string' && transientNetworkCodes.has(code)) {
    return true
  }
  const message = `${err.message ?? ''} ${err.cause?.message ?? ''}`
  return (
    Array.from(transientNetworkCodes).some(c => message.includes(c)) ||
    /socket hang up|temporarily unavailable|connection reset/i.test(message)
  )
}

/**
 * Retries `fn` while it fails with transient errors. Delays grow
 * exponentially but are randomly spread (equal jitter) so that many hook
 * processes recovering at the same instant do not retry in lockstep and
 * re-overload the recovering API server.
 */
export async function withTransientRetry<T>(
  fn: (attempt: number) => Promise<T>,
  {
    retries = DEFAULT_RETRIES,
    baseMs = DEFAULT_BACKOFF_BASE_MS,
    capMs = DEFAULT_BACKOFF_CAP_MS,
    sleepFn = sleep,
    random = Math.random
  }: RetryOptions = {}
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      if (!isTransientApiError(error)) {
        throw error
      }
      if (attempt < retries) {
        const backoff = Math.min(capMs, baseMs * 2 ** (attempt - 1))
        const delay = Math.round(backoff * (0.5 + random()))
        core.debug(
          `transient API error on attempt ${attempt}/${retries}, retrying in ${delay}ms`
        )
        await sleepFn(delay)
      }
    }
  }
  throw lastError
}

interface PermissionsCacheEntry {
  namespace: string
  allowed: boolean
  timestamp: number
}

function cacheFilePath(): string {
  const dir = process.env['RUNNER_TEMP'] || os.tmpdir()
  return path.join(dir, 'container-hooks-k8s-auth-cache.json')
}

function readCache(): PermissionsCacheEntry | undefined {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(cacheFilePath(), 'utf8')
    ) as PermissionsCacheEntry
    if (
      parsed &&
      typeof parsed.allowed === 'boolean' &&
      typeof parsed.timestamp === 'number' &&
      typeof parsed.namespace === 'string'
    ) {
      return parsed
    }
  } catch {
    // cache is best-effort
  }
  return undefined
}

function writeCache(entry: PermissionsCacheEntry): void {
  try {
    fs.mkdirSync(path.dirname(cacheFilePath()), { recursive: true })
    fs.writeFileSync(cacheFilePath(), JSON.stringify(entry))
  } catch (error) {
    core.debug(`failed to persist permission cache: ${String(error)}`)
  }
}

export interface AuthCheckOptions {
  namespace: string
  review: ReviewFn
  retry?: RetryOptions
  now?: () => number
}

type ReviewOutcome =
  | { kind: 'allowed' }
  | { kind: 'denied' }
  | { kind: 'inconclusive'; error: unknown }

/**
 * Checks whether the ServiceAccount has all required permissions, with
 * three properties the naive `Promise.all` version lacked:
 *
 * 1. Result caching per job: once a check succeeds, subsequent hook
 *    invocations (each is a fresh process) answer from a local file and do
 *    not touch the API server at all. This removes a per-step burst of ~15
 *    SelfSubjectAccessReview POSTs from every job.
 * 2. Transient-error tolerance: transport failures and 4xx/5xx on the review
 *    endpoint itself are retried with exponential backoff + jitter, and
 *    finally degrade to the cached last-good verdict instead of killing the
 *    hook process. A momentary control-plane flap no longer aborts steps in
 *    the middle of a job.
 * 3. Accurate failure semantics: `allowed:false` answers are the only ones
 *    treated as denials; an "unable to determine" error is surfaced as such
 *    instead of being reported as a missing permission.
 */
export async function hasRequiredPermissions(
  options: AuthCheckOptions
): Promise<boolean> {
  const now = options.now ?? Date.now
  const ts = now()
  const cache = readCache()

  if (
    cache?.allowed &&
    cache.namespace === options.namespace &&
    ts - cache.timestamp < CACHE_TTL_MS
  ) {
    core.debug('permissions previously verified for this job, skipping check')
    return true
  }

  const reviewOne = async (attrs: {
    group: string
    resource: string
    subresource: string
    namespace: string
    verb: string
  }): Promise<ReviewOutcome> => {
    try {
      const response = await withTransientRetry(
        async () => options.review(attrs),
        options.retry
      )
      return response.status?.allowed ? { kind: 'allowed' } : { kind: 'denied' }
    } catch (error) {
      return { kind: 'inconclusive', error }
    }
  }

  const reviews: Promise<ReviewOutcome>[] = []
  for (const permission of requiredPermissions) {
    for (const verb of permission.verbs) {
      reviews.push(
        reviewOne({
          group: permission.group,
          resource: permission.resource,
          subresource: permission.subresource,
          namespace: options.namespace,
          verb
        })
      )
    }
  }
  const outcomes = await Promise.all(reviews)

  if (outcomes.some(o => o.kind === 'denied')) {
    return false
  }

  const inconclusive = outcomes.filter(
    (o): o is { kind: 'inconclusive'; error: unknown } =>
      o.kind === 'inconclusive'
  )
  if (inconclusive.length > 0) {
    // The review could not be delivered. Prefer a previously-good verdict
    // within the stale grace window over aborting running jobs.
    if (
      cache?.allowed &&
      cache.namespace === options.namespace &&
      ts - cache.timestamp < CACHE_TTL_MS + CACHE_STALE_GRACE_MS
    ) {
      core.warning(
        `permission pre-check could not reach the API server (${inconclusive.length} review(s) failed); reusing the successful check from ${new Date(cache.timestamp).toISOString()}`
      )
      return true
    }
    throw new Error(
      `unable to verify the runner ServiceAccount permissions: ${inconclusive.length} of ${outcomes.length} access reviews could not be completed after ${options.retry?.retries ?? DEFAULT_RETRIES} attempts. Last error: ${formatError(inconclusive[0].error)}. This is not a permissions denial — check the API server's availability and the runner's authorization decision chain.`
    )
  }

  writeCache({ namespace: options.namespace, allowed: true, timestamp: ts })
  return true
}
