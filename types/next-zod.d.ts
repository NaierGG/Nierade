declare module "next/dist/compiled/zod" {
  export const z: any;
  export class ZodError extends Error {
    flatten(): unknown;
  }
}
