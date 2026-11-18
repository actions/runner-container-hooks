import { EventEmitter } from 'events'

const mockExec = jest.fn()

jest.mock('@actions/core', () => ({
  debug: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}))

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: jest.fn().mockImplementation(() => ({
    loadFromDefault: jest.fn(),
    makeApiClient: jest.fn().mockReturnValue({}),
    getContexts: jest.fn().mockReturnValue([{ namespace: 'test-namespace' }])
  })),
  Exec: jest.fn().mockImplementation(() => ({ exec: mockExec })),
  CoreV1Api: jest.fn(),
  BatchV1Api: jest.fn(),
  AuthorizationV1Api: jest.fn()
}))

jest.mock('tar-fs', () => ({
  default: {
    pack: jest.fn(),
    extract: jest.fn()
  },
  __esModule: true
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

describe('execPodStep', () => {
  it('rejects when the stream closes before the command reports a status', async () => {
    const ws = new MockWebSocket()
    mockExec.mockImplementation(async () => {
      setImmediate(() => {
        ws.readyState = 3
        ws.emit('close')
      })
      return ws
    })

    await expect(
      execPodStep(['sh', '-c', 'sleep 3600'], 'job-pod', 'job')
    ).rejects.toThrow(
      'exec stream closed before the command reported an exit status'
    )
  }, 5000)

  it('resolves with the exit code when the status arrives before the close', async () => {
    const ws = new MockWebSocket()
    mockExec.mockImplementation(async (...args) => {
      const onStatus = args[8] as (status: {
        status: string
        code?: number
      }) => void
      setImmediate(() => onStatus({ status: 'Success', code: 0 }))
      return ws
    })

    await expect(
      execPodStep(['sh', '-c', 'true'], 'job-pod', 'job')
    ).resolves.toBe(0)
  })
})
