import * as grpc from '@grpc/grpc-js'
import * as tmp from 'tmp'
import { chmodSync, fchmodSync, readFileSync, writeFileSync } from 'fs'
import { exec } from 'child_process'
import { script_executor } from './script_executor'

const keepaliveOptions = {
  // If a client is idle for 30 seconds, send a GOAWAY
  'grpc.max_connection_idle_ms': 30_000,
  // If any connection is alive for more than 1 day, send a GOAWAY
  'grpc.max_connection_age_ms': 86400_000,
  // Allow 10 seconds for pending RPCs to complete before forcibly closing connections
  'grpc.max_connection_age_grace_ms': 10_000,
  // Ping the client every 10 seconds to ensure the connection is still active
  'grpc.keepalive_time_ms': 10_000,
  // Wait 5 seconds for the ping ack before assuming the connection is dead
  'grpc.keepalive_timeout_ms': 5_000
}

const ROOT_CERT_PATH =
  process.env['SCRIPT_EXECUTOR_ROOT_CERT_PATH'] || '/certs/ca.crt'
const SERVER_CERT_PATH =
  process.env['SCRIPT_EXECUTOR_SERVER_CERT_PATH'] || '/certs/server.crt'
const SERVER_KEY_PATH =
  process.env['SCRIPT_EXECUTOR_SERVER_KEY_PATH'] || '/certs/server.key'
const SERVER_PORT = process.env['SCRIPT_EXECUTOR_SERVER_PORT'] || '50051'

class ScriptExecutorService extends script_executor.UnimplementedScriptExecutorService {
  ExecuteScript(
    call: grpc.ServerWritableStream<
      script_executor.ScriptRequest,
      script_executor.ScriptResponse
    >
  ): void {
    const tmpFile = tmp.fileSync()
    try {
      writeFileSync(tmpFile.name, call.request.script)
      chmodSync(tmpFile.name, '755')
    } catch (error) {
      console.log(`error writing script content to file ${error}`)
      call.end()
    }

    const process = exec(`sh -e ${tmpFile.name}`)

    process.stdout?.on('data', data => {
      console.log(`stdout: ${data}`)
      call.write(
        new script_executor.ScriptResponse({ output: data.toString() })
      )
    })

    process.stderr?.on('data', data => {
      console.log(`stderr: ${data}`)
      call.write(new script_executor.ScriptResponse({ error: data.toString() }))
    })

    process.on('close', code => {
      console.log(`child process exited with code ${code}`)
      call.write(new script_executor.ScriptResponse({ code: code as number }))
      call.end()
    })
  }
}

function main(): void {
  const server = new grpc.Server(keepaliveOptions)
  server.addService(
    script_executor.UnimplementedScriptExecutorService.definition,
    new ScriptExecutorService()
  )

  const serverCredential = grpc.ServerCredentials.createSsl(
    readFileSync(ROOT_CERT_PATH),
    [
      {
        cert_chain: readFileSync(SERVER_CERT_PATH),
        private_key: readFileSync(SERVER_KEY_PATH)
      }
    ],
    true // Checking Client Certificate to enable mTLS.
  )

  server.bindAsync(`0.0.0.0:${SERVER_PORT}`, serverCredential, error => {
    console.error(`Error when binding server ${error}`)
    server.start()
    console.log(`Server running on port ${SERVER_PORT}`)
  })
}

main()
