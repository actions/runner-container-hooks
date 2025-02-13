import * as core from '@actions/core'
import { log } from 'console'

interface RpcResult {
  id: string,
  status: string,
  pid?: number,
  returncode?: number,
  error?: string

}

async function startRpc(url: string, id: string, containerPath: string): Promise<RpcResult> {

  new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      core.warning('Received SIGINT, terminating');
      const request = new Request(`${url}/`, { method: 'DELETE' })
      fetch(request).then(() => resolve());
    })
    process.on('SIGTERM', () => {
      core.warning('Received SIGTERM, terminating');
      const request = new Request(`${url}/`, { method: 'DELETE' })
      fetch(request).then(() => resolve());
    })
  });

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
  core.debug(`Starting rpc with id ${id} and containerPath ${containerPath} at url ${url}`)
  const request = new Request(
    url,
    {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ "id": id, "path": containerPath })
    })
  const response = await fetch(request)
  return response.json();
}

async function getRpcStatus(url: string): Promise<RpcResult> {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
  const request = new Request(url, { method: 'GET', headers: headers })
  const response = await fetch(request)
  return response.json()
}

async function getLogs(url: string, id: string, fromLine: number): Promise<string[]> {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
  const params = new URLSearchParams({
    id: id,
    fromLine: fromLine.toString()
  })
  const request = new Request(`${url}?${params.toString()}`, { method: 'GET', headers: headers })
  const response = await fetch(request)
  return response.json()
}

async function getLogsAndStatus(url: string, id: string, beginLogsAfterLine: number): Promise<{ status: RpcResult, logLines: number }> {

  // TODO: get all logs here
  const logs = await getLogs(`${url}/logs`, id, beginLogsAfterLine)
  logs.forEach(line => process.stdout.write(line))

  const status = await getRpcStatus(url)

  return {
    status: status,
    logLines: logs.length,
  }
}

async function flushLogs(url: string, id: string, beginLogsAfterLine: number): Promise<void> {
  while (true) {
    const logs = await getLogs(`${url}/logs`, id, beginLogsAfterLine)
    logs.forEach(line => process.stdout.write(line))

    beginLogsAfterLine += logs.length

    if (logs.length === 0) {
      return
    }
  }
}

async function awaitRpcCompletion(url: string, id: string): Promise<RpcResult> {

  let { status, logLines } = await getLogsAndStatus(url, id, 0)

  while (status.status !== 'completed' && status.status !== 'failed') {
    await new Promise(resolve => setTimeout(resolve, 1000))
    const logAndStatus = await getLogsAndStatus(url, id, logLines)
    logLines += logAndStatus.logLines
    status = logAndStatus.status
  }
  if (status.status === 'failed') {
    await flushLogs(url, id, logLines)
    throw new Error(`rpc failed: ${status.error}`)
  } else if (status.status !== 'completed') {
    throw new Error(`rpc failed: unexpected status ${status.status}`)
  } else if (status.returncode !== 0) {
    await flushLogs(url, id, logLines)
    throw new Error(`step failed with return code ${status.returncode}`)
  }
  await flushLogs(url, id, logLines)
  return status
}

export async function rpcPodStep(
  id: string,
  containerPath: string,
  serviceName: string
): Promise<void> {
  const url = `http://${serviceName}:8080`
  await startRpc(url, id, containerPath)
  await awaitRpcCompletion(url, id)
}

export async function waitForRpcStatus(url: string): Promise<void> {
  while (true) {
    try {
      await getRpcStatus(url)
      return
    } catch (err) {
      core.debug(`failed getting RPC status, not yet ready: ${JSON.stringify(err)}`)
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}
