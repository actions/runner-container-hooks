import * as fs from 'fs'
import {
  cleanupJob,
  prepareJob,
  runContainerStep,
  runScriptStep
} from '../src/hooks'
import TestSetup, { TableTest } from './test-setup'

let definitions

let testSetup: TestSetup

describe('e2e', () => {
  const cases = [] as TableTest[]

  cases.push({
    name: 'should prepare job, then run script step, then run container step then cleanup',
    fn: async () => {
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
    }
  })

  cases.push({
    name: 'should prepare job, then run script step, then run container step with Dockerfile then cleanup',
    fn: async () => {
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
    }
  })

  describe('k8s config', () => {
    beforeEach(() => {
      testSetup = new TestSetup('k8s')
      testSetup.initialize()

      definitions = {
        prepareJob: testSetup.getPrepareJobDefinition(),
        runScriptStep: testSetup.getRunScriptStepDefinition(),
        runContainerStep: testSetup.getRunContainerStepDefinition()
      }
    })

    afterEach(() => {
      testSetup.teardown()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
    })
  })

  describe('docker config', () => {
    beforeEach(() => {
      testSetup = new TestSetup('docker')
      testSetup.initialize()

      definitions = {
        prepareJob: testSetup.getPrepareJobDefinition(),
        runScriptStep: testSetup.getRunScriptStepDefinition(),
        runContainerStep: testSetup.getRunContainerStepDefinition()
      }
    })

    afterEach(() => {
      testSetup.teardown()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
    })
  })
})
