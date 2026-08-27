const mockExecPodStep = jest.fn()
const mockExecCpFromPod = jest.fn()
const mockExecCpToPod = jest.fn()
const mockWriteRunScript = jest.fn()

jest.mock('@actions/core', () => ({
  debug: jest.fn(),
  warning: jest.fn()
}))

jest.mock('../src/k8s', () => ({
  execPodStep: mockExecPodStep,
  execCpFromPod: mockExecCpFromPod,
  execCpToPod: mockExecCpToPod
}))

jest.mock('../src/k8s/utils', () => ({
  formatError: (error: unknown) => String(error),
  writeRunScript: mockWriteRunScript,
  sleep: jest.fn(),
  listDirAllCommand: jest.fn()
}))

jest.mock('fs', () => ({ rmSync: jest.fn() }))

import { runScriptStep } from '../src/hooks/run-script-step'

describe('runScriptStep', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.RUNNER_WORKSPACE = '/runner/_work/repository/repository'
    mockWriteRunScript.mockReturnValue({
      containerPath: '/__w/_temp/script.sh',
      runnerPath: '/runner/_work/_temp/script.sh'
    })
    mockExecCpToPod.mockResolvedValue(undefined)
    mockExecCpFromPod.mockResolvedValue(undefined)
  })

  afterEach(() => {
    delete process.env.RUNNER_WORKSPACE
  })

  it('returns the entrypoint exit code after copying file commands', async () => {
    mockExecPodStep
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(23)

    await expect(
      runScriptStep(
        {
          entryPoint: 'bash',
          entryPointArgs: ['-c', 'exit 23'],
          environmentVariables: {},
          prependPath: [],
          workingDirectory: '/workspace'
        },
        { jobPod: 'job-pod' }
      )
    ).resolves.toBe(23)

    expect(mockExecCpFromPod).toHaveBeenCalledTimes(1)
  })
})
