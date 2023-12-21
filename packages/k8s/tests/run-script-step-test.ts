import * as fs from 'fs'
import { cleanupJob, prepareJob, runScriptStep } from '../src/hooks'
import { TestHelper } from './test-setup'
import * as k8s from '@kubernetes/client-node'
import { prunePods } from '../src/k8s'


jest.useRealTimers()

let testHelper: TestHelper

let prepareJobOutputData: any

let runScriptStepDefinition

let execSpy; 

describe('Run script step', () => {
  beforeEach(async () => {
    execSpy = jest.spyOn(k8s.Exec.prototype, 'exec');
    testHelper = new TestHelper()
    await testHelper.initialize()
    await prunePods()
    
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
    execSpy.mockRestore();
    await cleanupJob()
    await testHelper.cleanup()
  })

  it('should not throw an exception', async () => {
    await expect(
      runScriptStep(
        runScriptStepDefinition.args,
        prepareJobOutputData.state,
        null
      )
    ).resolves.not.toThrow()
  })

  
  it('should be able to handle errors occurring in k8s.Exec.exec() (e.g non 2xx Kubernetes API response)', async () => {
    let errorCallCount = 0;
    const mockExec = jest.fn(async (...args) => {
      errorCallCount++;

      if (errorCallCount < 2) {
        throw new Error('Simulated failure message, case1');
      } else {
        execSpy.mockRestore();
        throw new Error('Simulated failure message, case 1');
      }
    });

    execSpy.mockImplementation(mockExec);
    await expect(
      runScriptStep(
        runScriptStepDefinition.args,
        prepareJobOutputData.state,
        null
      )
    ).resolves.not.toThrow()
  })

  it('should fail after multiple consecutive failures in k8s.Exec.exec()', async () => {

    const mockExec = jest.fn(async (...args) => {
      throw new Error('Simulated failure message, case 2');
    });
    execSpy.mockImplementation(mockExec);
    await expect(
      runScriptStep(
        runScriptStepDefinition.args,
        prepareJobOutputData.state,
        null
      )
    ).rejects.toThrow()
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

  it('Dollar symbols in environment variables should not be expanded', async () => {
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
