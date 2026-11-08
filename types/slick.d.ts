// Types for the parts of Slick's plugin API these plugins use, written from
// Slick's src/shared/Plugin.ts, src/shared/settings.ts and src/app/pluginManager.ts.
// It's a subset: add to it when a plugin needs more. Anything missing is reachable
// through `api.raw` without a type error.

declare module '$slick' {
  export type Setting =
    | { type: 'boolean'; label: string; description?: string; default: boolean; restartRequired?: boolean }
    | { type: 'number'; label: string; description?: string; default: number; min?: number; max?: number; restartRequired?: boolean }
    | { type: 'text' | 'color' | 'file'; label: string; description?: string; default: string; maxLength?: number; accept?: string; restartRequired?: boolean }
    | { type: 'select'; label: string; description?: string; default: string; options: { value: string; label: string }[]; restartRequired?: boolean };

  /** Where a plugin is listed in Preferences, from Slick's PLUGIN_CATEGORIES. */
  export type PluginCategory =
    | 'messages'
    | 'composer'
    | 'people'
    | 'channels'
    | 'sounds'
    | 'privacy'
    | 'appearance'
    | 'app'
    | 'hackclub';

  export type SettingsSchema = Record<string, Setting>;

  /** What a schema's settings read as on `this.config`. */
  export type ConfigOf<S extends SettingsSchema> = {
    [K in keyof S]: S[K] extends { type: 'boolean' } ? boolean : S[K] extends { type: 'number' } ? number : string;
  } & { enabled: boolean };

  export interface Store<T> {
    get(): T;
    set(value: T): void;
    update(fn: (value: T) => T): void;
    /** React hook: re-renders the component when the value changes. */
    use(): T;
  }

  export interface Cache<T> {
    get(key: string, fetcher: (key: string) => Promise<T>): Promise<T>;
    /** What's already known, without fetching. Safe during a render. */
    peek(key: string): T | undefined;
  }

  export interface SlickAPI {
    /** Aborts after the plugin stops. Use it to cancel timers and requests. */
    signal: AbortSignal;
    loader: 'electron' | 'extension' | 'userscript';
    patchComponent<P = any>(
      name: string | { filter: (component: any) => boolean },
      replace: (Original: React.ComponentType<P>) => React.ComponentType<P>,
    ): void;
    setStyle(css: string): void;
    onDocument(callback: (doc: Document) => void): () => void;
    /** Cross-origin request through the desktop app. Text body only. */
    fetch(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<{ status: number; body: string }>;
    /** Calls the Slack Web API as you. */
    userAPI<T = any>(method: string, params?: Record<string, string | Blob>, options?: { signal?: AbortSignal }): Promise<{ ok: true } & T>;
    Store: new <T>(initial: T) => Store<T>;
    Cache<T>(name: string, ttlMs?: number | ((value: T) => number), maxEntries?: number): Cache<T>;
    storage: {
      get<T>(key: string, fallback: T): Promise<T>;
      set(key: string, value: unknown): Promise<boolean>;
      delete(key: string): Promise<boolean>;
    };
    settings: { set(key: string, value: unknown): Promise<void> };
    /** Everything else Slick offers, untyped. */
    [key: string]: any;
  }

  export abstract class SlickPlugin<Schema extends SettingsSchema = SettingsSchema> {
    static readonly id: string;
    static readonly pluginName: string;
    static readonly description: string;
    static readonly category?: PluginCategory;
    static readonly authors: string;
    static readonly defaultEnabled: boolean;
    static readonly settings: SettingsSchema;
    static readonly requiredAPIs: readonly string[];
    static readonly liveSettings: readonly string[];
    static readonly relaunchSettings: readonly string[];

    constructor(api: SlickAPI, config: ConfigOf<Schema>);
    protected api: SlickAPI;
    protected config: ConfigOf<Schema>;

    abstract start(): void | Promise<void>;
    stop(): void | Promise<void>;
    onSettingsChange(changed: string[]): void | Promise<void>;
    protected log: (...args: unknown[]) => void;
  }
}
