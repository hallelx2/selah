// One way to download a file for every installer: the Bible texts, Henry, the Hebrew and Greek,
// and Doré's plates. Public sources are sometimes slow and sometimes fail for a moment (Project
// Gutenberg answered 504 after 70s, then 200 twice, on 2026-10-11), so a failure that can pass is
// retried with growing pauses before anyone is told. A failure that cannot pass, such as a 404,
// is reported at once. Silence is what times out, never a slow but steady download.

export interface DownloadOptions {
  /** Says what is being fetched, for the message if it fails: "plate 001", "the KJV". */
  label: string
  fetcher?: typeof fetch
  /** Attempts in all, the first included. */
  attempts?: number
  /** The pause before each retry, in ms; the last is reused if there are more retries. */
  delays?: number[]
  /** Give up on an attempt when no bytes have arrived for this long. */
  idleMs?: number
  /** Bytes so far and the total when the server says it. Restarts from zero on a retry. */
  onProgress?: (received: number, total: number | undefined) => void
  /** Throws when the bytes are wrong (size, checksum); the attempt is retried like any other. */
  verify?: (data: Uint8Array) => void
  sleep?: (ms: number) => Promise<void>
}

/** A download that failed for good; its message is a sentence a reader can act on. */
export class DownloadError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "DownloadError"
  }
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524])
const REASON: Record<number, string> = {
  404: "it is not there (HTTP 404)",
  408: "the request timed out (HTTP 408)",
  429: "the server asked us to slow down (HTTP 429)",
  500: "the server had an error (HTTP 500)",
  502: "the server's gateway failed (HTTP 502)",
  503: "the server is busy (HTTP 503)",
  504: "the server timed out (HTTP 504)",
}
const reason = (status: number) => REASON[status] ?? `the server answered HTTP ${status}`

export async function download(url: string, opts: DownloadOptions): Promise<Uint8Array> {
  const { label, fetcher = fetch, attempts = 4, delays = [2_000, 6_000, 15_000], idleMs = 60_000, onProgress, verify } = opts
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const host = new URL(url).host
  let last = ""
  // a server that says when to come back (Retry-After) is believed, up to a minute
  let retryAfter: number | undefined
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(retryAfter ?? delays[Math.min(attempt - 2, delays.length - 1)] ?? 0)
    retryAfter = undefined
    const abort = new AbortController()
    let idle: ReturnType<typeof setTimeout> | undefined
    let silent = false
    let reader: { cancel(): Promise<void> } | undefined
    const arm = () => {
      clearTimeout(idle)
      idle = setTimeout(() => {
        silent = true
        abort.abort()
        // aborting the request does not always end a body already streaming: end the read too
        reader?.cancel().catch(() => {})
      }, idleMs)
    }
    try {
      arm()
      const res = await fetcher(url, { signal: abort.signal })
      if (!res.ok) {
        // drain nothing more from a failed answer; its body is an error page
        res.body?.cancel().catch(() => {})
        if (!RETRYABLE.has(res.status)) throw new DownloadError(`Could not download ${label} from ${host}: ${reason(res.status)}.`, res.status)
        last = reason(res.status)
        const after = Number(res.headers.get("retry-after"))
        if (Number.isFinite(after) && after > 0) retryAfter = Math.min(after * 1000, 60_000)
        continue
      }
      // Content-Length counts the bytes as sent; fetch hands back a gzip body decompressed, so
      // for an encoded answer it is no total at all (KJV: 1,458,623 sent, 8,400,187 read)
      const encoding = res.headers.get("content-encoding")
      const total = !encoding || encoding === "identity" ? Number(res.headers.get("content-length")) || undefined : undefined
      const chunks: Uint8Array[] = []
      let received = 0
      onProgress?.(0, total)
      if (res.body) {
        const body = res.body.getReader()
        reader = body
        for (;;) {
          const { done, value } = await body.read()
          if (done) break
          arm()
          chunks.push(value)
          received += value.length
          onProgress?.(received, total)
        }
      }
      // a read ended by silence is a failed attempt, whatever arrived before it
      if (silent) throw new Error("silent")
      const data = chunks.length === 1 ? chunks[0]! : new Uint8Array(Buffer.concat(chunks))
      if (total !== undefined && data.length !== total) {
        last = `the transfer stopped at ${received} of ${total} bytes`
        continue
      }
      try {
        verify?.(data)
      } catch (e) {
        last = (e as Error).message
        continue
      }
      return data
    } catch (e) {
      if (e instanceof DownloadError) throw e
      last = silent ? `nothing arrived for ${Math.round(idleMs / 1000)}s` : `the connection failed (${(e as Error).message})`
    } finally {
      clearTimeout(idle)
    }
  }
  throw new DownloadError(`Could not download ${label} from ${host}: ${last}. Tried ${attempts === 1 ? "once" : `${attempts} times`}.`)
}
