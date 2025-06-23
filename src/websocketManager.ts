import { Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { WebSocketMessage } from "./types/types";
import jwt from "jsonwebtoken";
import jwkToPem from "jwk-to-pem";

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

        this.wss.on("connection", async (ws, req) => {
            const authToken =
                req.headers["sec-websocket-protocol"]?.split(" ")[1];
            console.log(req.headers["sec-websocket-protocol"]);
            if (!authToken || !authToken[0]!! || !authToken[1]) {
                console.error("No or invalid Authorization header");
                ws.close(1008, "Unauthorized");
                return;
            }

            const isVerified = await verifyUser(authToken);
            console.log("is verified : ", isVerified);
            if (!isVerified) {
                console.error("No or invalid Authorization header");
                ws.close(1008, "Unauthorized");
                return;
            }

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
        console.log(
            "Handling message:",
            data.type,
            "from:",
            data.from,
            "to:",
            data.to
        );

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

            case "initiate_call":
                const recipientWs = this.Users.get(data.to);
                if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                    recipientWs.send(
                        JSON.stringify({
                            type: "initiate_call",
                            from: data.from,
                            callId: data.callId,
                            to: data.to,
                        })
                    );
                    console.log(
                        `Call initiated from ${data.from} to ${data.to}`
                    );
                } else {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Recipient not online",
                            callId: data.callId,
                            from: data.to,
                            to: data.from,
                        })
                    );
                    console.log(`Recipient ${data.to} not online`);
                }
                break;

            case "accept_call":
                const callerWs = this.Users.get(data.to);
                if (callerWs && callerWs.readyState === WebSocket.OPEN) {
                    callerWs.send(
                        JSON.stringify({
                            type: "call_accepted",
                            from: data.from,
                            callId: data.callId,
                            to: data.to,
                        })
                    );
                    console.log(
                        `Call accepted by ${data.from}, notified ${data.to}`
                    );
                } else {
                    console.error(
                        `Caller ${data.to} not found or connection closed`
                    );
                }
                break;

            case "decline_call":
                const declinedCallerWs = this.Users.get(data.to);
                if (
                    declinedCallerWs &&
                    declinedCallerWs.readyState === WebSocket.OPEN
                ) {
                    declinedCallerWs.send(
                        JSON.stringify({
                            type: "call_declined",
                            from: data.from,
                            callId: data.callId,
                            to: data.to,
                        })
                    );
                    console.log(
                        `Call declined by ${data.from}, notified ${data.to}`
                    );
                } else {
                    console.error(
                        `Caller ${data.to} not found or connection closed`
                    );
                }
                break;

            case "offer":
            case "answer":
            case "candidate":
                const receiver = this.Users.get(data.to);
                if (!receiver) {
                    console.error(`Receiver ${data.to} not found`);
                    return;
                }
                if (receiver.readyState === WebSocket.OPEN) {
                    receiver.send(JSON.stringify(data));
                    console.log(
                        `Sent ${data.type} from ${data.from} to ${data.to}`
                    );
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

async function verifyUser(token: string) {
    try {
        const response = await fetch(
            "https://precious-axolotl-250.convex.site/.well-known/jwks.json"
        );

        const JWKS = JSON.parse(await response.json());
        const publicKey = jwkToPem(JWKS.keys[0]);

        const user = jwt.verify(token, publicKey, {
            algorithms: ["RS256"],
        });
        return user;
    } catch (err) {
        console.log(err);
        return null;
    }
}
