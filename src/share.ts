import { randomId } from "./crypto";

export type ShareClaims = {
  sid: string; // share_links row id
  fid: string; // drive file id
  exp?: number; // unix seconds
};

export function newShareId(): string {
  return randomId(9);
}

export function isShareExpired(claims: ShareClaims): boolean {
  return typeof claims.exp === "number" && Date.now() / 1000 > claims.exp;
}