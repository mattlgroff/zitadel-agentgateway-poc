import { createServer, request } from "node:http";
import { pipeline } from "node:stream";

const server = createServer((incoming, outgoing) => {
  const upstream = request({
    hostname: "stack-typescript",
    port: 5000,
    method: incoming.method,
    path: incoming.url,
    headers: incoming.headers,
  }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    pipeline(response, outgoing, () => undefined);
  });
  upstream.on("error", (error) => {
    if (!outgoing.headersSent) outgoing.writeHead(502, { "content-type": "text/plain" });
    outgoing.end(`Stack unavailable: ${error.message}`);
  });
  pipeline(incoming, upstream, () => undefined);
});

server.listen(5000, "0.0.0.0");
