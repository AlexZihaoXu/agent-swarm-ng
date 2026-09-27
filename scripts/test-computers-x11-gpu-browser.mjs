// Opt-in, test-owned X11/GPU computer only. Prove the sandboxed guest Chrome's
// actual WebGL shader is visible over the dashboard's JPEG stream, and that
// the trusted menu sends a browser-reserved Ctrl+T to the guest, not host.
import { chromium } from '../frontend/node_modules/@playwright/test/index.mjs';
const id=process.env.TEST_COMPUTER_ID;
if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id??''))throw Error('Bound disposable computer UUID required');
const browser=await chromium.launch({headless:true,chromiumSandbox:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 const base='http://caddy-dev:5173';
 const rows=(await(await page.request.get(base+'/api/computers')).json()).computers;
 if(rows.length!==1||rows[0].id!==id||rows[0].name!=='Portal-free disposable probe')throw Error('Unexpected test-owned computer roster');
 await page.goto(`${base}/computers/${id}`);
 const frame=page.frameLocator('iframe[title="Portal-free disposable probe desktop"]');
 await frame.locator('#videoCanvas').waitFor({state:'attached',timeout:35000});
 await page.getByRole('button',{name:'Enable human desktop input'}).click();
 // The preceding input regression intentionally leaves GNOME Overview open.
 // Select the newly launched Chrome window from that overview before asserting
 // the shader pixels; this is a real remote pointer click, not a CDP page.
 const box=await page.locator('iframe').boundingBox();
 if(!box)throw Error('Desktop iframe missing');
 const scale=Math.min(box.width/1920,box.height/1080);
 await page.mouse.click(box.x+600*scale,box.y+846*scale);
 const greenPixels=async()=>{
  const png=await page.screenshot({animations:'disabled'});
  return page.evaluate(async data=>{
   const image=await createImageBitmap(await(await fetch(`data:image/png;base64,${data}`)).blob());
   const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
   const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();
   const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   let green=0;for(let p=0;p<rgba.length;p+=4)if(rgba[p]<105&&rgba[p+1]>170&&rgba[p+2]>30&&rgba[p+2]<165)green++;
   return green;
  },Buffer.from(png).toString('base64'));
 };
 let before=0;
 for(let n=0;n<25;n++){before=await greenPixels();if(before>5000)break;await page.waitForTimeout(170);}
 console.log('GPU_WEBGL_REMOTE_GREEN_PIXELS',before);
 if(before<5000){await page.screenshot({path:'/work/.scratch/gpu-webgl-remote-failure.png',animations:'disabled'});throw Error('Guest WebGL demo did not appear in the remote JPEG viewer');}
 await page.getByRole('button',{name:'Remote shortcuts'}).click();
 await page.getByRole('menuitem',{name:/New tab.*Ctrl\+T/}).click();
 let after=before;
 for(let n=0;n<45;n++){after=await greenPixels();if(after<500)break;await page.waitForTimeout(120);}
 console.log('GUEST_NEW_TAB_GREEN_PIXELS',after,'HOST_PAGES',page.context().pages().length);
 if(after>=500||page.context().pages().length!==1)throw Error('Ctrl+T did not open the guest tab while retaining the host tab');
 await page.getByRole('button',{name:'Remote shortcuts'}).click();
 await page.getByRole('menuitem',{name:/Close tab.*Ctrl\+W/}).click();
 let restored=after;
 for(let n=0;n<45;n++){restored=await greenPixels();if(restored>5000)break;await page.waitForTimeout(120);}
 console.log('GUEST_CLOSE_TAB_WEBGL_GREEN_PIXELS',restored);
 if(restored<5000)throw Error('Ctrl+W did not restore the visible guest WebGL demo');
}finally{await browser.close();}
