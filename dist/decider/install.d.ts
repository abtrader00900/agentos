export declare const RELEASE_URL = "https://github.com/feder-cr/jev/releases/download/jevos-v2";
export declare const MODEL_ASSET = "jevos-v2-openvino-int8.zip";
export type Download = (url: string, file: string) => Promise<void>;
export type Unpack = (archive: string, dest: string) => void;
export declare function binaryAsset(platform?: string, arch?: string): string;
/** "<sha256>  <name>" lines (a "*" before the name marks binary mode) */
export declare function parseSums(text: string): Map<string, string>;
export declare const isInstalled: (home?: string) => boolean;
export declare function installDecider(opts: {
    home?: string;
    platform?: string;
    arch?: string;
    force?: boolean;
    confirm: (question: string) => Promise<boolean>;
    download?: Download;
    unpack?: Unpack;
    log?: (line: string) => void;
}): Promise<"installed" | "already" | "declined">;
