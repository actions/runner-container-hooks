import * as k8s from '@kubernetes/client-node'
import { isRetryableError, retryAfterDelay } from '../src/k8s'

function apiException(
  code: number,
  headers: { [key: string]: string } = {}
): k8s.ApiException<unknown> {
  return new k8s.ApiException(code, `status ${code}`, {}, headers)
}

function networkError(code: string, cause?: unknown): Error {
  const err = new Error(`network error ${code}`) as Error & {
    code: string
    cause?: unknown
  }
  err.code = code
  if (cause !== undefined) {
    err.cause = cause
  }
  return err
}

describe('isRetryableError', () => {
  it.each([408, 429, 500, 502, 503, 504])(
    'returns true for ApiException with status %i',
    code => {
      expect(isRetryableError(apiException(code))).toBe(true)
    }
  )

  it.each([400, 401, 403, 404, 409, 422])(
    'returns false for ApiException with status %i',
    code => {
      expect(isRetryableError(apiException(code))).toBe(false)
    }
  )

  it('returns false for ApiException even if cause chain has a retryable network code', () => {
    // The ApiException branch does not descend into the cause chain —
    // if the API responded 400, retrying is pointless regardless of
    // what happened underneath. Documents current precedence.
    const inner = networkError('ECONNRESET')
    const err = apiException(400)
    ;(err as unknown as { cause: unknown }).cause = inner
    expect(isRetryableError(err)).toBe(false)
  })

  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENETUNREACH',
    'EAI_AGAIN',
    'ENOTFOUND'
  ])('returns true for plain Error with network code %s', code => {
    expect(isRetryableError(networkError(code))).toBe(true)
  })

  it('returns false for plain Error with non-retryable code', () => {
    expect(isRetryableError(networkError('EACCES'))).toBe(false)
  })

  it('returns true when a retryable code is nested in the cause chain', () => {
    const root = networkError('ECONNRESET')
    const middle = new Error('middle') as Error & { cause: unknown }
    middle.cause = root
    const outer = new Error('outer') as Error & { cause: unknown }
    outer.cause = middle
    expect(isRetryableError(outer)).toBe(true)
  })

  it('returns false for null', () => {
    expect(isRetryableError(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isRetryableError(undefined)).toBe(false)
  })

  it('returns false for a string', () => {
    expect(isRetryableError('ECONNRESET')).toBe(false)
  })

  it('returns false for Error with no code property', () => {
    expect(isRetryableError(new Error('boom'))).toBe(false)
  })

  it('returns false for Error whose code is non-string', () => {
    const err = new Error('boom') as Error & { code: number }
    err.code = 42
    expect(isRetryableError(err)).toBe(false)
  })
})

describe('retryAfterDelay', () => {
  it('falls back to exponential backoff when Retry-After header is missing', () => {
    const delay = retryAfterDelay(apiException(429), 0)
    // retryDelay(0) = 1000 * 1 * (0.5..1.5) = 500..1500
    expect(delay).toBeGreaterThanOrEqual(500)
    expect(delay).toBeLessThanOrEqual(1500)
  })

  it('uses lowercase retry-after header value in seconds', () => {
    const delay = retryAfterDelay(apiException(429, { 'retry-after': '5' }), 0)
    expect(delay).toBe(5000)
  })

  it('uses capitalized Retry-After header', () => {
    const delay = retryAfterDelay(apiException(429, { 'Retry-After': '7' }), 0)
    expect(delay).toBe(7000)
  })

  it('caps the delay at 30 seconds', () => {
    const delay = retryAfterDelay(
      apiException(429, { 'retry-after': '600' }),
      0
    )
    expect(delay).toBe(30_000)
  })

  it('falls back when Retry-After value is not numeric (HTTP-date format)', () => {
    // Per RFC 7231 the header may be an HTTP-date; we only handle seconds.
    const delay = retryAfterDelay(
      apiException(429, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }),
      1
    )
    // retryDelay(1) = 2000 * (0.5..1.5) = 1000..3000
    expect(delay).toBeGreaterThanOrEqual(1000)
    expect(delay).toBeLessThanOrEqual(3000)
  })

  it('falls back when Retry-After is zero', () => {
    const delay = retryAfterDelay(apiException(429, { 'retry-after': '0' }), 2)
    // retryDelay(2) = 4000 * (0.5..1.5) = 2000..6000
    expect(delay).toBeGreaterThanOrEqual(2000)
    expect(delay).toBeLessThanOrEqual(6000)
  })

  it('falls back when Retry-After is negative', () => {
    const delay = retryAfterDelay(apiException(429, { 'retry-after': '-5' }), 0)
    expect(delay).toBeGreaterThanOrEqual(500)
    expect(delay).toBeLessThanOrEqual(1500)
  })

  it('falls back when Retry-After is empty', () => {
    const delay = retryAfterDelay(apiException(429, { 'retry-after': '' }), 0)
    expect(delay).toBeGreaterThanOrEqual(500)
    expect(delay).toBeLessThanOrEqual(1500)
  })
})
