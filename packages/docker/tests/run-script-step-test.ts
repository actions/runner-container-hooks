import * as fs from 'fs'
import { PrepareJobResponse } from 'hooklib/lib'
import { prepareJob, runScriptStep } from '../src/hooks'
import TestSetup, { TableTest } from './test-setup'

jest.useRealTimers()

let testSetup: TestSetup

let definitions

let prepareJobResponse: PrepareJobResponse

describe('run script step', () => {
  const cases = [] as TableTest[]

  cases.push({
    name: 'Should run script step without exceptions',
    fn: async () => {
      await expect(
        runScriptStep(definitions.runScriptStep.args, prepareJobResponse.state)
      ).resolves.not.toThrow()
    }
  })

  cases.push({
    name: 'Should have path variable changed in container with prepend path string',
    fn: async () => {
      definitions.runScriptStep.args.prependPath = '/some/path'
      definitions.runScriptStep.args.entryPoint = '/bin/bash'
      definitions.runScriptStep.args.entryPointArgs = [
        '-c',
        `if [[ ! $(env | grep "^PATH=") = "PATH=${definitions.runScriptStep.args.prependPath}:"* ]]; then exit 1; fi`
      ]
      await expect(
        runScriptStep(definitions.runScriptStep.args, prepareJobResponse.state)
      ).resolves.not.toThrow()
    }
  })

  cases.push({
    name: 'Should have path variable changed in container with prepend path string array',
    fn: async () => {
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
    }
  })

  describe('k8s config', () => {
    beforeEach(async () => {
      testSetup = new TestSetup('k8s')
      testSetup.initialize()

      definitions = {
        prepareJob: testSetup.getPrepareJobDefinition(),
        runScriptStep: testSetup.getRunScriptStepDefinition()
      }

      const prepareJobOutput = testSetup.createOutputFile(
        'prepare-job-output.json'
      )
      await prepareJob(definitions.prepareJob.args, prepareJobOutput)

      prepareJobResponse = JSON.parse(
        fs.readFileSync(prepareJobOutput, 'utf-8')
      )
    })

    afterEach(() => {
      testSetup.teardown()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
    })
  })

  describe('docker config', () => {
    beforeEach(async () => {
      testSetup = new TestSetup('docker')
      testSetup.initialize()

      definitions = {
        prepareJob: testSetup.getPrepareJobDefinition(),
        runScriptStep: testSetup.getRunScriptStepDefinition()
      }

      const prepareJobOutput = testSetup.createOutputFile(
        'prepare-job-output.json'
      )
      await prepareJob(definitions.prepareJob.args, prepareJobOutput)

      prepareJobResponse = JSON.parse(
        fs.readFileSync(prepareJobOutput, 'utf-8')
      )
    })

    afterEach(() => {
      testSetup.teardown()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
    })
  })
})
