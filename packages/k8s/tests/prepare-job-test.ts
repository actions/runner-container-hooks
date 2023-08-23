import * as fs from 'fs'
import * as path from 'path'
import { cleanupJob } from '../src/hooks'
import { createContainerSpec, prepareJob } from '../src/hooks/prepare-job'
import { TestHelper } from './test-setup'
import { generateContainerName } from '../src/k8s/utils'
import { V1Container } from '@kubernetes/client-node'

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
