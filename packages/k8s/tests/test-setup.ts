import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs'
import { HookData } from 'hooklib/lib'
import * as path from 'path'
import internal from 'stream'
import { v4 as uuidv4 } from 'uuid'
import { waitForPodPhases } from '../src/k8s'
import { PodPhase } from '../src/k8s/utils'

const kc = new k8s.KubeConfig()

kc.loadFromDefault()

const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
const k8sStorageApi = kc.makeApiClient(k8s.StorageV1Api)
const k8sAppsV1 = kc.makeApiClient(k8s.AppsV1Api)

export class TestHelper {
  private tempDirPath: string
  private podName: string
  constructor() {
    this.tempDirPath = `${__dirname}/_temp/runner`
    this.podName = uuidv4().replace(/-/g, '')
  }

  public async initialize(): Promise<void> {
    process.env['ACTIONS_RUNNER_POD_NAME'] = `${this.podName}`
    process.env['RUNNER_WORKSPACE'] = `${this.tempDirPath}/_work/repo`
    process.env['RUNNER_TEMP'] = `${this.tempDirPath}/_work/_temp`
    process.env['GITHUB_WORKSPACE'] = `${this.tempDirPath}/_work/repo/repo`
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'default'

    fs.mkdirSync(`${this.tempDirPath}/_work/repo/repo`, { recursive: true })
    fs.mkdirSync(`${this.tempDirPath}/externals`, { recursive: true })
    fs.mkdirSync(process.env.RUNNER_TEMP, { recursive: true })

    fs.copyFileSync(
      path.resolve(`${__dirname}/../../../examples/example-script.sh`),
      `${process.env.RUNNER_TEMP}/example-script.sh`
    )

    await this.cleanupK8sResources()
    try {
      await this.createTestVolume()
      await this.createTestJobPod()
    } catch (e) {
      console.log(e)
    }
  }

  public async cleanup(): Promise<void> {
    try {
      await this.cleanupK8sResources()
      fs.rmSync(this.tempDirPath, { recursive: true })
    } catch {}
  }
  public async cleanupK8sResources() {
    await k8sApi
      .deleteNamespacedPersistentVolumeClaim(
        `${this.podName}-work`,
        'default',
        undefined,
        undefined,
        0
      )
      .catch(e => {})
    await k8sApi.deletePersistentVolume(`${this.podName}-pv`).catch(e => {})
    await k8sStorageApi.deleteStorageClass('local-storage').catch(e => {})
    await k8sApi
      .deleteNamespacedPod(this.podName, 'default', undefined, undefined, 0)
      .catch(e => {})
    await k8sApi
      .deleteNamespacedPod(
        `${this.podName}-workflow`,
        'default',
        undefined,
        undefined,
        0
      )
      .catch(e => {})
  }
  public createFile(fileName?: string, content = ''): string {
    const filePath = `${this.tempDirPath}/${fileName || uuidv4()}`
    fs.writeFileSync(filePath, content)
    return filePath
  }

  public removeFile(fileName: string): void {
    const filePath = `${this.tempDirPath}/${fileName}`
    fs.rmSync(filePath)
  }

  public async createTestJobPod() {
    const container = {
      name: 'nginx',
      image: 'nginx:latest',
      imagePullPolicy: 'IfNotPresent'
    } as k8s.V1Container

    const pod: k8s.V1Pod = {
      metadata: {
        name: this.podName
      },
      spec: {
        restartPolicy: 'Never',
        containers: [container]
      }
    } as k8s.V1Pod
    await k8sApi.createNamespacedPod('default', pod)
  }

  public async createTestVolume() {
    var sc: k8s.V1StorageClass = {
      metadata: {
        name: 'local-storage'
      },
      provisioner: 'kubernetes.io/no-provisioner',
      volumeBindingMode: 'Immediate'
    }
    await k8sStorageApi.createStorageClass(sc)

    var volume: k8s.V1PersistentVolume = {
      metadata: {
        name: `${this.podName}-pv`
      },
      spec: {
        storageClassName: 'local-storage',
        capacity: {
          storage: '2Gi'
        },
        volumeMode: 'Filesystem',
        accessModes: ['ReadWriteOnce'],
        hostPath: {
          path: `${this.tempDirPath}/_work`
        }
      }
    }
    await k8sApi.createPersistentVolume(volume)
    var volumeClaim: k8s.V1PersistentVolumeClaim = {
      metadata: {
        name: `${this.podName}-work`
      },
      spec: {
        accessModes: ['ReadWriteOnce'],
        volumeMode: 'Filesystem',
        storageClassName: 'local-storage',
        volumeName: `${this.podName}-pv`,
        resources: {
          requests: {
            storage: '1Gi'
          }
        }
      }
    }
    await k8sApi.createNamespacedPersistentVolumeClaim('default', volumeClaim)
  }

  public getPrepareJobDefinition(): HookData {
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

  public getRunScriptStepDefinition(): HookData {
    const runScriptStep = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname + '/../../../examples/run-script-step.json'),
        'utf8'
      )
    )

    runScriptStep.args.entryPointArgs[1] = `/__w/_temp/example-script.sh`
    return runScriptStep
  }

  public getRunContainerStepDefinition(): HookData {
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

  public async createContainerRegistry(): Promise<{
    registryName: string
    registryPort: number
    nodePort: number
  }> {
    const registryName = 'docker-registry'
    const registryPort = 5000
    const nodePort = 31500

    const cm = registryConfigMap(registryName, registryPort)
    const secret = registrySecret(registryName)
    const ss = registryStatefulSet(registryName, registryPort)
    const svc = registryService(registryName, registryPort, nodePort)
    const namespace =
      process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] || 'default'

    await Promise.all([
      k8sApi.createNamespacedConfigMap(namespace, cm),
      k8sApi.createNamespacedSecret(namespace, secret)
    ])
    await k8sAppsV1.createNamespacedStatefulSet(namespace, ss)
    await waitForPodPhases(
      `${registryName}-0`,
      new Set([PodPhase.RUNNING]),
      new Set([PodPhase.PENDING, PodPhase.UNKNOWN])
    )
    await k8sApi.createNamespacedService(namespace, svc)
    return {
      registryName,
      registryPort,
      nodePort
    }
  }

  public initializeDockerAction(): string {
    const actionPath = `${this.tempDirPath}/_work/_actions/example-handle/example-repo/example-branch/mock-directory`
    fs.mkdirSync(actionPath, { recursive: true })
    this.writeDockerfile(actionPath)
    this.writeEntrypoint(actionPath)
    return actionPath
  }

  private writeDockerfile(actionPath: string) {
    const content = `FROM ubuntu:latest
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]`
    fs.writeFileSync(`${actionPath}/Dockerfile`, content)
  }

  private writeEntrypoint(actionPath) {
    const content = `#!/bin/sh -l
echo "Hello $1"
time=$(date)
echo "::set-output name=time::$time"`
    const entryPointPath = `${actionPath}/entrypoint.sh`
    fs.writeFileSync(entryPointPath, content)
    fs.chmodSync(entryPointPath, 0o755)
  }
}

function registryConfigMap(name: string, port: number): k8s.V1ConfigMap {
  const REGISTRY_CONFIG_MAP_YAML = `
storage:
  filesystem:
    rootdirectory: /var/lib/registry
    maxthreads: 100
health:
  storagedriver:
    enabled: true
    interval: 10s
    threshold: 3
http:
  addr: :${port}
  headers:
    X-Content-Type-Options:
    - nosniff
log:
  fields:
    service: registry
storage:
  cache:
    blobdescriptor: inmemory
version: 0.1
`.trim()
  const cm = new k8s.V1ConfigMap()
  cm.apiVersion = 'v1'
  cm.data = {
    'config.yaml': REGISTRY_CONFIG_MAP_YAML
  }
  cm.kind = 'ConfigMap'
  cm.metadata = new k8s.V1ObjectMeta()
  cm.metadata.labels = { app: name }
  cm.metadata.name = `${name}-config`

  return cm
}

function registryStatefulSet(name: string, port: number): k8s.V1StatefulSet {
  const ss = new k8s.V1StatefulSet()
  ss.apiVersion = 'apps/v1'
  ss.metadata = new k8s.V1ObjectMeta()
  ss.metadata.name = name

  const spec = new k8s.V1StatefulSetSpec()
  spec.selector = new k8s.V1LabelSelector()
  spec.selector.matchLabels = { app: 'docker-registry' }
  spec.serviceName = 'registry'
  spec.replicas = 1

  const tmpl = new k8s.V1PodTemplateSpec()
  tmpl.metadata = new k8s.V1ObjectMeta()
  tmpl.metadata.labels = { app: name }
  tmpl.spec = new k8s.V1PodSpec()
  tmpl.spec.terminationGracePeriodSeconds = 5 // TODO: figure out for how long

  const c = new k8s.V1Container()
  c.command = ['/bin/registry', 'serve', '/etc/docker/registry/config.yaml']
  c.env = [
    {
      name: 'REGISTRY_HTTP_SECRET',
      valueFrom: {
        secretKeyRef: {
          key: 'haSharedSecret',
          name: `${name}-secret`
        }
      }
    },
    {
      name: 'REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY',
      value: '/var/lib/registry'
    }
  ]
  c.image = 'registry:2.6.2'
  c.name = name
  c.imagePullPolicy = 'IfNotPresent'
  c.ports = [
    {
      containerPort: port,
      protocol: 'TCP'
    }
  ]

  c.volumeMounts = [
    {
      mountPath: '/etc/docker/registry',
      name: 'docker-registry-config'
    }
  ]

  c.livenessProbe = new k8s.V1Probe()
  c.livenessProbe.failureThreshold = 3
  c.livenessProbe.periodSeconds = 10
  c.livenessProbe.successThreshold = 1
  c.livenessProbe.timeoutSeconds = 1
  c.livenessProbe.httpGet = new k8s.V1HTTPGetAction()
  c.livenessProbe.httpGet.path = '/'
  c.livenessProbe.httpGet.port = port
  c.livenessProbe.httpGet.scheme = 'HTTP'

  c.readinessProbe = new k8s.V1Probe()
  c.readinessProbe.failureThreshold = 3
  c.readinessProbe.periodSeconds = 10
  c.readinessProbe.successThreshold = 1
  c.readinessProbe.timeoutSeconds = 1
  c.readinessProbe.httpGet = new k8s.V1HTTPGetAction()
  c.readinessProbe.httpGet.path = '/'
  c.readinessProbe.httpGet.port = port
  c.readinessProbe.httpGet.scheme = 'HTTP'

  tmpl.spec.containers = [c]
  tmpl.spec.volumes = [
    {
      name: `${name}-config`,
      configMap: {
        name: `${name}-config`
      }
    }
  ]

  spec.template = tmpl
  ss.spec = spec

  return ss
}
function registryService(
  name: string,
  port: number,
  nodePort: number
): k8s.V1Service {
  const svc = new k8s.V1Service()
  svc.apiVersion = 'v1'
  svc.kind = 'Service'
  svc.metadata = new k8s.V1ObjectMeta()
  svc.metadata.name = name
  svc.metadata.labels = {
    app: name
  }
  const spec = new k8s.V1ServiceSpec()
  spec.externalTrafficPolicy = 'Cluster'
  spec.ports = [
    {
      name: 'registry',
      nodePort: nodePort,
      port: port,
      protocol: 'TCP',
      targetPort: port
    }
  ]
  spec.selector = {
    app: name
  }
  spec.sessionAffinity = 'None'
  spec.type = 'NodePort'
  svc.spec = spec

  return svc
}

function registrySecret(name: string): k8s.V1Secret {
  const secret = new k8s.V1Secret()
  secret.apiVersion = 'v1'
  secret.data = { haSharedSecret: 'U29tZVZlcnlTdHJpbmdTZWNyZXQK' }
  secret.kind = 'Secret'
  secret.metadata = new k8s.V1ObjectMeta()
  secret.metadata.labels = {
    app: name,
    chart: `${name}-1.4.3`
  }
  secret.metadata.name = `${name}-secret`
  secret.type = 'Opaque'

  return secret
}
