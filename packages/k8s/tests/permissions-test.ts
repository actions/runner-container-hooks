import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  isTransientApiError,
  withTransientRetry,
  hasRequiredPermissions,
  requiredPermissions
} from '../src/k8s/permissions'

const totalReviews = requiredPermissions.reduce(
  (sum, p) => sum + p.verbs.length,
  0
)

async function allowedResponse() {
  return Promise.resolve({ status: { allowed: true } })
}

describe('isTransientApiError', () => {
  it('classifies connection errors as transient', () => {
    expect(isTransientApiError({ code: 'ECONNREFUSED' })).toBe(true)
    expect(
      isTransientApiError({
        message: 'fetch failed',
        cause: { code: 'ECONNRESET' }
      })
    ).toBe(true)
    expect(
      isTransientApiError(
        new Error(
          'request to https://10.247.0.1/apis/authorization.k8s.io/v1/selfsubjectaccessreviews failed, reason: connect ECONNREFUSED 10.247.0.1:443'
        )
      )
    ).toBe(true)
  })

  it('classifies API statuses: busy/unavailable transient, not-found definitive', () => {
    for (const code of [401, 403, 408, 429, 500, 502, 503, 504]) {
      expect(isTransientApiError({ statusCode: code })).toBe(true)
      expect(isTransientApiError({ response: { status: code } })).toBe(true)
    }
    expect(isTransientApiError({ statusCode: 404 })).toBe(false)
  })

  it('does not treat unknown errors as transient', () => {
    expect(isTransientApiError(new Error('boom'))).toBe(false)
    expect(isTransientApiError(undefined)).toBe(false)
    expect(isTransientApiError('ECONNREFUSED')).toBe(false)
  })
})

describe('withTransientRetry', () => {
  it('retries transient failures with jittered delays', async () => {
    const delays: number[] = []
    const sleepFn = async (ms: number) => {
      delays.push(ms)
    }
    let calls = 0
    const result = await withTransientRetry(
      async () => {
        calls++
        if (calls < 3) {
          throw { code: 'ECONNREFUSED' }
        }
        return 'ok'
      },
      { baseMs: 500, capMs: 8000, sleepFn, random: () => 0.5 }
    )
    expect(result).toBe('ok')
    expect(calls).toBe(3)
    // equal jitter: fixed random 0.5 -> delay == backoff == base * 2^(n-1)
    expect(delays).toEqual([500, 1000])
  })

  it('does not retry definitive errors', async () => {
    const sleepFn = jest.fn(async () => {})
    await expect(
      withTransientRetry(
        async () => {
          throw { statusCode: 404 }
        },
        { sleepFn }
      )
    ).rejects.toEqual({ statusCode: 404 })
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('gives up after the retry budget', async () => {
    const sleepFn = async () => {}
    await expect(
      withTransientRetry(
        async () => {
          throw { code: 'ECONNRESET' }
        },
        { retries: 3, sleepFn }
      )
    ).rejects.toEqual({ code: 'ECONNRESET' })
  })
})

describe('hasRequiredPermissions', () => {
  let tmpDir: string
  let cacheFile: string
  const ns = 'runners'

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-cache-'))
    process.env['RUNNER_TEMP'] = tmpDir
    cacheFile = path.join(tmpDir, 'container-hooks-k8s-auth-cache.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    delete process.env['RUNNER_TEMP']
  })

  const noWait = { retries: 2, baseMs: 1, capMs: 1, sleepFn: async () => {} }

  it('returns true and persists a cache entry when all reviews pass', async () => {
    const review = jest.fn(async () => allowedResponse())
    await expect(
      hasRequiredPermissions({ namespace: ns, review, retry: noWait })
    ).resolves.toBe(true)
    expect(review).toHaveBeenCalledTimes(totalReviews)
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    expect(cached.allowed).toBe(true)
    expect(cached.namespace).toBe(ns)
  })

  it('answers from the per-job cache without calling the API', async () => {
    const first = jest.fn(async () => allowedResponse())
    await hasRequiredPermissions({
      namespace: ns,
      review: first,
      retry: noWait
    })
    const second = jest.fn(async () => allowedResponse())
    await expect(
      hasRequiredPermissions({ namespace: ns, review: second, retry: noWait })
    ).resolves.toBe(true)
    expect(second).not.toHaveBeenCalled()
  })

  it('returns false for a definitive allowed:false answer and caches nothing', async () => {
    const review = jest.fn(async attrs =>
      Promise.resolve({ status: { allowed: attrs.verb !== 'delete' } })
    )
    await expect(
      hasRequiredPermissions({ namespace: ns, review, retry: noWait })
    ).resolves.toBe(false)
    expect(fs.existsSync(cacheFile)).toBe(false)
  })

  it('throws a distinct error when reviews are undeliverable and there is no cache', async () => {
    const review = jest.fn(() => {
      throw new Error('connect ECONNREFUSED 10.247.0.1:443')
    })
    await expect(
      hasRequiredPermissions({ namespace: ns, review, retry: noWait })
    ).rejects.toThrow(/not a permissions denial/)
  })

  it('survives an API outage by reusing a recent good verdict', async () => {
    // Seed a cache entry older than the TTL but inside the stale grace.
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({
        namespace: ns,
        allowed: true,
        timestamp: Date.now() - 2 * 60 * 60 * 1000 // 2h, TTL is 1h
      })
    )
    const review = jest.fn(() => {
      throw { code: 'ECONNREFUSED' }
    })
    await expect(
      hasRequiredPermissions({ namespace: ns, review, retry: noWait })
    ).resolves.toBe(true)
  })

  it('does not reuse a cache entry from another namespace', async () => {
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({
        namespace: 'other',
        allowed: true,
        timestamp: Date.now()
      })
    )
    const review = jest.fn(() => {
      throw { code: 'ECONNREFUSED' }
    })
    await expect(
      hasRequiredPermissions({ namespace: ns, review, retry: noWait })
    ).rejects.toThrow(/not a permissions denial/)
  })

  it('recovers when the API blips and heals between retries', async () => {
    let failures = 0
    const review = jest.fn(async () => {
      if (failures++ < 20) {
        // the first probes hit the outage, everything after recovers
        throw { code: 'ECONNREFUSED' }
      }
      return allowedResponse()
    })
    await expect(
      hasRequiredPermissions({
        namespace: ns,
        review,
        retry: { retries: 5, baseMs: 1, capMs: 2, sleepFn: async () => {} }
      })
    ).resolves.toBe(true)
  })
})
