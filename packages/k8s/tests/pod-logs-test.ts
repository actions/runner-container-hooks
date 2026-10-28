import { PassThrough } from 'stream'
import { getPodLogs } from '../src/k8s'

const mockLog = jest.fn()

jest.mock('@kubernetes/client-node', () => {
  const actual = jest.requireActual('@kubernetes/client-node')
  return {
    ...actual,
    Log: jest.fn().mockImplementation(() => ({ log: mockLog }))
  }
})

describe('pod log completion', () => {
  const originalNamespace = process.env.ACTIONS_RUNNER_KUBERNETES_NAMESPACE
  let controller: AbortController

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    mockLog.mockReset()
    controller = new AbortController()
    process.env.ACTIONS_RUNNER_KUBERNETES_NAMESPACE = 'test'
  })

  afterEach(() => {
    jest.useRealTimers()
    if (originalNamespace === undefined) {
      delete process.env.ACTIONS_RUNNER_KUBERNETES_NAMESPACE
    } else {
      process.env.ACTIONS_RUNNER_KUBERNETES_NAMESPACE = originalNamespace
    }
  })

  async function resultWithinDeadline(): Promise<string> {
    const result = Promise.race([
      getPodLogs('pod', 'container').then(
        () => 'completed',
        (error: Error) => error.message
      ),
      new Promise<string>(resolve => setTimeout(() => resolve('pending'), 100))
    ])
    await jest.advanceTimersByTimeAsync(100)
    return result
  }

  it('handles a stream that ends before the request returns', async () => {
    mockLog.mockImplementation(
      async (_ns, _pod, _container, output: PassThrough) => {
        output.end()
        await new Promise(resolve => setImmediate(resolve))
        return controller
      }
    )

    expect(await resultWithinDeadline()).toBe('completed')
    expect(controller.signal.aborted).toBe(true)
  })

  it('rejects stream errors instead of waiting forever', async () => {
    mockLog.mockImplementation(
      async (_ns, _pod, _container, output: PassThrough) => {
        setImmediate(() => output.destroy(new Error('log connection lost')))
        return controller
      }
    )

    expect(await resultWithinDeadline()).toBe('log connection lost')
    expect(controller.signal.aborted).toBe(true)
  })

  it('rejects premature stream closure', async () => {
    mockLog.mockImplementation(
      async (_ns, _pod, _container, output: PassThrough) => {
        setImmediate(() => output.destroy())
        return controller
      }
    )

    expect(await resultWithinDeadline()).toMatch(/premature close/i)
    expect(controller.signal.aborted).toBe(true)
  })

  it('destroys the stream when the request fails', async () => {
    let output: PassThrough | undefined
    mockLog.mockImplementation(
      async (_ns, _pod, _container, stream: PassThrough) => {
        output = stream
        throw new Error('request failed')
      }
    )

    expect(await resultWithinDeadline()).toBe('request failed')
    expect(output?.destroyed).toBe(true)
  })

  it('aborts a late request after a stream failure', async () => {
    mockLog.mockImplementation(
      async (_ns, _pod, _container, output: PassThrough) => {
        output.destroy(new Error('early stream failure'))
        await new Promise(resolve => setTimeout(resolve, 200))
        return controller
      }
    )

    expect(await resultWithinDeadline()).toBe('early stream failure')
    await jest.advanceTimersByTimeAsync(200)
    expect(controller.signal.aborted).toBe(true)
  })
})
