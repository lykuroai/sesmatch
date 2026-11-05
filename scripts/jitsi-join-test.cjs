// Jitsi 開通確認: 2 参加者を JVB 経由（p2p 無効）で同じ部屋に入れ、接続状態とスクリーンショット（jitsi-e2e.png）を取る。
// 使い方は JITSI-EC2.md §4。chrome-headless-shell を --remote-debugging-port=9333 で起動しておくこと
const WebSocket = require("next/dist/compiled/ws");
const http = require("http"); const fs = require("fs");
const [urlA, urlB] = [process.argv[2], process.argv[3]];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function newTab() { return new Promise((res, rej) => { const req = http.request({ host: "127.0.0.1", port: 9333, path: "/json/new?about:blank", method: "PUT" }, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => res(JSON.parse(d))); }); req.on("error", rej); req.end(); }); }
async function client() { const tab = await newTab(); const ws = new WebSocket(tab.webSocketDebuggerUrl); let id = 0; const pending = {};
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  ws.on("message", m => { const j = JSON.parse(m); if (j.id && pending[j.id]) { pending[j.id](j.result); delete pending[j.id]; } });
  await new Promise(r => ws.on("open", r)); await send("Page.enable"); await send("Runtime.enable"); return { send, ws }; }
const EXPR = `(() => { try { const c = window.APP && APP.conference; const room = c && c._room; const stats = room && room.connectionQuality && room.connectionQuality._localStats; return JSON.stringify({ joined: c ? c.isJoined() : null, members: c ? c.listMembers().length : null, connState: room ? room.getConnectionState() : null, p2p: room ? room.isP2PActive() : null, bitrate: stats && stats.bitrate ? stats.bitrate : null, transport: stats && stats.transport ? stats.transport.map(t => t.ip + " " + t.type + " " + t.localCandidateType + "/" + t.remoteCandidateType) : null }); } catch (e) { return JSON.stringify({ err: String(e) }); } })()`;
(async () => {
  const A = await client(); const B = await client();
  await A.send("Page.navigate", { url: urlA }); await sleep(4000); await B.send("Page.navigate", { url: urlB });
  let st = null;
  for (let i = 0; i < 10; i++) { await sleep(5000); const r = await A.send("Runtime.evaluate", { expression: EXPR, returnByValue: true }); st = r.result.value; console.log("A t+" + (i + 1) * 5 + "s", st); const j = JSON.parse(st); if (j.connState === "connected" && j.members >= 1 && j.transport) break; }
  const rb = await B.send("Runtime.evaluate", { expression: EXPR, returnByValue: true }); console.log("B", rb.result.value);
  const shot = await A.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("jitsi-e2e.png", Buffer.from(shot.data, "base64"));
  await A.send("Page.navigate", { url: "about:blank" }); await B.send("Page.navigate", { url: "about:blank" }); await sleep(1500); process.exit(0);
})().catch(e => { console.error("ERR", e); process.exit(1); });
