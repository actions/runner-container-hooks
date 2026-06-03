const mockExec = jest.fn()
const mockReadNamespacedPod = jest.fn()
const mockReadNamespacedJob = jest.fn()

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
        return { readNamespacedPod: mockReadNamespacedPod }
      }),
      getContexts: jest
        .fn()
        .mockReturnValue([{ namespace: 'test-namespace' }])
    })),
    Exec: jest.fn().mockImplementation(() => ({ exec: mockExec })),
    CoreV1Api: class CoreV1Api {},
    BatchV1Api: class BatchV1Api {},
    AuthorizationV1Api: class AuthorizationV1Api {},
    Log: jest.fn()
  }
})

jest.mock('tar-fs', () => ({
  default: {
    pack: jest.fn().mockReturnValue({ pipe: jest.fn() }),
    extract: jest.fn().mockReturnValue({
      on: jest.fn(),
      pipe: jest.fn()
    })
  },
  __esModule: true
}))

jest.mock('../src/k8s/utils', () => {
  const actual = jest.requireActual('../src/k8s/utils')
  return {
    ...actual,
    sleep: jest.fn().mockResolvedValue(undefined)
  }
})

import {
  execCpToPod,
  execCpFromPod,
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

  describe('execCpToPod', () => {
    it('should include Error.message in thrown error after retries', async () => {
      mockExec.mockRejectedValue(new Error('connection refused'))

      await expect(
        execCpToPod('test-pod', '/tmp/src', '/workspace')
      ).rejects.toThrow('cpToPod failed after 30 attempts: connection refused')
    })

    it('should use String() for non-Error throwables', async () => {
      mockExec.mockRejectedValue('raw string error')

      await expect(
        execCpToPod('test-pod', '/tmp/src', '/workspace')
      ).rejects.toThrow('cpToPod failed after 30 attempts: raw string error')
    })

    it('should not produce empty braces in error message', async () => {
      mockExec.mockRejectedValue(new Error('ETIMEOUT'))

      await expect(
        execCpToPod('test-pod', '/tmp/src', '/workspace')
      ).rejects.toMatchObject({
        message: expect.not.stringContaining('{}')
      })
    })
  })

  describe('execCpFromPod', () => {
    it('should include Error.message in thrown error after retries', async () => {
      mockExec.mockRejectedValue(new Error('container not found'))

      await expect(
        execCpFromPod('test-pod', '/workspace/output', '/tmp/dst')
      ).rejects.toThrow(
        'execCpFromPod failed after 30 attempts: container not found'
      )
    })

    it('should use String() for non-Error throwables', async () => {
      mockExec.mockRejectedValue(42)

      await expect(
        execCpFromPod('test-pod', '/workspace/output', '/tmp/dst')
      ).rejects.toThrow('execCpFromPod failed after 30 attempts: 42')
    })
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
      mockReadNamespacedJob.mockRejectedValue(
        new Error('403 Forbidden')
      )

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
      ).rejects.toThrow(
        /Pod test-pod is unhealthy with phase status Failed/
      )
    })

    it('should include Error.message when API call throws', async () => {
      mockReadNamespacedPod.mockRejectedValue(
        new Error('network timeout')
      )

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
      mockReadNamespacedPod.mockRejectedValue(
        new Error('socket hang up')
      )

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
