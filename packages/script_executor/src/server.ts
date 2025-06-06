import * as grpc from '@grpc/grpc-js'
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

class ScriptExecutorService extends script_executor.UnimplementedScriptExecutorService {
  ExecuteScript(
    call: grpc.ServerWritableStream<
      script_executor.ScriptRequest,
      script_executor.ScriptResponse
    >
  ): void {
    const process = exec(call.request.script)

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

  // TODO(quoct): Create and pass in a cert here to improve security.
  // As of now, only other job in the cluster can access it but we need to improve it.
  server.bindAsync(
    '0.0.0.0:50051',
    grpc.ServerCredentials.createInsecure(), // TODO(quoct): Change to create SSL.
    () => {
      server.start()
      console.log('Server running on port 50051')
    }
  )
}

main()
