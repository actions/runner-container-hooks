import * as fs from 'fs'
import * as path from 'path'
import { cleanupJob } from '../src/hooks'
import { createContainerSpec, prepareJob } from '../src/hooks/prepare-job'
import { TestHelper } from './test-setup'
import {
  ENV_HOOK_TEMPLATE_PATH,
  ENV_USE_KUBE_SCHEDULER,
  generateContainerName,
  readExtensionFromFile
} from '../src/k8s/utils'
import { getPodByName } from '../src/k8s'
import { V1Container } from '@kubernetes/client-node'
import * as yaml from 'js-yaml'
import { JOB_CONTAINER_NAME } from '../src/hooks/constants'

jest.useRealTimers()

let testHelper: TestHelper

let prepareJobData: any

let prepareJobOutputFilePath: string

describe('Prepare job', () => {
  beforeEach(async () => {
    testHelper = new TestHelper()
    await testHelper.initialize()
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

  it('should prepare job with envs CI and GITHUB_ACTIONS', async () => {
    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)

    const content = JSON.parse(
      fs.readFileSync(prepareJobOutputFilePath).toString()
    )

    const got = await getPodByName(content.state.jobPod)
    expect(got.spec?.containers[0].env).toEqual(
      expect.arrayContaining([
        { name: 'CI', value: 'true' },
        { name: 'GITHUB_ACTIONS', value: 'true' }
      ])
    )
    expect(got.spec?.containers[1].env).toEqual(
      expect.arrayContaining([
        { name: 'CI', value: 'true' },
        { name: 'GITHUB_ACTIONS', value: 'true' }
      ])
    )
  })

  it('should not override CI env var if already set', async () => {
    prepareJobData.args.container.environmentVariables = {
      CI: 'false'
    }

    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)

    const content = JSON.parse(
      fs.readFileSync(prepareJobOutputFilePath).toString()
    )

    const got = await getPodByName(content.state.jobPod)
    expect(got.spec?.containers[0].env).toEqual(
      expect.arrayContaining([
        { name: 'CI', value: 'false' },
        { name: 'GITHUB_ACTIONS', value: 'true' }
      ])
    )
    expect(got.spec?.containers[1].env).toEqual(
      expect.arrayContaining([
        { name: 'CI', value: 'true' },
        { name: 'GITHUB_ACTIONS', value: 'true' }
      ])
    )
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

  it('should not set command + args for service container if not passed in args', async () => {
    const services = prepareJobData.args.services.map(service => {
      return createContainerSpec(service, generateContainerName(service.image))
    }) as [V1Container]

    expect(services[0].command).toBe(undefined)
    expect(services[0].args).toBe(undefined)
  })

  it('should determine alpine correctly', async () => {
    prepareJobData.args.container.image = 'alpine:latest'
    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    const content = JSON.parse(
      fs.readFileSync(prepareJobOutputFilePath).toString()
    )
    expect(content.isAlpine).toBe(true)
  })

  it('should run pod with extensions applied', async () => {
    process.env[ENV_HOOK_TEMPLATE_PATH] = path.join(
      __dirname,
      '../../../examples/extension.yaml'
    )

    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()

    delete process.env[ENV_HOOK_TEMPLATE_PATH]

    const content = JSON.parse(
      fs.readFileSync(prepareJobOutputFilePath).toString()
    )

    const got = await getPodByName(content.state.jobPod)

    expect(got.metadata?.annotations?.['annotated-by']).toBe('extension')
    expect(got.metadata?.labels?.['labeled-by']).toBe('extension')
    expect(got.spec?.securityContext?.runAsUser).toBe(1000)
    expect(got.spec?.securityContext?.runAsGroup).toBe(3000)

    // job container
    expect(got.spec?.containers[0].name).toBe(JOB_CONTAINER_NAME)
    expect(got.spec?.containers[0].image).toBe('node:22')
    expect(got.spec?.containers[0].command).toEqual(['sh'])
    expect(got.spec?.containers[0].args).toEqual(['-c', 'sleep 50'])

    // service container
    expect(got.spec?.containers[1].image).toBe('redis')
    expect(got.spec?.containers[1].command).toBeFalsy()
    expect(got.spec?.containers[1].args).toBeFalsy()
    expect(got.spec?.containers[1].env).toEqual(
      expect.arrayContaining([
        { name: 'CI', value: 'true' },
        { name: 'GITHUB_ACTIONS', value: 'true' },
        { name: 'ENV2', value: 'value2' }
      ])
    )
    expect(got.spec?.containers[1].resources).toEqual({
      requests: { memory: '1Mi', cpu: '1' },
      limits: { memory: '1Gi', cpu: '2' }
    })
    // side-car
    expect(got.spec?.containers[2].name).toBe('side-car')
    expect(got.spec?.containers[2].image).toBe('ubuntu:latest')
    expect(got.spec?.containers[2].command).toEqual(['sh'])
    expect(got.spec?.containers[2].args).toEqual(['-c', 'sleep 60'])
  })

  it('should put only job and services in output context file', async () => {
    process.env[ENV_HOOK_TEMPLATE_PATH] = path.join(
      __dirname,
      '../../../examples/extension.yaml'
    )

    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()

    const content = JSON.parse(
      fs.readFileSync(prepareJobOutputFilePath).toString()
    )

    expect(content.state.jobPod).toBeTruthy()
    expect(content.context.container).toBeTruthy()
    expect(content.context.services).toBeTruthy()
    expect(content.context.services.length).toBe(1)
  })

  it('should not throw exception using kube scheduler', async () => {
    // only for ReadWriteMany volumes or single node cluster
    process.env[ENV_USE_KUBE_SCHEDULER] = 'true'

    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()

    delete process.env[ENV_USE_KUBE_SCHEDULER]
  })

  test.each([undefined, null, []])(
    'should not throw exception when portMapping=%p',
    async pm => {
      prepareJobData.args.services.forEach(s => {
        s.portMappings = pm
      })
      await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
      const content = JSON.parse(
        fs.readFileSync(prepareJobOutputFilePath).toString()
      )
      expect(() => content.context.services[0].image).not.toThrow()
    }
  )
})
