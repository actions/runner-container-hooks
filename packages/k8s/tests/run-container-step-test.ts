import { TestTempOutput } from './test-setup'
import * as path from 'path'
import { runContainerStep } from '../src/hooks'
import * as fs from 'fs'

jest.useRealTimers()

let testTempOutput: TestTempOutput

let runContainerStepJsonPath = path.resolve(
  `${__dirname}/../../../examples/run-container-step.json`
)

let runContainerStepData: any

describe('Run container step', () => {
  beforeAll(() => {
    const content = fs.readFileSync(runContainerStepJsonPath)
    runContainerStepData = JSON.parse(content.toString())
    process.env.RUNNER_NAME = 'testjob'
  })
  it('should not throw', async () => {
    await expect(
      runContainerStep(runContainerStepData.args)
    ).resolves.not.toThrow()
  })
})
