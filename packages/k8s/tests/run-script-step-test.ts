import * as fs from 'fs'
import { cleanupJob, prepareJob, runScriptStep } from '../src/hooks'
import { TestHelper } from './test-setup'

jest.useRealTimers()

let testHelper: TestHelper

let prepareJobOutputData: any

let runScriptStepDefinition

describe('Run script step', () => {
  beforeEach(async () => {
    testHelper = new TestHelper()
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

  // NOTE: To use this test, do kubectl apply -f podspec.yaml (from podspec examples)
  // then change the name of the file to 'run-script-step-test.ts' and do
  // npm run test run-script-step

  it('should not throw an exception', async () => {
    await expect(
      runScriptStep(
        runScriptStepDefinition.args,
        prepareJobOutputData.state,
        null
      )
    ).resolves.not.toThrow()
  })

  it('should fail if the working directory does not exist', async () => {
    runScriptStepDefinition.args.workingDirectory = '/foo/bar'
    await expect(
      runScriptStep(
        runScriptStepDefinition.args,
        prepareJobOutputData.state,
        null
      )
    ).rejects.toThrow()
  })

  it('should shold have env variables available', async () => {
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
  })

  it('Should have path variable changed in container with prepend path string', async () => {
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
  })

  it('Should have path variable changed in container with prepend path string array', async () => {
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
  })
})
