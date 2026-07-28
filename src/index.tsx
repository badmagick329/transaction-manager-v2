import { startApp } from "./main";

const server = await startApp();

console.log(`Server running at ${server.url}`);
