export type ConfigOptions = {
    PORT: number;
};

export type WebSocketMessage = {
    from: string;
    to: string;
    type: "register" | "offer" | "answer" | "candidate";
    sdp?: RTCSessionDescriptionInit;
    iceCandidates?: RTCIceCandidateInit;
};
