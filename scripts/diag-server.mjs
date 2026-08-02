import http from 'http';
import fs from 'fs';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    console.log("Received diagnostic payload!");
    fs.writeFileSync('hang-diag.json', body);
    res.end('ok');
    process.exit(0);
  });
});

server.listen(9999, () => {
  console.log("Listening on 9999...");
});
