import { Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { WebSocketMessage } from "./types/types";

export class WebSocketManager {
    private Users: Map<string, WebSocket> = new Map();
    private static instance: WebSocketManager;
    private wss: WebSocketServer | null = null;

    public initialize(server: Server) {
        if (this.wss) {
            console.log("WebSocket server already initialized");
            return;
        }
        try {
            this.wss = new WebSocketServer({ server });
            this.setupEventHandlers();
            console.log("WebSocket server initialized");
        } catch (err) {
            console.error("Error initializing WebSocket server:", err);
        }
    }

    public static getInstance() {
        if (!this.instance) {
            this.instance = new WebSocketManager();
        }
        return this.instance;
    }

    private setupEventHandlers() {
        if (!this.wss) {
            console.error("WebSocket server not initialized");
            return;
        }

        this.wss.on("connection", (ws) => {
            console.log("New WebSocket connection established");

            ws.on("message", (data) => {
                try {
                    const parsed = JSON.parse(String(data)) as WebSocketMessage;
                    if (!parsed.type || !parsed.from) {
                        console.error(
                            "Invalid WebSocket message format:",
                            parsed
                        );
                        return;
                    }
                    this.handleMessages(parsed, ws);
                } catch (err) {
                    console.error(
                        "Error parsing WebSocket message:",
                        err,
                        "Data:",
                        data
                    );
                }
            });

            ws.on("close", () => {
                // Remove user on disconnect
                for (const [userId, socket] of this.Users.entries()) {
                    if (socket === ws) {
                        this.Users.delete(userId);
                        console.log(`User ${userId} disconnected`);
                        break;
                    }
                }
            });

            ws.on("error", (err) => {
                console.error("WebSocket error:", err);
            });
        });
    }

    private handleMessages(data: WebSocketMessage, ws: WebSocket) {
        console.log("Handling message:", data.type, "from:", data.from);
        switch (data.type) {
            case "register":
                if (this.Users.has(data.from)) {
                    console.log(
                        `User ${data.from} already registered, updating socket`
                    );
                }
                this.Users.set(data.from, ws);
                console.log(`User ${data.from} registered`);
                break;
            case "answer":
            case "candidate":
            case "offer":
                const receiver = this.Users.get(data.to);
                if (!receiver) {
                    console.error(`Receiver ${data.to} not found`);
                    return;
                }
                if (receiver.readyState === WebSocket.OPEN) {
                    receiver.send(JSON.stringify(data));
                    console.log(`Sent ${data.type} to ${data.to}`);
                } else {
                    console.error(`Receiver ${data.to} WebSocket is not open`);
                }
                break;
            default:
                console.error("Unknown message type:", data.type);
        }
    }

    public getUsers() {
        return this.Users;
    }
}
