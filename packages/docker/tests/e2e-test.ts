import * as fs from 'fs'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'
import {
  cleanupJob,
  prepareJob,
  runContainerStep,
  runScriptStep
} from '../src/hooks'
import TestSetup from './test-setup'

const prepareJobJson = fs.readFileSync(
  path.resolve(__dirname + '/../../../examples/prepare-job.json'),
  'utf8'
)

const containerStepJson = fs.readFileSync(
  path.resolve(__dirname + '/../../../examples/run-container-step.json'),
  'utf8'
)

let prepareJobDefinition: any
let scriptStepDefinition: any
let runContainerStepDefinition: any

let prepareJobOutputFilePath: string

let testSetup: TestSetup

describe('e2e', () => {
  beforeEach(() => {
    // init dirs
    testSetup = new TestSetup()
    testSetup.initialize()

    prepareJobDefinition = JSON.parse(prepareJobJson)
    prepareJobDefinition.args.container.userMountVolumes =
      testSetup.userMountVolumes
    prepareJobDefinition.args.container.systemMountVolumes =
      testSetup.systemMountVolumes
    prepareJobDefinition.args.container.workingDirectory =
      testSetup.containerWorkingDirectory
    prepareJobDefinition.args.container.registry = null
    prepareJobDefinition.args.services.forEach(s => (s.registry = null))

    const scriptStepJson = fs.readFileSync(
      path.resolve(__dirname + '/../../../examples/run-script-step.json'),
      'utf8'
    )
    scriptStepDefinition = JSON.parse(scriptStepJson)
    scriptStepDefinition.args.workingDirectory =
      testSetup.containerWorkingDirectory
    scriptStepDefinition.args.registry = null

    runContainerStepDefinition = JSON.parse(containerStepJson)
    runContainerStepDefinition.args.workingDirectory =
      testSetup.containerWorkingDirectory
    runContainerStepDefinition.args.userMountVolumes =
      testSetup.userMountVolumes
    runContainerStepDefinition.args.systemMountVolumes =
      runContainerStepDefinition.args.registry = null

    prepareJobOutputFilePath = `${
      testSetup.testDir
    }/prepare-job-output-${uuidv4()}.json`
    fs.writeFileSync(prepareJobOutputFilePath, '')
  })

  afterEach(() => {
    testSetup.teardown()
  })

  it('should prepare job, then run script step, then run container step then cleanup', async () => {
    await expect(
      prepareJob(prepareJobDefinition.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()
    let rawState = fs.readFileSync(prepareJobOutputFilePath, 'utf-8')
    let resp = JSON.parse(rawState)
    await expect(
      runScriptStep(scriptStepDefinition.args, resp.state)
    ).resolves.not.toThrow()
    await expect(
      runContainerStep(runContainerStepDefinition.args, resp.state)
    ).resolves.not.toThrow()
    await expect(cleanupJob(resp, resp.state, null)).resolves.not.toThrow()
  })

  it('should prepare job, then run script step, then run container step with Dockerfile then cleanup', async () => {
    await expect(
      prepareJob(prepareJobDefinition.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()
    let rawState = fs.readFileSync(prepareJobOutputFilePath, 'utf-8')
    let resp = JSON.parse(rawState)
    await expect(
      runScriptStep(scriptStepDefinition.args, resp.state)
    ).resolves.not.toThrow()

    const dockerfilePath = `${testSetup.testDir}/Dockerfile`
    fs.writeFileSync(
      dockerfilePath,
      `FROM ubuntu:latest
ENV TEST=test
ENTRYPOINT [ "tail", "-f", "/dev/null" ]
    `
    )
    const containerStepDataCopy = JSON.parse(
      JSON.stringify(runContainerStepDefinition)
    )
    containerStepDataCopy.args.dockerfile = 'Dockerfile'
    containerStepDataCopy.args.context = '.'
    await expect(
      runContainerStep(containerStepDataCopy.args, resp.state)
    ).resolves.not.toThrow()
    await expect(cleanupJob(resp, resp.state, null)).resolves.not.toThrow()
  })
})
