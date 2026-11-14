jest.mock('../src/k8s', () => ({
  execCpFromPod: jest.fn(),
  execCpToPod: jest.fn(),
  execPodStep: jest.fn()
}))
jest.mock('../src/k8s/utils', () => ({
  formatError: (error: unknown) => String(error),
  writeRunScript: jest.fn(() => ({
    containerPath: '/__w/_temp/step.sh',
    runnerPath: '/tmp/nonexistent-hook-unit-script'
  }))
}))
import { execCpFromPod, execPodStep } from '../src/k8s'
import { runScriptStep } from '../src/hooks/run-script-step'

beforeEach(() => {
  process.env.RUNNER_WORKSPACE = '/tmp/work/repo'
  jest.mocked(execPodStep).mockReset()
})
const args = () => ({
  entryPoint: 'sh',
  entryPointArgs: ['step.sh'],
  workingDirectory: '/__w/repo'
})
test('nonzero workload still copies file commands and preserves actual exit', async () => {
  jest
    .mocked(execPodStep)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(17)
  await expect(runScriptStep(args(), { jobPod: 'pod' }, true)).resolves.toBe(17)
  expect(execPodStep).toHaveBeenNthCalledWith(
    3,
    ['sh', '-e', '/__w/_temp/step.sh'],
    'pod',
    expect.any(String),
    undefined,
    true
  )
  expect(execCpFromPod).toHaveBeenCalled()
})
test('setup failure never becomes workload exit', async () => {
  jest.mocked(execPodStep).mockRejectedValueOnce(new Error('mkdir failed'))
  await expect(runScriptStep(args(), { jobPod: 'pod' }, true)).rejects.toThrow(
    'mkdir failed'
  )
  expect(execCpFromPod).not.toHaveBeenCalled()
})
test('legacy call does not opt into exit-code return', async () => {
  jest
    .mocked(execPodStep)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0)
    .mockRejectedValueOnce(new Error('exit 17'))
  await expect(runScriptStep(args(), { jobPod: 'pod' })).rejects.toThrow(
    'exit 17'
  )
  expect(execPodStep).toHaveBeenNthCalledWith(
    3,
    ['sh', '-e', '/__w/_temp/step.sh'],
    'pod',
    expect.any(String),
    undefined,
    false
  )
})
