import { EventEmitter } from 'events'

const mockExec = jest.fn()

jest.mock('@kubernetes/client-node', () => {
  return {
    KubeConfig: jest.fn().mockImplementation(() => ({
      loadFromDefault: jest.fn(),
      makeApiClient: jest.fn().mockImplementation(() => ({})),
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

jest.mock('@actions/core', () => ({
  debug: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  info: jest.fn()
}))

import { execPodStep } from '../src/k8s'

class MockWebSocket extends EventEmitter {
  readyState = 1
  ping = jest.fn()
  close = jest.fn(() => {
    this.readyState = 3
    this.emit('close')
  })
}

describe('execPodStep close-without-status', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'test-namespace'
    // Keep heartbeat dormant during the test so the only settle path is the
    // close-without-status handler under test.
    process.env['ACTIONS_RUNNER_HEARTBEAT_PERIOD_MS'] = '60000'
    process.env['ACTIONS_RUNNER_HEARTBEAT_DEADLINE_MS'] = '60000'
  })

  afterEach(() => {
    delete process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE']
    delete process.env['ACTIONS_RUNNER_HEARTBEAT_PERIOD_MS']
    delete process.env['ACTIONS_RUNNER_HEARTBEAT_DEADLINE_MS']
  })

  it('rejects when the WebSocket closes without a status response', async () => {
    const ws = new MockWebSocket()

    mockExec.mockImplementation(async () => {
      // Simulate the underlying socket closing before the status callback
      // ever fires (e.g. apiserver dropped the upgraded connection).
      setImmediate(() => {
        ws.readyState = 3
        ws.emit('close')
      })
      return ws
    })

    await expect(
      execPodStep(['echo', 'hello'], 'test-pod', 'test-container')
    ).rejects.toThrow('WebSocket closed without status response')
  })

  it('resolves and does not reject again when close fires after a Success status', async () => {
    const ws = new MockWebSocket()

    mockExec.mockImplementation(async (...args: unknown[]) => {
      // The status callback is the last positional argument that
      // execPodStep passes to exec.exec.
      const statusCallback = args[args.length - 1] as (resp: {
        status: string
        code?: number
      }) => void | Promise<void>

      // Drive the status callback first. The implementation will then call
      // ws.close() itself, which (via MockWebSocket.close) emits 'close'
      // synchronously, triggering the once('close') guarded by
      // statusReceived. That guard must prevent a second settle.
      setImmediate(() => {
        void statusCallback({ status: 'Success', code: 0 })
      })

      return ws
    })

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      const result = await execPodStep(
        ['echo', 'hello'],
        'test-pod',
        'test-container'
      )
      expect(result).toBe(0)

      // Give any pending microtasks / setImmediate callbacks a chance to run
      // so a stray reject (if the regression returned) would surface.
      await new Promise(r => setImmediate(r))

      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
