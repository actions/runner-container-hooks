const mockExec = jest.fn()
const mockReadNamespacedPod = jest.fn()
const mockReadNamespacedJob = jest.fn()
const mockListNamespacedPod = jest.fn()

jest.mock('@kubernetes/client-node', () => {
  return {
    KubeConfig: jest.fn().mockImplementation(() => ({
      loadFromDefault: jest.fn(),
      makeApiClient: jest.fn().mockImplementation(ApiClass => {
        const name = ApiClass?.name || ApiClass?.toString() || ''
        if (name.includes('Batch')) {
          return { readNamespacedJob: mockReadNamespacedJob }
        }
        if (name.includes('Authorization')) {
          return { createSelfSubjectAccessReview: jest.fn() }
        }
        return {
          readNamespacedPod: mockReadNamespacedPod,
          listNamespacedPod: mockListNamespacedPod
        }
      }),
      getContexts: jest.fn().mockReturnValue([{ namespace: 'test-namespace' }])
    })),
    Exec: jest.fn().mockImplementation(() => ({ exec: mockExec })),
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    CoreV1Api: class CoreV1Api {},
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    BatchV1Api: class BatchV1Api {},
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    AuthorizationV1Api: class AuthorizationV1Api {},
    Log: jest.fn()
  }
})

jest.mock('../src/k8s/utils', () => {
  const actual = jest.requireActual('../src/k8s/utils')
  return {
    ...actual,
    sleep: jest.fn().mockResolvedValue(undefined)
  }
})

import {
  getContainerJobPodName,
  waitForJobToComplete,
  waitForPodPhases
} from '../src/k8s'
import { PodPhase } from '../src/k8s/utils'

describe('error serialization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'test-namespace'
  })

  afterEach(() => {
    delete process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE']
  })

  describe('getContainerJobPodName', () => {
    const originalTimeout =
      process.env.ACTIONS_RUNNER_PREPARE_JOB_TIMEOUT_SECONDS

    beforeEach(() => {
      jest.useFakeTimers({ now: 0 })
      delete process.env.ACTIONS_RUNNER_PREPARE_JOB_TIMEOUT_SECONDS
    })

    afterEach(() => {
      jest.useRealTimers()
      if (originalTimeout === undefined) {
        delete process.env.ACTIONS_RUNNER_PREPARE_JOB_TIMEOUT_SECONDS
      } else {
        process.env.ACTIONS_RUNNER_PREPARE_JOB_TIMEOUT_SECONDS = originalTimeout
      }
    })

    it.each([
      [undefined, 120],
      ['1800', 1200]
    ])(
      'allows pod discovery after %p timeout configuration and %p seconds of delay',
      async (configured, delaySeconds) => {
        if (configured !== undefined) {
          process.env.ACTIONS_RUNNER_PREPARE_JOB_TIMEOUT_SECONDS = configured
        }
        mockListNamespacedPod.mockImplementation(async () => ({
          items:
            Date.now() >= delaySeconds * 1000
              ? [{ metadata: { name: 'step-pod' } }]
              : []
        }))

        const result = expect(getContainerJobPodName('step-job')).resolves.toBe(
          'step-pod'
        )
        await jest.runAllTimersAsync()
        await result

        expect(Date.now()).toBeGreaterThanOrEqual(delaySeconds * 1000)
        expect(mockListNamespacedPod).toHaveBeenCalledWith({
          namespace: 'test-namespace',
          labelSelector: 'job-name=step-job',
          limit: 1
        })
      }
    )

    it.each([
      [undefined, 600],
      ['1800', 1800],
      ['1', 1]
    ])(
      'times out pod discovery with configuration %p after %p seconds',
      async (configured, timeoutSeconds) => {
        if (configured !== undefined) {
          process.env.ACTIONS_RUNNER_PREPARE_JOB_TIMEOUT_SECONDS = configured
        }
        mockListNamespacedPod.mockResolvedValue({ items: [] })

        const result = expect(
          getContainerJobPodName('step-job')
        ).rejects.toThrow('backoff timeout')
        await jest.runAllTimersAsync()
        await result

        expect(Date.now()).toBeGreaterThan(timeoutSeconds * 1000)
        expect(Date.now()).toBeLessThanOrEqual((timeoutSeconds + 20) * 1000)
      }
    )
  })

  describe('waitForJobToComplete', () => {
    it('should include Error.message when job fails', async () => {
      mockReadNamespacedJob.mockResolvedValue({
        status: { failed: 1 }
      })

      await expect(waitForJobToComplete('my-job')).rejects.toThrow(
        'job my-job has failed: job my-job has failed'
      )
    })

    it('should include Error.message when API call throws', async () => {
      mockReadNamespacedJob.mockRejectedValue(new Error('403 Forbidden'))

      await expect(waitForJobToComplete('my-job')).rejects.toThrow(
        'job my-job has failed: 403 Forbidden'
      )
    })

    it('should use String() for non-Error throwables from API', async () => {
      mockReadNamespacedJob.mockRejectedValue('unexpected API failure')

      await expect(waitForJobToComplete('my-job')).rejects.toThrow(
        'job my-job has failed: unexpected API failure'
      )
    })
  })

  describe('waitForPodPhases', () => {
    it('should include error message when pod enters unhealthy phase', async () => {
      mockReadNamespacedPod.mockResolvedValue({
        status: { phase: 'Failed' }
      })

      await expect(
        waitForPodPhases(
          'test-pod',
          new Set([PodPhase.RUNNING]),
          new Set([PodPhase.PENDING])
        )
      ).rejects.toThrow(/Pod test-pod is unhealthy with phase status Failed/)
    })

    it('should include Error.message when API call throws', async () => {
      mockReadNamespacedPod.mockRejectedValue(new Error('network timeout'))

      await expect(
        waitForPodPhases(
          'test-pod',
          new Set([PodPhase.RUNNING]),
          new Set([PodPhase.PENDING])
        )
      ).rejects.toThrow(
        'Pod test-pod is unhealthy with phase status Unknown: network timeout'
      )
    })

    it('should not produce empty braces from Error objects', async () => {
      mockReadNamespacedPod.mockRejectedValue(new Error('socket hang up'))

      try {
        await waitForPodPhases(
          'test-pod',
          new Set([PodPhase.RUNNING]),
          new Set([PodPhase.PENDING])
        )
        fail('Expected waitForPodPhases to throw')
      } catch (error) {
        const msg = (error as Error).message
        expect(msg).not.toContain('{}')
        expect(msg).toContain('socket hang up')
      }
    })
  })
})
