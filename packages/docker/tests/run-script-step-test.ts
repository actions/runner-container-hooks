import * as fs from 'fs'
import { PrepareJobResponse } from 'hooklib/lib'
import { prepareJob, runScriptStep } from '../src/hooks'
import TestSetup from './test-setup'

jest.useRealTimers()

let testSetup: TestSetup

let definitions

let prepareJobResponse: PrepareJobResponse

describe('run script step', () => {
  beforeEach(async () => {
    testSetup = new TestSetup()
    testSetup.initialize()

    definitions = {
      prepareJob: testSetup.getPrepareJobDefinition(),
      runScriptStep: testSetup.getRunScriptStepDefinition()
    }

    const prepareJobOutput = testSetup.createOutputFile(
      'prepare-job-output.json'
    )
    await prepareJob(definitions.prepareJob.args, prepareJobOutput)

    prepareJobResponse = JSON.parse(fs.readFileSync(prepareJobOutput, 'utf-8'))
  })

  it('Should run script step without exceptions', async () => {
    await expect(
      runScriptStep(definitions.runScriptStep.args, prepareJobResponse.state)
    ).resolves.not.toThrow()
  })

  it('Should have path variable changed in container with prepend path string', async () => {
    definitions.runScriptStep.args.prependPath = '/some/path'
    definitions.runScriptStep.args.entryPoint = '/bin/bash'
    definitions.runScriptStep.args.entryPointArgs = [
      '-c',
      `if [[ ! $(env | grep "^PATH=") = "PATH=${definitions.runScriptStep.args.prependPath}:"* ]]; then exit 1; fi`
    ]
    await expect(
      runScriptStep(definitions.runScriptStep.args, prepareJobResponse.state)
    ).resolves.not.toThrow()
  })

  it('Should have path variable changed in container with prepend path string array', async () => {
    definitions.runScriptStep.args.prependPath = ['/some/other/path']
    definitions.runScriptStep.args.entryPoint = '/bin/bash'
    definitions.runScriptStep.args.entryPointArgs = [
      '-c',
      `if [[ ! $(env | grep "^PATH=") = "PATH=${definitions.runScriptStep.args.prependPath.join(
        ':'
      )}:"* ]]; then exit 1; fi`
    ]
    await expect(
      runScriptStep(definitions.runScriptStep.args, prepareJobResponse.state)
    ).resolves.not.toThrow()
  })
})
