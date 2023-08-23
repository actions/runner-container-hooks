import * as fs from 'fs'
import * as path from 'path'
import { cleanupJob } from '../src/hooks'
import { createContainerSpec, prepareJob } from '../src/hooks/prepare-job'
import { TestHelper } from './test-setup'
import { ENV_HOOK_TEMPLATE_PATH, generateContainerName } from '../src/k8s/utils'
import { getPodByName } from '../src/k8s'
import { V1Container } from '@kubernetes/client-node'
import * as yaml from 'js-yaml'

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

  it('should run pod with extensions applied', async () => {
    const extension = {
      metadata: {
        annotations: {
          foo: 'bar'
        },
        labels: {
          bar: 'baz'
        }
      },
      spec: {
        containers: [
          {
            name: 'job',
            command: ['sh'],
            args: ['-c', 'sleep 50']
          },
          {
            name: 'side-container',
            command: ['sh'],
            args: ['-c', 'sleep 50']
          }
        ],
        restartPolicy: 'Never',
        securityContext: {
          runAsUser: 1000,
          runAsGroup: 3000
        }
      }
    }

    let filePath = testHelper.createFile()
    fs.writeFileSync(filePath, yaml.dump(extension))
    process.env[ENV_HOOK_TEMPLATE_PATH] = filePath

    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()

    delete process.env[ENV_HOOK_TEMPLATE_PATH]

    const content = JSON.parse(
      fs.readFileSync(prepareJobOutputFilePath).toString()
    )

    const got = await getPodByName(content.state.jobPod)

    expect(got.metadata?.annotations?.foo).toBe('bar')
    expect(got.metadata?.labels?.bar).toBe('baz')
    expect(got.spec?.securityContext?.runAsUser).toBe(1000)
    expect(got.spec?.securityContext?.runAsGroup).toBe(3000)
    expect(got.spec?.containers[0].command).toEqual(['sh'])
    expect(got.spec?.containers[0].args).toEqual(['-c', 'sleep 50'])
    expect(got.spec?.containers[1].command).toEqual(['sh'])
    expect(got.spec?.containers[1].args).toEqual(['-c', 'sleep 50'])
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
