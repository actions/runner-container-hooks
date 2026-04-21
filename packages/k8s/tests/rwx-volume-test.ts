import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs'
import { cleanupJob, prepareJob, runScriptStep } from '../src/hooks'
import {
  TestHelper,
  isRWXTestEnabled,
  getRWXStorageClass,
  RWX_SKIP_MESSAGE
} from './test-setup'
import { RunScriptStepArgs } from 'hooklib'

jest.useRealTimers()

const kc = new k8s.KubeConfig()
kc.loadFromDefault()
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

describe('RWX Volume Tests', () => {
  const describeOrSkip = isRWXTestEnabled() ? describe : describe.skip

  describeOrSkip('RWX volume integration', () => {
    let testHelper: TestHelper
    let rwxPvcName: string
    let prepareJobData: any
    let prepareJobOutputFilePath: string

    beforeEach(async () => {
      testHelper = new TestHelper()
      await testHelper.initialize()

      const podName = process.env.ACTIONS_RUNNER_POD_NAME
      rwxPvcName = `${podName}-work-rwx`

      const volumeClaim: k8s.V1PersistentVolumeClaim = {
        metadata: {
          name: rwxPvcName
        },
        spec: {
          accessModes: ['ReadWriteMany'],
          volumeMode: 'Filesystem',
          storageClassName: getRWXStorageClass(),
          resources: {
            requests: {
              storage: '1Gi'
            }
          }
        }
      }

      await k8sApi.createNamespacedPersistentVolumeClaim({
        namespace: 'default',
        body: volumeClaim
      })

      process.env.ACTIONS_RUNNER_CLAIM_NAME = rwxPvcName

      prepareJobData = testHelper.getPrepareJobDefinition()
      prepareJobOutputFilePath = testHelper.createFile(
        'prepare-job-output.json'
      )
    })

    afterAll(async () => {
      if (rwxPvcName) {
        try {
          await k8sApi.deleteNamespacedPersistentVolumeClaim({
            name: rwxPvcName,
            namespace: 'default'
          })
        } catch {
          // Ignore cleanup errors - PVC may not exist
        }
      }
    })

    afterEach(async () => {
      await testHelper.cleanup()
    })

    it('should successfully run hook flow with RWX volume', async () => {
      await expect(
        prepareJob(prepareJobData.args, prepareJobOutputFilePath)
      ).resolves.not.toThrow()

      const prepareJobOutputJson = fs.readFileSync(prepareJobOutputFilePath)
      const prepareJobOutputData = JSON.parse(prepareJobOutputJson.toString())

      const scriptStepData = testHelper.getRunScriptStepDefinition()

      await expect(
        runScriptStep(
          scriptStepData.args as RunScriptStepArgs,
          prepareJobOutputData.state
        )
      ).resolves.not.toThrow()

      await expect(cleanupJob()).resolves.not.toThrow()
    })

    it('should verify RWX PVC was created with correct access mode', async () => {
      const pvc = await k8sApi.readNamespacedPersistentVolumeClaim({
        name: rwxPvcName,
        namespace: 'default'
      })

      expect(pvc.spec?.accessModes).toContain('ReadWriteMany')
      expect(pvc.spec?.storageClassName).toBe(getRWXStorageClass())
      expect(pvc.spec?.volumeMode).toBe('Filesystem')
    })

    it('should verify RWX claim name is set correctly', () => {
      expect(process.env.ACTIONS_RUNNER_CLAIM_NAME).toBe(rwxPvcName)
    })
  })

  if (!isRWXTestEnabled()) {
    it(RWX_SKIP_MESSAGE, () => {})
  }
})
