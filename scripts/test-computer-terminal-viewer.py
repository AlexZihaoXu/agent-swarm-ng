"""Disposable fixed-size real PTY/keyboard/reattach proof, invoked by the core fixture."""
import base64, json, os, selectors, subprocess, sys, time
name=sys.argv[1]
assert name.startswith('swarm-core-test-')
assert subprocess.check_output(['docker','inspect','--format','{{index .Config.Labels "swarm.ng.test"}}',name]).decode().strip()=='core-tools'
base=['docker','exec','--user','root',name,'python3','-I','/opt/swarm/computer-core.py']
def call(mode,value):return json.loads(subprocess.check_output(base+[mode,json.dumps(value)]))
def run(operation,**value):
 t=call('prepare',{})['validationToken'];result=call('execute',{'kind':'terminal','operation':operation,**value,'validationToken':t});assert result.get('result'),result;return result['result']
fixture="""import os,tty,fcntl,termios,struct
f=open('/workspace/viewer-input','ab',buffering=0)
tty.setraw(0)
size=struct.unpack('HHHH',fcntl.ioctl(0,termios.TIOCGWINSZ,b'\\0'*8))
assert size[:2]==(36,120),size
os.write(1,b'\\x1b[?1049h\\x1b[2J\\x1b[2;3H\\x1b[31mVIEWER_READY\\x1b[0m')
while True:
 b=os.read(0,4096)
 if not b:break
 f.write(b)
 os.write(1,b'\\x1b[3;3HKEY_RECEIVED')
"""
subprocess.run(['docker','exec','-i','--user','agent',name,'python3','-c','import sys;open("/workspace/viewer-fixture.py","w").write(sys.stdin.read())'],input=fixture.encode(),check=True)
session=run('create',name='viewer-proof',command='python3 -u /workspace/viewer-fixture.py')['session']['id']
class Viewer:
 def __init__(self):
  self.p=subprocess.Popen(['docker','exec','-i','--user','agent',name,'python3','-I','/opt/swarm/computer-terminal-viewer.py',session],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  self.selector=selectors.DefaultSelector();self.selector.register(self.p.stdout,selectors.EVENT_READ);self.raw=b'';self.output=b'';self.ready=False
 def send(self,value):self.p.stdin.write(json.dumps(value).encode()+b'\n');self.p.stdin.flush()
 def wait(self,predicate):
  end=time.monotonic()+10
  while time.monotonic()<end:
   if predicate():return
   for key,_ in self.selector.select(.2):
    chunk=os.read(key.fd,65536)
    assert chunk,('viewer EOF',self.p.poll(),self.p.stderr.read())
    self.raw+=chunk
    while b'\n' in self.raw:
     line,self.raw=self.raw.split(b'\n',1);event=json.loads(line)
     if event['type']=='ready':assert(event['columns'],event['rows'])==(120,36);self.ready=True
     elif event['type']=='output':self.output+=base64.b64decode(event['data'])
     else:raise AssertionError(event)
  raise AssertionError(('viewer timeout',self.output[-1000:]))
 def close(self):
  if not self.p.stdin.closed:self.p.stdin.close()
  self.p.wait(timeout=8);self.selector.close();self.p.stdout.close();self.p.stderr.close()
a=Viewer();b=None
try:
 a.wait(lambda:a.ready and b'VIEWER_READY' in a.output)
 assert b'\x1b[' in a.output
 payload=b'\x02\t\x1b[A\x03'+ '世界'.encode()
 a.send({'type':'input','data':base64.b64encode(payload).decode()})
 a.wait(lambda:b'KEY_RECEIVED' in a.output)
 received=subprocess.check_output(['docker','exec',name,'python3','-c','import sys;sys.stdout.buffer.write(open("/workspace/viewer-input","rb").read())'])
 assert payload in received,received
 b=Viewer();b.wait(lambda:b.ready and b'VIEWER_READY' in b.output)
 status=run('status',session=session)['session'];assert(status['columns'],status['rows'])==(120,36)
 # Resizing is not part of the bridge protocol, even if a malicious client asks for it.
 b.send({'type':'resize','columns':80,'rows':24});b.p.wait(timeout=8);b.close();b=None
 a.close()
 assert run('status',session=session)['session']['alive']
 a=Viewer();a.wait(lambda:a.ready and b'VIEWER_READY' in a.output)
 assert run('status',session=session)['session']['columns']==120
finally:
 a.close()
 if b:b.close()
 run('delete',session=session)
print('PASS real120x36 PTY, ANSI full-screen output, Ctrl+B/Tab/arrows/Ctrl+C/Unicode, concurrent viewers, rejected resize and detach/reattach without killing program')
