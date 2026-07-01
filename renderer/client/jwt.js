function fromBase64Url(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return atob(normalized + pad);
}

export function decodeJwt(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const textDecoder = new TextDecoder();

  const headerBytes = Uint8Array.from(fromBase64Url(headerPart), (c) =>
    c.charCodeAt(0)
  );
  const payloadBytes = Uint8Array.from(fromBase64Url(payloadPart), (c) =>
    c.charCodeAt(0)
  );
  const signature = Uint8Array.from(fromBase64Url(signaturePart), (c) =>
    c.charCodeAt(0)
  );

  return {
    header: JSON.parse(textDecoder.decode(headerBytes)),
    payload: JSON.parse(textDecoder.decode(payloadBytes)),
    signature
  };
}

