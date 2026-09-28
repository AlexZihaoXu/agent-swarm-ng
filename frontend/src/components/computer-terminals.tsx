import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { computerTerminal, type TerminalRequest, type TerminalResult } from '@/lib/computer-terminals';
import type { Computer } from './computer-card';
const field='min-h-10 min-w-0 rounded-md border border-border bg-sidebar px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:text-sm';
const keys=['Tab','Escape','BSpace','Up','Down','Left','Right','Home','End','PageUp','PageDown','Delete','C-d','C-l','C-z'] as const;

/** Kibo dialog-standard-3 + input-group-textarea-1 composition; inert snapshots, not guest HTML/JS. */
export function ComputerTerminals({computer,open,connected,onOpenChange}:{computer:Computer;open:boolean;connected:boolean;onOpenChange:(open:boolean)=>void}) {
  const client=useQueryClient();
  const [selected,setSelected]=useState<string|null>(null);
  const [creating,setCreating]=useState(false),[name,setName]=useState(''),[command,setCommand]=useState(''),[cwd,setCwd]=useState('/workspace');
  const [text,setText]=useState(''),[key,setKey]=useState<(typeof keys)[number]>('Tab');
  const [deleting,setDeleting]=useState(false),[confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const inFlight=useRef(false),output=useRef<HTMLPreElement>(null),follow=useRef(true);
  const available=connected&&computer.state==='running';
  const queryKey=['computer-terminals',computer.id,selected];
  const query=useQuery({queryKey,enabled:open&&available&&!busy,retry:false,gcTime:0,refetchInterval:2000,refetchIntervalInBackground:false,refetchOnWindowFocus:false,
    queryFn:async({signal})=>{
      // Sequential: the core fence deliberately admits only one short operation per computer.
      const list=await computerTerminal(computer.id,{operation:'list'},signal);
      const view=selected&&list.sessions?.some(item=>item.id===selected)?await computerTerminal(computer.id,{operation:'view',session:selected},signal):null;
      return {sessions:list.sessions??[],view};
    },
  });
  const sessions=query.data?.sessions??[];
  const view=query.data?.view,session=view?.session;
  const actionable=available&&!busy&&!query.isFetching&&!query.isError&&session?.id===selected;
  const live=Boolean(actionable&&session?.alive);
  useEffect(()=>{if(open&&selected===null&&sessions[0])setSelected(sessions[0].id);},[open,selected,sessions]);
  useEffect(()=>{setText('');setDeleting(false);setConfirmation('');follow.current=true;},[selected]);
  useEffect(()=>{if(output.current&&follow.current)output.current.scrollTop=output.current.scrollHeight;},[view?.text,selected]);
  useEffect(()=>{
    if(!open||!available){void client.cancelQueries({queryKey:['computer-terminals',computer.id]});setText('');setCreating(false);setDeleting(false);setError('');setNotice('');}
  },[open,available,computer.id,client]);
  const act=async(body:TerminalRequest,done?:(value:TerminalResult)=>void)=>{
    if(inFlight.current||!available||query.isFetching)return;
    inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      const result=await computerTerminal(computer.id,body);
      done?.(result);setNotice(body.operation==='interrupt'?'Ctrl+C sent; inspect the output to confirm.':'Request accepted.');
      await client.invalidateQueries({queryKey:['computer-terminals',computer.id]});
    }catch(err){setError(err instanceof Error?err.message:'Terminal request failed. Inspect before retrying.');}
    finally{inFlight.current=false;setBusy(false);}
  };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 motion-safe:data-[state=open]:animate-[fade-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[fade-out_120ms_ease-in]" />
    <Dialog.Content onCloseAutoFocus={event=>{event.preventDefault();document.querySelector<HTMLElement>(`[data-computer-id="${CSS.escape(computer.id)}"] button[aria-label^="Actions for"]`)?.focus();}} className="fixed left-1/2 top-1/2 z-50 flex h-[min(90dvh,52rem)] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] min-w-0 max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl motion-safe:data-[state=open]:animate-[dialog-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[dialog-out_120ms_ease-in] sm:w-[calc(100%-2rem)]">
      <header className="shrink-0 border-b border-border px-3 py-3 sm:px-5">
        <div className="flex min-w-0 items-center justify-between gap-3"><Dialog.Title className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">Terminals · {computer.name}</Dialog.Title><Dialog.Close asChild><Button variant="outline" size="sm" className="size-10 shrink-0 p-0" aria-label="Close terminals">×</Button></Dialog.Close></div>
        <Dialog.Description className="mt-1 text-xs text-muted-foreground">Shared tmux sessions. Closing this view or releasing control leaves programs running. Powering off ends them.</Dialog.Description>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-3 sm:p-5">
        {!available?<p role="status" className="text-sm text-muted-foreground">Computer unavailable. Reconnect or power it on before using terminals.</p>:<>
          <div className="mb-3 flex min-w-0 shrink-0 flex-wrap gap-2">
            <select aria-label="Select terminal" className={`${field} w-0 flex-1 cursor-pointer disabled:cursor-default`} value={selected??''} disabled={busy||!sessions.length} onChange={event=>{setSelected(event.target.value);setNotice('');setError('');}}><option value="">Select terminal</option>{sessions.map(item=><option key={item.id} value={item.id}>{item.name} · {item.alive?'Running':'Exited'}</option>)}</select>
            <Button variant="outline" size="sm" className="min-h-10" disabled={busy} onClick={()=>{setCreating(value=>!value);setDeleting(false);setError('');}}>New terminal</Button>
          </div>
          {creating&&<form className="mb-3 shrink-0 space-y-2 rounded-lg border border-border p-3 motion-safe:animate-[fade-in_120ms_ease-out]" onSubmit={event=>{event.preventDefault();void act({operation:'create',name,...(command?{command}:{}),...(cwd?{cwd}:{})},result=>{if(result.session)setSelected(result.session.id);setCreating(false);setName('');setCommand('');});}}>
            <label className="block text-xs">Terminal name<input aria-label="Terminal name" className={`${field} mt-1 w-full`} value={name} pattern="[A-Za-z0-9](?:[A-Za-z0-9_]|-){0,47}" maxLength={48} required disabled={busy} onChange={event=>setName(event.target.value)} /></label>
            <label className="block text-xs">Initial command<input aria-label="Initial command" placeholder="Optional; otherwise an interactive shell" className={`${field} mt-1 w-full font-mono`} value={command} maxLength={32768} disabled={busy} onChange={event=>setCommand(event.target.value)} /></label>
            <label className="block text-xs">Working directory<input aria-label="Working directory" className={`${field} mt-1 w-full font-mono`} value={cwd} maxLength={4096} disabled={busy} onChange={event=>setCwd(event.target.value)} /></label>
            <p className="text-[11px] text-muted-foreground">Names: letters, digits, hyphens and underscores. Commands run as the guest agent account, including its configured sudo permissions.</p>
            <div className="flex flex-wrap justify-end gap-2"><Button type="button" size="sm" variant="outline" className="min-h-10" disabled={busy} onClick={()=>setCreating(false)}>Cancel</Button><Button type="submit" size="sm" className="min-h-10" disabled={busy||query.isFetching||!name}>Create terminal</Button></div>
          </form>}
          {query.isPending&&<p role="status" className="text-sm text-muted-foreground">Loading terminals…</p>}
          {query.isError&&<p role="alert" className="mb-2 text-sm text-red-400">Snapshot unavailable: {query.error.message} Shown output may be stale.</p>}
          {query.isSuccess&&!sessions.length&&<p className="py-8 text-center text-sm text-muted-foreground">No terminals yet. Create one to start.</p>}
          {selected&&query.isSuccess&&sessions.length>0&&!sessions.some(item=>item.id===selected)&&<p role="status" className="text-sm text-muted-foreground">This terminal was deleted. Select another terminal.</p>}
          {view&&session&&<div className="flex min-h-60 min-w-0 flex-1 flex-col rounded-lg border border-border bg-background motion-safe:animate-[fade-in_120ms_ease-out]">
            <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 font-mono text-xs"><span className="min-w-0 flex-1 truncate" title={session.cwd}>{session.name} · {session.alive?'Running':`Exited${session.exitCode!==null?` (${session.exitCode})`:session.exitSignal?` (${session.exitSignal})`:''}`}</span><Button variant="outline" size="sm" className="min-h-9" disabled={!actionable} onClick={()=>{setDeleting(value=>!value);setConfirmation('');}}>Delete terminal</Button></div>
            <pre ref={output} aria-label="Terminal output" tabIndex={0} onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.scrollTop-node.clientHeight<32;}} className="min-h-40 min-w-0 flex-1 overflow-auto whitespace-pre p-3 font-mono text-xs leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring">{view.text||'(Empty terminal)'}</pre>
            <div className="shrink-0 space-y-2 border-t border-border p-3">
              <p className="text-[10px] text-muted-foreground">{query.isError?'Stale snapshot':'Snapshot every 2s while visible'} · {session.columns}×{session.rows}{view.truncated?' · Truncated (latest rows/50 KB)':''} · Running shell ≠ completed task.</p>
              {deleting?<form className="space-y-2" onSubmit={event=>{event.preventDefault();if(confirmation===session.name)void act({operation:'delete',session:session.id},()=>{setSelected(null);setDeleting(false);});}}><p className="text-xs text-red-400">Delete stops this session and discards its output. Type {session.name} to confirm.</p><input aria-label="Confirm terminal name" className={`${field} w-full`} value={confirmation} disabled={busy} onChange={event=>setConfirmation(event.target.value)} /><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" className="min-h-10" onClick={()=>setDeleting(false)}>Cancel</Button><Button type="submit" variant="outline" size="sm" className="min-h-10 text-red-400" disabled={!actionable||confirmation!==session.name}>Confirm delete</Button></div></form>:<>
                <div className="flex min-w-0 gap-2"><textarea aria-label="Terminal text" placeholder="Text to paste; Enter is sent separately" rows={2} maxLength={32768} value={text} disabled={!session.alive||busy} onChange={event=>setText(event.target.value)} className={`${field} min-h-16 flex-1 resize-y py-2 font-mono`} /><Button size="sm" className="min-h-10 self-end" disabled={!live||!text} onClick={()=>void act({operation:'type',session:session.id,text},()=>setText(''))}>Send text</Button></div>
                <div className="flex min-w-0 flex-wrap gap-2"><Button variant="outline" size="sm" className="min-h-10" disabled={!live} onClick={()=>void act({operation:'press',session:session.id,key:'Enter'})}>Enter</Button><select aria-label="Terminal key" className={`${field} w-24 cursor-pointer disabled:cursor-default`} value={key} disabled={!session.alive||busy} onChange={event=>setKey(event.target.value as typeof key)}>{keys.map(value=><option key={value}>{value}</option>)}</select><Button variant="outline" size="sm" className="min-h-10" disabled={!live} onClick={()=>void act({operation:'press',session:session.id,key})}>Send key</Button><Button variant="outline" size="sm" className="min-h-10" disabled={!live} onClick={()=>void act({operation:'interrupt',session:session.id})}>Interrupt</Button></div>
              </>}
            </div>
          </div>}
        </>}
      </div>
      <footer className="flex min-w-0 shrink-0 items-center gap-3 border-t border-border px-3 py-3 sm:px-5"><div className="min-w-0 flex-1 text-xs [overflow-wrap:anywhere]">{error&&<p role="alert" className="text-red-400">{error} Do not resend blindly.</p>}<p role="status" className="text-muted-foreground">{busy?'Sending…':notice}</p></div><Dialog.Close asChild><Button variant="outline" size="sm" className="min-h-10">Close</Button></Dialog.Close></footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
