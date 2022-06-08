import * as fs from 'fs'
import { PrepareJobResponse } from 'hooklib/lib'
import * as path from 'path'
import { prepareJob, runScriptStep } from '../src/hooks'
import TestSetup from './test-setup'

jest.useRealTimers()

let testSetup: TestSetup

const definitions = {
  prepareJob: JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname + '/../../../examples/prepare-job.json'),
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

let prepareJobResponse: PrepareJobResponse

describe('run-script-step', () => {
  beforeEach(async () => {
    testSetup = new TestSetup()
    testSetup.initialize()

    const prepareJobOutput = testSetup.createOutputFile(
      'prepare-job-output.json'
    )
    definitions.prepareJob.args.container.registry = null
    definitions.prepareJob.args.services.forEach(s => {
      s.registry = null
    })
    await prepareJob(definitions.prepareJob.args, prepareJobOutput)

    prepareJobResponse = JSON.parse(fs.readFileSync(prepareJobOutput, 'utf-8'))
  })

  it('Should run script step without exceptions', async () => {
    await expect(
      runScriptStep(definitions.runScriptStep.args, prepareJobResponse.state)
    ).resolves.not.toThrow()
  })
})
