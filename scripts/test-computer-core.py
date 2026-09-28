"""Opt-in disposable guest checks. Invoked only by test-computer-core.sh."""
import json, subprocess, sys, time
CONTAINER = sys.argv[1]
assert CONTAINER.startswith('swarm-core-test-')
assert subprocess.check_output(['docker','inspect','--format','{{ index .Config.Labels "swarm.ng.test" }}',CONTAINER]).decode().strip() == 'core-tools'
BASE=['docker','exec','--user','root',CONTAINER,'python3','-I','/opt/swarm/computer-core.py']
def call(mode, value): return json.loads(subprocess.check_output(BASE+[mode,json.dumps(value)]))
def token(): return call('prepare',{})['validationToken']
def run(value, t=None): return call('execute',{**value,'validationToken':t or token()})
def exists(path):return subprocess.run(['docker','exec',CONTAINER,'test','-e','/workspace/'+path]).returncode==0
# All side effects are inside this dedicated disposable guest, never the owner desktop.
for kind in ['write','read','edit']:
 value={'kind':kind,'path':'core-proof.txt',**({'content':'hello\nworld\n'} if kind=='write' else {'edits':[{'oldText':'world','newText':'WORLD'}]} if kind=='edit' else {})}
 assert run(value).get('result'), value
result=run({'kind':'bash','command':'python3 -c "import sys;sys.stdout.write(\'x\'*100000);sys.stderr.write(\'y\'*100000)"'})['result']
assert len(result['stdout'])==25000 and len(result['stderr'])==25000 and all(result['truncated'].values())
result=run({'kind':'bash','command':'sleep 2; touch /workspace/timeout-leak','timeout':.2})
assert result['settled'] and 'timed out' in result['error'] and not exists('timeout-leak')
old=token();assert call('cancel',{})['settled']
assert run({'kind':'write','path':'stale-leak','content':'bad'},old)['started'] is False
assert not exists('stale-leak')
# Detachment cannot survive the worker PID namespace.
command="python3 -c 'import os,time; p=os.fork(); os._exit(0) if p else None; os.setsid(); p=os.fork(); os._exit(0) if p else None; time.sleep(1); open(\"/workspace/detached-leak\",\"w\").write(\"bad\")'"
assert run({'kind':'bash','command':command})['settled']
time.sleep(1.2);assert not exists('detached-leak')
# Explicit cancellation joins the executing command; its prepared token cannot be replayed.
t=token();p=subprocess.Popen(BASE+['execute',json.dumps({'kind':'bash','command':'touch /workspace/entered; sleep 10; touch /workspace/cancel-leak','validationToken':t})],stdout=subprocess.PIPE)
for _ in range(100):
 if exists('entered'):break
 time.sleep(.02)
else:raise AssertionError('Command never entered')
assert call('cancel',{})['settled'];result=json.loads(p.communicate(timeout=10)[0]);assert result['settled'] and 'cancelled' in result['error']
assert not exists('cancel-leak')
# Small image reads preserve real model-image bytes, not a text/base64 substitute.
png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII='
subprocess.run(['docker','exec','--user','agent',CONTAINER,'python3','-c',f'import base64;open("/workspace/pixel.png","wb").write(base64.b64decode("{png}"))'],check=True)
result=run({'kind':'read','path':'pixel.png'})['result'];assert result['type']=='image' and result['width']==1 and result['height']==1
# Killing the supervisor must not allow a misleading successful release. Cleanup is the fixture's disposal.
t=token();p=subprocess.Popen(BASE+['execute',json.dumps({'kind':'bash','command':'touch /workspace/crash-entered; sleep 30','validationToken':t})],stdout=subprocess.PIPE)
for _ in range(100):
    state=subprocess.run(['docker','exec','--user','root',CONTAINER,'python3','-c','from pathlib import Path;print(Path("/run/swarm-core-tools/active").read_text())'],capture_output=True)
    if state.returncode==0 and exists('crash-entered'): break
    time.sleep(.02)
else: raise AssertionError('No active supervisor marker')
pid=json.loads(state.stdout)['pid']
subprocess.run(['docker','exec','--user','root',CONTAINER,'kill','-KILL',str(pid)],check=True)
p.communicate(timeout=10)
assert call('cancel',{}).get('settled') is False
assert 'validationToken' not in call('prepare',{})
print('PASS guest read/edit/write, bounded stdout/stderr, timeout, stale fencing, double-fork cleanup, cancellation, PNG image and fail-closed supervisor loss')
