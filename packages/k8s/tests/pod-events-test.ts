const mockReadNamespacedPod = jest.fn()
const mockListNamespacedEvent = jest.fn()

jest.mock('@kubernetes/client-node', () => {
  return {
    KubeConfig: jest.fn().mockImplementation(() => ({
      loadFromDefault: jest.fn(),
      makeApiClient: jest.fn().mockImplementation(ApiClass => {
        const name = ApiClass?.name || ApiClass?.toString() || ''
        if (name.includes('Batch')) {
          return { readNamespacedJob: jest.fn() }
        }
        if (name.includes('Authorization')) {
          return { createSelfSubjectAccessReview: jest.fn() }
        }
        return {
          readNamespacedPod: mockReadNamespacedPod,
          listNamespacedEvent: mockListNamespacedEvent
        }
      }),
      getContexts: jest.fn().mockReturnValue([{ namespace: 'test-namespace' }])
    })),
    Exec: jest.fn().mockImplementation(() => ({ exec: jest.fn() })),
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    CoreV1Api: class CoreV1Api {},
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    BatchV1Api: class BatchV1Api {},
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
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

import { waitForPodPhases } from '../src/k8s'
import { PodPhase } from '../src/k8s/utils'

// awaiting RUNNING / backing-off PENDING mirrors the real prepare-job call.
// A pod reported in any other phase falls straight into the unhealthy-throw
// path, which is the catch block that enriches the error with Warning events.
const awaitingPhases = (): Set<PodPhase> => new Set([PodPhase.RUNNING])
const backOffPhases = (): Set<PodPhase> => new Set([PodPhase.PENDING])

describe('waitForPodPhases Warning event enrichment', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'test-namespace'
  })

  afterEach(() => {
    delete process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE']
  })

  it('appends recent Warning events to the thrown error', async () => {
    mockReadNamespacedPod.mockResolvedValue({ status: { phase: 'Failed' } })
    mockListNamespacedEvent.mockResolvedValue({
      items: [
        {
          reason: 'FailedScheduling',
          message: '0/3 nodes are available: 3 Too many pods.',
          lastTimestamp: new Date('2026-06-05T10:00:00Z'),
          type: 'Warning'
        }
      ]
    })

    await expect(
      waitForPodPhases('test-pod', awaitingPhases(), backOffPhases())
    ).rejects.toThrow(
      'events: [FailedScheduling] 0/3 nodes are available: 3 Too many pods.'
    )
  })

  it('queries Warning events scoped to the pod in the right namespace', async () => {
    mockReadNamespacedPod.mockResolvedValue({ status: { phase: 'Failed' } })
    mockListNamespacedEvent.mockResolvedValue({ items: [] })

    await expect(
      waitForPodPhases('test-pod', awaitingPhases(), backOffPhases())
    ).rejects.toThrow(/unhealthy with phase status Failed/)

    expect(mockListNamespacedEvent).toHaveBeenCalledWith({
      namespace: 'test-namespace',
      fieldSelector: 'involvedObject.name=test-pod,type=Warning'
    })
  })

  it('keeps only the 3 most recent events, newest first', async () => {
    mockReadNamespacedPod.mockResolvedValue({ status: { phase: 'Failed' } })
    mockListNamespacedEvent.mockResolvedValue({
      items: [
        {
          reason: 'Oldest',
          message: 'm0',
          lastTimestamp: new Date('2026-06-05T10:00:00Z')
        },
        {
          reason: 'Newest',
          message: 'm3',
          lastTimestamp: new Date('2026-06-05T10:03:00Z')
        },
        {
          reason: 'Middle',
          message: 'm1',
          // exercise the eventTime fallback when lastTimestamp is absent
          eventTime: new Date('2026-06-05T10:01:00Z')
        },
        {
          reason: 'Later',
          message: 'm2',
          lastTimestamp: new Date('2026-06-05T10:02:00Z')
        }
      ]
    })

    let message = ''
    try {
      await waitForPodPhases('test-pod', awaitingPhases(), backOffPhases())
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('events: [Newest] m3; [Later] m2; [Middle] m1')
    expect(message).not.toContain('Oldest')
  })

  it('does not append an events section when there are none', async () => {
    mockReadNamespacedPod.mockResolvedValue({ status: { phase: 'Failed' } })
    mockListNamespacedEvent.mockResolvedValue({ items: [] })

    let message = ''
    try {
      await waitForPodPhases('test-pod', awaitingPhases(), backOffPhases())
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('unhealthy with phase status Failed')
    expect(message).not.toContain('events:')
  })

  it('is best-effort: a failed event lookup never shadows the original error', async () => {
    mockReadNamespacedPod.mockRejectedValue(new Error('network timeout'))
    mockListNamespacedEvent.mockRejectedValue(
      new Error('events is forbidden: User cannot list events')
    )

    let message = ''
    try {
      await waitForPodPhases('test-pod', awaitingPhases(), backOffPhases())
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain(
      'Pod test-pod is unhealthy with phase status Unknown: network timeout'
    )
    expect(message).not.toContain('events:')
    expect(message).not.toContain('forbidden')
  })
})
