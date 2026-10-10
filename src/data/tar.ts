/**
 * A minimal reader for (gzipped) POSIX/ustar tarballs: enough to unpack a GitHub codeload
 * archive in memory without shelling out to tar, so imports behave the same on every platform.
 */
export interface TarEntry {
  path: string
  data: Uint8Array
}

const decoder = new TextDecoder()

function field(block: Uint8Array, start: number, length: number): string {
  const raw = block.subarray(start, start + length)
  const end = raw.indexOf(0)
  return decoder.decode(end === -1 ? raw : raw.subarray(0, end)).trim()
}

export function* readTar(input: Uint8Array): Generator<TarEntry> {
  const bytes = input[0] === 0x1f && input[1] === 0x8b ? Bun.gunzipSync(input as Uint8Array<ArrayBuffer>) : input
  let offset = 0
  let longName: string | undefined
  // pax extended headers can carry a long path too
  let paxPath: string | undefined
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) break
    const name = field(header, 0, 100)
    const size = parseInt(field(header, 124, 12) || "0", 8)
    const type = String.fromCharCode(header[156] || 48)
    const prefix = field(header, 345, 155)
    const dataStart = offset + 512
    const data = bytes.subarray(dataStart, dataStart + size)
    offset = dataStart + Math.ceil(size / 512) * 512

    if (type === "L") {
      longName = decoder.decode(data).replace(/\0+$/, "")
      continue
    }
    if (type === "x") {
      const m = /\d+ path=([^\n]+)\n/.exec(decoder.decode(data))
      paxPath = m?.[1]
      continue
    }
    if (type === "g") continue
    const path = paxPath ?? longName ?? (prefix ? `${prefix}/${name}` : name)
    longName = undefined
    paxPath = undefined
    if (type === "0" || type === "\0") yield { path, data }
  }
}
