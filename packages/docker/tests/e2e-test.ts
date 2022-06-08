import * as fs from 'fs'
import * as path from 'path'
import {
  cleanupJob,
  prepareJob,
  runContainerStep,
  runScriptStep
} from '../src/hooks'
import TestSetup from './test-setup'

const definitions = {
  prepareJob: JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname + '/../../../examples/prepare-job.json'),
      'utf8'
    )
  ),

  runContainerStep: JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname + '/../../../examples/run-container-step.json'),
      'utf8'
    )
  ),

  runScriptStep: JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname + '/../../../examples/run-script-step.json'),
      'utf-8'
    )
  )
}

let testSetup: TestSetup

describe('e2e', () => {
  beforeEach(() => {
    testSetup = new TestSetup()
    testSetup.initialize()
    definitions.prepareJob.args.container.systemMountVolumes =
      testSetup.systemMountVolumes
  })

  afterEach(() => {
    testSetup.teardown()
  })

  it('should prepare job, then run script step, then run container step then cleanup', async () => {
    const prepareJobOutput = testSetup.createOutputFile(
      'prepare-job-output.json'
    )

    await expect(
      prepareJob(definitions.prepareJob.args, prepareJobOutput)
    ).resolves.not.toThrow()

    let rawState = fs.readFileSync(prepareJobOutput, 'utf-8')
    let resp = JSON.parse(rawState)

    await expect(
      runScriptStep(definitions.runScriptStep.args, resp.state)
    ).resolves.not.toThrow()

    await expect(
      runContainerStep(definitions.runContainerStep.args, resp.state)
    ).resolves.not.toThrow()

    await expect(cleanupJob()).resolves.not.toThrow()
  })

  it('should prepare job, then run script step, then run container step with Dockerfile then cleanup', async () => {
    const prepareJobOutput = testSetup.createOutputFile(
      'prepare-job-output.json'
    )

    await expect(
      prepareJob(definitions.prepareJob.args, prepareJobOutput)
    ).resolves.not.toThrow()

    let rawState = fs.readFileSync(prepareJobOutput, 'utf-8')
    let resp = JSON.parse(rawState)

    await expect(
      runScriptStep(definitions.runScriptStep.args, resp.state)
    ).resolves.not.toThrow()

    const dockerfilePath = `${testSetup.workingDirectory}/Dockerfile`
    fs.writeFileSync(
      dockerfilePath,
      `FROM ubuntu:latest
ENV TEST=test
ENTRYPOINT [ "tail", "-f", "/dev/null" ]
    `
    )

    const containerStepDataCopy = JSON.parse(
      JSON.stringify(definitions.runContainerStep)
    )

    containerStepDataCopy.args.dockerfile = 'Dockerfile'

    await expect(
      runContainerStep(containerStepDataCopy.args, resp.state)
    ).resolves.not.toThrow()

    await expect(cleanupJob()).resolves.not.toThrow()
  })
})
