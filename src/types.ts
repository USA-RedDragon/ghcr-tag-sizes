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

export type MessageListener = (
  message: GetSizeMessage,
  sender: unknown,
  sendResponse: (response: SizeResult) => void
) => boolean | void;

export interface ExtApi {
  runtime: {
    sendMessage(message: GetSizeMessage): Promise<SizeResult>;
    onMessage: { addListener(listener: MessageListener): void };
  };
}
