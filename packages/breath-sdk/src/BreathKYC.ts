type EventType = "complete" | "error" | "step";

interface BreathKYCOptions {
  apiKey: string;
  baseUrl?: string;
  theme?: "light" | "dark";
  language?: "pt" | "en";
  containerId?: string;
}

interface VerificationResult {
  sessionId: string;
  status: "PASSED" | "FAILED";
  overallScore: number;
}

type EventCallback = (data: unknown) => void;

export class BreathKYC {
  private readonly options: Required<BreathKYCOptions>;
  private iframe: HTMLIFrameElement | null = null;
  private listeners = new Map<EventType, Set<EventCallback>>();

  constructor(options: BreathKYCOptions) {
    this.options = {
      baseUrl: "https://verify.breath.id",
      theme: "dark",
      language: "pt",
      containerId: "breathkyc-container",
      ...options,
    };

    this.handleMessage = this.handleMessage.bind(this);
  }

  open(): void {
    if (this.iframe) return;

    const container =
      document.getElementById(this.options.containerId) ?? document.body;

    this.iframe = document.createElement("iframe");
    this.iframe.src = `${this.options.baseUrl}/verify?apiKey=${this.options.apiKey}&theme=${this.options.theme}&lang=${this.options.language}`;
    this.iframe.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:999999;background:rgba(0,0,0,0.8);";
    this.iframe.allow = "camera;microphone;geolocation";

    container.appendChild(this.iframe);
    window.addEventListener("message", this.handleMessage);
  }

  close(): void {
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    window.removeEventListener("message", this.handleMessage);
  }

  on(event: EventType, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: EventType, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  private handleMessage(event: MessageEvent): void {
    if (!event.data?.type?.startsWith("breathkyc:")) return;

    const eventType = event.data.type.replace("breathkyc:", "") as EventType;
    const callbacks = this.listeners.get(eventType);

    if (callbacks) {
      for (const cb of callbacks) {
        cb(event.data.payload);
      }
    }

    if (eventType === "complete" || eventType === "error") {
      this.close();
    }
  }
}
