import WebSocket from "ws";
const ws = new WebSocket(process.argv[2]);
ws.on("upgrade", (res) => console.log("upgrade", res.statusCode, Object.entries(res.headers).filter(([k]) => k.startsWith("x-")).map(([k, v]) => `${k}=${v}`).join(" ")));
ws.on("close", (c) => { console.log("closed", c); process.exit(0); });
ws.on("error", (e) => { console.log("error", e.message); process.exit(1); });
setTimeout(() => process.exit(0), 8000);
