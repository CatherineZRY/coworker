export type NotifyKind = "success" | "error" | "info";

export type Notify = (kind: NotifyKind, message: string) => void;
