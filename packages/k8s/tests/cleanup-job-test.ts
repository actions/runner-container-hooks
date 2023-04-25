import * as k8s from '@kubernetes/client-node'
import { cleanupJob, prepareJob } from '../src/hooks'
import { RunnerInstanceLabel } from '../src/hooks/constants'
import { namespace } from '../src/k8s'
import { TestHelper, TableTest } from './test-setup'

let testHelper: TestHelper

describe('Cleanup Job', () => {
  const cases = [] as TableTest[]

  cases.push({
    name: 'should not throw',
    fn: async () => {
      await expect(cleanupJob()).resolves.not.toThrow()
    }
  })

  cases.push({
    name: 'should have no runner linked pods running',
    fn: async () => {
      await cleanupJob()
      const kc = new k8s.KubeConfig()

      kc.loadFromDefault()
      const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

      const podList = await k8sApi.listNamespacedPod(
        namespace(),
        undefined,
        undefined,
        undefined,
        undefined,
        new RunnerInstanceLabel().toString()
      )

      expect(podList.body.items.length).toBe(0)
    }
  })

  cases.push({
    name: 'should have no runner linked secrets',
    fn: async () => {
      await cleanupJob()
      const kc = new k8s.KubeConfig()

      kc.loadFromDefault()
      const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

      const secretList = await k8sApi.listNamespacedSecret(
        namespace(),
        undefined,
        undefined,
        undefined,
        undefined,
        new RunnerInstanceLabel().toString()
      )

      expect(secretList.body.items.length).toBe(0)
    }
  })

  describe('k8s config', () => {
    beforeEach(async () => {
      testHelper = new TestHelper('k8s')
      await testHelper.initialize()
      let prepareJobData = testHelper.getPrepareJobDefinition()
      const prepareJobOutputFilePath = testHelper.createFile(
        'prepare-job-output.json'
      )
      await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    })

    afterEach(async () => {
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
      let prepareJobData = testHelper.getPrepareJobDefinition()
      const prepareJobOutputFilePath = testHelper.createFile(
        'prepare-job-output.json'
      )
      await prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    })

    afterEach(async () => {
      await testHelper.cleanup()
    })

    cases.forEach(e => {
      it(e.name, e.fn)
    })
  })
})
