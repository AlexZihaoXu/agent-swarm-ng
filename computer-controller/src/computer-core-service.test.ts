import { expect, it, vi } from 'vitest';
import { ComputerCoreService, validateCore } from './computer-core-service';
const token = 'edc242f0-06f3-4a19-a941-6c3935e44f87';
it.each([
  {kind:'read',path:'/workspace/a'}, {kind:'edit',path:'a',edits:[{oldText:'a',newText:'b'}]},
  {kind:'write',path:'a',content:''}, {kind:'bash',command:'pwd',cwd:'/workspace',timeout:120},
])('validates core request %j without inferring a host target', input => expect(validateCore(input)).toEqual(input));
it.each([
  {kind:['read'],path:'a'}, {kind:'read',path:'a',computerId:'other'}, {kind:'read',path:'a',offset:0},
  {kind:'read',path:'a',limit:2001}, {kind:'write',path:'a',content:'x'.repeat(65536)},
  {kind:'edit',path:'a',edits:[{oldText:'',newText:'x'}]}, {kind:'bash',command:' '},
  {kind:'bash',command:'pwd',timeout:121}, {kind:'bash',command:'pwd',env:{SECRET:'x'}},
])('rejects invalid core request %#', input => expect(()=>validateCore(input)).toThrow());
it('requires a prepared generation and accepts only bounded settled receipts', async () => {
  const exec = vi.fn(async (_id, mode) => Buffer.from(JSON.stringify(mode==='prepare' ? {validationToken:token} : {started:true,settled:true,result:{type:'text',path:'/workspace/a',text:'ok',bytes:2,sha256:'a'.repeat(64),extra:'not forwarded'}})));
  const service=new ComputerCoreService(exec);
  const prepared = await service.prepare('id',{kind:'write',path:'a',content:'ok'});
  expect(prepared.validationToken).not.toBe(token);
  await expect(service.execute('id',{kind:'write',path:'a',content:'ok'})).rejects.toThrow(/Prepare/);
  const result=await service.execute('id',{kind:'write',path:'a',content:'ok',validationToken:prepared.validationToken});
  expect(result.result).not.toHaveProperty('extra');
  for (const body of [{settled:false}, {settled:true,started:true,result:{type:'text',text:'x'}}]) {
    const broken=new ComputerCoreService(async(_id,mode)=>Buffer.from(JSON.stringify(mode==='prepare'?{validationToken:token}:body)));
    const p = await broken.prepare('id',{kind:'read',path:'a'});
    await expect(broken.execute('id',{kind:'read',path:'a',validationToken:p.validationToken})).rejects.toThrow(/uncertain/);
  }
});
it('controller fencing rejects replay after cancellation even if guest accepts stale tokens', async () => {
  const exec=vi.fn(async (_id,mode)=>Buffer.from(JSON.stringify(mode==='prepare'?{validationToken:token}:{settled:true})));
  const service=new ComputerCoreService(exec);
  const prepared=await service.prepare('id',{kind:'read',path:'a'});
  await service.cancel('id');
  await expect(service.execute('id',{kind:'read',path:'a',validationToken:prepared.validationToken})).rejects.toThrow(/expired/);
  expect(exec.mock.calls.map(call=>call[1])).toEqual(['prepare','cancel']);
});
it('cancellation joins a delayed already-admitted Docker exec before acknowledging transfer', async () => {
  let finish!: (value:Buffer)=>void;
  const service=new ComputerCoreService(async (_id,mode)=> mode==='execute' ? new Promise<Buffer>(resolve=>{finish=resolve;}) : Buffer.from(JSON.stringify(mode==='prepare'?{validationToken:token}:{settled:true})));
  const prepared=await service.prepare('id',{kind:'read',path:'a'});
  const executing=service.execute('id',{kind:'read',path:'a',validationToken:prepared.validationToken});
  let settled=false;const cancelled=service.cancel('id').then(()=>{settled=true;});
  await Promise.resolve();expect(settled).toBe(false);
  finish(Buffer.from(JSON.stringify({started:false,settled:true,error:'Cancelled generation'})));
  await executing;await cancelled;expect(settled).toBe(true);
});
it('invalidates a preparation that finishes after cancellation', async () => {
  let finish!: (value:Buffer)=>void;
  const service=new ComputerCoreService(async (_id,mode)=>mode==='prepare' ? new Promise<Buffer>(resolve=>{finish=resolve;}) : Buffer.from('{"settled":true}'));
  const preparing=service.prepare('id',{kind:'read',path:'a'});
  await service.cancel('id'); finish(Buffer.from(JSON.stringify({validationToken:token})));
  await expect(preparing).rejects.toThrow(/cancelled/);
});
it('cancellation cannot report success for a lost supervisor', async () => {
  await expect(new ComputerCoreService(async()=>Buffer.from('{"settled":false}')).cancel('id')).rejects.toThrow(/uncertain/);
});
