import * as fs from 'fs'
import { containerBuild } from '../src/dockerCommands'
import TestSetup from './test-setup'

let testSetup
let runContainerStepDefinition
const runContainerStepInputPath = `${__dirname}/../../../examples/run-container-step.json`

describe('container build', () => {
  beforeEach(() => {
    testSetup = new TestSetup()
    testSetup.initialize()

    let runContainerStepJson = fs.readFileSync(
      runContainerStepInputPath,
      'utf8'
    )
    runContainerStepDefinition = JSON.parse(runContainerStepJson.toString())
    runContainerStepDefinition.image = ''
    const actionPath = testSetup.initializeDockerAction()
    runContainerStepDefinition.dockerfile = `${actionPath}/Dockerfile`
  })

  afterEach(() => {
    testSetup.teardown()
  })

  it('should build container', async () => {
    await expect(
      containerBuild(runContainerStepDefinition, 'example-test-tag')
    ).resolves.not.toThrow()
  })
})
