"""Swarm assist MCP server (stdio): the notify_supervisor tool, so Claude Code can message the swarm agent that
supervises its terminal (a question, a blocker, progress, done) without ending its turn.

The message goes to that agent's listener through the events file. With no listener for this terminal it is dropped
and Claude Code is told so. A small rate limit keeps it from flooding the agent.
"""
import json
import sys
import time

from swarm_claude import append, listening, terminal

MESSAGE_MAX = 1000
MIN_GAP_S = 10
PER_HOUR = 30
TOOL = {
    'name': 'notify_supervisor',
    'description': (
        'Send a short message to the swarm agent supervising this terminal (the agent that asked you for this work): '
        'a question you need answered, a blocker, a decision to make, or that you are done. It reaches the agent at '
        "once; the agent may reply by typing into this session. Keep it to what the agent needs; don't repeat what "
        'your final answer will say anyway.'
    ),
    'inputSchema': {
        'type': 'object',
        'properties': {'message': {'type': 'string', 'minLength': 1, 'maxLength': MESSAGE_MAX}},
        'required': ['message'],
        'additionalProperties': False,
    },
}
sent: list[float] = []


def text(result: str, error=False):
    return {'content': [{'type': 'text', 'text': result}], 'isError': error}


def notify(arguments: dict):
    message = str(arguments.get('message') or '').strip()
    if not message:
        return text('Write a message.', True)
    where = terminal()
    if not where:
        return text('This session is not running in a swarm terminal, so there is no supervising agent to notify.', True)
    if not listening(where['id'], 'message'):
        return text('No swarm agent is listening to this terminal right now, so the message was not delivered. '
                    'Carry on with the task, and try again later if it still matters.', True)
    now = time.time()
    sent[:] = [at for at in sent if now - at < 3600]
    if sent and now - sent[-1] < MIN_GAP_S:
        return text(f'Wait {int(MIN_GAP_S - (now - sent[-1])) + 1} s before sending another message.', True)
    if len(sent) >= PER_HOUR:
        return text(f'At most {PER_HOUR} messages an hour; carry on and report in your final answer.', True)
    append('message', message[:MESSAGE_MAX], where=where)
    sent.append(now)
    return text('Delivered to the supervising agent.')


def handle(request: dict):
    method = request.get('method')
    if method == 'initialize':
        version = (request.get('params') or {}).get('protocolVersion', '2025-06-18')
        return {'protocolVersion': version, 'capabilities': {'tools': {}},
                'serverInfo': {'name': 'swarm-assist', 'version': '1.0.0'}}
    if method == 'tools/list':
        return {'tools': [TOOL]}
    if method == 'tools/call':
        params = request.get('params') or {}
        if params.get('name') != TOOL['name']:
            raise LookupError(f"Unknown tool {params.get('name')}")
        return notify(params.get('arguments') or {})
    if method == 'ping':
        return {}
    raise LookupError(f'Unknown method {method}')


def main():
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            request = json.loads(raw)
        except ValueError:
            continue
        if 'id' not in request:
            continue  # notifications (initialized, cancelled) need no answer
        try:
            reply = {'jsonrpc': '2.0', 'id': request['id'], 'result': handle(request)}
        except LookupError as error:
            reply = {'jsonrpc': '2.0', 'id': request['id'], 'error': {'code': -32601, 'message': str(error)}}
        except Exception as error:  # never crash the session's tool
            reply = {'jsonrpc': '2.0', 'id': request['id'], 'error': {'code': -32603, 'message': str(error)}}
        sys.stdout.write(json.dumps(reply) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
