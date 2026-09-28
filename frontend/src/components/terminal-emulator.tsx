import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@/components/ui/button';
const COLS=120,ROWS=36;
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));

/** Fixed geometry. No fit/resize, links, clipboard, image or attach addons. */
export function TerminalEmulator({computerId,sessionId,interactive}:{computerId:string;sessionId:string;interactive:boolean}) {
  const host=useRef<HTMLDivElement>(null),terminal=useRef<Terminal|null>(null),connected=useRef(false);
  const [attempt,setAttempt]=useState(0),[visible,setVisible]=useState(()=>!document.hidden);
  const [status,setStatus]=useState('Connecting…');
  const inputAllowed=useRef(interactive);inputAllowed.current=interactive;
  useEffect(()=>{const change=()=>setVisible(!document.hidden);document.addEventListener('visibilitychange',change);return()=>document.removeEventListener('visibilitychange',change);},[]);
  useEffect(()=>{if(terminal.current)terminal.current.options.disableStdin=!(interactive&&connected.current);},[interactive]);
  useEffect(()=>{
    if(!host.current||!visible){setStatus('Paused while hidden.');return;}
    const term=new Terminal({cols:COLS,rows:ROWS,fontSize:13,lineHeight:1.15,fontFamily:'Consolas, "Liberation Mono", monospace',cursorBlink:true,scrollback:2000,disableStdin:true,screenReaderMode:true,windowOptions:{},linkHandler:{activate:()=>{}},theme:{background:'#141414',foreground:'#ededed',cursor:'#ededed'}});
    terminal.current=term;term.open(host.current);
    // Remote OSC52 must never read/write the browser clipboard, and no terminal title drives UI.
    const clipboard=term.parser.registerOscHandler(52,()=>true);
    term.attachCustomKeyEventHandler(event=>{event.stopPropagation();return true;});
    // Mouse is local focus/scroll only. Even a guest enabling mouse reporting or alternate-scroll
    // cannot turn clicks/wheel/touches into guest input. onBinary (legacy mouse) is never attached.
    const stopMouse=(event:Event)=>{if(event.type==='mousedown'&&(event as MouseEvent).button===0)term.focus();event.stopPropagation();};
    const mouseEvents=['mousedown','mouseup','mousemove','wheel','pointerdown','pointerup','pointermove','touchstart','touchmove','touchend'];
    const element=host.current;
    for(const name of mouseEvents)element.addEventListener(name,stopMouse,{capture:true});
    const url=new URL(`/api/computers/${encodeURIComponent(computerId)}/terminals/${encodeURIComponent(sessionId)}/stream`,location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const socket=new WebSocket(url);
    let ready=false,disposed=false,pending=0,queue:Uint8Array[]=[],renderBytes=0;
    let flushTimer:ReturnType<typeof setTimeout>|undefined;
    const timeout=setTimeout(()=>socket.close(),12000);
    const end=()=>{if(disposed)return;ready=false;connected.current=false;queue=[];pending=0;clearTimeout(flushTimer);clearTimeout(timeout);term.options.disableStdin=true;setStatus('Disconnected. Input may have been applied; inspect before repeating it.');socket.close();};
    const flush=()=>{
      flushTimer=undefined;if(!ready||disposed)return;
      try{
        const batch=new Uint8Array(pending);let offset=0;for(const bytes of queue){batch.set(bytes,offset);offset+=bytes.length;}
        for(let i=0;i<batch.length;i+=4096){if(socket.bufferedAmount>65536)throw Error();socket.send(JSON.stringify({type:'input',data:encode(batch.subarray(i,i+4096))}));}
        queue=[];pending=0;
      }catch{end();}
    };
    const data=term.onData(value=>{
      if(!ready||disposed)return;
      // Focus reports are not keyboard input. Defence in depth for mouse protocols as well.
      if(/^\x1b\[(?:I|O)$/.test(value)||/^\x1b\[(?:<\d+;\d+;\d+[Mm]|M[\s\S]{3}|\d+;\d+;\d+M)$/.test(value))return;
      const bytes=new TextEncoder().encode(value);pending+=bytes.length;
      if(pending>65536){end();return;}
      for(let i=0;i<bytes.length;i+=4096)queue.push(bytes.slice(i,i+4096));
      if(flushTimer===undefined)flushTimer=setTimeout(flush,10);
    });
    const heartbeat=setInterval(()=>{if(ready&&socket.readyState===WebSocket.OPEN)socket.send('{"type":"ping"}');},5000);
    socket.onmessage=event=>{
      if(disposed)return;
      try{
        if(typeof event.data!=='string'||event.data.length>16384)throw Error();
        const frame=JSON.parse(event.data);
        if(frame.type==='ready'&&frame.columns===COLS&&frame.rows===ROWS){ready=true;connected.current=true;clearTimeout(timeout);term.options.disableStdin=!inputAllowed.current;setStatus('Connected · 120 × 36 · Keyboard only');term.focus();return;}
        if(frame.type!=='output'||!ready||typeof frame.data!=='string'||frame.data.length>12000)throw Error();
        const bytes=Uint8Array.from(atob(frame.data),c=>c.charCodeAt(0));renderBytes+=bytes.length;if(renderBytes>262144)throw Error();
        term.write(bytes,()=>{renderBytes-=bytes.length;});
      }catch{end();}
    };
    socket.onerror=end;socket.onclose=end;
    setStatus('Connecting…');
    return()=>{
      disposed=true;ready=false;connected.current=false;queue=[];clearTimeout(timeout);clearTimeout(flushTimer);clearInterval(heartbeat);socket.close();data.dispose();clipboard.dispose();
      for(const name of mouseEvents)element.removeEventListener(name,stopMouse,true);
      term.dispose();terminal.current=null;
    };
  },[computerId,sessionId,attempt,visible]);
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-terminal-emulator>
    <div className="min-h-0 max-w-full flex-1 overflow-auto bg-[#141414] p-2" aria-label="Interactive terminal" data-testid="terminal-viewport"><div ref={host} className="w-max" /></div>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground"><span role="status">{status}</span>{status.startsWith('Disconnected')&&<Button size="sm" variant="outline" className="min-h-9" onClick={()=>setAttempt(value=>value+1)}>Reconnect</Button>}<span>Browser/OS-reserved shortcuts may require Send key.</span></div>
  </div>;
}
