import { PrepareJobArgs, writeToResponseFile } from 'hooklib'
import { prepareJob } from '../src/hooks/prepare-job'
import * as k8s from '../src/k8s'
import * as utils from '../src/k8s/utils'

jest.mock('hooklib', () => ({
  ...jest.requireActual('hooklib'),
  writeToResponseFile: jest.fn()
}))

jest.mock('../src/k8s', () => ({
  ...jest.requireActual('../src/k8s'),
  createJobPod: jest.fn(),
  prunePods: jest.fn(),
  waitForPodPhases: jest.fn(),
  execCpToPod: jest.fn(),
  isPodContainerAlpine: jest.fn()
}))

describe('prepare job response ports', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetAllMocks()
    process.env = {
      ...originalEnv,
      ACTIONS_RUNNER_POD_NAME: 'runner',
      RUNNER_WORKSPACE: '/work/repo'
    }
    jest.spyOn(utils, 'readExtensionFromFile').mockReturnValue(undefined)
    jest
      .mocked(k8s.createJobPod)
      .mockImplementation(async (name, container, services) => {
        if (!container) {
          throw new Error('Expected a job container')
        }
        return {
          metadata: { name },
          spec: { containers: [container, ...(services || [])] }
        }
      })
    jest.mocked(k8s.prunePods).mockResolvedValue(undefined)
    jest.mocked(k8s.waitForPodPhases).mockResolvedValue(undefined)
    jest.mocked(k8s.execCpToPod).mockResolvedValue(undefined)
    jest.mocked(k8s.isPodContainerAlpine).mockResolvedValue(false)
  })

  afterEach(() => {
    process.env = originalEnv
    jest.restoreAllMocks()
  })

  it.each([
    { mappings: undefined, expected: {} },
    { mappings: [], expected: {} },
    { mappings: ['8080'], expected: {} },
    { mappings: ['31080:8080'], expected: { '8080': '31080' } },
    {
      mappings: ['31080:8080', '31081:8081/udp', '9090'],
      expected: { '8080': '31080', '8081': '31081' }
    }
  ])('serializes job ports for $mappings', async ({ mappings, expected }) => {
    const args: PrepareJobArgs = {
      container: {
        image: 'ubuntu:latest',
        workingDirectory: '/__w/repo/repo',
        systemMountVolumes: [],
        portMappings: mappings
      },
      services: [
        { image: 'redis', contextName: 'redis', portMappings: ['31379:6379'] }
      ]
    }

    await prepareJob(args, 'response.json')

    expect(writeToResponseFile).toHaveBeenCalledTimes(1)
    const [file, content] = jest.mocked(writeToResponseFile).mock.calls[0]
    expect(file).toBe('response.json')
    const response = JSON.parse(content)
    expect(response.context.container.ports).toEqual(expected)
    expect(response.context.services[0].ports).toEqual({ '6379': '31379' })
  })
})
