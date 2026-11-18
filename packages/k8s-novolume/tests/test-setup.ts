import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs'
import { HookData } from 'hooklib/lib'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'

const kc = new k8s.KubeConfig()

kc.loadFromDefault()

const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

export class TestHelper {
  private tempDirPath: string
  private podName: string
  private runnerWorkdir: string
  private runnerTemp: string

  constructor() {
    this.tempDirPath = `${__dirname}/_temp/runner`
    this.runnerWorkdir = `${this.tempDirPath}/_work`
    this.runnerTemp = `${this.tempDirPath}/_work/_temp`
    this.podName = uuidv4().replace(/-/g, '')
  }

  async initialize(): Promise<void> {
    process.env['ACTIONS_RUNNER_POD_NAME'] = `${this.podName}`
    process.env['RUNNER_WORKSPACE'] = `${this.runnerWorkdir}/repo`
    process.env['RUNNER_TEMP'] = `${this.runnerTemp}`
    process.env['GITHUB_WORKSPACE'] = `${this.runnerWorkdir}/repo/repo`
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'default'

    fs.mkdirSync(`${this.runnerWorkdir}/repo/repo`, { recursive: true })
    fs.mkdirSync(`${this.tempDirPath}/externals`, { recursive: true })
    fs.mkdirSync(this.runnerTemp, { recursive: true })
    fs.mkdirSync(`${this.runnerTemp}/_github_workflow`, { recursive: true })
    fs.mkdirSync(`${this.runnerTemp}/_github_home`, { recursive: true })
    fs.mkdirSync(`${this.runnerTemp}/_runner_file_commands`, {
      recursive: true
    })

    fs.copyFileSync(
      path.resolve(`${__dirname}/../../../examples/example-script.sh`),
      `${this.runnerTemp}/example-script.sh`
    )

    await this.cleanupK8sResources()
    try {
      await this.createTestJobPod()
    } catch (e) {
      console.log(e)
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.cleanupK8sResources()
      fs.rmSync(this.tempDirPath, { recursive: true })
    } catch {
      // Ignore errors during cleanup
    }
  }

  async cleanupK8sResources(): Promise<void> {
    await k8sApi
      .deleteNamespacedPod({
        name: this.podName,
        namespace: 'default',
        gracePeriodSeconds: 0
      })
      .catch((e: k8s.ApiException<any>) => {
        if (e.code !== 404) {
          console.error(JSON.stringify(e))
        }
      })
    await k8sApi
      .deleteNamespacedPod({
        name: `${this.podName}-workflow`,
        namespace: 'default',
        gracePeriodSeconds: 0
      })
      .catch((e: k8s.ApiException<any>) => {
        if (e.code !== 404) {
          console.error(JSON.stringify(e))
        }
      })
  }
  createFile(fileName?: string): string {
    const filePath = `${this.tempDirPath}/${fileName || uuidv4()}`
    fs.writeFileSync(filePath, '')
    return filePath
  }

  removeFile(fileName: string): void {
    const filePath = `${this.tempDirPath}/${fileName}`
    fs.rmSync(filePath)
  }

  async createTestJobPod(): Promise<void> {
    const container = {
      name: 'runner',
      image: 'ghcr.io/actions/actions-runner:latest',
      imagePullPolicy: 'IfNotPresent'
    } as k8s.V1Container

    const pod: k8s.V1Pod = {
      metadata: {
        name: this.podName
      },
      spec: {
        restartPolicy: 'Never',
        containers: [container],
        securityContext: {
          runAsUser: 1001,
          runAsGroup: 1001,
          fsGroup: 1001
        }
      }
    } as k8s.V1Pod
    await k8sApi.createNamespacedPod({ namespace: 'default', body: pod })
  }

  getPrepareJobDefinition(): HookData {
    const prepareJob = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname + '/../../../examples/prepare-job.json'),
        'utf8'
      )
    )

    prepareJob.args.container.userMountVolumes = undefined
    prepareJob.args.container.registry = null
    prepareJob.args.services.forEach(s => {
      s.registry = null
    })

    return prepareJob
  }

  getRunScriptStepDefinition(): HookData {
    const runScriptStep = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname + '/../../../examples/run-script-step.json'),
        'utf8'
      )
    )

    runScriptStep.args.entryPointArgs[1] = `/__w/_temp/example-script.sh`
    return runScriptStep
  }

  getRunContainerStepDefinition(): HookData {
    const runContainerStep = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname + '/../../../examples/run-container-step.json'),
        'utf8'
      )
    )

    runContainerStep.args.entryPointArgs[1] = `/__w/_temp/example-script.sh`
    runContainerStep.args.userMountVolumes = undefined
    runContainerStep.args.registry = null
    return runContainerStep
  }
}
