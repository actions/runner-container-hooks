import * as core from '@actions/core'

interface RpcResult {
  id: string,
  status: string,
  pid?: number,
  returncode?: number,
  error?: string

}

async function startRpc(url: string, id: string, containerPath: string): Promise<RpcResult> {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
  core.warning(`Starting rpc with id ${id} and containerPath ${containerPath} at url ${url}`)
  const request = new Request(
    url,
    {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ "id": id, "path": containerPath })
    })
  return fetch(request).then(
    response => response.json(),
    async error => {
      core.warning(`rpc failed: ${error}`)
      return {
        status: 'failed',
        error: error
      }
    }
  )
}

async function getRpcStatus(url: string): Promise<RpcResult> {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
  const request = new Request(url, { method: 'GET', headers: headers })
  return fetch(request).then(response => response.json())
}

async function getLogs(url: string, id: string, beginAfterLine: number): Promise<string[]> {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
  const params = new URLSearchParams({
    id: id,
    beginAfterLine: beginAfterLine.toString()
  })
  const request = new Request(`${url}?${params.toString()}`, { method: 'GET', headers: headers })
  return fetch(request).then(response => response.json())
}

async function getLogsAndStatus(url: string, id: string, beginStdoutAfterLine: number, beginStderrAfterLine: number): Promise<{ status: RpcResult, stdoutLines: number, stderrLines: number }> {

  const stdout = await getLogs(`${url}/stdout`, id, beginStdoutAfterLine)
  stdout.forEach(line => process.stdout.write(line))

  const stderr = await getLogs(`${url}/stderr`, id, beginStderrAfterLine)
  stderr.forEach(line => process.stderr.write(line))

  const status = await getRpcStatus(url)

  return {
    status: status,
    stdoutLines: stdout.length,
    stderrLines: stderr.length
  }
}

async function flushLogs(url: string, id: string, beginStdoutAfterLine: number, beginStderrAfterLine: number): Promise<void> {
  while (true) {
    const stdout = await getLogs(`${url}/stdout`, id, beginStdoutAfterLine)
    stdout.forEach(line => process.stdout.write(line))

    const stderr = await getLogs(`${url}/stderr`, id, beginStderrAfterLine)
    stderr.forEach(line => process.stderr.write(line))

    if (stdout.length === 0 && stderr.length === 0) {
      return
    }
  }
}

async function awaitRpcCompletion(url: string, id: string): Promise<RpcResult> {

  let { status, stdoutLines, stderrLines } = await getLogsAndStatus(url, id, 0, 0)

  while (status.status !== 'completed' && status.status !== 'failed') {
    core.warning(`Waiting for completion (id = ${status.id})...`)
    await new Promise(resolve => setTimeout(resolve, 1000))
    const { status: newStatus, stdoutLines: newStdoutLines, stderrLines: newStderrLines } = await getLogsAndStatus(url, id, stdoutLines, stderrLines)
    stdoutLines += newStdoutLines
    stderrLines += newStderrLines
    status = newStatus
  }
  if (status.status === 'failed') {
    flushLogs(url, id, stdoutLines, stderrLines)
    throw new Error(`rpc failed: ${status.error}`)
  } else if (status.status !== 'completed') {
    throw new Error(`rpc failed: unexpected status ${status.status}`)
  } else if (status.returncode !== 0) {
    flushLogs(url, id, stdoutLines, stderrLines)
    throw new Error(`rpc failed: return code ${status.returncode}`)
  }
  return status
}

export async function rpcPodStep(
  id: string,
  containerPath: string,
  serviceName: string
): Promise<void> {
  const url = `http://${serviceName}:8080`
  await startRpc(url, id, containerPath).then(() =>
    awaitRpcCompletion(url, id).then(status =>
      core.warning(`completed with return code ${status.returncode}`)))
}

