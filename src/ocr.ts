import type { Worker } from "tesseract.js";

export async function extractImageText(
  image: string,
  signal: AbortSignal,
  onProgress: (status: string) => void,
): Promise<string> {
  let worker: Worker | undefined;
  let stopped = false;
  let rejectInterrupted: (reason: Error) => void = () => {};
  const abort = () => {
    stopped = true;
    void worker?.terminate();
    rejectInterrupted(
      new DOMException("Text extraction canceled.", "AbortError"),
    );
  };
  const interrupted = new Promise<never>((_, reject) => {
    rejectInterrupted = reject;
  });
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 90_000);
  const work = async () => {
    if (signal.aborted)
      throw new DOMException("Text extraction canceled.", "AbortError");
    onProgress("Loading text recognition…");
    const { createWorker, PSM } = await import("tesseract.js");
    if (stopped)
      throw new DOMException("Text extraction canceled.", "AbortError");
    worker = await createWorker("eng", 1, {
      logger: (message) => {
        if (!stopped)
          onProgress(
            message.status === "recognizing text"
              ? `Reading image text… ${Math.round(message.progress * 100)}%`
              : "Loading text recognition…",
          );
      },
      // A language-data failure can leave createWorker pending. Surface the
      // worker error directly so the form can offer manual input promptly.
      errorHandler: () => {
        stopped = true;
        rejectInterrupted(
          new Error("Text recognition could not load or finish."),
        );
      },
    });
    if (stopped) {
      await worker.terminate();
      throw new DOMException("Text extraction canceled.", "AbortError");
    }
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const result = await worker.recognize(image);
    return result.data.text.trim();
  };
  try {
    return await Promise.race([work(), interrupted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    stopped = true;
    void worker?.terminate();
  }
}
