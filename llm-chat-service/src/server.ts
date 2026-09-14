import { createServer } from "node:http";
import { config } from "./config.js";
import { handleRequest } from "./routes/chat.js";

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(config.port, config.host, () => {
  console.log(`LLM chat service listening on http://${config.host}:${config.port}`);
});
