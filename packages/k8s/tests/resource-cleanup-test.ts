const mockDeletePod = jest.fn()
const mockReadPod = jest.fn()
const mockListPods = jest.fn()
const mockDeleteJob = jest.fn()
const mockReadJob = jest.fn()
const mockListJobs = jest.fn()

jest.mock('@kubernetes/client-node', () => {
  const actual = jest.requireActual('@kubernetes/client-node')
  return {
    ...actual,
    KubeConfig: jest.fn().mockImplementation(() => ({
      loadFromDefault: jest.fn(),
      makeApiClient: jest.fn().mockImplementation(api => {
        if (api === actual.BatchV1Api) {
          return {
            deleteNamespacedJob: mockDeleteJob,
            readNamespacedJob: mockReadJob,
            listNamespacedJob: mockListJobs
          }
        }
        return {
          deleteNamespacedPod: mockDeletePod,
          readNamespacedPod: mockReadPod,
          listNamespacedPod: mockListPods
        }
      })
    }))
  }
})

import { ApiException } from '@kubernetes/client-node'
import { deleteJob, deletePod, pruneJobs, prunePods } from '../src/k8s'

const originalEnv = process.env
const notFound = new ApiException(404, 'Not Found', undefined, {})

beforeEach(() => {
  jest.resetAllMocks()
  jest.useFakeTimers({ now: 0 })
  process.env = {
    ...originalEnv,
    ACTIONS_RUNNER_POD_NAME: 'runner',
    ACTIONS_RUNNER_KUBERNETES_NAMESPACE: 'test-namespace',
    ACTIONS_RUNNER_PREPARE_JOB_TIMEOUT_SECONDS: '10'
  }
  mockDeletePod.mockResolvedValue({})
  mockReadPod.mockRejectedValue(notFound)
  mockListPods.mockResolvedValue({ items: [] })
  mockDeleteJob.mockResolvedValue({})
  mockReadJob.mockRejectedValue(notFound)
  mockListJobs.mockResolvedValue({ items: [] })
})

afterEach(() => {
  jest.useRealTimers()
  process.env = originalEnv
})

describe('pod cleanup', () => {
  it('uses a nonzero grace period and waits for the pod to disappear', async () => {
    mockReadPod.mockResolvedValueOnce({
      metadata: { deletionTimestamp: new Date() },
      status: { phase: 'Running' }
    })
    let finished = false
    const deletion = deletePod('old-pod').then(() => {
      finished = true
    })

    await jest.advanceTimersByTimeAsync(0)
    expect(mockDeletePod).toHaveBeenCalledWith({
      name: 'old-pod',
      namespace: 'test-namespace',
      gracePeriodSeconds: 1
    })
    expect(finished).toBe(false)
    await jest.runAllTimersAsync()
    await deletion
    expect(mockReadPod).toHaveBeenCalledTimes(2)
  })

  it('tolerates an already deleted pod', async () => {
    mockDeletePod.mockRejectedValue(notFound)

    await expect(deletePod('old-pod')).resolves.toBeUndefined()
  })

  it('does not swallow a deletion failure', async () => {
    mockDeletePod.mockRejectedValue(
      new ApiException(403, 'Forbidden', undefined, {})
    )
    mockListPods.mockResolvedValue({
      items: [{ metadata: { name: 'old-pod' } }]
    })

    await expect(prunePods()).rejects.toThrow('Failed to delete pod old-pod')
  })

  it('does not swallow a read failure while waiting for termination', async () => {
    mockReadPod.mockRejectedValue(new Error('connection lost'))

    await expect(deletePod('old-pod')).rejects.toThrow(
      'Failed to wait for deletion of pod old-pod: connection lost'
    )
  })

  it('fails closed when a pod does not terminate before the timeout', async () => {
    mockReadPod.mockResolvedValue({ status: { phase: 'Running' } })
    mockListPods.mockResolvedValue({
      items: [{ metadata: { name: 'old-pod' } }]
    })
    const result = expect(prunePods()).rejects.toThrow(
      'Failed to wait for deletion of pod old-pod: backoff timeout'
    )

    await jest.runAllTimersAsync()
    await result
    expect(Date.now()).toBeGreaterThan(10 * 1000)
    expect(mockDeletePod).toHaveBeenCalledTimes(1)
  })
})

describe('job cleanup', () => {
  it('waits for the controller to disappear before gracefully deleting all its pods', async () => {
    mockReadJob.mockResolvedValueOnce({
      metadata: { deletionTimestamp: new Date() }
    })
    mockListPods.mockResolvedValue({
      items: [
        {
          metadata: { name: 'step-pod-1' },
          spec: { terminationGracePeriodSeconds: 0 }
        },
        { metadata: { name: 'step-pod-2' } }
      ]
    })
    mockReadPod.mockResolvedValueOnce({ status: { phase: 'Running' } })
    let finished = false
    const deletion = deleteJob('step-job').then(() => {
      finished = true
    })

    await jest.advanceTimersByTimeAsync(0)
    expect(mockDeleteJob).toHaveBeenCalledWith({
      name: 'step-job',
      namespace: 'test-namespace',
      propagationPolicy: 'Orphan'
    })
    expect(mockDeletePod).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1000)
    expect(mockListPods).toHaveBeenCalledWith({
      namespace: 'test-namespace',
      labelSelector: 'job-name=step-job'
    })
    expect(mockDeletePod).toHaveBeenCalledTimes(2)
    expect(mockDeletePod).toHaveBeenCalledWith({
      name: 'step-pod-1',
      namespace: 'test-namespace',
      gracePeriodSeconds: 1
    })
    expect(finished).toBe(false)

    await jest.runAllTimersAsync()
    await deletion
    expect(mockReadPod).toHaveBeenCalledTimes(3)
  })

  it('still deletes remaining pods if the Job has already gone', async () => {
    mockDeleteJob.mockRejectedValue(notFound)
    mockListPods.mockResolvedValue({
      items: [{ metadata: { name: 'step-pod' } }]
    })

    await deleteJob('step-job')

    expect(mockDeletePod).toHaveBeenCalledWith({
      name: 'step-pod',
      namespace: 'test-namespace',
      gracePeriodSeconds: 1
    })
  })

  it('does not delete pods while a Job controller can still create replacements', async () => {
    mockReadJob.mockResolvedValue({ metadata: { name: 'step-job' } })
    const result = expect(deleteJob('step-job')).rejects.toThrow(
      'Failed to wait for deletion of job step-job: backoff timeout'
    )

    await jest.runAllTimersAsync()
    await result
    expect(mockListPods).not.toHaveBeenCalled()
    expect(mockDeletePod).not.toHaveBeenCalled()
  })

  it('does not swallow a Job deletion failure', async () => {
    mockDeleteJob.mockRejectedValue(new Error('Forbidden'))
    mockListJobs.mockResolvedValue({
      items: [{ metadata: { name: 'step-job' } }]
    })

    await expect(pruneJobs()).rejects.toThrow(
      'Failed to delete job step-job: Forbidden'
    )
    expect(mockDeletePod).not.toHaveBeenCalled()
  })

  it('does not swallow pod deletion failures after orphaning a Job', async () => {
    mockDeletePod.mockRejectedValue(new Error('Forbidden'))
    mockListPods.mockResolvedValue({
      items: [{ metadata: { name: 'step-pod' } }]
    })
    mockListJobs.mockResolvedValue({
      items: [{ metadata: { name: 'step-job' } }]
    })

    await expect(pruneJobs()).rejects.toThrow(
      'Failed to delete job step-job: Forbidden'
    )
  })
})

it('scopes fallback cleanup to this runner', async () => {
  await pruneJobs()
  await prunePods()

  const selector = {
    namespace: 'test-namespace',
    labelSelector: 'runner-pod=runner'
  }
  expect(mockListJobs).toHaveBeenCalledWith(selector)
  expect(mockListPods).toHaveBeenCalledWith(selector)
})
