/**
 * Minimal, defensive ZIP reader for OOXML (DOCX / XLSX / PPTX).
 *
 * Used by the upload preflight (bomb checks before any third-party parser sees
 * the bytes) and by the PPTX text extractor. It reads the central directory,
 * never trusts declared sizes on their own (inflation is capped by them and
 * verified), and supports only what Office writes: stored (0) and deflate (8)
 * entries, no encryption, no ZIP64, no multi-disk archives.
 */
import { constants as zlibConstants, inflateRawSync } from 'node:zlib'

export class ZipFormatError extends Error {
  constructor(
    readonly code: 'ZIP_INVALID' | 'ZIP_ENCRYPTED' | 'ZIP64' | 'ZIP_METHOD' | 'ZIP_SIZE_MISMATCH' | 'ZIP_PATH',
    message: string,
  ) {
    super(message)
    this.name = 'ZipFormatError'
  }
}

export interface ZipEntry {
  name: string
  method: number
  flags: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

export function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === SIG_LOCAL
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const lowerBound = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === SIG_EOCD) return offset
  }
  return -1
}

/** Parse the central directory. Throws ZipFormatError on anything unusual. */
export function readZipEntries(buffer: Buffer, maxEntries = 5_000): ZipEntry[] {
  if (buffer.length < 22 || !isZip(buffer)) throw new ZipFormatError('ZIP_INVALID', 'not a ZIP archive')
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) throw new ZipFormatError('ZIP_INVALID', 'end of central directory not found')
  const disk = buffer.readUInt16LE(eocd + 4)
  const cdDisk = buffer.readUInt16LE(eocd + 6)
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8)
  const entries = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ZipFormatError('ZIP64', 'ZIP64 archives are not supported')
  }
  if (disk !== 0 || cdDisk !== 0 || entriesOnDisk !== entries) {
    throw new ZipFormatError('ZIP_INVALID', 'multi-disk archives are not supported')
  }
  if (entries === 0) throw new ZipFormatError('ZIP_INVALID', 'empty archive')
  if (entries > maxEntries) throw new ZipFormatError('ZIP_INVALID', `too many entries (${entries})`)
  if (centralOffset + centralSize > eocd) throw new ZipFormatError('ZIP_INVALID', 'central directory out of bounds')

  const out: ZipEntry[] = []
  const seen = new Set<string>()
  let pointer = centralOffset
  for (let i = 0; i < entries; i += 1) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== SIG_CENTRAL) {
      throw new ZipFormatError('ZIP_INVALID', 'corrupt central directory')
    }
    const flags = buffer.readUInt16LE(pointer + 8)
    const method = buffer.readUInt16LE(pointer + 10)
    const compressedSize = buffer.readUInt32LE(pointer + 20)
    const uncompressedSize = buffer.readUInt32LE(pointer + 24)
    const nameLength = buffer.readUInt16LE(pointer + 28)
    const extraLength = buffer.readUInt16LE(pointer + 30)
    const commentLength = buffer.readUInt16LE(pointer + 32)
    const localHeaderOffset = buffer.readUInt32LE(pointer + 42)
    const next = pointer + 46 + nameLength + extraLength + commentLength
    if (next > buffer.length) throw new ZipFormatError('ZIP_INVALID', 'entry outside the archive')
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new ZipFormatError('ZIP64', 'ZIP64 entries are not supported')
    }
    if ((flags & 0x1) !== 0) throw new ZipFormatError('ZIP_ENCRYPTED', 'encrypted entry')
    if (method !== 0 && method !== 8) throw new ZipFormatError('ZIP_METHOD', `compression method ${method}`)
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8')
    if (!name || name.includes('\u0000') || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) {
      throw new ZipFormatError('ZIP_PATH', 'unsafe entry path')
    }
    if (seen.has(name)) throw new ZipFormatError('ZIP_INVALID', 'duplicate entry name')
    seen.add(name)
    if (localHeaderOffset + 30 > buffer.length) throw new ZipFormatError('ZIP_INVALID', 'local header out of bounds')
    out.push({ name, method, flags, compressedSize, uncompressedSize, localHeaderOffset })
    pointer = next
  }
  return out
}

function dataRange(buffer: Buffer, entry: ZipEntry): { start: number; end: number } {
  const p = entry.localHeaderOffset
  if (buffer.readUInt32LE(p) !== SIG_LOCAL) throw new ZipFormatError('ZIP_INVALID', 'bad local header')
  const nameLength = buffer.readUInt16LE(p + 26)
  const extraLength = buffer.readUInt16LE(p + 28)
  const start = p + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > buffer.length) throw new ZipFormatError('ZIP_INVALID', 'entry data out of bounds')
  return { start, end }
}

/**
 * Inflate one entry. The output may never exceed the declared uncompressed
 * size (a lying central directory is the classic way to smuggle a bomb past a
 * size check) and must match it exactly.
 */
export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const { start, end } = dataRange(buffer, entry)
  const raw = buffer.subarray(start, end)
  if (entry.method === 0) {
    if (raw.length !== entry.uncompressedSize) throw new ZipFormatError('ZIP_SIZE_MISMATCH', 'stored size mismatch')
    return Buffer.from(raw)
  }
  let out: Buffer
  try {
    out = inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.uncompressedSize + 1) })
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) {
      throw new ZipFormatError('ZIP_SIZE_MISMATCH', 'entry inflates past its declared size')
    }
    throw new ZipFormatError('ZIP_INVALID', 'corrupt deflate stream')
  }
  if (out.length !== entry.uncompressedSize) throw new ZipFormatError('ZIP_SIZE_MISMATCH', 'inflated size mismatch')
  return out
}

/**
 * First bytes of an entry without inflating all of it (enough to inspect an
 * XML prolog). Bounded by `maxInput` compressed bytes.
 */
export function peekZipEntry(buffer: Buffer, entry: ZipEntry, maxInput = 16_384, maxOutput = 8_192): Buffer {
  const { start, end } = dataRange(buffer, entry)
  const raw = buffer.subarray(start, Math.min(end, start + maxInput))
  if (entry.method === 0) return Buffer.from(raw.subarray(0, maxOutput))
  try {
    const out = inflateRawSync(raw, { finishFlush: zlibConstants.Z_SYNC_FLUSH })
    return out.subarray(0, maxOutput)
  } catch {
    throw new ZipFormatError('ZIP_INVALID', 'corrupt deflate stream')
  }
}
