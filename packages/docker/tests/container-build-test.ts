import { containerBuild } from '../src/dockerCommands'
import TestSetup from './test-setup'

let testSetup
let runContainerStepDefinition

describe('container build', () => {
  beforeEach(() => {
    testSetup = new TestSetup()
    testSetup.initialize()

    runContainerStepDefinition = testSetup.getRunContainerStepDefinition()
  })

  afterEach(() => {
    testSetup.teardown()
  })

  it('should build container', async () => {
    runContainerStepDefinition.image = ''
    const actionPath = testSetup.initializeDockerAction()
    runContainerStepDefinition.dockerfile = `${actionPath}/Dockerfile`
    await expect(
      containerBuild(runContainerStepDefinition, 'example-test-tag')
    ).resolves.not.toThrow()
  })
})
