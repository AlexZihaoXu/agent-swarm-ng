import net from 'node:net';
export type ExecConnection = { write(data: string): void; close(): void };
/** Fixed Docker HTTP hijack over Unix TCP semantics. Raw net avoids Bun's HTTP-upgrade shim.
 * No caller URL/headers. Incremental bounded headers and non-TTY frame demultiplexing.
 */
export function attachExec(socketPath:string,id:string,signal:AbortSignal,onOutput:(chunk:Buffer)=>void,onEnd:()=>void):Promise<ExecConnection> {
  return new Promise((resolve,reject)=>{
    let closed=false,upgraded=false,header=Buffer.alloc(0),buffer=Buffer.alloc(0);
    const socket=net.createConnection({path:socketPath});
    const close=()=>{if(closed)return;closed=true;reject(new Error('Terminal attachment closed.'));signal.removeEventListener('abort',close);socket.destroy();onEnd();};
    const fail=(message:string)=>{reject(new Error(message));close();};
    const consume=(chunk:Buffer)=>{
      buffer=Buffer.concat([buffer,chunk]);
      while(buffer.length>=8){
        const size=buffer.readUInt32BE(4);
        if(size>1048576||![1,2].includes(buffer[0]))return fail('Invalid Docker stream frame.');
        if(buffer.length<size+8)break;
        const stream=buffer[0],payload=buffer.subarray(8,size+8);buffer=buffer.subarray(size+8);
        if(stream===1){try{onOutput(payload);}catch{fail('Invalid terminal stream.');return;}}
      }
      if(buffer.length>1048584)fail('Docker stream exceeds its bound.');
    };
    socket.setTimeout(5000);
    socket.on('connect',()=>{
      if(closed)return;
      const body=JSON.stringify({Detach:false,Tty:false});
      socket.write(`POST /v1.44/exec/${encodeURIComponent(id)}/start HTTP/1.1\r\nHost: docker\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n${body}`);
    });
    socket.on('data',chunk=>{
      if(closed)return;
      if(upgraded){consume(chunk);return;}
      header=Buffer.concat([header,chunk]);const end=header.indexOf('\r\n\r\n');
      if(end<0){if(header.length>16384)fail('Docker upgrade header exceeded its bound.');return;}
      if(end>16384||!/^HTTP\/1\.[01] 101\b/.test(header.toString('ascii',0,end)))return fail('Docker exec upgrade failed.');
      upgraded=true;socket.setTimeout(25000);
      resolve({write(data){if(closed||socket.writableLength>65536)throw new Error('Terminal input is unavailable.');socket.write(data);},close});
      const head=header.subarray(end+4);header=Buffer.alloc(0);if(head.length)consume(head);
    });
    socket.on('error',close).on('end',close).on('close',close).on('timeout',close);
    signal.addEventListener('abort',close,{once:true});if(signal.aborted)close();
  });
}
