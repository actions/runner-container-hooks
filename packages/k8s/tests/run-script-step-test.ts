import * as fs from 'fs'
import { cleanupJob, prepareJob, runScriptStep } from '../src/hooks'
import { TableTest, TestHelper } from './test-setup'

jest.useRealTimers()

let testHelper: TestHelper

let prepareJobOutputData: any

let runScriptStepDefinition

// NOTE: To use this test, do kubectl apply -f podspec.yaml (from podspec examples)
// then change the name of the file to 'run-script-step-test.ts' and do
// npm run test run-script-step

describe('Run script step', () => {
  const cases = [] as TableTest[]

  cases.push({
    name: 'should not throw an exception',
    fn: async () => {
      await expect(
        runScriptStep(
          runScriptStepDefinition.args,
          prepareJobOutputData.state,
          null
        )
      ).resolves.not.toThrow()
    }
  })

  cases.push({
    name: 'should fail if the working directory does not exist',
    fn: async () => {
      runScriptStepDefinition.args.workingDirectory = '/foo/bar'
      await expect(
        runScriptStep(
          runScriptStepDefinition.args,
          prepareJobOutputData.state,
          null
        )
      ).rejects.toThrow()
    }
  })

  cases.push({
    name: 'should shold have env variables available',
    fn: async () => {
      runScriptStepDefinition.args.entryPoint = 'bash'

      runScriptStepDefinition.args.entryPointArgs = [
        '-c',
        "'if [[ -z $NODE_ENV ]]; then exit 1; fi'"
      ]
      await expect(
        runScriptStep(
          runScriptStepDefinition.args,
          prepareJobOutputData.state,
          null
        )
      ).resolves.not.toThrow()
    }
  })

  cases.push({
    name: 'Should have path variable changed in container with prepend path string',
    fn: async () => {
      runScriptStepDefinition.args.prependPath = '/some/path'
      runScriptStepDefinition.args.entryPoint = '/bin/bash'
      runScriptStepDefinition.args.entryPointArgs = [
        '-c',
        `'if [[ ! $(env | grep "^PATH=") = "PATH=${runScriptStepDefinition.args.prependPath}:"* ]]; then exit 1; fi'`
      ]

      await expect(
        runScriptStep(
          runScriptStepDefinition.args,
          prepareJobOutputData.state,
          null
        )
      ).resolves.not.toThrow()
    }
  })

  cases.push({
    name: 'Dollar symbols in environment variables should not be expanded',
    fn: async () => {
      runScriptStepDefinition.args.environmentVariables = {
        VARIABLE1: '$VAR',
        VARIABLE2: '${VAR}',
        VARIABLE3: '$(VAR)'
      }
      runScriptStepDefinition.args.entryPointArgs = [
        '-c',
        '\'if [[ -z "$VARIABLE1" ]]; then exit 1; fi\'',
        '\'if [[ -z "$VARIABLE2" ]]; then exit 2; fi\'',
        '\'if [[ -z "$VARIABLE3" ]]; then exit 3; fi\''
      ]

      await expect(
        runScriptStep(
          runScriptStepDefinition.args,
          prepareJobOutputData.state,
          null
        )
      ).resolves.not.toThrow()
    }
  })

  cases.push({
    name: 'Should have path variable changed in container with prepend path string array',
    fn: async () => {
      runScriptStepDefinition.args.prependPath = ['/some/other/path']
      runScriptStepDefinition.args.entryPoint = '/bin/bash'
      runScriptStepDefinition.args.entryPointArgs = [
        '-c',
        `'if [[ ! $(env | grep "^PATH=") = "PATH=${runScriptStepDefinition.args.prependPath.join(
          ':'
        )}:"* ]]; then exit 1; fi'`
      ]

      await expect(
        runScriptStep(
          runScriptStepDefinition.args,
          prepareJobOutputData.state,
          null
        )
      ).resolves.not.toThrow()
    }
  })

  describe('k8s config', () => {
    beforeEach(async () => {
      testHelper = new TestHelper('k8s')
      await testHelper.initialize()
      const prepareJobOutputFilePath = testHelper.createFile(
        'prepare-job-output.json'
      )

      const prepareJobData = testHelper.getPrepareJobDefinition()
      runScriptStepDefinition = testHelper.getRunScriptStepDefinition()

      await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
      const outputContent = fs.readFileSync(prepareJobOutputFilePath)
      prepareJobOutputData = JSON.parse(outputContent.toString())
    })

    afterEach(async () => {
      await cleanupJob()
      await testHelper.cleanup()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
    })
  })

  describe('docker config', () => {
    beforeEach(async () => {
      testHelper = new TestHelper('docker')
      await testHelper.initialize()
      const prepareJobOutputFilePath = testHelper.createFile(
        'prepare-job-output.json'
      )

      const prepareJobData = testHelper.getPrepareJobDefinition()
      runScriptStepDefinition = testHelper.getRunScriptStepDefinition()

      await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
      const outputContent = fs.readFileSync(prepareJobOutputFilePath)
      prepareJobOutputData = JSON.parse(outputContent.toString())
    })

    afterEach(async () => {
      await cleanupJob()
      await testHelper.cleanup()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
    })
  })
})
