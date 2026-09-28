import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from '@sinclair/typebox';
import type { ComputerUseService } from './service';
const session = Type.String({ pattern:'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$',description:'Exact session ID returned by terminal_create/list, scoped to your currently claimed computer.' });
const target = { session };
const keys = ['Enter','Tab','BTab','Escape','BSpace','Delete','Insert','Space','Up','Down','Left','Right','Home','End','PageUp','PageDown',...Array.from({length:12},(_,i)=>`F${i+1}`),...[...'abcdefghijklmnopqrstuvwxyz'].flatMap(c=>[`C-${c}`,`M-${c}`])];
export const terminalParameters = {
  create:Type.Object({name:Type.String({pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$'}),command:Type.Optional(Type.String({minLength:1,maxLength:32768})),cwd:Type.Optional(Type.String({minLength:1,maxLength:4096}))},{additionalProperties:false}),
  list:Type.Object({},{additionalProperties:false}),
  view:Type.Object(target,{additionalProperties:false}),
  type:Type.Object({...target,text:Type.String({minLength:1,maxLength:32768})},{additionalProperties:false}),
  press:Type.Object({...target,key:Type.Union(keys.map(key=>Type.Literal(key)))},{additionalProperties:false}),
  interrupt:Type.Object(target,{additionalProperties:false}),
  delete:Type.Object(target,{additionalProperties:false}),
  status:Type.Object(target,{additionalProperties:false}),
};
export const terminalRequest = Type.Union(Object.entries(terminalParameters).map(([operation,schema])=>Type.Object({operation:Type.Literal(operation),...schema.properties},{additionalProperties:false})));
export type TerminalRequest = Static<typeof terminalRequest>;
const descriptions = {
  create:'Create a named persistent tmux terminal (32/computer, names unique ignoring case). Default interactive Bash; optional command runs bash -lc and leaves an exited pane/output when finished. cwd defaults /workspace; ~/ is /home/agent. Returns stable session ID. Fixed 120×36 initial terminal. Does not wait for a command to finish.',
  list:'List managed tmux sessions on this computer. Shared with other authorized agents and the operator; not private agent memory.',
  view:'Read latest ≤2000 rows/50000 UTF-8 bytes of plain terminal screen/scrollback, with explicit truncation. tmux retains10000 history rows in memory, not a permanent log. This is a snapshot, not incremental stdout/stderr; full-screen applications may redraw it.',
  type:'Paste literal text into a live session (≤32768 UTF-8 bytes); never interpret text as tmux key names. No Enter is appended. Bracketed paste is used where supported; supplied newlines may execute commands. Use press Enter to submit and view to verify. Control keys belong in press.',
  press:'Send one enumerated tmux key: Enter, Tab/BTab, Escape, BSpace, Delete/Insert, Space, arrows, Home/End/PageUp/PageDown, F1..F12, C-a..C-z, M-a..M-z. No raw tmux commands or arbitrary targets.',
  interrupt:'Send Ctrl+C to the terminal foreground program. This is an interrupt request, not proof of termination; programs can ignore it. View/status to verify.',
  delete:'Kill this tmux session and discard its screen/history. Destructive: may terminate its running programs. Deliberately detached/external programs are not guaranteed to stop. Inspect the exact session before deleting.',
  status:'Read actual pane alive/exited status, exit code when tmux has one, cwd and foreground command. A running interactive shell is NOT proof that its last command succeeded or that a task is complete.',
};
export function createTerminalTools(service:ComputerUseService,agentId:string):ToolDefinition[] {
  return (Object.keys(terminalParameters) as (keyof typeof terminalParameters)[]).map(operation=>defineTool({
    name:`terminal_${operation}`,label:`Terminal ${operation}`,parameters:terminalParameters[operation],
    description:'Requires your currently assigned and claimed computer; guest uid1000 only, no platform-host access. Read swarm/computers/terminals. Await each computer operation. Sessions/programs survive tool calls, turn completion, browser disconnect, backend restart and claim release; stopping/replacing the computer ends them. Cancellation stops further API input, not persistent programs. '+descriptions[operation],
    async execute(_call,params,signal){
      const receipt=await service.core(agentId,{...params,kind:'terminal',operation},signal);
      return {content:[{type:'text' as const,text:JSON.stringify(receipt.error?{error:receipt.error,started:receipt.started}:receipt.result)}],details:{},isError:Boolean(receipt.error)};
    },
  }));
}
