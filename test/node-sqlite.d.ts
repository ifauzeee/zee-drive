// Minimal ambient types for `node:sqlite` (repo has no @types/node).
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
  export class StatementSync {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
  }
}

// Vite asset queries used by the web bundle (vite/client is not in tsconfig
// types, so the ?raw and ?url imports the Plyr sprite needs are declared here).
declare module "*?raw" {
  const src: string;
  export default src;
}
declare module "*?url" {
  const src: string;
  export default src;
}
