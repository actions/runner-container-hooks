import { runContainerStep } from '../src/hooks'
import { TestHelper } from './test-setup'
import { ENV_HOOK_TEMPLATE_PATH } from '../src/k8s/utils'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { JOB_CONTAINER_EXTENSION_NAME } from '../src/hooks/constants'

jest.useRealTimers()

let testHelper: TestHelper

let runContainerStepData: any

describe('Run container step', () => {
  beforeEach(async () => {
    testHelper = new TestHelper()
    await testHelper.initialize()
    runContainerStepData = testHelper.getRunContainerStepDefinition()
  })

  afterEach(async () => {
    await testHelper.cleanup()
  })

  it('should not throw', async () => {
    const exitCode = await runContainerStep(runContainerStepData.args)
    expect(exitCode).toBe(0)
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
})
