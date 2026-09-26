// Opt-in isolated E2E. The shell harness checks namespace/labels and passes
// exactly one disposable computer ID. Never aim this script at the live stack.
// No portal interactions or user data; genuine remote insecure HTTP/JPEG.
import { chromium } from '../frontend/node_modules/@playwright/test/index.mjs';
const base='http://caddy-dev:5173';
const id=process.env.TEST_COMPUTER_ID;
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id??'')) throw Error('Bound disposable computer UUID required');
const name='Portal-free disposable probe';
const browser=await chromium.launch({headless:true,chromiumSandbox:true});
const page=await browser.newPage({viewport:{width:1280,height:800}});
// Observe the pinned client's worker's own once-per-second decoded-present
// counters, without changing trusted client bytes or recording desktop data.
await page.addInitScript(()=>{
 const NativeWorker=window.Worker;
 window.Worker=new Proxy(NativeWorker,{construct(target,args){
  const worker=Reflect.construct(target,args);
  worker.addEventListener('message',event=>{
   const m=event.data;
   if(m?.type!=='wireStats'||!Number.isFinite(m.presents))return;
   const stats=window.__computerWireStats??(window.__computerWireStats=[]);
   stats.push({at:performance.now(),presents:m.presents,frames:m.frames,chunks:m.chunks});
   if(stats.length>60)stats.shift();
  });
  return worker;
 }});
});
const errors=[];
page.on('pageerror',error=>errors.push(error.message.slice(0,200)));
page.on('console',msg=>{if(msg.type()==='error')errors.push(`${msg.text().slice(0,150)} @${msg.location().url.slice(0,120)}`);});
page.on('requestfailed',request=>console.log('REQUEST_FAILED',JSON.stringify({path:new URL(request.url()).pathname,reason:request.failure()?.errorText})));
async function pixel(x,y){
 const png=await page.screenshot({animations:'disabled'});
 return page.evaluate(async({image,x,y})=>{
  const bitmap=await createImageBitmap(await(await fetch(`data:image/png;base64,${image}`)).blob());
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
  const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,-x,-y);bitmap.close();
  return [...ctx.getImageData(0,0,1,1).data];
 },{image:Buffer.from(png).toString('base64'),x,y});
}
try{
 const response=await page.request.get(`${base}/api/computers`);const rows=(await response.json()).computers;
 if(rows.length!==1||rows[0].id!==id||rows[0].name!==name||rows[0].state!=='running') throw Error('Bound test computer roster changed');
 await page.addInitScript(computerId=>localStorage.removeItem(`computer-consent:${computerId}`),id);
 await page.goto(base);
 await page.getByRole('tab',{name:'Computers'}).click();
 await page.getByRole('button',{name:`Open ${name} desktop`}).click();
 if(await page.getByRole('button',{name:'Grant screen access'}).count())throw Error('Portal-free viewer still shows consent button');
 if(await page.getByRole('button',{name:/Click the permission dialog/}).count())throw Error('Portal-free viewer still blocks live input with preview overlay');
 const frame=page.frameLocator(`iframe[title="${name} desktop"]`);
 await frame.locator('#videoCanvas').waitFor({state:'attached',timeout:40000});
 // The JPEG canvas is reparented/resized during setup. Use the stable iframe
 // rectangle and 1920x1080 contain geometry instead of fixed page pixels;
 // hiding the global tabs changes the available screen height.
 await page.waitForTimeout(250);
 const desktopBox=await page.locator(`iframe[title="${name} desktop"]`).boundingBox();
 if(!desktopBox||desktopBox.width<640)throw Error('Live desktop iframe has no usable bounds');
 const scale=Math.min(desktopBox.width/1920,desktopBox.height/1080);
 const left=desktopBox.x+(desktopBox.width-1920*scale)/2;
 const top=desktopBox.y+(desktopBox.height-1080*scale)/2;
 const point=(x,y)=>[left+x*scale,top+y*scale];
 console.log('DESKTOP_VIEWPORT',JSON.stringify({x:desktopBox.x,y:desktopBox.y,width:desktopBox.width,height:desktopBox.height,scale}));
 const capabilities=await frame.locator('body').evaluate(()=>({secure:isSecureContext,decoder:typeof VideoDecoder,bitmap:typeof createImageBitmap}));
 if(capabilities.secure||capabilities.decoder!=='undefined'||capabilities.bitmap!=='function')throw Error('Not testing remote insecure HTTP/JPEG');
 let desktop=false;
 for(let i=0;i<80;i++){const p=await pixel(640,420);if(p[0]+p[1]+p[2]>75){desktop=true;break;}await page.waitForTimeout(140);}
 if(!desktop)throw Error('No visually decoded GNOME frame without portal');
 console.log('NO_PORTAL_VISIBLE_DESKTOP',JSON.stringify(capabilities));
 const cursor=await frame.locator('body').evaluate(()=>{
  const input=window.webrtcInput;
  const css=input?.element?.style.cursor??'';
  const hotspot=css.match(/^url\("data:image\/png;base64,[A-Za-z0-9+/=]+"\) (\d+) (\d+), default$/);
  return {attached:!!input,remotePNG:css.startsWith('url("data:image/png;base64,'),
    hotspot:hotspot?[Number(hotspot[1]),Number(hotspot[2])]:null,
    browserCursor:input?.use_browser_cursors??null};
 });
 console.log('REMOTE_CURSOR',JSON.stringify(cursor));
 if(!cursor.attached||!cursor.browserCursor||!cursor.remotePNG||!cursor.hotspot||cursor.hotspot.some(n=>n<0||n>128))throw Error('GNOME cursor image/hotspot not applied');
 // GNOME Shell dock Files icon at the fixed monitor coordinate 35x68.
 await page.mouse.click(...point(35,68));
 let before;
 for(let i=0;i<50;i++){
  before=await pixel(...point(440,380));
  if(before[0]>180&&before[1]>180&&before[2]>180)break;
  await page.waitForTimeout(110);
 }
 console.log('FILES_CLICK_PIXEL_LAST',JSON.stringify(before));
 if(!before||before[0]<180)throw Error('Browser click did not open GNOME Files without portal');
 console.log('NO_PORTAL_FILES_CLICK',JSON.stringify(before));
 // Drag GNOME Files by its titlebar label, not its breadcrumb/location field.
 await page.mouse.move(...point(205,220));await page.mouse.down();
 await page.mouse.move(...point(655,410),{steps:22});
 const held=await frame.locator('body').evaluate(()=>window.webrtcInput?.buttonMask??null);
 await page.mouse.up();await page.waitForTimeout(500);
 const after=await pixel(...point(440,380));
 const released=await frame.locator('body').evaluate(()=>window.webrtcInput?.buttonMask??null);
 console.log('NO_PORTAL_HELD_DRAG',JSON.stringify({held,released,before,after}));
 if(held!==1||released!==0||after[0]>170&&after[1]>170&&after[2]>170)throw Error('Held browser drag failed to move GNOME Files window');
 await page.keyboard.press('Meta');
 let overview=false;
 for(let i=0;i<40;i++){
  const p=await pixel(...point(960,78));if(p[0]<130&&p[1]>45&&p[2]>45){overview=true;break;}
  await page.waitForTimeout(95);
 }
 if(!overview)throw Error('Browser Meta key did not show GNOME Overview');
 console.log('NO_PORTAL_OVERVIEW_KEY',overview);
 await page.screenshot({path:'/work/.scratch/x11-portal-free-desktop.png',animations:'disabled'});
 const times=[];
 const cpu=[];
 for(let i=0;i<12;i++){
  const wanted=i%2===1;
  const started=Date.now();await page.keyboard.press('Meta');
  let seen=false;
  for(let n=0;n<35;n++){
   const p=await pixel(...point(960,78));seen=p[0]<130&&p[1]>45&&p[2]>45;
   if(seen===wanted)break;
   await page.waitForTimeout(85);
  }
  if(seen!==wanted)throw Error('Missing Overview frame transition');
  times.push(Date.now()-started);
  const status=await page.request.get(`${base}/api/computers`).catch(()=>null);
  if(status?.ok()){
   const usage=(await status.json()).computers.find(row=>row.id===id)?.cpuPercent;
   if(typeof usage==='number')cpu.push(usage);
  }
  await page.waitForTimeout(160);
 }
 const sorted=[...times].sort((a,b)=>a-b);
 const orderedCPU=[...cpu].sort((a,b)=>a-b);
 const wireStats=await frame.locator('body').evaluate(()=>window.__computerWireStats??[]);
 console.log('CLIENT_JPEG_PRESENTATIONS',JSON.stringify({oneSecondSamples:wireStats.length,
  presentsPerSecond:wireStats.map(s=>s.presents),
  note:'Selkies decoder worker presented-frame counts sampled per second during sparse GNOME activity; not an optical or sustained 120-fps guarantee'}));
 console.log('NO_PORTAL_KEY_TO_VISIBLE_FRAME',JSON.stringify({samples:times.length,p50:sorted[5],p95:sorted[11],values:times,
  cpuPercent:cpu.length?{p50:orderedCPU[Math.ceil(cpu.length*.5)-1],p95:orderedCPU[Math.ceil(cpu.length*.95)-1],values:cpu}:null,
  method:'Chromium Meta dispatch to screenshot-polled GNOME Overview pixel, includes CDP and screenshot overhead, not optical glass-to-glass'}));
 await page.setViewportSize({width:320,height:700});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Phone viewport overflow');
 await page.getByRole('button',{name:'Pan desktop right'}).click();
 let panned=false;
 for(let n=0;n<30;n++){
  if(await page.getByRole('button',{name:'Pan desktop left'}).isEnabled()){panned=true;break;}
  await page.waitForTimeout(70);
 }
 if(!panned)throw Error('Phone pan control failed');
 console.log('NO_PORTAL_PHONE_PAN',true);
 await page.close(); // Release the primary viewer before the HiDPI session.
 // A second context in the same automation browser emulates a HiDPI viewer.
 // Guest Xft DPI must remain at its operator-owned 96 despite client DPR=2.
 const highDpi=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:2});
 highDpi.on('pageerror',error=>errors.push(error.message.slice(0,200)));
 await highDpi.goto(base,{waitUntil:'domcontentloaded',timeout:15000});
 await highDpi.getByRole('tab',{name:'Computers'}).click();
 await highDpi.getByRole('button',{name:`Open ${name} desktop`}).click();
 const highFrame=highDpi.frameLocator(`iframe[title="${name} desktop"]`);
 await highFrame.locator('#videoCanvas').waitFor({state:'attached',timeout:40000});
 await highDpi.waitForTimeout(850);
 const dpr=await highFrame.locator('body').evaluate(()=>window.devicePixelRatio);
 if(dpr!==2)throw Error('HiDPI browser did not request a 2x screen density');
 console.log('HIGH_DPR_VIEWER_CONNECTED',{dpr});
 await highDpi.close();
 if(errors.length)throw Error(`Browser errors: ${JSON.stringify(errors.slice(0,4))}`);
}catch(error){
 await page.screenshot({path:'/work/.scratch/x11-portal-free-failure.png',animations:'disabled'}).catch(()=>{});
 console.log('E2E_FAILURE_CONTEXT',String(error).slice(0,220));
 throw error;
}finally{
 await browser.close();
}
