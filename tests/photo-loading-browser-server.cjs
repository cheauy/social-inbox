const http=require('http'),fs=require('fs'),path=require('path'),counts={};let retry=false;
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#2563eb"/></svg>';
const server=http.createServer((request,response)=>{const url=new URL(request.url,'http://fixture.local');counts[request.url]=(counts[request.url]||0)+1;
 if(url.pathname==='/stats'){response.setHeader('Content-Type','application/json');return response.end(JSON.stringify(counts));}
 if(url.pathname==='/shutdown'){response.end('closed');return server.close();}
 if(url.pathname==='/allow-retry'){retry=true;return response.end('ready');}
 if(url.pathname==='/bad.svg'||url.pathname==='/api/inbox/message-image'&&url.searchParams.get('messageId')!=='recover'&&!retry){response.statusCode=404;return response.end('Fixture missing image');}
 if(url.pathname.endsWith('.svg')||url.pathname==='/api/inbox/message-image'){const send=()=>{response.setHeader('Content-Type','image/svg+xml');response.setHeader('Cache-Control','private, max-age=60');response.end(svg);};return url.pathname==='/slow.svg'?setTimeout(send,700):send();}
 const name=url.pathname==='/'?'tenh-photo-loading-browser.html':url.pathname.slice(1);if(!['tenh-photo-loading-browser.html','tenh-photo-loading-bundle.js'].includes(name)){response.statusCode=404;return response.end();}
 response.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':'text/html');response.end(fs.readFileSync(path.join(process.env.TEMP,name)));});
server.listen(0,'127.0.0.1',()=>{const port=server.address().port;fs.writeFileSync(path.join(process.env.TEMP,'tenh-photo-loading-port.txt'),String(port));console.log('Synthetic image fixture listening on loopback port '+port);});
