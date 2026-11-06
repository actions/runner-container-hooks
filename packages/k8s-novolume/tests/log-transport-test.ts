import * as http from 'http'
import * as k8s from '@kubernetes/client-node'

describe('pod logs over HTTP', () => {
  const namespace = process.env.ACTIONS_RUNNER_KUBERNETES_NAMESPACE
  let server: http.Server
  let getPodLogs: typeof import('../src/k8s').getPodLogs
  let disconnect = false
  let requests: number
  let disconnectTimer: NodeJS.Timeout | undefined

  beforeAll(async () => {
    server = http.createServer((_request, response) => {
      requests++
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.write('streaming logs\n')
      if (disconnect) {
        disconnectTimer = setTimeout(() => response.destroy(), 25)
      } else {
        response.end('complete\n')
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP server address')
    }

    const loadConfig = jest
      .spyOn(k8s.KubeConfig.prototype, 'loadFromDefault')
      .mockImplementation(function (this: k8s.KubeConfig) {
        this.loadFromOptions({
          clusters: [
            {
              name: 'test',
              server: `http://127.0.0.1:${address.port}`,
              skipTLSVerify: true
            }
          ],
          users: [{ name: 'test' }],
          contexts: [{ name: 'test', cluster: 'test', user: 'test' }],
          currentContext: 'test'
        })
      })
    try {
      getPodLogs = (await import('../src/k8s')).getPodLogs
    } finally {
      loadConfig.mockRestore()
    }
    process.env.ACTIONS_RUNNER_KUBERNETES_NAMESPACE = 'test'
  })

  beforeEach(() => {
    requests = 0
    disconnect = false
  })

  afterAll(async () => {
    clearTimeout(disconnectTimer)
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    )
    if (namespace === undefined) {
      delete process.env.ACTIONS_RUNNER_KUBERNETES_NAMESPACE
    } else {
      process.env.ACTIONS_RUNNER_KUBERNETES_NAMESPACE = namespace
    }
  })

  it('completes when the real client receives the end of the response', async () => {
    await getPodLogs('pod', 'container')
    expect(requests).toBe(1)
  })

  it('rejects when the HTTP socket closes during a log response', async () => {
    disconnect = true
    let deadline: NodeJS.Timeout | undefined
    try {
      const result = await Promise.race([
        getPodLogs('pod', 'container').then(
          () => 'completed',
          (error: Error) => error
        ),
        new Promise<string>(resolve => {
          deadline = setTimeout(() => resolve('pending'), 2000)
        })
      ])
      expect(requests).toBe(1)
      expect(result).toBeInstanceOf(Error)
    } finally {
      clearTimeout(deadline)
    }
  })
})
