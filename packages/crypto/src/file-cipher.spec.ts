import { decryptFile, encryptFile, FileDecryptError } from "./file-cipher";

describe("encryptFile / decryptFile", () => {
  it("CR-01: round-trips a 1 KB payload", () => {
    const plaintext = Buffer.from("x".repeat(1024));
    const { blob, kFile } = encryptFile(plaintext);
    expect(Buffer.from(decryptFile(blob, kFile))).toEqual(plaintext);
  });

  it("CR-13: round-trips a 1-byte payload", () => {
    const plaintext = Buffer.from([0x42]);
    const { blob, kFile } = encryptFile(plaintext);
    expect(Buffer.from(decryptFile(blob, kFile))).toEqual(plaintext);
  });

  it("CR-07: flipping one bit in the ciphertext fails decryption", () => {
    const plaintext = Buffer.from("secret patient data");
    const { blob, kFile } = encryptFile(plaintext);
    const tampered = Buffer.from(blob);
    tampered[20] = tampered[20]! ^ 0x01;
    expect(() => decryptFile(tampered, kFile)).toThrow(FileDecryptError);
  });

  it("CR-14: encrypting the same file twice yields different nonce, key and ciphertext", () => {
    const plaintext = Buffer.from("same file, twice");
    const a = encryptFile(plaintext);
    const b = encryptFile(plaintext);
    expect(a.kFile).not.toEqual(b.kFile);
    expect(a.blob.subarray(0, 12)).not.toEqual(b.blob.subarray(0, 12));
    expect(a.blob).not.toEqual(b.blob);
  });

  it("CR-15: 10,000 encryptions never repeat a nonce", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const { blob } = encryptFile(Buffer.from(`row-${i}`));
      const nonce = Buffer.from(blob.subarray(0, 12)).toString("hex");
      expect(seen.has(nonce)).toBe(false);
      seen.add(nonce);
    }
  });

  it("CR-12: rejects an empty file before generating a key", () => {
    expect(() => encryptFile(Buffer.alloc(0))).toThrow(RangeError);
  });

  it("rejects a wrong key with FileDecryptError, not a silent garbage result", () => {
    const plaintext = Buffer.from("secret");
    const { blob } = encryptFile(plaintext);
    const wrongKey = Buffer.alloc(32, 7);
    expect(() => decryptFile(blob, wrongKey)).toThrow(FileDecryptError);
  });
});
