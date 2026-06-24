import * as k8s from '@kubernetes/client-node'

// Silence retry warnings emitted by the wrapper.
jest.mock('@actions/core', () => ({
  warning: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  setFailed: jest.fn(),
  setOutput: jest.fn()
}))

// Replace sleep so retry backoff doesn't actually wait, and we can assert
// what delay the wrapper requested.
jest.mock('../src/k8s/utils', () => ({
  ...jest.requireActual('../src/k8s/utils'),
  sleep: jest.fn().mockResolvedValue(undefined)
}))

// Replace KubeConfig so the module-level k8sApi/k8sBatchV1Api/k8sAuthorizationV1Api
// are wired to a fake API we control. Every real class (ApiException, V1Pod,
// V1Secret, etc.) is preserved via jest.requireActual so `instanceof` checks
// and constructors still work normally.
jest.mock('@kubernetes/client-node', () => {
  const actual = jest.requireActual('@kubernetes/client-node')
  const fakeApi: Record<string, jest.Mock> = {
    createNamespacedPod: jest.fn(),
    readNamespacedPod: jest.fn(),
    deleteNamespacedPod: jest.fn(),
    listNamespacedPod: jest.fn(),
    createNamespacedSecret: jest.fn(),
    readNamespacedSecret: jest.fn(),
    deleteNamespacedSecret: jest.fn(),
    listNamespacedSecret: jest.fn(),
    readNamespacedJob: jest.fn(),
    createSelfSubjectAccessReview: jest.fn()
  }
  class FakeKubeConfig {
    loadFromDefault(): void {}
    getContexts(): unknown[] {
      return [{ namespace: 'test-ns', name: 'test', cluster: 'c', user: 'u' }]
    }
    makeApiClient(): typeof fakeApi {
      return fakeApi
    }
  }
  return {
    ...actual,
    __getFakeApi: () => fakeApi,
    KubeConfig: FakeKubeConfig
  }
})

import { sleep } from '../src/k8s/utils'
import {
  createDockerSecret,
  createSecretForEnvs,
  deletePod,
  deleteSecret,
  withRetryClient
} from '../src/k8s'

const fakeApi = (
  k8s as unknown as {
    __getFakeApi: () => Record<string, jest.Mock>
  }
).__getFakeApi()
const mockedSleep = sleep as jest.Mock

function apiException(
  code: number,
  headers: Record<string, string> = {}
): k8s.ApiException<unknown> {
  return new k8s.ApiException(code, `status ${code}`, {}, headers)
}

function networkError(code: string): Error {
  const err = new Error(`network error ${code}`) as Error & { code: string }
  err.code = code
  return err
}

beforeAll(() => {
  process.env.ACTIONS_RUNNER_POD_NAME = 'test-runner'
  process.env.ACTIONS_RUNNER_KUBERNETES_NAMESPACE = 'test-ns'
})

beforeEach(() => {
  for (const fn of Object.values(fakeApi)) {
    fn.mockReset()
  }
  mockedSleep.mockReset()
  mockedSleep.mockResolvedValue(undefined)
})

describe('withRetryClient', () => {
  it('returns value on first attempt without sleeping', async () => {
    const fn = jest.fn().mockResolvedValue('ok')
    const wrapped = withRetryClient({ call: fn }) as { call: typeof fn }
    await expect(wrapped.call('arg')).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('arg')
    expect(mockedSleep).not.toHaveBeenCalled()
  })

  it('retries on retryable network error and eventually succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(networkError('ECONNRESET'))
      .mockRejectedValueOnce(networkError('ETIMEDOUT'))
      .mockResolvedValueOnce('ok')
    const wrapped = withRetryClient({ call: fn }) as { call: typeof fn }
    await expect(wrapped.call()).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(mockedSleep).toHaveBeenCalledTimes(2)
  })

  it('gives up after MAX_RETRIES and throws the final error', async () => {
    const err = apiException(500)
    const fn = jest.fn().mockRejectedValue(err)
    const wrapped = withRetryClient({ call: fn }) as { call: typeof fn }
    await expect(wrapped.call()).rejects.toBe(err)
    // 1 initial attempt + 3 retries = 4 calls, with sleep between each pair
    // of consecutive attempts but not after the final failure.
    expect(fn).toHaveBeenCalledTimes(4)
    expect(mockedSleep).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-retryable ApiException (e.g. 409)', async () => {
    const err = apiException(409)
    const fn = jest.fn().mockRejectedValue(err)
    const wrapped = withRetryClient({ call: fn }) as { call: typeof fn }
    await expect(wrapped.call()).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(mockedSleep).not.toHaveBeenCalled()
  })

  it('does not retry plain Error with no retryable code', async () => {
    const err = new Error('boom')
    const fn = jest.fn().mockRejectedValue(err)
    const wrapped = withRetryClient({ call: fn }) as { call: typeof fn }
    await expect(wrapped.call()).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('uses Retry-After header value for 429', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(apiException(429, { 'retry-after': '7' }))
      .mockResolvedValueOnce('ok')
    const wrapped = withRetryClient({ call: fn }) as { call: typeof fn }
    await expect(wrapped.call()).resolves.toBe('ok')
    expect(mockedSleep).toHaveBeenCalledWith(7000)
  })

  it('uses exponential backoff for non-429 retryable errors', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(apiException(500))
      .mockResolvedValueOnce('ok')
    const wrapped = withRetryClient({ call: fn }) as { call: typeof fn }
    await expect(wrapped.call()).resolves.toBe('ok')
    // retryDelay(0) = 1000 * 2^0 * (0.5..1.5) = 500..1500
    const delay = mockedSleep.mock.calls[0][0]
    expect(delay).toBeGreaterThanOrEqual(500)
    expect(delay).toBeLessThanOrEqual(1500)
  })

  it('passes non-function properties through untouched', () => {
    const target = { name: 'k8sApi', count: 42, fn: jest.fn() }
    const wrapped = withRetryClient(target)
    expect(wrapped.name).toBe('k8sApi')
    expect(wrapped.count).toBe(42)
    expect(typeof wrapped.fn).toBe('function')
  })
})

describe('idempotent write fallbacks', () => {
  describe('createSecretForEnvs', () => {
    it('returns the secret name when create succeeds', async () => {
      fakeApi.createNamespacedSecret.mockResolvedValue({})
      const name = await createSecretForEnvs({ FOO: 'bar' })
      expect(name).toMatch(/-secret-/)
      expect(fakeApi.createNamespacedSecret).toHaveBeenCalledTimes(1)
      expect(fakeApi.readNamespacedSecret).not.toHaveBeenCalled()
    })

    it('returns the secret name on 409 when existing data matches', async () => {
      const envs = { FOO: 'bar', BAZ: 'qux' }
      const expectedData: Record<string, string> = {}
      for (const [k, v] of Object.entries(envs)) {
        expectedData[k] = Buffer.from(v).toString('base64')
      }
      fakeApi.createNamespacedSecret.mockRejectedValue(apiException(409))
      fakeApi.readNamespacedSecret.mockResolvedValue({ data: expectedData })

      const name = await createSecretForEnvs(envs)
      expect(name).toMatch(/-secret-/)
      expect(fakeApi.readNamespacedSecret).toHaveBeenCalledTimes(1)
    })

    it('throws on 409 when existing data differs', async () => {
      fakeApi.createNamespacedSecret.mockRejectedValue(apiException(409))
      fakeApi.readNamespacedSecret.mockResolvedValue({
        data: { FOO: Buffer.from('stale').toString('base64') }
      })
      await expect(createSecretForEnvs({ FOO: 'bar' })).rejects.toThrow(
        /does not match the requested envs/
      )
    })

    it('rethrows non-409 errors without reading', async () => {
      fakeApi.createNamespacedSecret.mockRejectedValue(apiException(403))
      await expect(createSecretForEnvs({ FOO: 'bar' })).rejects.toBeInstanceOf(
        k8s.ApiException
      )
      expect(fakeApi.readNamespacedSecret).not.toHaveBeenCalled()
    })
  })

  describe('createDockerSecret', () => {
    const registry = {
      serverUrl: 'https://reg.example.com',
      username: 'u',
      password: 'p'
    }

    it('returns existing secret on 409 when data matches', async () => {
      // Echo back whatever the function tried to write so the comparison
      // passes — this exercises the matching branch without re-deriving the
      // function's dockerconfigjson encoding here.
      let attempted: { data?: Record<string, string> } = {}
      fakeApi.createNamespacedSecret.mockImplementation(
        async (req: { body: { data?: Record<string, string> } }) => {
          attempted = req.body
          throw apiException(409)
        }
      )
      fakeApi.readNamespacedSecret.mockImplementation(async () => ({
        data: attempted.data
      }))

      const result = await createDockerSecret(registry)
      expect(result).toBeDefined()
      expect(fakeApi.readNamespacedSecret).toHaveBeenCalledTimes(1)
    })

    it('throws on 409 with mismatched credentials', async () => {
      fakeApi.createNamespacedSecret.mockRejectedValue(apiException(409))
      fakeApi.readNamespacedSecret.mockResolvedValue({
        data: { '.dockerconfigjson': Buffer.from('stale').toString('base64') }
      })
      await expect(createDockerSecret(registry)).rejects.toThrow(
        /does not match the requested registry credentials/
      )
    })
  })

  describe('delete handlers', () => {
    it('deletePod swallows 404', async () => {
      fakeApi.deleteNamespacedPod.mockRejectedValue(apiException(404))
      await expect(deletePod('p')).resolves.toBeUndefined()
    })

    it('deletePod rethrows other errors', async () => {
      fakeApi.deleteNamespacedPod.mockRejectedValue(apiException(403))
      await expect(deletePod('p')).rejects.toBeInstanceOf(k8s.ApiException)
    })

    it('deleteSecret swallows 404', async () => {
      fakeApi.deleteNamespacedSecret.mockRejectedValue(apiException(404))
      await expect(deleteSecret('s')).resolves.toBeUndefined()
    })

    it('deleteSecret rethrows other errors', async () => {
      fakeApi.deleteNamespacedSecret.mockRejectedValue(apiException(403))
      await expect(deleteSecret('s')).rejects.toBeInstanceOf(k8s.ApiException)
    })
  })
})
