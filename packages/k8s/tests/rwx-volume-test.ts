import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs'
import * as path from 'path'
import { cleanupJob, prepareJob, runScriptStep } from '../src/hooks'
import { TestHelper } from './test-setup'
import { RunScriptStepArgs } from 'hooklib'

jest.useRealTimers()

const kc = new k8s.KubeConfig()
kc.loadFromDefault()
const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
const k8sStorageApi = kc.makeApiClient(k8s.StorageV1Api)

describe('RWX Volume Tests', () => {
  let testHelper: TestHelper
  let rwxPvcName: string
  let rwxPvName: string
  let rwxStorageClassName: string
  let prepareJobData: any
  let prepareJobOutputFilePath: string

  beforeEach(async () => {
    testHelper = new TestHelper()
    await testHelper.initialize()

    const podName = process.env.ACTIONS_RUNNER_POD_NAME as string
    const runnerWorkspace = process.env.RUNNER_WORKSPACE as string
    const runnerWorkRoot = path.resolve(runnerWorkspace, '..')

    rwxPvcName = `${podName}-work-rwx`
    rwxPvName = `${podName}-work-rwx-pv`
    rwxStorageClassName = `${podName}-work-rwx-storage`

    const sc: k8s.V1StorageClass = {
      metadata: { name: rwxStorageClassName },
      provisioner: 'kubernetes.io/no-provisioner',
      volumeBindingMode: 'Immediate'
    }
    await k8sStorageApi.createStorageClass({ body: sc })

    const pv: k8s.V1PersistentVolume = {
      metadata: { name: rwxPvName },
      spec: {
        storageClassName: rwxStorageClassName,
        capacity: { storage: '2Gi' },
        volumeMode: 'Filesystem',
        accessModes: ['ReadWriteMany'],
        hostPath: { path: runnerWorkRoot }
      }
    }
    await k8sApi.createPersistentVolume({ body: pv })

    const volumeClaim: k8s.V1PersistentVolumeClaim = {
      metadata: { name: rwxPvcName },
      spec: {
        accessModes: ['ReadWriteMany'],
        volumeMode: 'Filesystem',
        storageClassName: rwxStorageClassName,
        volumeName: rwxPvName,
        resources: { requests: { storage: '1Gi' } }
      }
    }

    await k8sApi.createNamespacedPersistentVolumeClaim({
      namespace: 'default',
      body: volumeClaim
    })

    process.env.ACTIONS_RUNNER_CLAIM_NAME = rwxPvcName

    prepareJobData = testHelper.getPrepareJobDefinition()
    prepareJobOutputFilePath = testHelper.createFile('prepare-job-output.json')
  })

  afterEach(async () => {
    await testHelper.cleanup()
    delete process.env.ACTIONS_RUNNER_CLAIM_NAME
    await k8sApi
      .deleteNamespacedPersistentVolumeClaim({
        name: rwxPvcName,
        namespace: 'default',
        gracePeriodSeconds: 0
      })
      .catch(() => undefined)
    await k8sApi
      .deletePersistentVolume({ name: rwxPvName })
      .catch(() => undefined)
    await k8sStorageApi
      .deleteStorageClass({ name: rwxStorageClassName })
      .catch(() => undefined)
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
    expect(pvc.spec?.storageClassName).toBe(rwxStorageClassName)
    expect(pvc.spec?.volumeMode).toBe('Filesystem')
  })

  it('should verify RWX claim name is set correctly', () => {
    expect(process.env.ACTIONS_RUNNER_CLAIM_NAME).toBe(rwxPvcName)
  })
})
