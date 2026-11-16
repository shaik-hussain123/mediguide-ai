import http from 'node:http';
const calls = [];
http.createServer((req, res) => {
  if (req.url === '/__calls') { res.writeHead(200); return res.end(JSON.stringify(calls)); }
  let b = ''; req.on('data', (c) => { b += c; }).on('end', () => {
    const body = JSON.parse(b || '{}'); const parts = body.contents.at(-1).parts; const text = parts.map((p) => p.text || '').join(' ');
    calls.push({ key: req.headers['x-goog-api-key'], sys: body.systemInstruction.parts[0].text.slice(-220), text: text.slice(0, 80) });
    const reply = /prescription/i.test(text) ? '```json\n{"medicines":[{"name":"Dolo 650","strength":"650 mg","frequency":"1-0-1","days":"5"},{"name":"Unknownex","strength":"10 mg","frequency":"once daily","days":""}],"notes":""}\n```' : 'Fake answer from MediChat';
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] } }] }));
  });
}).listen(5602);
