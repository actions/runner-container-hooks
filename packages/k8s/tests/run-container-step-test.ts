import * as fs from 'fs'
import * as path from 'path'
import { runContainerStep } from '../src/hooks'
import { TestHelper } from './test-setup'

jest.useRealTimers()

let testHelper: TestHelper

let runContainerStepJsonPath = path.resolve(
  `${__dirname}/../../../examples/run-container-step.json`
)

let runContainerStepData: any

describe('Run container step', () => {
  beforeAll(async () => {
    const content = fs.readFileSync(runContainerStepJsonPath)
    runContainerStepData = JSON.parse(content.toString())
    testHelper = new TestHelper()
    await testHelper.initialize()
  })
  it('should not throw', async () => {
    const exitCode = await runContainerStep(runContainerStepData.args)
    expect(exitCode).toBe(0)
  })
  afterEach(async () => {
    await testHelper.cleanup()
  })
})
