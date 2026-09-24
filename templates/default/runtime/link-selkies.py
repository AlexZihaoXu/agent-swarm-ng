#!/usr/bin/python3
"""Link only this GNOME session's consented portal capture to Selkies.

Headless GNOME has no session manager to link its PipeWire video output ports.
The other GNOME output is the long-lived, private preview session; never link it
into a browser stream. PipeWire object IDs change across desktop restarts.
"""
import json
import os
from pathlib import Path
import subprocess
import time

runtime = Path(os.environ['XDG_RUNTIME_DIR'])


def port_pair(objects, preview_node):
    nodes = {
        obj['id']: obj.get('info', {}).get('props', {})
        for obj in objects if obj.get('type') == 'PipeWire:Interface:Node'
    }
    outputs = []
    inputs = []
    for obj in objects:
        if obj.get('type') != 'PipeWire:Interface:Port':
            continue
        props = obj.get('info', {}).get('props', {})
        try:
            node_id = int(props['node.id'])
        except (KeyError, TypeError, ValueError):
            continue
        node = nodes.get(node_id, {})
        if node.get('node.name') == 'gnome-shell' and props.get('port.name') == 'output_1':
            outputs.append((obj['id'], node_id))
        if (node.get('node.name') == 'python3.12' and
                node.get('media.class') == 'Stream/Input/Video' and
                props.get('port.name') == 'input_1'):
            inputs.append(obj['id'])
    # Both the preview and the portal must exist. Refuse ambiguous extra
    # captures or inputs rather than exposing the wrong session to a viewer.
    if len(outputs) != 2 or len(inputs) != 1 or sum(node == preview_node for _, node in outputs) != 1:
        return None
    return next(port for port, node in outputs if node != preview_node), inputs[0]


def run():
    linked = None
    while True:
        try:
            preview_node = int((runtime / 'screencast-node').read_text().strip())
            objects = json.loads(subprocess.check_output(['pw-dump'], timeout=5))
            pair = port_pair(objects, preview_node)
            if pair and pair != linked:
                subprocess.run(['pw-link', '-L', str(pair[0]), str(pair[1])],
                               check=True, timeout=5, capture_output=True)
                print('Computer live PipeWire portal connected', flush=True)
                linked = pair
            elif pair is None:
                linked = None
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            # A missing portal session (before consent or after disconnect) is
            # expected. Do not log arbitrary D-Bus/PipeWire content or tokens.
            if linked is not None:
                print('Computer live PipeWire link unavailable:', type(error).__name__, flush=True)
            linked = None
        time.sleep(1)


if __name__ == '__main__':
    run()
