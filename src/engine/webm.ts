interface Element {
  id: number;
  start: number;
  data: number;
  end: number;
  sizeOffset: number;
  sizeLength: number;
  unknown: boolean;
}
function elements(bytes: Uint8Array, start: number, end: number): Element[] {
  const result: Element[] = [];
  let offset = start;
  while (offset < end) {
    const beginning = offset;
    let count = 1,
      marker = 128;
    while (count <= 4 && !(bytes[offset] & marker)) {
      count++;
      marker >>= 1;
    }
    if (count > 4 || offset + count >= end) throw new Error('Invalid WebM element.');
    let id = 0;
    for (let i = 0; i < count; i++) id = id * 256 + bytes[offset++];
    const sizeOffset = offset;
    count = 1;
    marker = 128;
    while (count <= 8 && !(bytes[offset] & marker)) {
      count++;
      marker >>= 1;
    }
    if (count > 8 || offset + count > end) throw new Error('Invalid WebM element size.');
    let size = bytes[offset++] & (marker - 1);
    let unknown = size === marker - 1;
    for (let i = 1; i < count; i++) {
      const n = bytes[offset++];
      unknown &&= n === 255;
      size = size * 256 + n;
    }
    const finish = unknown ? end : offset + size;
    if (finish > end || finish < offset) throw new Error('Incomplete WebM data.');
    result.push({
      id,
      start: beginning,
      data: offset,
      end: finish,
      sizeOffset,
      sizeLength: count,
      unknown,
    });
    offset = finish;
  }
  return result;
}
function encodeSize(value: number, length = 1): Uint8Array {
  while (value >= 2 ** (length * 7) - 1) length++;
  if (length > 8) throw new Error('WebM is too large.');
  const bytes = new Uint8Array(length);
  let n = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = n % 256;
    n = Math.floor(n / 256);
  }
  bytes[0] |= 2 ** (8 - length);
  return bytes;
}
/** Chrome's MediaRecorder writes a live WebM header without Duration. Add it to
 * Info while preserving every encoded frame and the existing TimestampScale. */
export function completeRecordedWebm(buffer: ArrayBuffer, milliseconds: number): ArrayBuffer {
  const bytes = new Uint8Array(buffer);
  const segment = elements(bytes, 0, bytes.length).find((e) => e.id === 0x18538067);
  if (!segment) throw new Error('Missing WebM segment.');
  const children = elements(bytes, segment.data, segment.end);
  const info = children.find((e) => e.id === 0x1549a966);
  if (!info) throw new Error('Missing WebM information.');
  const details = elements(bytes, info.data, info.end);
  const scaleElement = details.find((e) => e.id === 0x2ad7b1);
  let scale = 1_000_000;
  if (scaleElement) {
    scale = 0;
    for (let i = scaleElement.data; i < scaleElement.end; i++) scale = scale * 256 + bytes[i];
  }
  const durationValue = (milliseconds * 1_000_000) / scale;
  const duration = details.find((e) => e.id === 0x4489);
  if (duration) {
    const copy = buffer.slice(0);
    const view = new DataView(copy);
    if (duration.end - duration.data === 8) view.setFloat64(duration.data, durationValue);
    else if (duration.end - duration.data === 4) view.setFloat32(duration.data, durationValue);
    else throw new Error('Unsupported WebM duration field.');
    return copy;
  }
  // Seek tables contain byte offsets. Never invalidate a pre-indexed container.
  // Such containers can already determine duration from their cues during playback.
  if (children.some((e) => e.id === 0x114d9b74 || e.id === 0x1c53bb6b)) return buffer;
  const durationBytes = new Uint8Array(11);
  durationBytes.set([0x44, 0x89, 0x88]);
  new DataView(durationBytes.buffer).setFloat64(3, durationValue);
  const infoSize = encodeSize(info.end - info.data + durationBytes.length, info.sizeLength);
  const delta = durationBytes.length + infoSize.length - info.sizeLength;
  const segmentSize = segment.unknown
    ? bytes.slice(segment.sizeOffset, segment.data)
    : encodeSize(segment.end - segment.data + delta, segment.sizeLength);
  const pieces = [
    bytes.slice(0, segment.sizeOffset),
    segmentSize,
    bytes.slice(segment.data, info.sizeOffset),
    infoSize,
    bytes.slice(info.data, info.end),
    durationBytes,
    bytes.slice(info.end),
  ];
  const result = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const piece of pieces) {
    result.set(piece, offset);
    offset += piece.length;
  }
  return result.buffer;
}
