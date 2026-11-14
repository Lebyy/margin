// The `ws` package has no types bundled, and the types package did not install.
// This is the slice Talk uses. A wider declaration would pretend we had checked the rest of the library.

declare module "ws" {
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";

  export class WebSocketServer {
    constructor(options: { noServer: true });
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, callback: (client: WebSocket) => void): void;
  }

  export class WebSocket {
    static readonly OPEN: number;
    readyState: number;
    send(data: string | Buffer): void;
    close(): void;
    on(event: "message", listener: (data: Buffer, isBinary: boolean) => void): void;
    on(event: "close", listener: () => void): void;
    on(event: "error", listener: (error: Error) => void): void;
  }
}
