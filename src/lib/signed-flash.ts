import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getAuthSecret } from "@/config/env";

const FLASH_TTL_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;

type FlashKind = "notice" | "error";

export type FlashSearchParams = {
  notice?: string | string[];
  error?: string | string[];
  flashAt?: string | string[];
  flashSig?: string | string[];
};

function signaturePayload(
  pathname: string,
  kind: FlashKind,
  message: string,
  timestamp: string,
) {
  return `${pathname}\n${kind}\n${timestamp}\n${message}`;
}

function sign(
  pathname: string,
  kind: FlashKind,
  message: string,
  timestamp: string,
) {
  return createHmac("sha256", getAuthSecret())
    .update(signaturePayload(pathname, kind, message, timestamp))
    .digest("hex");
}

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function equalSignature(expected: string, actual: string) {
  if (!/^[a-f0-9]{64}$/i.test(actual)) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export function signedFlashPath(
  path: string,
  kind: FlashKind,
  message: string,
  now = Date.now(),
) {
  const url = new URL(path, "http://anella.internal");
  const normalizedMessage = message.trim().slice(0, 1_000);
  const timestamp = String(now);
  url.searchParams.delete("notice");
  url.searchParams.delete("error");
  url.searchParams.set(kind, normalizedMessage);
  url.searchParams.set("flashAt", timestamp);
  url.searchParams.set(
    "flashSig",
    sign(url.pathname, kind, normalizedMessage, timestamp),
  );
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readSignedFlash(
  query: FlashSearchParams,
  pathname: string,
  now = Date.now(),
) {
  const notice = one(query.notice);
  const error = one(query.error);
  const timestamp = one(query.flashAt);
  const actualSignature = one(query.flashSig);
  const kind: FlashKind | undefined =
    notice && !error ? "notice" : error && !notice ? "error" : undefined;
  const message =
    kind === "notice" ? notice : kind === "error" ? error : undefined;

  if (!kind || !message || !timestamp || !actualSignature) {
    return { notice: undefined, error: undefined };
  }
  if (message.length > 1_000 || !/^\d{13}$/.test(timestamp)) {
    return { notice: undefined, error: undefined };
  }
  const issuedAt = Number(timestamp);
  const age = now - issuedAt;
  if (age < -MAX_CLOCK_SKEW_MS || age > FLASH_TTL_MS) {
    return { notice: undefined, error: undefined };
  }
  const expectedSignature = sign(pathname, kind, message, timestamp);
  if (!equalSignature(expectedSignature, actualSignature)) {
    return { notice: undefined, error: undefined };
  }

  return kind === "notice"
    ? { notice: message, error: undefined }
    : { notice: undefined, error: message };
}
