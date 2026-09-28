import { describe, it, expect } from 'vitest';
import { completeRecordedWebm } from '../src/engine/webm';
describe('MediaRecorder container finalization', () => {
  it('inserts a duration without changing encoded frame bytes', () => {
    const header = [
      0x18, 0x53, 0x80, 0x67, 0xff, 0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f,
      0x42, 0x40,
    ];
    const frame = [0x1f, 0x43, 0xb6, 0x75, 0x83, 0x11, 0x22, 0x33];
    const result = new Uint8Array(
      completeRecordedWebm(new Uint8Array([...header, ...frame]).buffer, 12000),
    );
    expect(result.length).toBe(header.length + frame.length + 11);
    expect(Array.from(result.slice(-8))).toEqual(frame);
    expect(new DataView(result.buffer).getFloat64(header.length + 3)).toBe(12000);
    expect(result[9]).toBe(0x92);
  });
  it('rejects incomplete data', () =>
    expect(() => completeRecordedWebm(new ArrayBuffer(2), 1000)).toThrow());
});
