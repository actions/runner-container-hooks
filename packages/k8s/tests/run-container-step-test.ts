import { runContainerStep } from '../src/hooks'
import { TestHelper } from './test-setup'

jest.useRealTimers()

// describe('Run container step with image', () => {
//   let testHelper: TestHelper
//   let runContainerStepData: any

//   beforeEach(async () => {
//     testHelper = new TestHelper()
//     await testHelper.initialize()
//     runContainerStepData = testHelper.getRunContainerStepDefinition()
//   })

//   afterEach(async () => {
//     await testHelper.cleanup()
//   })

//   it('should not throw', async () => {
//     const exitCode = await runContainerStep(runContainerStepData.args)
//     expect(exitCode).toBe(0)
//   })

//   it('should fail if the working directory does not exist', async () => {
//     runContainerStepData.args.workingDirectory = '/foo/bar'
//     await expect(runContainerStep(runContainerStepData.args)).rejects.toThrow()
//   })

//   it('should shold have env variables available', async () => {
//     runContainerStepData.args.entryPoint = 'bash'
//     runContainerStepData.args.entryPointArgs = [
//       '-c',
//       "'if [[ -z $NODE_ENV ]]; then exit 1; fi'"
//     ]
//     await expect(
//       runContainerStep(runContainerStepData.args)
//     ).resolves.not.toThrow()
//   })
// })

describe('run container step with docker build', () => {
  let testHelper: TestHelper
  let runContainerStepData: any
  beforeEach(async () => {
    testHelper = new TestHelper()
    await testHelper.initialize()
    runContainerStepData = testHelper.getRunContainerStepDefinition()
  })

  afterEach(async () => {
    await testHelper.cleanup()
  })

  it('should build container and execute docker action', async () => {
    const { registryName, localRegistryPort, nodePort } =
      await testHelper.createContainerRegistry()

    process.env.ACTIONS_RUNNER_CONTAINER_HOOKS_LOCAL_REGISTRY_HOST = registryName
    process.env.ACTIONS_RUNNER_CONTAINER_HOOKS_LOCAL_REGISTRY_PORT =
      localRegistryPort.toString()
    process.env.ACTIONS_RUNNER_CONTAINER_HOOKS_LOCAL_REGISTRY_NODE_PORT =
      nodePort.toString()
    const actionPath = testHelper.initializeDockerAction()
    const data = JSON.parse(JSON.stringify(runContainerStepData))
    data.args.dockerfile = `${actionPath}/Dockerfile`
    await expect(runContainerStep(data.args)).resolves.not.toThrow()
  })
})
