import { Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { WebSocketMessage } from "./types/types";
import jwt from "jsonwebtoken";
import jwkToPem from "jwk-to-pem";
import { URL } from "url";

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
            this.wss = new WebSocketServer({
                server,
                verifyClient: async (info, cb) => {
                    // Extract token from query parameter
                    const url = new URL(
                        info.req.url || "",
                        `http://${info.req.headers.host}`
                    );
                    const authToken = url.searchParams.get("token");

                    if (!authToken) {
                        console.error("No token provided in query parameter");
                        cb(false, 401, "Unauthorized: No token provided");
                        return;
                    }

                    const user = await verifyUser(authToken);
                    if (!user || typeof user === "string" || !user.sub) {
                        console.error("Invalid or unverified token");
                        cb(false, 401, "Unauthorized: Invalid token");
                        return;
                    }

                    // Store user ID in the request object for later use
                    (info.req as any).userId = user.sub;
                    cb(true); // Allow connection
                },
            });
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

        this.wss.on("connection", (ws, req) => {
            // Get user ID from the request object
            const userId = (req as any).userId;
            if (!userId) {
                console.error("No user ID found in request");
                ws.close(1008, "Unauthorized");
                return;
            }

            console.log(
                `New WebSocket connection established for user: ${userId}`
            );
            this.Users.set(userId, ws);

            ws.on("message", (data) => {
                try {
                    const parsed = JSON.parse(
                        data.toString()
                    ) as WebSocketMessage;
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
                for (const [id, socket] of this.Users.entries()) {
                    if (socket === ws) {
                        this.Users.delete(id);
                        console.log(`User ${id} disconnected`);
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
        const convex_url = process.env.CONVEX_URL ? process.env.CONVEX_URL : "";
        const response = await fetch(convex_url, { cache: "no-store" });

        if (!response.ok) {
            throw new Error(`Failed to fetch JWKS: ${response.statusText}`);
        }

        const jwks = await response.json();
        if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
            throw new Error("Invalid JWKS response: No keys found");
        }

        const publicKey = jwkToPem(jwks.keys[0]);

        const user = jwt.verify(token, publicKey, {
            algorithms: ["RS256"],
        });

        return user;
    } catch (err) {
        console.error("Error verifying user:", err);
        return null;
    }
}
