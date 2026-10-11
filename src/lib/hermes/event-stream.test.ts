import { describe, expect, it } from "vitest";
import { readEventStream } from "./event-stream";

describe("readEventStream", () => {
  it("fails if the first chunk arrives after the last", async () => {
    let lastReleased = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('event: assistant.delta\ndata: {"delta":"Hi"}\n\n'));
        await new Promise((resolve) => setTimeout(resolve, 40));
        lastReleased = true;
        controller.enqueue(
          encoder.encode('event: assistant.completed\ndata: {"content":"Hi"}\n\n'),
        );
        controller.close();
      },
    });
    let firstArrivedAfterLast = true;
    await readEventStream(stream, (frame) => {
      if (frame.includes("assistant.delta")) firstArrivedAfterLast = lastReleased;
    });
    expect(firstArrivedAfterLast).toBe(false);
  });
});
