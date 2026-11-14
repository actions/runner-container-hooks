jest.mock('fs', () => ({ ...jest.requireActual('fs'), rmSync: jest.fn() }))
jest.mock('@kubernetes/client-node', () => ({
  V1Container: jest.fn()
}))
jest.mock('../src/k8s', () => ({
  createContainerStepPod: jest.fn(),
  deletePod: jest.fn(),
  execCpFromPod: jest.fn(),
  execCpToPod: jest.fn(),
  execPodStep: jest.fn(),
  getPrepareJobTimeoutSeconds: jest.fn(() => 30),
  waitForPodPhases: jest.fn()
}))
jest.mock('../src/k8s/utils', () => ({
  formatError: (error: unknown) => String(error),
  CONTAINER_VOLUMES: [],
  PodPhase: { RUNNING: 'Running', PENDING: 'Pending', UNKNOWN: 'Unknown' },
  DEFAULT_CONTAINER_ENTRY_POINT_ARGS: ['-f', '/dev/null'],
  readExtensionFromFile: jest.fn(),
  writeContainerStepScript: jest.fn(() => ({
    containerPath: '/__w/_temp/step.sh',
    runnerPath: '/tmp/container-step-test-script'
  }))
}))
import {
  createContainerStepPod,
  deletePod,
  execPodStep,
  waitForPodPhases
} from '../src/k8s'
import { runContainerStep } from '../src/hooks/run-container-step'

beforeEach(() => {
  process.env.ACTIONS_RUNNER_POD_NAME = 'runner-pod'
  process.env.RUNNER_WORKSPACE = '/tmp/container-test/work/repo'
  process.env.GITHUB_WORKSPACE = '/__w/repo/repo'
  jest.mocked(createContainerStepPod).mockReset()
  jest.mocked(createContainerStepPod).mockResolvedValue({
    metadata: { name: 'step-pod' }
  })
  jest.mocked(execPodStep).mockReset()
  jest.mocked(deletePod).mockReset()
  jest.mocked(deletePod).mockResolvedValue(undefined)
  jest.mocked(waitForPodPhases).mockReset()
})
const args = () => ({
  image: 'test-image',
  entryPoint: 'sh',
  workingDirectory: '/__w/repo/repo',
  systemMountVolumes: []
})

test.each([0, 1, 17, 255])(
  'container workload exit %i is returned and the step pod is removed',
  async code => {
    jest.mocked(execPodStep).mockResolvedValue(code)
    await expect(runContainerStep(args(), true)).resolves.toBe(code)
    expect(execPodStep).toHaveBeenCalledWith(
      ['sh', '-e', '/__w/_temp/step.sh'],
      'step-pod',
      expect.any(String),
      undefined,
      true,
      expect.stringMatching(/^HOOK_WORKLOAD_START_/)
    )
    expect(deletePod).toHaveBeenCalledWith('step-pod')
  }
)
test('container transport failure still rejects and removes the pod', async () => {
  jest.mocked(execPodStep).mockRejectedValue(new Error('ECONNRESET'))
  await expect(runContainerStep(args(), true)).rejects.toThrow('ECONNRESET')
  expect(deletePod).toHaveBeenCalledWith('step-pod')
})
test('container setup failure never reaches workload execution', async () => {
  jest
    .mocked(waitForPodPhases)
    .mockRejectedValue(new Error('pod startup failed'))
  await expect(runContainerStep(args(), true)).rejects.toThrow(
    'pod startup failed'
  )
  expect(execPodStep).not.toHaveBeenCalled()
  expect(deletePod).toHaveBeenCalledWith('step-pod')
})
test('legacy container invocation does not opt into status response', async () => {
  jest.mocked(execPodStep).mockRejectedValue(new Error('exit 17'))
  await expect(runContainerStep(args())).rejects.toThrow('exit 17')
  expect(execPodStep).toHaveBeenCalledWith(
    ['sh', '-e', '/__w/_temp/step.sh'],
    'step-pod',
    expect.any(String),
    undefined,
    false,
    undefined
  )
})
