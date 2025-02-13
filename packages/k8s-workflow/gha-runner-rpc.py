#!/usr/bin/env python3

# Copyright (c) 2024 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# This implements a very simple RPC server that should be running on the job container of the workflow pod,
# and used by the k8s hook to execute steps in the workflow on the workflow pod.

# It supports a running a single RPC call at a time, and will return an error if a new call is made while
# another one is still running (which is a valid assumption, as the runner is expected to execute one step at a time).


from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import time
from flask import Flask, jsonify, request
from threading import Thread
from waitress import serve

import argparse
import json
import logging
import os
import signal
import subprocess

import logging
import json_logging

app = Flask(__name__)
app.logger.setLevel(logging.DEBUG)
json_logging.init_flask(enable_json=True)
json_logging.init_request_instrument(app)

@dataclass
class Response:
    id: str
    status: str
    pid: int = None
    returncode: int = None
    error: str = None

def readLines(path, fromLine, maxLines):
    try:
        with open(path, 'r') as f:
            return [x for i, x in enumerate(f) if i >= fromLine and x.endswith('\n') and i < fromLine + maxLines]
    except Exception as e:
        app.logger.warning(f"Error reading file {path}: {e}")
        return []

class State:
    def __init__(self):
        self.latest_id = None
        self.status = Response(id = "", status = "idle")
        self.worker = ThreadPoolExecutor(max_workers=1)
        self.future = None
        self.process = None
        self.out = None

    def __run(self, id, path):
        self.latest_id = id
        try:
            app.logger.debug(f"Running id {id}")
            logsfilename = f"/logs/{id}.out"
            self.out = open(logsfilename, "w")
            self.process = subprocess.Popen(['sh', '-e', path], start_new_session=True, stdout=self.out, stderr=self.out)
            app.logger.debug(f"Process for id {id} started with pid {self.process.pid}")
            self.status = Response(
                id = id,
                status = 'running',
                pid = self.process.pid
            )
            self.process.wait()
            self.out.close()
            app.logger.debug(f"Process for id {id} finished (return code {self.process.returncode})")
            self.status = Response(
                id = id,
                status = 'completed',
                returncode = self.process.returncode,
            )
        except Exception as e:
            app.logger.error(f"Error starting process: {e}")
            self.status = Response(
                id = id,
                status = 'failed',
                error = str(e),
                returncode = -1,
            )


    def exec(self, id, path):
        if self.future and not self.future.done():
            app.logger.error(f"A job is already running (ID {self.latest_id})")
            return Response(
                id = id,
                status = 'failed',
                error = f"A job is already running (ID {self.latest_id})",
                returncode = -1,
            )

        app.logger.debug(f"Queueing job {id} with path {path}")
        self.status = Response(id = id, status = "pending")
        self.future = self.worker.submit(self.__run, id, path)
        return self.status

    def cancel(self):
        if not self.future:
            return Response(
                id = '',
                status = 'failed',
                error = 'No job has been started yet',
            )
        elif self.future.done():
            # The job is already done, no need to cancel
            return self.status
        else:
            app.logger.debug(f"Cancelling {self.latest_id} (pid {self.process.pid})")
            os.killpg(os.getpgid(self.process.pid), signal.SIGINT)

            return Response(
                id = self.latest_id,
                status = 'cancelling',
                pid = self.process.pid
            )

state = State()

# Post a new job
@app.route('/', methods=['POST'])
def call():
    data = json.loads(request.data)
    if 'id' not in data or 'path' not in data:
        return jsonify(Response(
            id = '',
            status = 'failed',
            error = 'Missing id or path in request',
        ))
    id = data['id']
    path = data['path']
    return jsonify(state.exec(id, path))

# Cancel the current job
@app.route('/', methods=['DELETE'])
def cancel():
    return jsonify(state.cancel())

# Get the current status
@app.route('/')
def status():
    app.logger.debug(f"Status: {state.status}")
    return jsonify(state.status)

# Get the logs of a given job
@app.route('/logs')
def logs():
    if 'id' not in request.args:
        return 'Missing id in request', 400
    id = request.args.get('id')
    fromLine = int(request.args.get('fromLine', 0))
    maxLines = int(request.args.get('maxLines', 1000))
    path = f"/logs/{id}.out"
    return jsonify(readLines(path, fromLine, maxLines))


if __name__ == '__main__':

    parser = argparse.ArgumentParser()
    parser.add_argument('--dev', action='store_true', help='Run in Flask development mode')
    args = parser.parse_args()
    if args.dev:
        app.run(host='0.0.0.0', port=8080, debug=True)
    else:
        serve(app, host='0.0.0.0', port=8080, threads=1)

