import { containerBuild } from '../src/dockerCommands'
import TestSetup, { TableTest } from './test-setup'

let testSetup
let runContainerStepDefinition

describe('container build', () => {
  const cases = [] as TableTest[]

  cases.push({
    name: 'should build container',
    fn: async () => {
      runContainerStepDefinition.image = ''
      const actionPath = testSetup.initializeDockerAction()
      runContainerStepDefinition.dockerfile = `${actionPath}/Dockerfile`
      await expect(
        containerBuild(runContainerStepDefinition, 'example-test-tag')
      ).resolves.not.toThrow()
    }
  })

  describe('k8s config', () => {
    beforeEach(() => {
      testSetup = new TestSetup('k8s')
      testSetup.initialize()

      runContainerStepDefinition = testSetup.getRunContainerStepDefinition()
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

      runContainerStepDefinition = testSetup.getRunContainerStepDefinition()
    })

    afterEach(() => {
      testSetup.teardown()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
    })
  })
})
