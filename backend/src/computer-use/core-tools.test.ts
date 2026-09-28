import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { prepareDatabase } from '../test-database';
import { createChatSession } from '../chat-runtime';
import { ComputerUseService, type ComputerRuntime } from './service';
import { ScreenshotPool } from './image-pool';
import { createComputerTools } from './tools';
import { withoutScreenshotBytes } from './session-images';

it('custom core tools override Pi host builtins and require the current claim; image files use the bounded reference pool', async () => {
  const db=await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!,`${crypto.randomUUID()}.db`));
  const pool=new ScreenshotPool(join(db.dataDirectory,'core-images'));
  const agent=await db.createAgent({name:'A',endpointId:'mock',model:'gpt-4o',thinkingLevel:'off'});
  const computer=await db.client.computer.create({data:{name:'Desk',state:'running',requestKey:crypto.randomUUID()}});
  const host=join(process.env.SQLITE_TEST_ROOT!,'host-sentinel-'+crypto.randomUUID());
  await writeFile(host,'HOST SENTINEL');
  const run=vi.fn(async (_id, request:any)=>({started:true,settled:true as const,result:request.path==='picture.jpg'
    ? {type:'image',path:'/workspace/picture.jpg',mimeType:'image/jpeg',data:Buffer.from([255,216,255,217]).toString('base64'),width:10,height:10}
    : {type:'text',text:'GUEST RESULT'}}));
  const runtime:ComputerRuntime={capture:async()=>{throw Error('No screenshot');},execute:async()=>({started:true,completed:1,error:null}),cancel:async()=>{},prepareCore:async(_id,request)=>request,core:run};
  const service=new ComputerUseService(db,runtime);await service.assign(agent.id,[computer.id]);
  const session=await createChatSession({name:'A',model:'gpt-4o',thinkingLevel:'off',baseUrl:'http://127.0.0.1:1/v1',channel:{id:agent.channels[0].id,agentId:agent.id,kind:'platform-chat'}},[],()=>{},createComputerTools(service,pool,agent.id));
  const invoke=(name:string,args:object)=>session.agent.state.tools.find(tool=>tool.name===name)!.execute('call',args);
  const calls:[string,object][]=[['read',{path:host}],['write',{path:host,content:'WRONG'}],['edit',{path:host,edits:[{oldText:'HOST',newText:'WRONG'}]}],['bash',{command:`printf WRONG > '${host}'`}]];
  try {
    for(const [name,args] of calls) await expect(invoke(name,args)).rejects.toThrow(/use_computer/);
    expect(run).not.toHaveBeenCalled();expect(await readFile(host,'utf8')).toBe('HOST SENTINEL');
    await service.use(agent.id,'Desk');
    for(const [name,args] of calls) expect(JSON.stringify(await invoke(name,args))).toContain('GUEST RESULT');
    expect(run.mock.calls.every(([id])=>id===computer.id)).toBe(true);expect(await readFile(host,'utf8')).toBe('HOST SENTINEL');
    const image=await invoke('read',{path:'picture.jpg'});
    expect(image.content.some(block=>block.type==='image')).toBe(true);
    expect(JSON.stringify(image.content[0])).toContain('not a desktop screenshot');
    const entry={type:'message',message:{role:'toolResult',toolName:'read',content:image.content,details:image.details}} as any;
    expect(JSON.stringify(withoutScreenshotBytes(entry))).not.toContain('"type":"image"');
    await expect(service.run(agent.id,{})).rejects.toThrow(/look/i);
    await service.use(agent.id,null);
    await expect(invoke('read',{path:host})).rejects.toThrow(/use_computer/);
  } finally {session.dispose();await pool.removeAgent(agent.id);await db.close();await rm(host,{force:true});}
});
