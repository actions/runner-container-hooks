import * as fs from 'fs'
import * as path from 'path'
import { cleanupJob, createPodSpec } from '../src/hooks'
import { createContainerSpec, prepareJob } from '../src/hooks/prepare-job'
import { TestHelper } from './test-setup'
import { createJob, createPod, waitForPodPhases } from '../src/k8s'
import {
  V1EnvVar,
  V1ResourceRequirements,
  V1Volume,
  V1VolumeMount
} from '@kubernetes/client-node'
import { JOB_CONTAINER_NAME } from '../src/hooks/constants'
import {
  DEFAULT_CONTAINER_ENTRY_POINT,
  DEFAULT_CONTAINER_ENTRY_POINT_ARGS,
  PodPhase
} from '../src/k8s/utils'

jest.useRealTimers()

let testHelper: TestHelper

let prepareJobData: any

let prepareJobOutputFilePath: string

describe('Prepare job', () => {
  beforeEach(async () => {
    testHelper = new TestHelper()
    await testHelper.initialize()

    await waitForPodPhases(
      testHelper.podName,
      new Set([PodPhase.RUNNING]),
      new Set([PodPhase.PENDING])
    )
    prepareJobData = testHelper.getPrepareJobDefinition()
    prepareJobOutputFilePath = testHelper.createFile('prepare-job-output.json')
  })
  afterEach(async () => {
    await cleanupJob()
    await testHelper.cleanup()
  })

  it('should not throw exception', async () => {
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()
  })

  it('should generate output file in JSON format', async () => {
    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    const content = fs.readFileSync(prepareJobOutputFilePath)
    expect(() => JSON.parse(content.toString())).not.toThrow()
  })

  it('should prepare job with absolute path for userVolumeMount', async () => {
    prepareJobData.args.container.userMountVolumes = [
      {
        sourceVolumePath: path.join(
          process.env.GITHUB_WORKSPACE as string,
          '/myvolume'
        ),
        targetVolumePath: '/volume_mount',
        readOnly: false
      }
    ]
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()
  })

  it('should throw an exception if the user volume mount is absolute path outside of GITHUB_WORKSPACE', async () => {
    prepareJobData.args.container.userMountVolumes = [
      {
        sourceVolumePath: '/somewhere/not/in/gh-workspace',
        targetVolumePath: '/containermount',
        readOnly: false
      }
    ]
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).rejects.toThrow()
  })

  it('should not run prepare job without the job container', async () => {
    prepareJobData.args.container = undefined
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).rejects.toThrow()
  })

  it('should have the extra fields set if ACTIONS_RUNNER_POD_TEMPLATE_PATH env variable is set', async () => {
    process.env.ACTIONS_RUNNER_POD_TEMPLATE_PATH = path.resolve(
      __dirname,
      'podtemplate.yaml'
    )

    const container = createContainerSpec(
      prepareJobData.args.container,
      JOB_CONTAINER_NAME,
      true
    )
    const services = prepareJobData.args.services.map(service => {
      return createContainerSpec(service, service.image.split(':')[0])
    })
    const pod = await createPod(container, services)

    // name, image,command,args should not be overwritten
    expect(pod.spec?.containers[0].name).toEqual('job')
    expect(pod.spec?.containers[0].image).toEqual('node:14.16')
    expect(pod.spec?.containers[0].command).toEqual([
      DEFAULT_CONTAINER_ENTRY_POINT
    ])
    expect(pod.spec?.containers[0].args).toEqual(
      DEFAULT_CONTAINER_ENTRY_POINT_ARGS
    )

    //rest of template should be appended
    expect(pod.spec?.containers[0].env).toContainEqual({
      name: 'TEST',
      value: 'testvalue'
    } as V1EnvVar)
    expect(pod.spec?.containers[0].env).toContainEqual({
      name: 'NODE_ENV',
      value: 'development'
    } as V1EnvVar)

    expect(pod.spec?.containers[0].resources).toEqual({
      requests: { cpu: '128m' }
    } as V1ResourceRequirements)

    expect(pod.spec?.containers[0].volumeMounts).toContainEqual({
      name: 'work',
      mountPath: '/__w'
    } as V1VolumeMount)
  })
})
