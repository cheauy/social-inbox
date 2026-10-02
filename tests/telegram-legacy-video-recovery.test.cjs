const test = require("node:test");
const assert = require("node:assert/strict");

const {
  database,
  loader,
} = require("./tenh-seven/harness.cjs");

const mp4Header = () =>
  new Uint8Array([
    0, 0, 0, 16,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
  ]);

function legacyVideo(overrides = {}) {
  return {
    id: "video1",
    business_id: "b1",
    platform_message_id: "telegram:72595:77",
    message_type: "video",
    raw_payload: {
      tenh_attachment: {
        type: "image",
        mime_type: "video/mp4",
        size: 16,
      },
    },
    ...overrides,
  };
}

function createHarness({
  message = legacyVideo(),
  signedUrlForPath,
  fetchImpl,
  businessId = "b1",
} = {}) {
  const db = database({
    messages: [message],
  });
  const signedPaths = [];
  const fetches = [];
  const load = loader({
    "next/server": {
      NextResponse: Response,
    },
    "@/lib/supabase/admin": {
      supabaseAdmin: db,
    },
    "@/lib/auth/get-current-member": {
      getCurrentMember: async () => ({
        success: true,
        member: {
          business_id: businessId,
        },
      }),
    },
    "@/lib/media/signed-urls": {
      cachedSignedUrls: async (_bucket, paths) => {
        signedPaths.push(...paths);
        const url = signedUrlForPath?.(paths[0]);
        return url
          ? [{ path: paths[0], signedUrl: url }]
          : [];
      },
    },
  }, {
    fetch: async (url, init) => {
      fetches.push({ url, init });
      return fetchImpl(url, init, fetches.length);
    },
  });

  const route = load(
    "app/api/messages/[messageId]/media/route.ts",
  );

  async function get(range) {
    const request = {
      headers: new Headers(
        range ? { Range: range } : undefined,
      ),
      nextUrl: new URL(
        "https://fixture.test/api/messages/video1/media",
      ),
    };

    return route.GET(request, {
      params: Promise.resolve({
        messageId: "video1",
      }),
    });
  }

  return {
    db,
    fetches,
    get,
    signedPaths,
  };
}

test("canonical Telegram video remains a signed redirect with no legacy lookup", async () => {
  const harness = createHarness({
    signedUrlForPath: (path) =>
      path.endsWith("/video")
        ? "https://storage.fixture/canonical-video"
        : null,
    fetchImpl: async () => {
      throw new Error("canonical redirect must not be proxied");
    },
  });

  const response = await harness.get();

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "https://storage.fixture/canonical-video",
  );
  assert.equal(harness.signedPaths.length, 1);
  assert.match(harness.signedPaths[0], /\/video$/);
  assert.equal(harness.fetches.length, 0);
});

test("exact legacy Telegram MP4 fallback validates bytes and preserves a partial range", async () => {
  const harness = createHarness({
    signedUrlForPath: (path) =>
      path.endsWith("/photo")
        ? "https://storage.fixture/legacy-photo"
        : null,
    fetchImpl: async (_url, init, call) => {
      if (call === 1) {
        assert.equal(init.headers.Range, "bytes=0-11");
        return new Response(mp4Header(), {
          status: 206,
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Length": "12",
            "Content-Range": "bytes 0-11/16",
          },
        });
      }

      assert.equal(init.headers.Range, "bytes=8-11");
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": "4",
          "Content-Range": "bytes 8-11/16",
          ETag: '"fixture-etag"',
        },
      });
    },
  });

  const response = await harness.get("bytes=8-11");

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-length"), "4");
  assert.equal(response.headers.get("content-range"), "bytes 8-11/16");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array([1, 2, 3, 4]),
  );
  assert.equal(harness.signedPaths.length, 2);
  assert.match(harness.signedPaths[0], /\/video$/);
  assert.match(harness.signedPaths[1], /\/photo$/);
  assert.equal(harness.fetches.length, 2);
});

test("legacy proxy preserves an unsatisfied range without returning object bytes", async () => {
  const harness = createHarness({
    signedUrlForPath: (path) =>
      path.endsWith("/photo")
        ? "https://storage.fixture/legacy-photo"
        : null,
    fetchImpl: async (_url, _init, call) =>
      call === 1
        ? new Response(mp4Header(), {
            status: 206,
            headers: {
              "Content-Length": "12",
              "Content-Range": "bytes 0-11/16",
            },
          })
        : new Response(null, {
            status: 416,
            headers: {
              "Content-Range": "bytes */16",
            },
          }),
  });

  const response = await harness.get("bytes=99-100");

  assert.equal(response.status, 416);
  assert.equal(response.headers.get("content-range"), "bytes */16");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test("cross-workspace request cannot sign or fetch the legacy object", async () => {
  const harness = createHarness({
    businessId: "other-business",
    signedUrlForPath: () =>
      "https://storage.fixture/should-not-sign",
    fetchImpl: async () =>
      new Response(mp4Header()),
  });

  const response = await harness.get();

  assert.equal(response.status, 404);
  assert.equal(harness.signedPaths.length, 0);
  assert.equal(harness.fetches.length, 0);
});

test("unrelated legacy photo bytes are rejected instead of being mislabeled MP4", async () => {
  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0,
    0x4a, 0x46, 0x49, 0x46,
    0, 0, 0, 0,
  ]);
  const harness = createHarness({
    signedUrlForPath: (path) =>
      path.endsWith("/photo")
        ? "https://storage.fixture/unrelated-photo"
        : null,
    fetchImpl: async () =>
      new Response(jpeg, {
        status: 206,
        headers: {
          "Content-Length": "12",
          "Content-Range": "bytes 0-11/16",
        },
      }),
  });

  const response = await harness.get();

  assert.equal(response.status, 404);
  assert.equal(harness.signedPaths.length, 2);
  assert.equal(harness.fetches.length, 1);
});

test("legacy recovery failure is bounded to canonical, exact fallback, and one validation fetch", async () => {
  const harness = createHarness({
    signedUrlForPath: (path) =>
      path.endsWith("/photo")
        ? "https://storage.fixture/unavailable-legacy"
        : null,
    fetchImpl: async () => {
      throw new Error("fixture provider failure");
    },
  });

  const response = await harness.get();

  assert.equal(response.status, 404);
  assert.equal(harness.signedPaths.length, 2);
  assert.equal(harness.fetches.length, 1);
});
