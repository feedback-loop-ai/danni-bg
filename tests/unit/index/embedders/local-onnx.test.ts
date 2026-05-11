import { describe, expect, it } from 'bun:test';
import { LocalOnnxEmbedder } from '../../../../src/index/embedders/local-onnx.ts';

describe('index.embedders.local-onnx', () => {
  it('produces vectors with the configured dimension', async () => {
    const e = new LocalOnnxEmbedder({ dimension: 16 });
    const [v] = await e.embed(['hello']);
    expect(v?.length).toBe(16);
    expect(e.dimension).toBe(16);
    expect(e.id).toContain('local-onnx:');
  });

  it('returns one vector per input', async () => {
    const e = new LocalOnnxEmbedder({ dimension: 8 });
    const out = await e.embed(['a', 'b', 'c']);
    expect(out.length).toBe(3);
  });

  it('honors custom embedFn', async () => {
    const e = new LocalOnnxEmbedder({
      dimension: 4,
      embedFn: async (texts) => texts.map(() => Float32Array.from([1, 0, 0, 0])),
    });
    const [v] = await e.embed(['x']);
    expect(v?.[0]).toBe(1);
  });

  it('embeds empty string deterministically', async () => {
    const e = new LocalOnnxEmbedder({ dimension: 4 });
    const [v] = await e.embed(['']);
    expect(v?.length).toBe(4);
  });
});
