import { expect,it } from 'vitest';
import { terminalSockets } from './terminal-stream';
const id='12345678-1234-4234-8234-123456789abc';
it('bounds connections and retains admission until cancelled startup has joined',async()=>{
 let finish!:(value:any)=>void;
 const streams=terminalSockets({terminalStream:()=>new Promise(resolve=>{finish=resolve;})} as any);
 const data=streams.reserve(id,id),other=streams.reserve(id,id);
 expect(()=>streams.reserve(id,id)).toThrow(/busy/);
 const ws={data,close:()=>{},send:()=>{},getBufferedAmount:()=>0} as any;
 const opening=streams.handlers.open(ws);streams.handlers.close(ws);
 expect(data.abort.signal.aborted).toBe(true);expect(()=>streams.reserve(id,id)).toThrow(/busy/);
 finish({close:()=>{},write:()=>{}});await opening;
 const next=streams.reserve(id,id);next.opening=false;other.opening=false;streams.release(next);streams.release(other);
});
it('bounds tiny-frame floods and never writes after release',()=>{
 const streams=terminalSockets({} as any),data=streams.reserve(id,id);data.opening=false;
 let writes=0;data.connection={close:()=>{},write:()=>{writes++;}};
 const ws={data,close:()=>{}} as any;
 for(let i=0;i<300;i++)streams.handlers.message(ws,'{"type":"input","data":"YQ=="}');
 expect(writes).toBe(256);expect(data.released).toBe(true);
 streams.handlers.message(ws,'{"type":"input","data":"YQ=="}');expect(writes).toBe(256);
});
it('rejects resize/binary/oversized input instead of forwarding it to the guest',()=>{
 const streams=terminalSockets({} as any);
 for(const message of ['{"type":"resize","columns":80}',Buffer.from('keyboard'),JSON.stringify({type:'input',data:'YQ==',command:'host'})]){
  let writes=0,closed=0;const data=streams.reserve(id,id);data.opening=false;data.connection={close:()=>{},write:()=>{writes++;}};
  streams.handlers.message({data,close:()=>{closed++;}} as any,message);
  expect(writes).toBe(0);expect(closed).toBe(1);expect(data.abort.signal.aborted).toBe(true);
 }
});
