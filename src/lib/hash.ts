import { type Hash, createHash } from 'node:crypto';

export class Sha256Stream {
  private readonly hasher: Hash;
  private bytes = 0;
  private finalized = false;

  constructor() {
    this.hasher = createHash('sha256');
  }

  update(chunk: Uint8Array): void {
    if (this.finalized) {
      throw new Error('Sha256Stream: update after digest');
    }
    this.hasher.update(chunk);
    this.bytes += chunk.byteLength;
  }

  digest(): { sha256: string; bytes: number } {
    if (this.finalized) {
      throw new Error('Sha256Stream: digest called twice');
    }
    this.finalized = true;
    return { sha256: this.hasher.digest('hex'), bytes: this.bytes };
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  const h = createHash('sha256');
  h.update(data);
  return h.digest('hex');
}
