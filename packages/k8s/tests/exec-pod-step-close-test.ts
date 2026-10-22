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

  it('resolves when the success status arrives before the close', async () => {
    const ws = new MockWebSocket()
    mockExec.mockImplementation(async (...args) => {
      const onStatus = args[8] as (status: {
        status: string
        code?: number
      }) => void
      setImmediate(() => {
        onStatus({ status: 'Success', code: 0 })
        ws.close()
      })
      return ws
    })

    await expect(
      execPodStep(['sh', '-c', 'true'], 'job-pod', 'job')
    ).resolves.toBeUndefined()
  })

  it('rejects with the status message when the command fails', async () => {
    const ws = new MockWebSocket()
    mockExec.mockImplementation(async (...args) => {
      const onStatus = args[8] as (status: {
        status: string
        message?: string
      }) => void
      setImmediate(() => {
        onStatus({
          status: 'Failure',
          message: 'command terminated with non-zero exit code'
        })
        ws.close()
      })
      return ws
    })

    await expect(
      execPodStep(['sh', '-c', 'false'], 'job-pod', 'job')
    ).rejects.toBe('command terminated with non-zero exit code')
  })
})
