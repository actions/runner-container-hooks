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

import { EventEmitter } from 'events'
import { execPodStep } from '../src/k8s'

interface FakeWebSocket extends EventEmitter {
  readyState: number
  terminate: jest.Mock
  close: jest.Mock
  ping: jest.Mock
}

function makeFakeWebSocket(readyState = 1): FakeWebSocket {
  const ws = new EventEmitter() as FakeWebSocket
  ws.readyState = readyState
  ws.terminate = jest.fn(() => {
    process.nextTick(() => ws.emit('close'))
  })
  ws.close = jest.fn(() => {
    process.nextTick(() => ws.emit('close'))
  })
  ws.ping = jest.fn()
  return ws
}

describe('safeTerminateWs (via execPodStep cleanup paths)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'test-namespace'
    // Keep the heartbeat from interfering with the test timing.
    process.env['ACTIONS_RUNNER_HEARTBEAT_PERIOD_MS'] = '600000'
    process.env['ACTIONS_RUNNER_HEARTBEAT_DEADLINE_MS'] = '600000'
  })

  afterEach(() => {
    delete process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE']
    delete process.env['ACTIONS_RUNNER_HEARTBEAT_PERIOD_MS']
    delete process.env['ACTIONS_RUNNER_HEARTBEAT_DEADLINE_MS']
  })

  it('calls terminate() (not close()) on the success-status cleanup path', async () => {
    const ws = makeFakeWebSocket()
    mockExec.mockImplementation(
      async (
        _ns,
        _pod,
        _container,
        _cmd,
        _stdout,
        _stderr,
        _stdin,
        _tty,
        statusCb
      ) => {
        // Fire the status callback asynchronously so callers can attach
        // .then/.catch first (mimics kc's Exec behavior).
        process.nextTick(() => statusCb({ status: 'Success', code: 0 }))
        return ws
      }
    )

    await expect(
      execPodStep(['echo', 'hi'], 'pod', 'container')
    ).resolves.toBe(0)

    expect(ws.terminate).toHaveBeenCalledTimes(1)
    expect(ws.close).not.toHaveBeenCalled()
  })

  it('calls terminate() (not close()) on the failure-status cleanup path', async () => {
    const ws = makeFakeWebSocket()
    mockExec.mockImplementation(
      async (
        _ns,
        _pod,
        _container,
        _cmd,
        _stdout,
        _stderr,
        _stdin,
        _tty,
        statusCb
      ) => {
        process.nextTick(() =>
          statusCb({ status: 'Failure', message: 'boom' })
        )
        return ws
      }
    )

    await expect(
      execPodStep(['echo', 'hi'], 'pod', 'container')
    ).rejects.toThrow('boom')

    expect(ws.terminate).toHaveBeenCalledTimes(1)
    expect(ws.close).not.toHaveBeenCalled()
  })

  it('calls terminate() (not close()) on the exec.exec error-handler path', async () => {
    const ws = makeFakeWebSocket()
    // exec.exec resolves with ws (so the .then assigns ws to the outer
    // closure), then the chain rejects so the .catch fires. A custom thenable
    // is the simplest way to interleave a resolve and a reject without racing
    // through the heartbeat machinery.
    let thenCb: ((v: unknown) => void) | undefined
    const thenable = {
      then(onFulfilled: (v: unknown) => void) {
        thenCb = onFulfilled
        return {
          catch: (onRejected: (e: Error) => void) => {
            process.nextTick(() => {
              thenCb?.(ws)
              process.nextTick(() => onRejected(new Error('exec failed')))
            })
            return Promise.resolve()
          }
        }
      }
    }
    mockExec.mockReturnValue(thenable)

    await expect(
      execPodStep(['echo', 'hi'], 'pod', 'container')
    ).rejects.toThrow('exec failed')

    expect(ws.terminate).toHaveBeenCalledTimes(1)
    expect(ws.close).not.toHaveBeenCalled()
  })

  it('swallows errors thrown by terminate() so cleanup never crashes', async () => {
    const ws = makeFakeWebSocket()
    ws.terminate = jest.fn(() => {
      // Schedule the close emit so the awaiting Promise resolves...
      process.nextTick(() => ws.emit('close'))
      // ...but also throw to exercise the defensive try/catch.
      throw new Error('terminate boom')
    })

    mockExec.mockImplementation(
      async (
        _ns,
        _pod,
        _container,
        _cmd,
        _stdout,
        _stderr,
        _stdin,
        _tty,
        statusCb
      ) => {
        process.nextTick(() => statusCb({ status: 'Success', code: 0 }))
        return ws
      }
    )

    await expect(
      execPodStep(['echo', 'hi'], 'pod', 'container')
    ).resolves.toBe(0)

    expect(ws.terminate).toHaveBeenCalledTimes(1)
  })
})
