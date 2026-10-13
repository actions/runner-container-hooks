import { cleanupJob, prepareJob, runContainerStep } from '../src/hooks'
import { TestHelper } from './test-setup'
import { ENV_HOOK_TEMPLATE_PATH } from '../src/k8s/utils'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { JOB_CONTAINER_EXTENSION_NAME } from '../src/hooks/constants'

jest.useRealTimers()

let testHelper: TestHelper

let runContainerStepData: any
let prepareJobData: any
let prepareJobOutputFilePath: string

describe('Run container step', () => {
  beforeEach(async () => {
    testHelper = new TestHelper()
    await testHelper.initialize()
    prepareJobData = testHelper.getPrepareJobDefinition()
    prepareJobOutputFilePath = testHelper.createFile('prepare-job-output.json')
    await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    runContainerStepData = testHelper.getRunContainerStepDefinition()
  })

  afterEach(async () => {
    delete process.env[ENV_HOOK_TEMPLATE_PATH]
    await cleanupJob()
    await testHelper.cleanup()
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
            name: JOB_CONTAINER_EXTENSION_NAME,
            command: ['sh'],
            args: ['-c', 'echo test']
          },
          {
            name: 'side-container',
            image: 'ubuntu:latest',
            command: ['sh'],
            args: ['-c', 'echo test']
          }
        ],
        restartPolicy: 'Never'
      }
    }

    let filePath = testHelper.createFile()
    fs.writeFileSync(filePath, yaml.dump(extension))
    process.env[ENV_HOOK_TEMPLATE_PATH] = filePath
    await expect(
      runContainerStep(runContainerStepData.args)
    ).resolves.not.toThrow()
    delete process.env[ENV_HOOK_TEMPLATE_PATH]
  })

  it('should shold have env variables available', async () => {
    runContainerStepData.args.entryPoint = 'bash'
    runContainerStepData.args.entryPointArgs = [
      '-c',
      "'if [[ -z $NODE_ENV ]]; then exit 1; fi'"
    ]
    await expect(
      runContainerStep(runContainerStepData.args)
    ).resolves.not.toThrow()
  })

  it('should run container step with envs CI and GITHUB_ACTIONS', async () => {
    runContainerStepData.args.entryPoint = 'bash'
    runContainerStepData.args.entryPointArgs = [
      '-c',
      "'if [[ -z $GITHUB_ACTIONS  ]] || [[ -z $CI ]]; then exit 1; fi'"
    ]
    await expect(
      runContainerStep(runContainerStepData.args)
    ).resolves.not.toThrow()
  })

  it(
    'should return once the job container exits even with a long-lived sidecar',
    async () => {
      // Waiting on the Job itself never returns here: a Job only succeeds
      // once every container has exited, so a sidecar that outlives the step
      // used to hang the hook indefinitely.
      const extension = {
        spec: {
          containers: [
            {
              name: 'side-container',
              image: 'ubuntu:latest',
              command: ['sh'],
              args: ['-c', 'sleep 600']
            }
          ],
          restartPolicy: 'Never'
        }
      }

      const filePath = testHelper.createFile()
      fs.writeFileSync(filePath, yaml.dump(extension))
      process.env[ENV_HOOK_TEMPLATE_PATH] = filePath

      runContainerStepData.args.entryPoint = 'bash'
      runContainerStepData.args.entryPointArgs = ['-c', "'exit 0'"]

      await expect(runContainerStep(runContainerStepData.args)).resolves.toBe(0)
    },
    150 * 1000
  )

  it(
    'should report the job container exit code, not a sidecar one',
    async () => {
      // The exit code used to be read from the last entry of
      // containerStatuses, which is a sidecar as soon as an extension adds
      // containers.
      const extension = {
        spec: {
          containers: [
            {
              name: 'side-container',
              image: 'ubuntu:latest',
              command: ['sh'],
              args: ['-c', 'exit 0']
            }
          ],
          restartPolicy: 'Never'
        }
      }

      const filePath = testHelper.createFile()
      fs.writeFileSync(filePath, yaml.dump(extension))
      process.env[ENV_HOOK_TEMPLATE_PATH] = filePath

      runContainerStepData.args.entryPoint = 'bash'
      runContainerStepData.args.entryPointArgs = ['-c', "'exit 3'"]

      await expect(runContainerStep(runContainerStepData.args)).resolves.toBe(3)
    },
    150 * 1000
  )
})
