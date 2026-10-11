// HAL-2656: one download for every installer, retrying what can pass and reporting what cannot.
import { describe, expect, test } from "bun:test"
import { download, DownloadError } from "../src/data/download"

const URL_ = "https://www.gutenberg.org/cache/epub/8710/images/001.jpg"
const bytes = new Uint8Array([1, 2, 3, 4, 5])
/** A server that answers each call with the next of `answers`. */
function server(answers: (() => Response | Promise<Response>)[]) {
  const calls: string[] = []
  const fetcher = (async (url: string) => {
    calls.push(String(url))
    const next = answers[Math.min(calls.length - 1, answers.length - 1)]!
    return next()
  }) as unknown as typeof fetch
  return { calls, fetcher }
}
const ok = () => new Response(bytes, { headers: { "content-length": "5" } })
const status = (s: number, headers?: Record<string, string>) => () => new Response("error page", { status: s, headers })

describe("download", () => {
  test("a 504 then a 200 gives the file (the founder's report, 2026-10-11)", async () => {
    const { calls, fetcher } = server([status(504), ok])
    const slept: number[] = []
    expect(await download(URL_, { label: "plate 001", fetcher, sleep: async (ms) => void slept.push(ms) })).toEqual(bytes)
    expect(calls).toHaveLength(2)
    expect(slept).toEqual([2_000])
  })

  test("a 404 cannot pass, so it is reported at once, without retries", async () => {
    const { calls, fetcher } = server([status(404)])
    await expect(download(URL_, { label: "plate 001", fetcher, sleep: async () => {} })).rejects.toThrow(
      "Could not download plate 001 from www.gutenberg.org: it is not there (HTTP 404).",
    )
    expect(calls).toHaveLength(1)
  })

  test("a failure that keeps happening ends in one sentence, after every attempt, with growing pauses", async () => {
    const { calls, fetcher } = server([status(504)])
    const slept: number[] = []
    const e = await download(URL_, { label: "plate 001", fetcher, sleep: async (ms) => void slept.push(ms) }).catch((x) => x)
    expect(e).toBeInstanceOf(DownloadError)
    expect(e.message).toBe("Could not download plate 001 from www.gutenberg.org: the server timed out (HTTP 504). Tried 4 times.")
    expect(calls).toHaveLength(4)
    expect(slept).toEqual([2_000, 6_000, 15_000])
  })

  test("Retry-After is believed, up to a minute", async () => {
    const slept: number[] = []
    const a = server([status(429, { "retry-after": "7" }), ok])
    await download(URL_, { label: "x", fetcher: a.fetcher, sleep: async (ms) => void slept.push(ms) })
    const b = server([status(503, { "retry-after": "3600" }), ok])
    await download(URL_, { label: "x", fetcher: b.fetcher, sleep: async (ms) => void slept.push(ms) })
    expect(slept).toEqual([7_000, 60_000])
  })

  test("a connection that fails is retried", async () => {
    const { calls, fetcher } = server([
      () => {
        throw new TypeError("fetch failed")
      },
      ok,
    ])
    expect(await download(URL_, { label: "x", fetcher, sleep: async () => {} })).toEqual(bytes)
    expect(calls).toHaveLength(2)
  })

  test("a transfer cut short is retried, and progress starts again from zero", async () => {
    const short = () => new Response(new Uint8Array([1, 2]), { headers: { "content-length": "5" } })
    const { calls, fetcher } = server([short, ok])
    const progress: number[] = []
    expect(await download(URL_, { label: "x", fetcher, sleep: async () => {}, onProgress: (n) => progress.push(n) })).toEqual(bytes)
    expect(calls).toHaveLength(2)
    expect(progress).toEqual([0, 2, 0, 5])
  })

  test("a server that goes silent is given up on and retried; a slow but steady one is not", async () => {
    // silent: headers, then nothing
    const silent = () =>
      new Response(new ReadableStream({ start() {} }), { headers: { "content-length": "5" } })
    const a = server([silent, ok])
    expect(await download(URL_, { label: "x", fetcher: a.fetcher, idleMs: 40, sleep: async () => {} })).toEqual(bytes)
    expect(a.calls).toHaveLength(2)
    // steady: a byte every 25ms against a 40ms idle limit, 125ms in all
    const steady = () =>
      new Response(
        new ReadableStream({
          async start(c) {
            for (const b of bytes) {
              await new Promise((r) => setTimeout(r, 25))
              c.enqueue(new Uint8Array([b]))
            }
            c.close()
          },
        }),
        { headers: { "content-length": "5" } },
      )
    const b = server([steady])
    expect(await download(URL_, { label: "x", fetcher: b.fetcher, idleMs: 40, sleep: async () => {} })).toEqual(bytes)
    expect(b.calls).toHaveLength(1)
  })

  // review of #18: Bun decompresses a gzip body but leaves Content-Length at the compressed size,
  // and raw.githubusercontent.com gzips the Bible texts (KJV: 1,458,623 sent, 8,400,187 read)
  test("a compressed answer is not mistaken for a cut-short one", async () => {
    const gz = () => new Response(bytes, { headers: { "content-length": "2", "content-encoding": "gzip" } })
    const { calls, fetcher } = server([gz])
    const progress: [number, number | undefined][] = []
    expect(await download(URL_, { label: "x", fetcher, sleep: async () => {}, onProgress: (n, t) => progress.push([n, t]) })).toEqual(bytes)
    expect(calls).toHaveLength(1)
    // the compressed length is no total for the decompressed bytes
    expect(progress.every(([, t]) => t === undefined)).toBe(true)
  })

  test("live: a real gzip-served file from GitHub downloads whole, in one try", async () => {
    const data = await download("https://raw.githubusercontent.com/hallelx2/selah/main/README.md", { label: "the README", attempts: 1 })
    expect(new TextDecoder().decode(data)).toContain("# Selah")
  }, 30_000)

  test("one attempt is reported as once", async () => {
    const { fetcher } = server([status(503)])
    await expect(download(URL_, { label: "x", fetcher, attempts: 1 })).rejects.toThrow("the server is busy (HTTP 503). Tried once.")
  })

  test("bytes that fail verification are fetched again, and the reason is in the message if they never pass", async () => {
    const { calls, fetcher } = server([ok])
    const e = await download(URL_, {
      label: "plate 001",
      fetcher,
      attempts: 2,
      sleep: async () => {},
      verify: () => {
        throw new Error("plate 001 did not match its pinned checksum")
      },
    }).catch((x) => x)
    expect(e.message).toBe("Could not download plate 001 from www.gutenberg.org: plate 001 did not match its pinned checksum. Tried 2 times.")
    expect(calls).toHaveLength(2)
  })
})
