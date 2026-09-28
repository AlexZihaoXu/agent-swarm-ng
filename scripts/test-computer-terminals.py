"""Real tmux proof inside the labelled disposable core-tools fixture, never a live computer."""
import json, subprocess, sys, time
name = sys.argv[1]
assert name.startswith('swarm-core-test-')
assert subprocess.check_output(['docker','inspect','--format','{{ index .Config.Labels "swarm.ng.test" }}',name]).decode().strip() == 'core-tools'
base = ['docker','exec','--user','root',name,'python3','-I','/opt/swarm/computer-core.py']
def call(mode, value): return json.loads(subprocess.check_output(base + [mode,json.dumps(value)]))
def run(operation, **value):
    token = call('prepare', {})['validationToken']
    result = call('execute', {'kind':'terminal','operation':operation,**value,'validationToken':token})
    assert result.get('settled') is True and 'error' not in result, result
    return result['result']
def until(operation, predicate, **value):
    for _ in range(50):
        result = run(operation, **value)
        if predicate(result): return result
        time.sleep(.05)
    raise AssertionError({'last': result, 'view': run('view', session=value['session']) if 'session' in value else None})
subprocess.run(['docker','exec','--user','agent',name,'tmux','-L','unrelated-proof','new-session','-d','-s','human','/bin/bash'],check=True)
assert run('list')['sessions'] == []
# New-server fast exits used to expose a tmux3.4 lost-SIGCHLD/zombie race. Keep this regression real.
for i in range(5):
    fast = run('create', name='fast-exit', command='exit 7')['session']['id']
    until('status', lambda r:r['session']['exitCode'] == 7, session=fast)
    run('delete', session=fast)
subprocess.run(['docker','exec','--user','agent',name,'mkdir','-p','/workspace/#{host}'],check=True)
literal = run('create', name='literal-cwd', command='pwd', cwd='/workspace/#{host}')['session']['id']
until('view', lambda r:'/workspace/#{host}' in r['text'], session=literal)
run('delete', session=literal)
one = run('create', name='oneshot', command="id -u; printf 'hello 世界\\n'; exit 7", cwd='/workspace')['session']['id']
status = until('status', lambda r:not r['session']['alive'] and r['session']['exitCode'] is not None, session=one)['session']
assert status['exitCode'] == 7, status
text = run('view',session=one)['text']; assert '1000' in text and 'hello 世界' in text, text
shell = run('create',name='interactive')['session']['id']
until('view',lambda r:'$' in r['text'],session=shell)
run('type',session=shell,text="printf 'literal ; kill-server 世界\\n'")
run('press',session=shell,key='Enter')
until('view',lambda r:'literal ; kill-server 世界' in r['text'],session=shell)
run('type',session=shell,text='cd /home/agent')
run('press',session=shell,key='Enter')
until('status',lambda r:r['session']['cwd']=='/home/agent',session=shell)
run('type',session=shell,text='sleep 30')
run('press',session=shell,key='Enter')
until('status',lambda r:r['session']['currentCommand']=='sleep',session=shell)
# Cancellation/claim release fences further API delivery, not the authorized persistent program.
old = call('prepare',{})['validationToken']; assert call('cancel',{})['settled']
stale = call('execute',{'kind':'terminal','operation':'delete','session':shell,'validationToken':old})
assert not stale['started']
assert run('status',session=shell)['session']['alive']
run('interrupt',session=shell)
until('status',lambda r:r['session']['currentCommand']=='bash',session=shell)
# Output cap remains explicit; completed panes survive the worker and subsequent requests.
large = run('create',name='large',command="python3 -c 'print(\"x\"*1000000)' ")['session']['id']
until('status',lambda r:not r['session']['alive'],session=large)
view=run('view',session=large);assert view['truncated'] and len(view['text'].encode())<=50000
for session in (one,shell,large): assert run('delete',session=session)['deleted']
assert run('list')['sessions']==[]
subprocess.run(['docker','exec','--user','agent',name,'tmux','-L','unrelated-proof','has-session','-t','human'],check=True)
print('PASS real tmux uid1000, completed-command exit/output, Unicode/literal input, persistent cwd/programs, stale fencing, Ctrl+C, bounded capture and deletion')
