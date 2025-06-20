import express from "express";
import { createServer } from "http";
import CONFIG from "./configs/config";
import { WebSocketManager } from "./websocketManager";

const app = express();

const server = createServer(app);

WebSocketManager.getInstance().initialize(server);

app.get("/", (req, res) => {
    res.send("hello robot");
});

app.get("/users", (req, res) => {
    const users = WebSocketManager.getInstance().getUsers();
    const tempUsers: string[] = [];
    for (const key of users.keys()) {
        tempUsers.push(key);
    }
    res.json(tempUsers);
});

server.listen(CONFIG.PORT, () =>
    console.log(`Server started on PORT ${CONFIG.PORT}`)
);
