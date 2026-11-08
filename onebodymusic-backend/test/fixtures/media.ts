export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64');
export const JPEG = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255, 217]);
export const WEBP = Buffer.from('524946461a000000574542505650384c0d0000002f00000010071011118888fe0700', 'hex');
export function mp3(): Buffer {
  const frame = Buffer.alloc(417); frame.set([255, 251, 144, 100]); return Buffer.concat([frame, frame]);
}
function box(type: string, payload: Buffer): Buffer { const header = Buffer.alloc(8); header.writeUInt32BE(8 + payload.length); header.write(type, 4); return Buffer.concat([header, payload]); }
export function m4a(handler = 'soun'): Buffer {
  const ftyp = box('ftyp', Buffer.from('M4A \0\0\0\0M4A isommp42', 'binary'));
  const hdlr = box('hdlr', Buffer.concat([Buffer.alloc(8), Buffer.from(handler), Buffer.alloc(12)]));
  return Buffer.concat([ftyp, box('moov', box('trak', box('mdia', hdlr))), box('mdat', Buffer.alloc(16))]);
}
export function uploaded(buffer: Buffer, name = 'cover.png', mimetype = 'image/png'): Express.Multer.File {
  return { fieldname: 'file', originalname: name, encoding: '7bit', mimetype, size: buffer.length, buffer } as Express.Multer.File;
}
