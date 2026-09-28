import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { computerTerminal, type TerminalRequest, type TerminalResult } from '@/lib/computer-terminals';
import type { Computer } from './computer-card';
const TerminalEmulator=lazy(()=>import('./terminal-emulator').then(module=>({default:module.TerminalEmulator})));
const field='min-h-10 min-w-0 rounded-md border border-border bg-sidebar px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:text-sm';
const keys=['Tab','Escape','BSpace','Up','Down','Left','Right','Home','End','PageUp','PageDown','Delete','C-d','C-l','C-z','C-t','C-w'] as const;

/** Retains the Kibo dialog shell; a trusted fixed-size xterm renders the guest PTY stream. */
export function ComputerTerminals({computer,open,connected,onOpenChange}:{computer:Computer;open:boolean;connected:boolean;onOpenChange:(open:boolean)=>void}) {
  const client=useQueryClient();
  const [selected,setSelected]=useState<string|null>(null);
  const [creating,setCreating]=useState(false),[name,setName]=useState(''),[command,setCommand]=useState(''),[cwd,setCwd]=useState('/workspace');
  const [key,setKey]=useState<(typeof keys)[number]>('Tab');
  const [deleting,setDeleting]=useState(false),[confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const inFlight=useRef(false);
  const available=connected&&computer.state==='running';
  // Keyed by computer only and keeping the previous list: choosing a terminal or a background poll must never blank the panel.
  const queryKey=['computer-terminals',computer.id];
  const query=useQuery({queryKey,enabled:open&&available&&!busy,retry:false,gcTime:0,placeholderData:keepPreviousData,refetchInterval:2000,refetchIntervalInBackground:false,refetchOnWindowFocus:false,
    queryFn:async({signal})=>{
      const list=await computerTerminal(computer.id,{operation:'list'},signal);
      return {sessions:list.sessions??[]};
    },
  });
  const sessions=query.data?.sessions??[];
  const session=sessions.find(item=>item.id===selected);
  // A background refresh must not disable the controls: a click that lands mid-poll would be silently dropped.
  const actionable=available&&!busy&&!query.isError&&session?.id===selected;
  const live=Boolean(actionable&&session?.alive);
  useEffect(()=>{if(open&&selected===null&&sessions[0])setSelected(sessions[0].id);},[open,selected,sessions]);
  useEffect(()=>{setDeleting(false);setConfirmation('');},[selected]);
  useEffect(()=>{
    if(!open||!available){void client.cancelQueries({queryKey:['computer-terminals',computer.id]});setCreating(false);setDeleting(false);setError('');setNotice('');}
  },[open,available,computer.id,client]);
  const act=async(body:TerminalRequest,done?:(value:TerminalResult)=>void)=>{
    if(inFlight.current||!available)return;
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
    <Dialog.Content onEscapeKeyDown={event=>{if((event.target as HTMLElement)?.closest('[data-terminal-emulator]'))event.preventDefault();}} onCloseAutoFocus={event=>{event.preventDefault();document.querySelector<HTMLElement>(`[data-computer-id="${CSS.escape(computer.id)}"] button[aria-label^="Actions for"]`)?.focus();}} className="fixed left-1/2 top-1/2 z-50 flex h-[min(90dvh,52rem)] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] min-w-0 max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl motion-safe:data-[state=open]:animate-[dialog-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[dialog-out_120ms_ease-in] sm:w-[calc(100%-2rem)]">
      <header className="shrink-0 border-b border-border px-3 py-3 sm:px-5">
        <div className="flex min-w-0 items-center justify-between gap-3"><Dialog.Title className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">Terminals · {computer.name}</Dialog.Title><Dialog.Close asChild><Button variant="outline" size="sm" className="size-10 shrink-0 p-0" aria-label="Close terminals">×</Button></Dialog.Close></div>
        <Dialog.Description className="mt-1 text-xs text-muted-foreground">Shared tmux sessions. Closing this view or releasing control leaves programs running. Powering off ends them.</Dialog.Description>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-3 sm:p-5">
        {!available?<p role="status" className="text-sm text-muted-foreground">Computer unavailable. Reconnect or power it on before using terminals.</p>:<>
          <div className="mb-3 flex min-w-0 shrink-0 flex-wrap gap-2">
            <select aria-label="Select terminal" className={`${field} w-0 flex-1 cursor-pointer`} value={selected??''} disabled={busy||!sessions.length} onChange={event=>{setSelected(event.target.value);setNotice('');setError('');}}><option value="">Select terminal</option>{sessions.map(item=><option key={item.id} value={item.id}>{item.name} · {item.alive?'Running':'Exited'}</option>)}</select>
            <Button variant="outline" size="sm" className="min-h-10" disabled={busy} onClick={()=>{setCreating(value=>!value);setDeleting(false);setError('');}}>New terminal</Button>
          </div>
          {creating&&<form className="mb-3 shrink-0 space-y-2 rounded-lg border border-border p-3 motion-safe:animate-[fade-in_120ms_ease-out]" onSubmit={event=>{event.preventDefault();void act({operation:'create',name,...(command?{command}:{}),...(cwd?{cwd}:{})},result=>{if(result.session)setSelected(result.session.id);setCreating(false);setName('');setCommand('');});}}>
            <label className="block text-xs">Terminal name<input aria-label="Terminal name" className={`${field} mt-1 w-full`} value={name} pattern="[A-Za-z0-9](?:[A-Za-z0-9_]|-){0,47}" maxLength={48} required disabled={busy} onChange={event=>setName(event.target.value)} /></label>
            <label className="block text-xs">Initial command<input aria-label="Initial command" placeholder="Optional; otherwise an interactive shell" className={`${field} mt-1 w-full font-mono`} value={command} maxLength={32768} disabled={busy} onChange={event=>setCommand(event.target.value)} /></label>
            <label className="block text-xs">Working directory<input aria-label="Working directory" className={`${field} mt-1 w-full font-mono`} value={cwd} maxLength={4096} disabled={busy} onChange={event=>setCwd(event.target.value)} /></label>
            <p className="text-[11px] text-muted-foreground">Names: letters, digits, hyphens and underscores. Commands run as the guest agent account, including its configured sudo permissions.</p>
            <div className="flex flex-wrap justify-end gap-2"><Button type="button" size="sm" variant="outline" className="min-h-10" disabled={busy} onClick={()=>setCreating(false)}>Cancel</Button><Button type="submit" size="sm" className="min-h-10" disabled={busy||!name}>Create terminal</Button></div>
          </form>}
          {query.isPending&&<p role="status" className="text-sm text-muted-foreground">Loading terminals…</p>}
          {query.isError&&<p role="alert" className="mb-2 text-sm text-red-400">Session list unavailable: {query.error.message}</p>}
          {query.isSuccess&&!sessions.length&&<p className="py-8 text-center text-sm text-muted-foreground">No terminals yet. Create one to start.</p>}
          {selected&&query.isSuccess&&sessions.length>0&&!sessions.some(item=>item.id===selected)&&<p role="status" className="text-sm text-muted-foreground">This terminal was deleted. Select another terminal.</p>}
          {session&&<div className="flex min-h-60 min-w-0 flex-1 flex-col rounded-lg border border-border bg-background motion-safe:animate-[fade-in_120ms_ease-out]">
            <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 font-mono text-xs"><span className="min-w-0 flex-1 truncate" title={session.cwd}>{session.name} · {session.alive?'Running':`Exited${session.exitCode!==null?` (${session.exitCode})`:session.exitSignal?` (${session.exitSignal})`:''}`}</span><Button variant="outline" size="sm" className="min-h-9" disabled={!actionable} onClick={()=>{setDeleting(value=>!value);setConfirmation('');}}>Delete terminal</Button></div>
            {open&&available&&<Suspense fallback={<p role="status" className="p-3 text-sm">Loading terminal…</p>}><TerminalEmulator key={session.id} computerId={computer.id} sessionId={session.id} interactive={session.alive&&!busy&&!creating&&!deleting} /></Suspense>}
            <div className="shrink-0 space-y-2 border-t border-border p-3">
              <p className="text-[10px] text-muted-foreground">Fixed 120 × 36 · Click the terminal to focus. Escape and Tab go to the guest; use Close to leave.</p>
              {deleting?<form className="space-y-2" onSubmit={event=>{event.preventDefault();if(confirmation===session.name)void act({operation:'delete',session:session.id},()=>{setSelected(null);setDeleting(false);});}}><p className="text-xs text-red-400">Delete stops this session and discards its output. Type {session.name} to confirm.</p><input aria-label="Confirm terminal name" className={`${field} w-full`} value={confirmation} disabled={busy} onChange={event=>setConfirmation(event.target.value)} /><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" className="min-h-10" onClick={()=>setDeleting(false)}>Cancel</Button><Button type="submit" variant="outline" size="sm" className="min-h-10 text-red-400" disabled={!actionable||confirmation!==session.name}>Confirm delete</Button></div></form>:<>
                <div className="flex min-w-0 flex-wrap gap-2"><Button variant="outline" size="sm" className="min-h-10" disabled={!live} onClick={()=>void act({operation:'press',session:session.id,key:'Enter'})}>Enter</Button><select aria-label="Terminal key" className={`${field} w-24 cursor-pointer`} value={key} disabled={!session.alive||busy} onChange={event=>setKey(event.target.value as typeof key)}>{keys.map(value=><option key={value}>{value}</option>)}</select><Button variant="outline" size="sm" className="min-h-10" disabled={!live} onClick={()=>void act({operation:'press',session:session.id,key})}>Send key</Button><Button variant="outline" size="sm" className="min-h-10" disabled={!live} onClick={()=>void act({operation:'interrupt',session:session.id})}>Interrupt</Button></div>
              </>}
            </div>
          </div>}
        </>}
      </div>
      <footer className="flex min-w-0 shrink-0 items-center gap-3 border-t border-border px-3 py-3 sm:px-5"><div className="min-w-0 flex-1 text-xs [overflow-wrap:anywhere]">{error&&<p role="alert" className="text-red-400">{error} Do not resend blindly.</p>}<p role="status" className="text-muted-foreground">{busy?'Sending…':notice}</p></div><Dialog.Close asChild><Button variant="outline" size="sm" className="min-h-10">Close</Button></Dialog.Close></footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
