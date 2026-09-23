// Tipos mínimos de Node para los guiones de playtest (el proyecto no instala @types/node).
declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exit(code?: number): never;
};

declare module 'node:fs' {
  const fs: {
    mkdirSync(path: string, opts?: { recursive?: boolean }): unknown;
    writeFileSync(path: string, data: string | Uint8Array): void;
    readFileSync(path: string, enc: string): string;
    existsSync(path: string): boolean;
  };
  export default fs;
}
