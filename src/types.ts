export interface Platform {
  os?: string;
  architecture?: string;
  variant?: string;
}

export interface IndexEntry {
  digest: string;
  platform?: Platform;
}

export interface Layer {
  size?: number;
}

export interface Manifest {
  manifests?: IndexEntry[];
  layers?: Layer[];
  config?: { size?: number };
}

export interface Arch {
  label: string;
  bytes: number;
}

export interface SizeResult {
  arches?: Arch[];
  needsAuth?: boolean;
  error?: string;
}

export interface GetSizeMessage {
  type: "getSize";
  image: string;
  digest: string;
}

/** Start GitHub's OAuth device flow; answered with a {@link DeviceCode}. */
export interface SignInStartMessage {
  type: "signInStart";
}

/** Poll the device flow once; answered with a {@link SignInPoll}. */
export interface SignInPollMessage {
  type: "signInPoll";
  deviceCode: string;
}

export type Message = GetSizeMessage | SignInStartMessage | SignInPollMessage;

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds to wait between polls. */
  interval: number;
  /** Seconds until the code expires. */
  expiresIn: number;
}

export type SignInPoll =
  | { status: "pending"; interval: number }
  | { status: "done" }
  | { status: "failed"; error: string };

export type MessageListener = (
  message: Message,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean | void;

export interface ExtApi {
  runtime: {
    sendMessage(message: GetSizeMessage): Promise<SizeResult>;
    sendMessage(message: SignInStartMessage): Promise<DeviceCode | { error: string }>;
    sendMessage(message: SignInPollMessage): Promise<SignInPoll>;
    onMessage: { addListener(listener: MessageListener): void };
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}
