import * as k8s from '@kubernetes/client-node'

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
  addr: :5000
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

export function registryConfigMap(): k8s.V1ConfigMap {
  const cm = new k8s.V1ConfigMap()
  cm.apiVersion = 'v1'
  cm.data = {
    'config.yaml': REGISTRY_CONFIG_MAP_YAML
  }
  cm.kind = 'ConfigMap'
  cm.metadata = new k8s.V1ObjectMeta()
  cm.metadata.labels = { app: 'docker-registry' }
  cm.metadata.name = 'docker-registry-config'
  // TODO: make this configurable

  return cm
}

export function registrySecret(): k8s.V1Secret {
  const secret = new k8s.V1Secret()
  secret.apiVersion = 'v1'
  secret.data = { haSharedSecret: 'U29tZVZlcnlTdHJpbmdTZWNyZXQK' }
  secret.kind = 'Secret'
  secret.metadata = new k8s.V1ObjectMeta()
  secret.metadata.labels = {
    app: 'docker-registry',
    chart: 'docker-registry-1.4.3'
  }
  secret.metadata.name = 'docker-registry-secret'
  secret.type = 'Opaque'

  return secret
}

export function registryStatefulSet(): k8s.V1StatefulSet {
  const ss = new k8s.V1StatefulSet()
  ss.apiVersion = 'apps/v1'
  ss.metadata = new k8s.V1ObjectMeta()
  ss.metadata.name = 'docker-registry'

  const spec = new k8s.V1StatefulSetSpec()
  spec.selector = new k8s.V1LabelSelector()
  spec.selector.matchLabels = { app: 'docker-registry' }
  spec.serviceName = 'registry'
  spec.replicas = 1

  const tmpl = new k8s.V1PodTemplateSpec()
  tmpl.metadata = new k8s.V1ObjectMeta()
  tmpl.metadata.labels = { app: 'docker-registry' }
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
          name: 'docker-registry-secret'
        }
      }
    },
    {
      name: 'REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY',
      value: '/var/lib/registry'
    }
  ]
  c.image = 'registry:2.6.2'
  c.name = 'docker-registry'
  c.imagePullPolicy = 'IfNotPresent'
  c.ports = [
    {
      containerPort: 5000,
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
  c.livenessProbe.httpGet.port = 5000
  c.livenessProbe.httpGet.scheme = 'HTTP'

  c.readinessProbe = new k8s.V1Probe()
  c.readinessProbe.failureThreshold = 3
  c.readinessProbe.periodSeconds = 10
  c.readinessProbe.successThreshold = 1
  c.readinessProbe.timeoutSeconds = 1
  c.readinessProbe.httpGet = new k8s.V1HTTPGetAction()
  c.readinessProbe.httpGet.path = '/'
  c.readinessProbe.httpGet.port = 5000
  c.readinessProbe.httpGet.scheme = 'HTTP'

  tmpl.spec.containers = [c]
  tmpl.spec.volumes = [
    {
      name: 'docker-registry-config',
      configMap: {
        name: 'docker-registry-config'
      }
    }
  ]

  spec.template = tmpl
  ss.spec = spec

  return ss
}

export function registryService(): k8s.V1Service {
  const svc = new k8s.V1Service()
  svc.apiVersion = 'v1'
  svc.kind = 'Service'
  svc.metadata = new k8s.V1ObjectMeta()
  svc.metadata.name = 'docker-registry'
  svc.metadata.labels = {
    app: 'docker-registry'
  }
  const spec = new k8s.V1ServiceSpec()
  spec.externalTrafficPolicy = 'Cluster'
  spec.ports = [
    {
      name: 'registry',
      nodePort: 31500,
      port: 5000,
      protocol: 'TCP',
      targetPort: 5000
    }
  ]
  spec.selector = {
    app: 'docker-registry'
  }
  spec.sessionAffinity = 'None'
  spec.type = 'NodePort'
  svc.spec = spec

  return svc
}

export function kanikoPod(): k8s.V1Pod {
  const pod = new k8s.V1Pod()
  pod.apiVersion = 'v1'
  pod.kind = 'Pod'
  pod.metadata = new k8s.V1ObjectMeta()
  pod.metadata.name = 'kaniko'

  const spec = new k8s.V1PodSpec()
  const c = new k8s.V1Container()
  c.image = 'gcr.io/kaniko-project/executor:latest'
  c.name = 'kaniko'
  c.imagePullPolicy = 'Always'
  c.env = [
    {
      name: 'GIT_TOKEN',
      value: process.env.GITHUB_TOKEN
    }
  ]
  c.args = [
    '--dockerfile=Dockerfile',
    '--context=git://github.com/nikola-jokic/dockeraction.git',
    '--destination=docker-registry.default.svc.cluster.local:5000/test/app:1.0'
  ]
  spec.containers = [c]
  spec.dnsPolicy = 'ClusterFirst'
  spec.restartPolicy = 'Never'
  pod.spec = spec

  return pod
}
