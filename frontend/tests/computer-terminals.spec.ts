import { test, expect, type Page } from './fixtures';
const id='c4a5f16d-0042-4b70-a232-dd65591a2c4c';
const sid='12345678-1234-1234-1234-123456789abc';
async function setup(page:Page,state='running') {
 const requests:any[]=[];
 let sessions=[{id:sid,name:'build',alive:true,exitCode:null,createdAt:1,columns:120,rows:36,cwd:'/workspace',currentCommand:'bash'}];
 await page.route('**/api/computers',route=>route.fulfill({json:{controllerConnected:true,computers:[{id,name:'Terminal desk',state,createdAt:0,cpuPercent:0,memoryBytes:0}]}}));
 await page.route('**/api/computers/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('settings-limits'))return route.fulfill({json:{cpuCores:{min:1,max:8,default:4},memoryGiB:{min:1,max:16,default:4},timezoneDefault:'UTC'}});
  if(url.pathname.endsWith('terminals')){
   const input=route.request().postDataJSON();requests.push(input);
   if(input.operation==='list')return route.fulfill({json:{type:'terminal',sessions}});
   if(input.operation==='create'){const session={...sessions[0],id:'98765432-1234-1234-1234-123456789abc',name:input.name};sessions.push(session);return route.fulfill({json:{type:'terminal',session}});}
   if(input.operation==='delete'){sessions=sessions.filter(row=>row.id!==input.session);return route.fulfill({json:{type:'terminal',deleted:true,sessionId:input.session}});}
   const session=sessions.find(row=>row.id===input.session);
   if(!session)return route.fulfill({status:400,json:{message:'Terminal not found.'}});
   if(input.operation==='view')return route.fulfill({json:{type:'terminal',session,text:'<script>not executable</script>\nhello 世界\n'+('x'.repeat(240)),truncated:true,note:'Latest rows only'}});
   return route.fulfill({json:{type:'terminal',session,accepted:true}});
  }
  return route.fulfill({status:503,json:{message:'Unavailable'}});
 });
 await page.goto('/computers');await page.getByRole('button',{name:'Actions for Terminal desk'}).click();
 return requests;
}
async function open(page:Page){const requests=await setup(page);await page.getByRole('menuitem',{name:'Terminals',exact:true}).click();const panel=page.getByRole('dialog',{name:'Terminals · Terminal desk'});await expect(panel.getByLabel('Terminal output')).toContainText('hello 世界');return {panel,requests};}
test('operator can inspect, send literal text/keys, interrupt and deliberately delete, without hidden Enter or replay',async({page})=>{
 const {panel,requests}=await open(page);
 await expect(panel.locator('script')).toHaveCount(0);await expect(panel).toContainText('Truncated');
 await panel.getByLabel('Terminal text').fill('echo hello');await panel.getByRole('button',{name:'Send text',exact:true}).click();
 await expect.poll(()=>requests.filter(r=>r.operation==='type').length).toBe(1);
 expect(requests.find(r=>r.operation==='type')).toEqual({operation:'type',session:sid,text:'echo hello'});
 expect(requests.some(r=>r.operation==='press')).toBe(false);
 await panel.getByRole('button',{name:'Enter',exact:true}).click();
 await expect.poll(()=>requests.filter(r=>r.operation==='press').length).toBe(1);
 await panel.getByRole('button',{name:'Interrupt',exact:true}).click();
 await expect.poll(()=>requests.filter(r=>r.operation==='interrupt').length).toBe(1);
 await panel.getByRole('button',{name:'Delete terminal',exact:true}).click();
 expect(requests.some(r=>r.operation==='delete')).toBe(false);
 await panel.getByLabel('Confirm terminal name').fill('build');await panel.getByRole('button',{name:'Confirm delete',exact:true}).click();
 await expect(panel).toContainText('No terminals yet');
 await panel.getByRole('button',{name:'Close',exact:true}).click();
 await expect(page.getByRole('button',{name:'Actions for Terminal desk'})).toBeFocused();
 expect(requests.filter(r=>!['list','view'].includes(r.operation)).map(r=>r.operation)).toEqual(['type','press','interrupt','delete']);
});
test('create preserves explicit command/cwd and closing/reopening never deletes sessions',async({page})=>{
 const {panel,requests}=await open(page);
 await panel.getByRole('button',{name:'New terminal',exact:true}).click();
 await panel.getByLabel('Terminal name',{exact:true}).fill('server');await panel.getByLabel('Initial command').fill('npm run dev');await panel.getByLabel('Working directory').fill('~/project');
 await panel.getByRole('button',{name:'Create terminal',exact:true}).click();
 await expect(panel.getByLabel('Select terminal')).toHaveValue('98765432-1234-1234-1234-123456789abc');
 expect(requests.find(r=>r.operation==='create')).toEqual({operation:'create',name:'server',command:'npm run dev',cwd:'~/project'});
 await panel.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'Actions for Terminal desk'}).click();await page.getByRole('menuitem',{name:'Terminals',exact:true}).click();
 await expect(panel.getByLabel('Terminal output')).toBeVisible();expect(requests.some(r=>r.operation==='delete')).toBe(false);
});
test('failed input is not retried or cleared while snapshot polling recovers',async({page})=>{
 const {panel,requests}=await open(page);let sends=0;
 await page.route(`**/api/computers/${id}/terminals`,route=>{
  if(route.request().postDataJSON().operation==='type'){sends++;return route.fulfill({status:503,json:{message:'Result uncertain; inspect before retrying.'}});}
  return route.fallback();
 });
 const before=requests.filter(r=>r.operation==='view').length;
 await panel.getByLabel('Terminal text').fill('do not repeat');await panel.getByRole('button',{name:'Send text',exact:true}).click();
 await expect(panel.getByRole('alert')).toContainText('Result uncertain');
 await expect(panel.getByLabel('Terminal text')).toHaveValue('do not repeat');
 await expect.poll(()=>requests.filter(r=>r.operation==='view').length).toBeGreaterThan(before);
 expect(sends).toBe(1);
});
test('stopped computers do not offer terminal execution',async({page})=>{await setup(page,'exited');await expect(page.getByRole('menuitem',{name:'Terminals',exact:true})).toHaveAttribute('data-disabled','');});
test('terminal snapshot and input stay usable at320px without page overflow',async({page})=>{
 await page.setViewportSize({width:320,height:760});const {panel}=await open(page);
 expect(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 await expect(panel.getByLabel('Terminal text')).toBeVisible();
 await page.screenshot({path:'../.scratch/terminal-320.png',animations:'disabled'});
});
