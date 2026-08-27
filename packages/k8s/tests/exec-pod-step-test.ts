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

describe('execPodStep', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.ACTIONS_RUNNER_KUBERNETES_NAMESPACE = 'test-namespace'
  })

  afterEach(() => {
    delete process.env.ACTIONS_RUNNER_KUBERNETES_NAMESPACE
  })

  it('rejects a successful response without an exit code', async () => {
    mockExec.mockImplementation(async (...args) => {
      const onComplete = args[8] as (response: { status: string }) => void
      onComplete({ status: 'Success' })
      return null
    })

    await expect(
      execPodStep(['sh', '-c', 'echo test'], 'job-pod', 'job')
    ).rejects.toThrow('execPodStep completed without an exit code')
  })
})
