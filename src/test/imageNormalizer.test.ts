import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PhotonImage } from "@silvia-odwyer/photon-node";
import { getImageDataUrlBase64Bytes, MAX_IMAGE_BASE64_BYTES, normalizeImageDataUrl } from "../imageNormalizer.js";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("normalizeImageDataUrl", () => {
  it("keeps a small image unchanged", async () => {
    const url = `data:image/png;base64,${ONE_PIXEL_PNG}`;
    assert.equal(await normalizeImageDataUrl(url), url);
  });

  it("resizes an image that exceeds the CLI dimension limit", async () => {
    const image = new PhotonImage(new Uint8Array(2_001 * 4).fill(255), 2_001, 1);
    try {
      const url = `data:image/png;base64,${Buffer.from(image.get_bytes()).toString("base64")}`;
      const normalized = await normalizeImageDataUrl(url);

      assert.notEqual(normalized, url);
      assert.match(normalized, /^data:image\/(png|jpeg);base64,/);
    } finally {
      image.free();
    }
  });

  it("does not reject a large raw image when its normalized base64 payload fits", async () => {
    const width = 750;
    const height = 1_000;
    const pixels = new Uint8Array(width * height * 4);
    let seed = 0x12345678;
    for (let index = 0; index < pixels.length; index += 1) {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      pixels[index] = seed >>> 24;
    }

    const image = new PhotonImage(pixels, width, height);
    try {
      const bytes = image.get_bytes();
      assert.ok(bytes.byteLength > 2_000_000);
      const url = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
      const normalized = await normalizeImageDataUrl(url);

      assert.equal(normalized, url);
      assert.ok(getImageDataUrlBase64Bytes(normalized)! <= MAX_IMAGE_BASE64_BYTES);
    } finally {
      image.free();
    }
  });

  it("passes non-data URLs through unchanged", async () => {
    const url = "https://example.com/image.png";
    assert.equal(await normalizeImageDataUrl(url), url);
  });

  it("passes malformed image data through unchanged", async () => {
    const url = "data:image/png;base64,not-an-image";
    assert.equal(await normalizeImageDataUrl(url), url);
  });
});
