export type ConfigOptions = {
    PORT: number;
};

export interface WebSocketMessage {
    type:
        | "register"
        | "offer"
        | "answer"
        | "candidate"
        | "initiate_call"
        | "accept_call"
        | "decline_call"
        | "error";
    from: string;
    to: string;
    sdp?: any;
    candidate?: any;
    callId?: string;
    message?: string;
}
