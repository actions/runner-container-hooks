import * as fs from 'fs'
import * as path from 'path'
import { cleanupJob } from '../src/hooks'
import { createContainerSpec, prepareJob } from '../src/hooks/prepare-job'
import { TableTest, TestHelper } from './test-setup'
import { generateContainerName } from '../src/k8s/utils'
import { V1Container } from '@kubernetes/client-node'

jest.useRealTimers()

let testHelper: TestHelper

let prepareJobData: any

let prepareJobOutputFilePath: string

describe('Prepare job', () => {
  const cases = [] as TableTest[]

  cases.push({
    name: 'should not throw exception',
    fn: async () => {
      await expect(
        prepareJob(prepareJobData.args, prepareJobOutputFilePath)
      ).resolves.not.toThrow()
    }
  })

  cases.push({
    name: 'should generate output file in JSON format',
    fn: async () => {
      await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
      const content = fs.readFileSync(prepareJobOutputFilePath)
      expect(() => JSON.parse(content.toString())).not.toThrow()
    }
  })

  cases.push({
    name: 'should prepare job with absolute path for userVolumeMount',
    fn: async () => {
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
    }
  })

  cases.push({
    name: 'should throw an exception if the user volume mount is absolute path outside of GITHUB_WORKSPACE',
    fn: async () => {
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
    }
  })

  cases.push({
    name: 'should not run prepare job without the job container',
    fn: async () => {
      prepareJobData.args.container = undefined
      await expect(
        prepareJob(prepareJobData.args, prepareJobOutputFilePath)
      ).rejects.toThrow()
    }
  })

  cases.push({
    name: 'should not set command + args for service container if not passed in args',
    fn: async () => {
      const services = prepareJobData.args.services.map(service => {
        return createContainerSpec(
          service,
          generateContainerName(service.image)
        )
      }) as [V1Container]

      expect(services[0].command).toBe(undefined)
      expect(services[0].args).toBe(undefined)
    }
  })

  describe('k8s config', () => {
    beforeEach(async () => {
      testHelper = new TestHelper('k8s')
      await testHelper.initialize()
      prepareJobData = testHelper.getPrepareJobDefinition()
      prepareJobOutputFilePath = testHelper.createFile(
        'prepare-job-output.json'
      )
    })
    afterEach(async () => {
      await cleanupJob()
      await testHelper.cleanup()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
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

  describe('docker config', () => {
    beforeEach(async () => {
      testHelper = new TestHelper('docker')
      await testHelper.initialize()
      prepareJobData = testHelper.getPrepareJobDefinition()
      prepareJobOutputFilePath = testHelper.createFile(
        'prepare-job-output.json'
      )
    })
    afterEach(async () => {
      await cleanupJob()
      await testHelper.cleanup()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
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
})
